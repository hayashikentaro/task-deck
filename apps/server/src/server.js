import express from "express";
import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WebSocketServer } from "ws";
import {
  AgentState,
  AgentStateConfidence,
  AgentStateSource,
  AttentionState,
  TASK_IDENTITY_COLOR_SLOT_COUNT,
  createTask,
  isTaskVisibleInNormalList,
  markTaskChildStatusError,
  markTaskChildStatusReported,
  markTaskAttentionAcknowledged,
  markTaskAgentState,
  markTaskClosed,
  markTaskExited,
  markTaskReviewed,
  markTaskRunning,
  markTaskInputLocked,
  markTaskInputUnlocked,
  normalizeIdentityColorSlot,
  parseChildStatusReportJson,
  serializeTask,
  TaskStatus,
  inferAgentStateFromStatus,
} from "@taskdeck/core";
import {
  managerEventFilenames,
  sanitizeManagerEventId,
  validateManagerEvent,
} from "@taskdeck/core/manager-inbox";
import {
  buildCodexAppServerThreadStartParams,
  buildCodexAppServerTurnInterruptParams,
  buildCodexAppServerTurnStartParams,
  codexAppServerThreadIdFromMessage,
  isCodexAppServerAuthError,
  isRoutineCodexAppServerNotification,
  normalizeCodexAppServerModels,
  resolveCodexAppServerTaskIdForThread,
  shouldSuppressCodexAppServerAuthErrorLine,
} from "@taskdeck/core/codex-app-server";
import {
  MANAGER_READABLE_ACTIONS_FILENAME,
  MANAGER_READABLE_CAPABILITIES_FILENAME,
  MANAGER_READABLE_CONTEXT_FILENAME,
  MANAGER_READABLE_DIRNAME,
  MANAGER_READABLE_UNREAD_EVENTS_FILENAME,
  buildManagerActionGuide,
  buildManagerReadableContext,
  createManagerActionCapabilitiesDocument,
  createManagerReadableEventsDocument,
} from "@taskdeck/core/manager-readable";
import {
  buildTaskDeckDecisionRequest,
  normalizeDecisionGatewayUrl,
} from "@taskdeck/core/decision-gateway";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const webRoot = path.join(repoRoot, "apps/web");
const webDist = path.join(webRoot, "dist");
const dataRoot = path.join(repoRoot, ".taskdeck");
const taskStorePath = path.join(dataRoot, "tasks.json");
const presetStorePath = path.join(dataRoot, "presets.json");
const sessionLabelStorePath = path.join(dataRoot, "session-labels.json");
const logRoot = path.join(dataRoot, "logs");
const attachmentRoot = path.join(dataRoot, "attachments");
const pendingAttachmentRoot = path.join(attachmentRoot, "pending");
const managerInboxRoot = path.join(dataRoot, "manager-inbox");
const managerReadableRoot = path.join(dataRoot, MANAGER_READABLE_DIRNAME);
const managerReadableContextPath = path.join(managerReadableRoot, MANAGER_READABLE_CONTEXT_FILENAME);
const managerReadableUnreadEventsPath = path.join(managerReadableRoot, MANAGER_READABLE_UNREAD_EVENTS_FILENAME);
const managerReadableActionsPath = path.join(managerReadableRoot, MANAGER_READABLE_ACTIONS_FILENAME);
const managerReadableCapabilitiesPath = path.join(managerReadableRoot, MANAGER_READABLE_CAPABILITIES_FILENAME);
const managerActionRunRoot = path.join(dataRoot, "run");
const managerActionDefaultSocketPath = path.join(managerActionRunRoot, "manager-actions.sock");
const managerActionSocketPointerPath = path.join(managerActionRunRoot, "manager-actions.json");
const managerActionTcpHost = process.env.TASKDECK_MANAGER_ACTION_HOST || "127.0.0.1";
const managerActionContainerHost = process.env.TASKDECK_MANAGER_ACTION_CONTAINER_HOST || "host.docker.internal";
const managerActionLogRoot = path.join(dataRoot, "manager-actions");
const managerActionHistoryPath = path.join(managerActionLogRoot, "history.json");
const defaultConfigPath = path.join(repoRoot, "taskdeck.config.json");
const localConfigPath = path.join(repoRoot, "taskdeck.local.json");
const envConfigPath = process.env.TASKDECK_CONFIG ? path.resolve(process.env.TASKDECK_CONFIG) : "";
const managerAgentProfileId = "taskdeck-manager";
const codexAppServerAgentProfileId = "codex-app-server";
const codexAppServerAgentSessionProvider = codexAppServerAgentProfileId;
const codexAppServerThreadSessionSource = "codex_app_server_thread";
const codexAppServerNativeSubagentSessionSource = "codex_app_server_native_subagent";
const codexAppServerSharedRuntimeId = "codex-app-server-shared-runtime";
const codexAppServerCommand = "codex --sandbox danger-full-access --ask-for-approval never app-server --listen stdio://";
const codexAppServerOnlyTaskError =
  "TaskDeck now only starts Codex App Server tasks while the App Server thread model is being rebuilt.";
const defaultAgentProfiles = [
  {
    id: codexAppServerAgentProfileId,
    label: "Codex App Server",
    command: codexAppServerCommand,
    description: "Run the primary Codex App Server adapter in the TaskDeck server environment",
  },
];

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const shell = process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "bash");
const inputDebugEnabled = process.env.TASKDECK_INPUT_DEBUG === "1";
const codexAppServerDebugEnabled = process.env.TASKDECK_CODEX_APP_SERVER_DEBUG === "1";
const decisionGatewayUrl = normalizeDecisionGatewayUrl(process.env.DECISION_GATEWAY_URL);
const decisionGatewayRequestTimeoutMs = 10_000;

const clients = new Set();
const tasks = new Map();
const logs = new Map();
const taskLogWriteQueues = new Map();
const taskOutputSequences = new Map();
const sessionLabels = new Map();
let presets = [];
let outputSequence = 0;
const maxLogLength = 250_000;
const childStatusPollIntervalMs = 2000;
const defaultContainerWorkspaceRoot = "/workspace";
const protectedContainerCleanupPids = new Set(["1", "7", "8", "130"]);
const imageAttachmentMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const imageAttachmentExtensions = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);
const activeCodexRuntimes = new Map();
const activeCodexThreadSessions = new Map();
const taskIdByCodexThreadId = new Map();
const processedManagerActionIds = new Set();
const childStatusFileSnapshots = new Map();
let managerActionSocketPath = managerActionDefaultSocketPath;
let managerActionTcpPort = 0;
let managerActionTcpToken = "";
let persistTasksQueue = Promise.resolve();
let persistPresetsQueue = Promise.resolve();
let persistSessionLabelsQueue = Promise.resolve();
let childStatusPollInFlight = false;
let codexModels = [];

const managerActionTypes = new Set(["ack", "review", "close"]);

app.use(express.json());

function createProcessEnvForChild() {
  const env = { ...process.env };
  delete env._VOLTA_TOOL_RECURSION;
  return env;
}

app.get("/api/context", async (_request, response) => {
  const projectRoots = await buildProjectRoots();
  const projectSuggestions = await buildProjectSuggestions(projectRoots);
  const defaultProjectRoot = projectRoots[0] || repoRoot;
  const controlRoot = await taskDeckControlRootCwd();
  response.json({
    repoRoot,
    controlRoot,
    dataRoot,
    projectRoot: defaultProjectRoot,
    defaultCwd: selectDefaultProjectCwd(projectSuggestions, defaultProjectRoot),
    serverCwd: process.cwd(),
    shell,
    pathSeparator: path.sep,
    isGitRepo: await cwdIsGitRepo(repoRoot),
    cwdSuggestions: await buildCwdSuggestions(),
    projectRoots,
    projectSuggestions,
    defaultModel: await loadDefaultModel(),
    agentProfiles: await loadAgentProfiles(),
    agentProfileConfig: await getAgentProfileConfigSummary(),
    decisionGateway: {
      configured: Boolean(decisionGatewayUrl),
      url: decisionGatewayUrl,
    },
  });
});

app.get("/api/diagnostics", async (_request, response) => {
  response.json(await buildDiagnostics());
});

app.post("/api/diagnostics/containers/:containerName/start", async (request, response) => {
  response.json(await startDiagnosticContainer(request.params.containerName));
});

app.post("/api/validate-cwd", async (request, response) => {
  response.json(await validateCwd(String(request.body?.cwd || "")));
});

app.post("/api/attachments", express.raw({ type: Array.from(imageAttachmentMimeTypes), limit: "12mb" }), async (request, response) => {
  try {
    const mimeType = normalizeImageMimeType(request.headers["content-type"]);
    if (!mimeType) {
      response.status(415).json({ error: "Unsupported image type." });
      return;
    }

    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      response.status(400).json({ error: "Attachment body is required." });
      return;
    }

    const id = randomUUID();
    const filename = sanitizeAttachmentFilename(decodeHeaderValue(request.headers["x-taskdeck-filename"]) || "image", mimeType);
    const extension = imageAttachmentExtensions.get(mimeType) || path.extname(filename) || ".img";
    const storedFilename = `${id}${extension}`;
    const createdAt = new Date().toISOString();
    const filePath = path.join(pendingAttachmentRoot, storedFilename);
    const metadataPath = path.join(pendingAttachmentRoot, `${id}.json`);

    await fs.mkdir(pendingAttachmentRoot, { recursive: true });
    await fs.writeFile(filePath, request.body);
    const attachment = {
      id,
      type: "image",
      filename,
      path: filePath,
      mimeType,
      size: request.body.length,
      createdAt,
    };
    await fs.writeFile(metadataPath, `${JSON.stringify({ ...attachment, storedFilename }, null, 2)}\n`);

    response.json({ attachment: { ...attachment, pending: true } });
  } catch (error) {
    console.error(`TaskDeck attachment upload failed: ${error.message}`);
    response.status(500).json({ error: "Unable to upload image." });
  }
});

app.use("/api/attachments", (error, _request, response, next) => {
  if (error?.type === "entity.too.large" || error?.name === "PayloadTooLargeError") {
    response.status(413).json({ error: "Attachment upload failed: payload too large." });
    return;
  }
  next(error);
});

app.get("/api/tasks", (_request, response) => {
  response.json({
    tasks: listTasks(),
    runningTaskId: getPrimaryRunningTaskId(),
    runningTaskIds: getRunningTaskIds(),
    codexModels,
  });
});

app.patch("/api/tasks/:taskId/title", async (request, response) => {
  const { taskId } = request.params;
  const task = tasks.get(taskId);
  const title = String(request.body?.title || "").trim();

  if (!task) {
    response.status(404).json({ error: "Task not found." });
    return;
  }

  if (!title) {
    response.status(400).json({ error: "TaskDeck display name is required." });
    return;
  }

  await renameTaskDeckDisplayName(task, title);
  broadcastTasks();

  response.json({
    ok: true,
    task: serializeTaskForClient(tasks.get(taskId)),
    tasks: listTasks(),
  });
});

app.patch("/api/tasks/:taskId/attention/acknowledge", async (request, response) => {
  const { taskId } = request.params;
  const task = tasks.get(taskId);

  if (!task) {
    response.status(404).json({ error: "Task not found." });
    return;
  }

  if (task.status !== TaskStatus.RUNNING) {
    response.status(409).json({ error: "Only running tasks can acknowledge attention." });
    return;
  }

  if (!task.attentionState || task.attentionState === AttentionState.NONE) {
    response.status(409).json({ error: "Task does not currently need attention." });
    return;
  }

  setTask(markTaskAttentionAcknowledged(task));
  await persistTasks();
  broadcastTasks();

  response.json({
    ok: true,
    task: serializeTaskForClient(tasks.get(taskId)),
    tasks: listTasks(),
    runningTaskId: getPrimaryRunningTaskId(),
    runningTaskIds: getRunningTaskIds(),
  });
});

app.patch("/api/tasks/:taskId/input-lock", async (request, response) => {
  const { taskId } = request.params;
  const task = tasks.get(taskId);
  const locked = Boolean(request.body?.locked);

  if (!task) {
    response.status(404).json({ error: "Task not found." });
    return;
  }

  if (task.status !== TaskStatus.RUNNING) {
    response.status(409).json({ error: "Only running tasks can toggle input lock." });
    return;
  }
  if (isCodexAppServerNativeSubagentTask(task)) {
    response.status(409).json({ error: "Native subagent cards are read-only." });
    return;
  }

  setTask(locked ? markTaskInputLocked(task) : markTaskInputUnlocked(task));
  await persistTasks();
  broadcastTasks();

  response.json({
    ok: true,
    task: serializeTaskForClient(tasks.get(taskId)),
    tasks: listTasks(),
    runningTaskId: getPrimaryRunningTaskId(),
    runningTaskIds: getRunningTaskIds(),
  });
});

app.delete("/api/tasks", async (_request, response) => {
  const taskIdsToClear = Array.from(tasks.keys());

  for (const taskId of taskIdsToClear) {
    await stopTaskProcesses(taskId);
    await clearTask(taskId);
  }

  await persistTasks();
  broadcastTasks();

  response.json({
    ok: true,
    clearedTaskIds: taskIdsToClear,
    tasks: listTasks(),
    runningTaskId: getPrimaryRunningTaskId(),
    runningTaskIds: getRunningTaskIds(),
  });
});

app.delete("/api/tasks/:taskId", async (request, response) => {
  const { taskId } = request.params;
  const task = tasks.get(taskId);

  if (!task) {
    response.status(404).json({ error: "Task not found." });
    return;
  }

  await stopTaskProcesses(taskId);

  await clearTask(taskId);
  await persistTasks();
  broadcastTasks();

  response.json({
    ok: true,
    clearedTaskId: taskId,
    tasks: listTasks(),
    runningTaskId: getPrimaryRunningTaskId(),
    runningTaskIds: getRunningTaskIds(),
  });
});

app.get("/api/presets", (_request, response) => {
  response.json({ presets });
});

app.delete("/api/presets", async (_request, response) => {
  presets = [];
  await persistPresets();
  broadcastPresets();
  response.json({ ok: true, presets });
});

app.get("/api/tasks/:taskId", (request, response) => {
  const task = tasks.get(request.params.taskId);

  if (!task) {
    response.status(404).json({ error: "Task not found." });
    return;
  }

  response.json({ task: serializeTaskForClient(task) });
});

app.get("/api/tasks/:taskId/logs", (request, response) => {
  if (!tasks.has(request.params.taskId)) {
    response.status(404).json({ error: "Task not found." });
    return;
  }

  readTaskLog(request.params.taskId)
    .then((taskLog) => {
      const tailLength = normalizeTailLength(request.query.tail);
      const logsForResponse = tailLength === null ? taskLog : taskLog.slice(-tailLength);
      response.json({
        taskId: request.params.taskId,
        logs: logsForResponse,
        truncated: logsForResponse.length < taskLog.length,
        outputSeq: outputSequence,
        taskSeq: outputSequenceForTask(request.params.taskId),
      });
    })
    .catch((error) => {
      response.status(500).json({
        taskId: request.params.taskId,
        logs: "",
        error: error.message,
      });
    });
});

app.post("/api/tasks/:taskId/decision-request", async (request, response) => {
  const task = tasks.get(request.params.taskId);

  if (!task) {
    response.status(404).json({ error: "Task not found." });
    return;
  }

  if (!decisionGatewayUrl) {
    response.status(400).json({
      error: "Decision Gateway is not configured. Set DECISION_GATEWAY_URL to enable this action.",
    });
    return;
  }

  try {
    const recentOutput = await readTaskLogTail(task.id, 4000);
    const decisionRequest = buildTaskDeckDecisionRequest({
      task: {
        ...task,
        sessionLabel: taskSessionLabel(task),
      },
      recentOutput,
    });
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), decisionGatewayRequestTimeoutMs);
    let gatewayResponse;
    try {
      gatewayResponse = await fetch(`${decisionGatewayUrl}/api/decision-requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(decisionRequest),
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const payload = await gatewayResponse.json().catch(() => ({}));

    if (!gatewayResponse.ok) {
      response.status(502).json({
        error: payload?.error || `Decision Gateway request failed with status ${gatewayResponse.status}.`,
      });
      return;
    }

    response.json({
      ok: true,
      decisionUrl: String(payload?.url || ""),
      decisionId: String(payload?.id || ""),
      requestId: String(payload?.requestId || ""),
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    response.status(timedOut ? 504 : 502).json({
      error: timedOut
        ? `Decision Gateway request timed out after ${decisionGatewayRequestTimeoutMs / 1000} seconds.`
        : `Unable to send decision request: ${error.message}`,
    });
  }
});

function normalizeTailLength(rawTail) {
  if (rawTail === undefined) {
    return null;
  }

  const tailLength = Number(rawTail);
  if (!Number.isFinite(tailLength) || tailLength <= 0) {
    return null;
  }

  return Math.min(Math.floor(tailLength), maxLogLength);
}

function normalizeBoolean(value) {
  return value === true || String(value || "").toLowerCase() === "true";
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

app.get("/api/tasks/:taskId/diff", async (request, response) => {
  const task = tasks.get(request.params.taskId);

  if (!task) {
    response.status(404).json({ error: "Task not found." });
    return;
  }

  try {
    const isGitRepo = await cwdIsGitRepo(task.cwd);
    if (!isGitRepo) {
      response.json({
        taskId: task.id,
        cwd: task.cwd,
        ok: false,
        isGitRepo: false,
        diff: "",
        message: "Not a git repository",
      });
      return;
    }

    const { stdout } = await execFileAsync("git", ["-C", task.cwd, "diff", "--"], {
      maxBuffer: 2 * 1024 * 1024,
    });
    response.json({
      taskId: task.id,
      cwd: task.cwd,
      ok: true,
      isGitRepo: true,
      diff: stdout,
    });
  } catch (error) {
    response.status(500).json({
      taskId: task.id,
      cwd: task.cwd,
      ok: false,
      isGitRepo: false,
      diff: "",
      error: error.message,
    });
  }
});

wss.on("connection", (socket) => {
  clients.add(socket);
  send(socket, {
    type: "snapshot",
    tasks: listTasks(),
    presets,
    runningTaskId: getPrimaryRunningTaskId(),
    runningTaskIds: getRunningTaskIds(),
    codexModels,
    outputSeq: outputSequence,
  });

  socket.on("message", (rawMessage) => {
    let message;

    try {
      message = JSON.parse(rawMessage.toString());
    } catch {
      send(socket, { type: "error", message: "Invalid client message." });
      return;
    }

    if (message.type === "start") {
      startTask(
        {
          title: String(message.title || "").trim(),
          command: String(message.command || "").trim(),
          cwd: String(message.cwd || "").trim(),
          agentProfileId: String(message.agentProfileId || "").trim(),
          agentLabel: String(message.agentLabel || "").trim(),
          agentModel: String(message.agentModel || "").trim(),
          sessionMode: String(message.sessionMode || "").trim(),
          resumeCommand: String(message.resumeCommand || "").trim(),
          agentSessionProvider: String(message.agentSessionProvider || "").trim(),
          agentSessionId: String(message.agentSessionId || "").trim(),
          agentSessionSource: String(message.agentSessionSource || "").trim(),
          agentSessionDetectedAt: String(message.agentSessionDetectedAt || "").trim(),
          agentSessionResumeCommand: String(message.agentSessionResumeCommand || "").trim(),
          initialInstruction: String(message.initialInstruction || "").trim(),
          attachments: normalizePendingAttachmentRefs(message.attachments),
        },
        socket,
      );
      return;
    }

    if (message.type === "input") {
      const taskId = String(message.taskId || "").trim();
      const inputResult = sendTaskInput(taskId, message.data, message.source || "client", {
        agentModel: String(message.agentModel || "").trim(),
        agentReasoningEffort: String(message.agentReasoningEffort || "").trim(),
      });
      if (!inputResult.ok) {
        if (inputResult.reason === "input-locked") {
          send(socket, { type: "error", message: "Input is locked for this task." });
        }
        if (inputDebugEnabled) {
          console.log(`[TaskDeck input] ignored task=${taskId || "-"} reason=${inputResult.reason}`);
        }
      }
      return;
    }

    if (message.type === "codex-app-server-request") {
      const taskId = String(message.taskId || "").trim();
      const requestId = normalizeCodexAppServerRequestId(message.requestId);
      const action = String(message.action || "").trim();
      const result = resolveCodexAppServerRequest(taskId, requestId, action);
      if (!result.ok) {
        send(socket, { type: "error", message: result.error || "Unable to resolve Codex App Server request." });
      }
      return;
    }

    if (message.type === "codex-app-server-interrupt-turn") {
      const taskId = String(message.taskId || "").trim();
      const result = interruptCodexAppServerTurn(taskId);
      if (!result.ok) {
        send(socket, { type: "error", message: result.error || "Unable to stop Codex App Server turn." });
      }
      return;
    }

    send(socket, { type: "error", message: `Unsupported message type: ${message.type}` });
  });

  socket.on("close", () => {
    clients.delete(socket);
  });
});

await initializePersistence();
await scanChildStatusFiles();
await refreshManagerReadableFiles();
await startManagerActionSocket();
await configureWebApp();

server.on("error", (error) => {
  console.error(`TaskDeck failed to listen on ${host}:${port}`);
  console.error(error);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`TaskDeck listening on http://${host}:${port}`);
});

const childStatusTimer = setInterval(scanChildStatusFiles, childStatusPollIntervalMs);
childStatusTimer.unref?.();

function buildUniqueNewSessionTitle(title, sessionMode) {
  const normalizedTitle = String(title || "").trim();
  if (sessionMode !== "new" || !normalizedTitle) {
    return normalizedTitle;
  }

  const existingTitles = new Set(Array.from(tasks.values()).map((task) => String(task.title || "")));
  if (!existingTitles.has(normalizedTitle)) {
    return normalizedTitle;
  }

  let index = 2;
  let candidate = `${normalizedTitle} (${index})`;
  while (existingTitles.has(candidate)) {
    index += 1;
    candidate = `${normalizedTitle} (${index})`;
  }
  return candidate;
}

async function startTask(startInput, socket) {
  const { command, agentProfileId } = startInput;

  if (!command) {
    send(socket, { type: "error", message: "Enter a command before starting a task." });
    return;
  }

  if (!isCodexAppServerAgentProfileId(agentProfileId)) {
    send(socket, { type: "error", message: codexAppServerOnlyTaskError });
    return;
  }

  await startTaskNow(startInput, socket);
}

async function startTaskNow({
  title,
  command,
  cwd,
  agentProfileId,
  agentLabel,
  agentModel,
  sessionMode,
  resumeCommand,
  agentSessionProvider,
  agentSessionId,
  agentSessionSource,
  agentSessionDetectedAt,
  agentSessionResumeCommand,
  initialInstruction,
  attachments = [],
}, socket) {
  if (!isCodexAppServerAgentProfileId(agentProfileId)) {
    send(socket, { type: "error", message: codexAppServerOnlyTaskError });
    return { ok: false, error: codexAppServerOnlyTaskError };
  }

  const isManagerLaunch = isManagerAgentProfileId(agentProfileId);
  const launchCwd = await cwdForTaskLaunch({ cwd, isManagerLaunch });
  const cwdValidation = await validateCwd(launchCwd);
  if (!cwdValidation.ok) {
    send(socket, { type: "error", message: cwdValidation.message });
    return { ok: false, error: cwdValidation.message };
  }

  const resolvedCwd = cwdValidation.resolvedCwd;
  const effectiveCommand = await commandForTaskCwd(command, resolvedCwd);
  const resolvedAgentModel = agentModel || modelFromCommand(effectiveCommand) || await loadDefaultModel();
  const launchInitialInstruction = await initialInstructionForTaskLaunch({
    isManagerLaunch,
    command: effectiveCommand,
    initialInstruction,
  });
  const explicitAgentSession = normalizeExplicitAgentSession({
    agentSessionProvider,
    agentSessionId,
    agentSessionSource,
    agentSessionDetectedAt,
    agentSessionResumeCommand,
  });
  const taskTitle = buildUniqueNewSessionTitle(title, sessionMode);
  const identityColorSlot = assignTaskIdentityColorSlot();
  const baseTask = createTask({
    title: taskTitle,
    command: effectiveCommand,
    cwd: resolvedCwd,
    agentProfileId,
    agentLabel,
    agentModel: resolvedAgentModel,
    sessionMode,
    resumeCommand,
    identityColorSlot,
    initialInstruction: launchInitialInstruction,
    isManager: isManagerLaunch,
    ...explicitAgentSession,
  });
  const childStatusFile = await ensureChildStatusFilePath(baseTask);
  const finalizedAttachments = await finalizePendingAttachments(attachments, baseTask.id);

  const task = markTaskRunning({
    ...baseTask,
    childStatusFile,
    attachments: finalizedAttachments,
  });
  tasks.set(task.id, task);
  logs.set(task.id, "");
  taskOutputSequences.set(task.id, 0);
  persistTasks();
  savePreset({
    title: task.title,
    command: task.command,
    cwd: task.cwd,
  });
  writeTaskLog(task.id, "");

  return startCodexAppServerThreadSession({ task, launchCommand: effectiveCommand, socket });
}

async function cwdForTaskLaunch({ cwd, isManagerLaunch }) {
  if (isManagerLaunch) {
    return taskDeckControlRootCwd();
  }
  return cwd;
}

async function taskDeckControlRootCwd() {
  const projectRoots = await resolveProjectRoots();
  return path.resolve(projectRoots[0] || path.dirname(repoRoot));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assignTaskIdentityColorSlot() {
  const slotUseCounts = Array.from({ length: TASK_IDENTITY_COLOR_SLOT_COUNT }, () => 0);

  for (const task of tasks.values()) {
    const slot = normalizeIdentityColorSlot(task.identityColorSlot);
    if (slot === undefined) {
      continue;
    }
    slotUseCounts[slot % TASK_IDENTITY_COLOR_SLOT_COUNT] += 1;
  }

  let selectedSlot = 0;
  for (let slot = 1; slot < slotUseCounts.length; slot += 1) {
    if (slotUseCounts[slot] < slotUseCounts[selectedSlot]) {
      selectedSlot = slot;
    }
  }

  return selectedSlot;
}

function sendTaskInput(taskId, data, source = "client", turnSelection = {}) {
  const normalizedTaskId = String(taskId || "").trim();
  if (activeCodexThreadSessions.has(normalizedTaskId)) {
    return sendTaskInputToCodexAppServer(normalizedTaskId, data, source, turnSelection);
  }
  return { ok: false, reason: "no-active-app-server-or-invalid-data" };
}

async function startCodexAppServerThreadSession({ task, launchCommand, socket }) {
  const command = String(launchCommand || task.command || "").trim();
  if (!command) {
    appendAndBroadcast(task.id, "\r\n[TaskDeck] Failed to start Codex App Server: empty launch command.\r\n", {
      role: "taskdeck",
      kind: "status",
    });
    setTask(markTaskExited(tasks.get(task.id), { exitCode: 1, signal: null }));
    broadcastTasks();
    return { ok: true, taskId: task.id };
  }

  const activeRuntime = startOrReuseCodexAppServerRuntime({ launchCommand: command, task });
  const activeAppServer = createActiveCodexThreadSession(task, activeRuntime);
  activeRuntime.threadSessionTaskIds.add(task.id);
  activeCodexThreadSessions.set(task.id, activeAppServer);

  updateAgentStateFromTaskDeckEvent(task.id, AgentState.THINKING, {
    reason: "Codex App Server thread session is starting.",
    source: AgentStateSource.TASKDECK_EVENT,
    confidence: AgentStateConfidence.MEDIUM,
    attentionState: AttentionState.NONE,
    attentionReason: "Codex App Server thread session is starting.",
    attentionSource: AgentStateSource.TASKDECK_EVENT,
    attentionConfidence: AgentStateConfidence.HIGH,
  });
  send(socket, { type: "started", taskId: task.id });
  appendAndBroadcast(
    task.id,
    activeRuntime.initialized
      ? "[TaskDeck] Reusing shared Codex App Server runtime; starting thread session.\n"
      : "[TaskDeck] Starting shared Codex App Server runtime and thread session.\n",
    { role: "taskdeck", kind: "status" },
  );

  if (activeRuntime.initialized) {
    sendCodexAppServerThreadStart(activeAppServer);
  } else {
    activeRuntime.pendingThreadStartTaskIds.add(task.id);
    if (!activeRuntime.initializeRequested) {
      activeRuntime.initializeRequested = true;
      sendCodexAppServerInitialize(activeAppServer);
    }
  }
  return { ok: true, taskId: task.id };
}

function startOrReuseCodexAppServerRuntime({ launchCommand, task }) {
  const activeRuntime = activeCodexRuntimes.get(codexAppServerSharedRuntimeId);
  if (codexRuntimeIsWritable(activeRuntime)) {
    activeRuntime.defaultTaskId = activeRuntime.defaultTaskId || task.id;
    return activeRuntime;
  }

  if (activeRuntime) {
    finishCodexAppServerRuntime(activeRuntime, {
      exitCode: 1,
      signal: null,
      statusMessage: "[TaskDeck] Replacing unavailable Codex App Server runtime.",
    });
    try {
      activeRuntime.process?.kill();
    } catch {
      // The previous runtime is already unavailable.
    }
  }

  const runtimeProcess = spawn(shell, ["-lc", launchCommand], {
    cwd: repoRoot,
    env: createProcessEnvForChild(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const nextRuntime = createActiveCodexRuntime({
    runtimeId: codexAppServerSharedRuntimeId,
    runtimeProcess,
    launchCommand,
    defaultTaskId: task.id,
  });
  activeCodexRuntimes.set(nextRuntime.id, nextRuntime);
  codexModels = [];
  broadcast({ type: "codex-models", models: codexModels });

  runtimeProcess.stdout.setEncoding("utf8");
  runtimeProcess.stderr.setEncoding("utf8");
  runtimeProcess.stdout.on("data", (data) => {
    handleCodexAppServerOutput(nextRuntime, data, "stdout");
  });
  runtimeProcess.stderr.on("data", (data) => {
    handleCodexAppServerOutput(nextRuntime, data, "stderr");
  });
  runtimeProcess.on("error", (error) => {
    handleCodexAppServerRuntimeError(nextRuntime, error);
  });
  runtimeProcess.on("exit", (exitCode, signal) => {
    handleCodexAppServerRuntimeExit(nextRuntime, { exitCode, signal });
  });

  return nextRuntime;
}

function codexRuntimeIsWritable(activeRuntime) {
  return Boolean(activeRuntime?.process?.stdin?.writable && !activeRuntime.process.stdin.destroyed);
}

function createActiveCodexRuntime({ runtimeId, runtimeProcess, launchCommand, defaultTaskId }) {
  return {
    id: runtimeId,
    instanceId: randomUUID(),
    process: runtimeProcess,
    launchCommand,
    defaultTaskId,
    startedAt: Date.now(),
    nextRequestId: 1,
    pendingRequests: new Map(),
    pendingThreadStartTaskIds: new Set(),
    threadSessionTaskIds: new Set(),
    stdoutBuffer: "",
    stderrBuffer: "",
    initialized: false,
    initializeRequested: false,
    accountReady: false,
    accountReadInFlight: false,
    authFailureDetected: false,
    loginInProgress: false,
    loginId: "",
    loginCompletedAt: 0,
    forcedAccountRefreshAttempted: false,
    modelListRequested: false,
    modelCatalog: [],
  };
}

function handleCodexAppServerRuntimeError(activeRuntime, error) {
  finishCodexAppServerRuntime(activeRuntime, {
    exitCode: 1,
    signal: null,
    statusMessage: `[TaskDeck] Codex App Server runtime error: ${error.message}`,
  });
}

function handleCodexAppServerRuntimeExit(activeRuntime, { exitCode, signal }) {
  finishCodexAppServerRuntime(activeRuntime, {
    exitCode,
    signal,
    statusMessage: `[TaskDeck] Codex App Server runtime exited${exitCode === null ? "" : ` with code ${exitCode}`}${signal ? ` signal ${signal}` : ""}.`,
  });
}

function finishCodexAppServerRuntime(activeRuntime, { exitCode, signal, statusMessage }) {
  if (!activeRuntime) {
    return;
  }

  const threadSessions = codexThreadSessionsForRuntime(activeRuntime);
  const affectedTaskIds = new Set([
    ...Array.from(activeRuntime.threadSessionTaskIds || []),
    ...threadSessions.map((threadSession) => threadSession.taskId),
  ]);
  activeRuntime.pendingRequests?.clear();
  activeRuntime.pendingThreadStartTaskIds?.clear();

  for (const threadSession of threadSessions) {
    clearCodexThreadSession(threadSession);
  }
  if (activeCodexRuntimes.get(activeRuntime.id) === activeRuntime) {
    activeCodexRuntimes.delete(activeRuntime.id);
  }
  activeRuntime.threadSessionTaskIds?.clear();

  let didChangeTasks = false;
  for (const taskId of affectedTaskIds) {
    const task = tasks.get(taskId);
    if (!task) {
      continue;
    }
    appendAndBroadcast(taskId, `${statusMessage}\n`, { role: "taskdeck", kind: "status" });
    if (task.status !== TaskStatus.RUNNING) {
      continue;
    }
    setTask(markTaskExited(task, { exitCode, signal }));
    didChangeTasks = true;
  }
  if (didChangeTasks) {
    broadcastTasks();
  }
}

function createActiveCodexThreadSession(task, activeRuntime) {
  return {
    taskId: task.id,
    runtimeId: activeRuntime.id,
    runtimeInstanceId: activeRuntime.instanceId,
    pendingServerRequests: new Map(),
    currentServerRequestId: null,
    threadId: "",
    threadStartRequested: false,
    activeTurnId: "",
    turnActive: false,
    assistantMessageOpen: false,
    assistantMessageOpenTaskIds: new Set(),
    pendingAuthRetry: null,
    tokenUsage: null,
    rateLimits: null,
    pendingInputs: [],
    nativeSubagentTaskIdsByThreadId: new Map(),
  };
}

function codexRuntimeForThreadSession(activeAppServer) {
  const activeRuntime = activeCodexRuntimes.get(activeAppServer?.runtimeId) ?? null;
  if (!activeRuntime) {
    return null;
  }
  const sessionRuntimeInstanceId = String(activeAppServer?.runtimeInstanceId || "").trim();
  if (sessionRuntimeInstanceId && sessionRuntimeInstanceId !== activeRuntime.instanceId) {
    return null;
  }
  return activeRuntime;
}

function codexRuntimeStateForThreadSession(activeAppServer) {
  return codexRuntimeForThreadSession(activeAppServer) || activeAppServer;
}

function codexThreadSessionsForRuntime(activeRuntime) {
  const runtimeId = String(activeRuntime?.id || "").trim();
  if (!runtimeId) {
    return [];
  }
  const runtimeInstanceId = String(activeRuntime?.instanceId || "").trim();
  return Array.from(activeCodexThreadSessions.values()).filter((activeAppServer) => {
    if (activeAppServer.runtimeId !== runtimeId) {
      return false;
    }
    return !runtimeInstanceId || activeAppServer.runtimeInstanceId === runtimeInstanceId;
  });
}

function clearCodexThreadSession(activeAppServer) {
  if (!activeAppServer) {
    return;
  }

  activeCodexThreadSessions.delete(activeAppServer.taskId);
  if (activeAppServer.threadId) {
    taskIdByCodexThreadId.delete(activeAppServer.threadId);
  }
  for (const threadId of activeAppServer.nativeSubagentTaskIdsByThreadId.keys()) {
    taskIdByCodexThreadId.delete(threadId);
  }

  const activeRuntime = codexRuntimeForThreadSession(activeAppServer);
  activeRuntime?.threadSessionTaskIds.delete(activeAppServer.taskId);
  activeRuntime?.pendingThreadStartTaskIds.delete(activeAppServer.taskId);
}

function recordCodexAppServerThreadSession(activeAppServer, threadId) {
  const normalizedThreadId = String(threadId || "").trim();
  if (!normalizedThreadId) {
    return false;
  }

  if (activeAppServer.threadId && activeAppServer.threadId !== normalizedThreadId) {
    taskIdByCodexThreadId.delete(activeAppServer.threadId);
  }
  activeAppServer.threadId = normalizedThreadId;
  taskIdByCodexThreadId.set(normalizedThreadId, activeAppServer.taskId);

  const activeRuntime = codexRuntimeForThreadSession(activeAppServer);
  activeRuntime?.threadSessionTaskIds.add(activeAppServer.taskId);

  const task = tasks.get(activeAppServer.taskId);
  if (!task) {
    return false;
  }

  const alreadyRecorded =
    task.agentSessionProvider === codexAppServerAgentSessionProvider &&
    task.agentSessionId === normalizedThreadId &&
    task.agentSessionSource === codexAppServerThreadSessionSource;
  if (alreadyRecorded) {
    return false;
  }

  const now = new Date().toISOString();
  setTask({
    ...task,
    agentSessionProvider: codexAppServerAgentSessionProvider,
    agentSessionId: normalizedThreadId,
    agentSessionSource: codexAppServerThreadSessionSource,
    agentSessionDetectedAt:
      task.agentSessionId === normalizedThreadId && task.agentSessionDetectedAt
        ? task.agentSessionDetectedAt
        : now,
    updatedAt: now,
  });
  return true;
}

function sendTaskInputToCodexAppServer(taskId, data, source = "client", turnSelection = {}) {
  const task = tasks.get(taskId);
  const activeAppServer = activeCodexThreadSessions.get(taskId);
  if (task?.inputLockedAt || task?.terminalInputLockedAt) {
    return { ok: false, reason: "input-locked" };
  }
  if (!activeAppServer || typeof data !== "string") {
    return { ok: false, reason: "no-active-app-server-or-invalid-data" };
  }

  const text = normalizeCodexAppServerInput(data);
  if (!text) {
    return { ok: false, reason: "empty-input" };
  }
  if (codexRuntimeStateForThreadSession(activeAppServer).authFailureDetected) {
    handleCodexAppServerAuthFailureDiagnostic(
      activeAppServer,
      "User input was blocked because Codex App Server authentication has already failed."
    );
    return { ok: false, reason: "codex-app-server-auth-failed" };
  }

  const turnInput = buildCodexTurnInput(task, text, turnSelection);
  updateTaskCodexTurnSelection(task, turnInput);

  logInputDebug(taskId, data, source);
  updateAgentStateFromTaskDeckEvent(taskId, AgentState.WORKING, {
    reason: "User input was sent to Codex App Server.",
    source: AgentStateSource.TASKDECK_EVENT,
    confidence: AgentStateConfidence.HIGH,
    attentionState: AttentionState.NONE,
    attentionReason: "User input was sent to Codex App Server.",
    attentionSource: AgentStateSource.TASKDECK_EVENT,
    attentionConfidence: AgentStateConfidence.HIGH,
  });
  appendCodexAppServerUserInput(activeAppServer, text);

  if (!activeAppServer.threadId) {
    activeAppServer.pendingInputs.push(turnInput);
    appendAndBroadcast(taskId, "[TaskDeck] Queued input until Codex App Server thread is ready.\n", {
      role: "taskdeck",
      kind: "status",
    });
    return { ok: true };
  }

  sendCodexAppServerTurn(activeAppServer, turnInput);
  return { ok: true };
}

function interruptCodexAppServerTurn(taskId) {
  const task = tasks.get(taskId);
  if (!task) {
    return { ok: false, error: "Task not found." };
  }
  if (task.status !== TaskStatus.RUNNING) {
    return { ok: false, error: "Only running tasks can be stopped." };
  }
  if (isCodexAppServerNativeSubagentTask(task)) {
    return { ok: false, error: "Native subagent cards are read-only." };
  }

  const activeAppServer = activeCodexThreadSessions.get(taskId);
  if (!activeAppServer) {
    return { ok: false, error: "No active Codex App Server thread session is available." };
  }
  if (!activeAppServer.threadId || !activeAppServer.activeTurnId || !activeAppServer.turnActive) {
    return { ok: false, error: "No active Codex App Server turn is available to stop." };
  }

  const requestId = sendCodexAppServerRequest(
    activeAppServer,
    "turn/interrupt",
    buildCodexAppServerTurnInterruptParams({
      threadId: activeAppServer.threadId,
      turnId: activeAppServer.activeTurnId,
    }),
  );
  if (requestId === null) {
    return { ok: false, error: "Codex App Server runtime is not writable." };
  }

  appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Stop requested for active Codex App Server turn.\n");
  updateAgentStateFromTaskDeckEvent(taskId, AgentState.WORKING, {
    reason: "Stop requested for active Codex App Server turn.",
    source: AgentStateSource.TASKDECK_EVENT,
    confidence: AgentStateConfidence.HIGH,
    attentionState: AttentionState.NONE,
    attentionReason: "Stop requested for active Codex App Server turn.",
    attentionSource: AgentStateSource.TASKDECK_EVENT,
    attentionConfidence: AgentStateConfidence.HIGH,
  });
  broadcastTasks();
  return { ok: true };
}

function normalizeCodexAppServerInput(data) {
  return String(data || "")
    .replace(/\r/g, "\n")
    .trim();
}

function buildCodexTurnInput(task, text, turnSelection = {}) {
  return {
    text,
    model: String(turnSelection.agentModel || task?.agentModel || "").trim(),
    effort: String(turnSelection.agentReasoningEffort || task?.agentReasoningEffort || "").trim(),
  };
}

function updateTaskCodexTurnSelection(task, turnInput) {
  if (!task || (task.agentModel === turnInput.model && task.agentReasoningEffort === turnInput.effort)) {
    return;
  }
  setTask({
    ...task,
    agentModel: turnInput.model,
    agentReasoningEffort: turnInput.effort,
    updatedAt: new Date().toISOString(),
  });
  broadcastTasks();
}

function sendCodexAppServerInitialize(activeAppServer) {
  sendCodexAppServerRequest(activeAppServer, "initialize", {
    clientInfo: {
      name: "taskdeck",
      title: "TaskDeck",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: true,
    },
  });
}

function sendCodexAppServerAccountRead(activeAppServer, { refreshToken = false } = {}) {
  const activeRuntime = codexRuntimeForThreadSession(activeAppServer);
  if (!activeRuntime) {
    appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server runtime is not available.\n");
    return;
  }
  if (!refreshToken && activeRuntime.accountReadInFlight) {
    return;
  }
  activeRuntime.accountReadInFlight = true;
  const requestId = sendCodexAppServerRequest(activeAppServer, "account/read", {
    refreshToken,
  });
  if (requestId === null) {
    activeRuntime.accountReadInFlight = false;
  }
}

function sendCodexAppServerModelList(activeAppServer, cursor = "") {
  const activeRuntime = codexRuntimeForThreadSession(activeAppServer);
  if (!activeRuntime || (activeRuntime.modelListRequested && !cursor)) {
    return;
  }
  activeRuntime.modelListRequested = true;
  const requestId = sendCodexAppServerRequest(activeAppServer, "model/list", {
    limit: 100,
    ...(cursor ? { cursor } : {}),
  });
  if (requestId === null) {
    activeRuntime.modelListRequested = false;
  }
}

function sendCodexAppServerLoginStart(activeAppServer) {
  const activeRuntime = codexRuntimeForThreadSession(activeAppServer);
  if (!activeRuntime) {
    appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server runtime is not available.\n");
    return;
  }
  if (activeRuntime.loginInProgress) {
    return;
  }
  activeRuntime.loginInProgress = true;
  const requestId = sendCodexAppServerRequest(activeAppServer, "account/login/start", {
    type: "chatgptDeviceCode",
  });
  if (requestId === null) {
    activeRuntime.loginInProgress = false;
  }
}

function sendCodexAppServerThreadStart(activeAppServer) {
  const task = tasks.get(activeAppServer.taskId);
  if (!task) {
    return;
  }
  const activeRuntime = codexRuntimeForThreadSession(activeAppServer);
  if (!activeRuntime) {
    appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server runtime is not available.\n");
    return;
  }
  if (activeAppServer.threadId || activeAppServer.threadStartRequested) {
    return;
  }
  if (!activeRuntime.initialized) {
    activeRuntime.pendingThreadStartTaskIds.add(activeAppServer.taskId);
    if (!activeRuntime.initializeRequested) {
      activeRuntime.initializeRequested = true;
      sendCodexAppServerInitialize(activeAppServer);
    }
    return;
  }
  if (!activeRuntime.accountReady) {
    activeRuntime.pendingThreadStartTaskIds.add(activeAppServer.taskId);
    activeAppServer.pendingAuthRetry = { method: "thread/start" };
    sendCodexAppServerAccountRead(activeAppServer);
    return;
  }
  activeAppServer.threadStartRequested = true;
  taskVisibleHostPath(task.command, task.cwd)
    .then((cwd) => {
      const requestId = sendCodexAppServerRequest(
        activeAppServer,
        "thread/start",
        buildCodexAppServerThreadStartParams({ cwd, model: task.agentModel }),
      );
      if (requestId === null) {
        activeAppServer.threadStartRequested = false;
      }
    })
    .catch((error) => {
      activeAppServer.threadStartRequested = false;
      appendCodexAppServerStatus(activeAppServer, `[TaskDeck] Could not resolve Codex App Server cwd: ${error.message}\n`);
      updateAgentStateFromTaskDeckEvent(activeAppServer.taskId, AgentState.FAILED, {
        reason: "Codex App Server cwd mapping failed.",
        source: AgentStateSource.TASKDECK_EVENT,
        confidence: AgentStateConfidence.HIGH,
        attentionState: AttentionState.FAILED,
        attentionReason: "Codex App Server cwd mapping failed.",
        attentionSource: AgentStateSource.TASKDECK_EVENT,
        attentionConfidence: AgentStateConfidence.HIGH,
      });
    });
}

function sendCodexAppServerTurn(activeAppServer, input) {
  const turnInput = typeof input === "string"
    ? buildCodexTurnInput(tasks.get(activeAppServer.taskId), input)
    : input;
  if (!activeAppServer.threadId) {
    activeAppServer.pendingInputs.push(turnInput);
    return;
  }
  sendCodexAppServerRequest(
    activeAppServer,
    "turn/start",
    buildCodexAppServerTurnStartParams({
      threadId: activeAppServer.threadId,
      text: turnInput.text,
      model: turnInput.model,
      effort: turnInput.effort,
    }),
  );
}

function sendCodexAppServerRequest(activeAppServer, method, params) {
  const activeRuntime = codexRuntimeForThreadSession(activeAppServer);
  if (!activeRuntime) {
    appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server runtime is not available.\n");
    return null;
  }
  const id = activeRuntime.nextRequestId;
  activeRuntime.nextRequestId += 1;
  const message = { jsonrpc: "2.0", id, method, params };
  activeRuntime.pendingRequests.set(id, { method, params, threadSession: activeAppServer });
  if (codexAppServerDebugEnabled) {
    appendAndBroadcast(activeAppServer.taskId, `[TaskDeck -> Codex App Server] ${JSON.stringify(message)}\n`, {
      role: "taskdeck",
      kind: "debug",
    });
  }
  if (!writeCodexAppServerRuntimeMessage(activeAppServer, message)) {
    activeRuntime.pendingRequests.delete(id);
    return null;
  }
  return id;
}

function sendCodexAppServerResponse(activeAppServer, id, result) {
  const message = { jsonrpc: "2.0", id, result };
  if (codexAppServerDebugEnabled) {
    appendAndBroadcast(activeAppServer.taskId, `[TaskDeck -> Codex App Server] ${JSON.stringify(message)}\n`, {
      role: "taskdeck",
      kind: "debug",
    });
  }
  writeCodexAppServerRuntimeMessage(activeAppServer, message);
}

function sendCodexAppServerRequestError(activeAppServer, id, messageText, code = -32603) {
  const message = {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message: messageText,
    },
  };
  if (codexAppServerDebugEnabled) {
    appendAndBroadcast(activeAppServer.taskId, `[TaskDeck -> Codex App Server] ${JSON.stringify(message)}\n`, {
      role: "taskdeck",
      kind: "debug",
    });
  }
  writeCodexAppServerRuntimeMessage(activeAppServer, message);
}

function writeCodexAppServerRuntimeMessage(activeAppServer, message) {
  const activeRuntime = codexRuntimeForThreadSession(activeAppServer);
  if (!codexRuntimeIsWritable(activeRuntime)) {
    appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server runtime is not writable.\n");
    return false;
  }
  activeRuntime.process.stdin.write(`${JSON.stringify(message)}\n`);
  return true;
}

function handleCodexAppServerOutput(activeRuntime, data, stream) {
  if (!activeRuntime) {
    return;
  }

  const bufferKey = stream === "stderr" ? "stderrBuffer" : "stdoutBuffer";
  activeRuntime[bufferKey] += data;
  const lines = activeRuntime[bufferKey].split(/\r?\n/);
  activeRuntime[bufferKey] = lines.pop() ?? "";
  for (const line of lines) {
    handleCodexAppServerOutputLine(activeRuntime, line, stream);
  }
}

function handleCodexAppServerOutputLine(activeRuntime, line, stream) {
  const trimmedLine = line.trim();
  if (!trimmedLine) {
    return;
  }

  const defaultThreadSession = defaultCodexThreadSessionForRuntime(activeRuntime);
  if (!trimmedLine.startsWith("{")) {
    if (isIgnorableCodexAppServerTextDiagnostic(trimmedLine)) {
      if (codexAppServerDebugEnabled) {
        appendCodexRuntimeDiagnostic(activeRuntime, `${line}\n`);
      }
      return;
    }
    if (shouldSuppressCodexAppServerAuthErrorLine({
      authFailureDetected: activeRuntime.authFailureDetected,
      line: trimmedLine,
    })) {
      if (codexAppServerDebugEnabled) {
        appendCodexRuntimeDiagnostic(activeRuntime, `${line}\n`);
      }
      return;
    }
    appendCodexRuntimeDiagnostic(activeRuntime, `${line}\n`);
    if (defaultThreadSession) {
      handleCodexAppServerTextDiagnostic(defaultThreadSession, line);
    }
    return;
  }

  try {
    const message = JSON.parse(trimmedLine);
    if (codexAppServerDebugEnabled) {
      appendCodexRuntimeDiagnostic(activeRuntime, `[TaskDeck Codex App Server ${stream} JSON] ${trimmedLine}\n`);
    }
    handleCodexAppServerMessage(activeRuntime, message);
  } catch (error) {
    appendCodexRuntimeDiagnostic(activeRuntime, `[TaskDeck] Could not parse Codex App Server ${stream} JSON: ${error.message}\n`);
    appendCodexRuntimeDiagnostic(activeRuntime, `${line}\n`);
    if (defaultThreadSession) {
      handleCodexAppServerTextDiagnostic(defaultThreadSession, line);
    }
  }
}

function defaultCodexThreadSessionForRuntime(activeRuntime) {
  if (!activeRuntime) {
    return null;
  }
  const defaultThreadSession = activeCodexThreadSessions.get(activeRuntime.defaultTaskId);
  if (
    defaultThreadSession?.runtimeId === activeRuntime.id &&
    defaultThreadSession.runtimeInstanceId === activeRuntime.instanceId
  ) {
    return defaultThreadSession;
  }
  const [activeAppServer] = codexThreadSessionsForRuntime(activeRuntime);
  if (activeAppServer) {
    activeRuntime.defaultTaskId = activeAppServer.taskId;
    return activeAppServer;
  }
  return null;
}

function appendCodexRuntimeDiagnostic(activeRuntime, data) {
  const activeAppServer = defaultCodexThreadSessionForRuntime(activeRuntime);
  if (!activeAppServer) {
    return;
  }
  appendAndBroadcast(activeAppServer.taskId, data, { role: "taskdeck", kind: "diagnostic" });
}

function isIgnorableCodexAppServerTextDiagnostic(line) {
  return String(line || "").includes("failed to clean up stale arg0 temp dirs");
}

function handleCodexAppServerMessage(activeRuntime, message) {
  const defaultThreadSession = defaultCodexThreadSessionForRuntime(activeRuntime);

  if (activeRuntime.authFailureDetected) {
    if (codexAppServerDebugEnabled) {
      appendCodexRuntimeDiagnostic(
        activeRuntime,
        `[TaskDeck] Ignoring Codex App Server message after authentication failure: ${String(message.method || message.id || "unknown")}\n`,
      );
    }
    return;
  }

  if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
    const pendingRequest = activeRuntime.pendingRequests.get(message.id);
    activeRuntime.pendingRequests.delete(message.id);
    const activeAppServer = pendingRequest?.threadSession || defaultThreadSession;
    if (activeAppServer) {
      handleCodexAppServerResponse(activeAppServer, message, pendingRequest);
    }
    return;
  }
  if (message.id !== undefined && message.method) {
    const activeAppServer = codexThreadSessionForCodexAppServerMessage(defaultThreadSession, message);
    if (activeAppServer) {
      handleCodexAppServerRequest(activeAppServer, message);
    }
    return;
  }
  if (message.method) {
    const activeAppServer = codexThreadSessionForCodexAppServerMessage(defaultThreadSession, message);
    if (activeAppServer) {
      handleCodexAppServerNotification(activeAppServer, message);
    }
    return;
  }
  appendCodexRuntimeDiagnostic(activeRuntime, `[TaskDeck] Unknown Codex App Server message: ${JSON.stringify(message)}\n`);
}

function codexThreadSessionForCodexAppServerMessage(defaultThreadSession, message) {
  if (!defaultThreadSession) {
    return null;
  }
  const threadId = codexAppServerThreadIdFromMessage(message);
  if (!threadId) {
    return defaultThreadSession;
  }

  const taskId = resolveCodexAppServerTaskIdForThread({
    threadId,
    defaultTaskId: defaultThreadSession.taskId,
    taskIdByThreadId: taskIdByCodexThreadId,
  });
  if (!taskId || taskId === defaultThreadSession.taskId) {
    const parentThreadSession = codexThreadSessionForCodexParentThread(message);
    if (parentThreadSession) {
      return parentThreadSession;
    }
    return codexUnknownThreadCanUseDefaultSession(defaultThreadSession, message, threadId) ? defaultThreadSession : null;
  }

  const directThreadSession = activeCodexThreadSessions.get(taskId);
  if (directThreadSession) {
    return directThreadSession;
  }

  const task = tasks.get(taskId);
  const parentThreadSession = activeCodexThreadSessions.get(task?.parentSessionId);
  return parentThreadSession || defaultThreadSession;
}

function codexThreadSessionForCodexParentThread(message) {
  const parentThreadId = String(message?.params?.thread?.parentThreadId || message?.params?.parentThreadId || "").trim();
  if (!parentThreadId) {
    return null;
  }
  const parentTaskId = taskIdByCodexThreadId.get(parentThreadId);
  return parentTaskId ? activeCodexThreadSessions.get(parentTaskId) || null : null;
}

function codexUnknownThreadCanUseDefaultSession(defaultThreadSession, message, threadId) {
  if (!defaultThreadSession.threadId || defaultThreadSession.threadId === threadId) {
    return true;
  }
  const parentThreadId = String(message?.params?.thread?.parentThreadId || "").trim();
  if (parentThreadId && parentThreadId === defaultThreadSession.threadId) {
    return true;
  }
  const parentTaskId = parentThreadId ? taskIdByCodexThreadId.get(parentThreadId) : "";
  return Boolean(parentTaskId && parentTaskId === defaultThreadSession.taskId);
}

function handleCodexAppServerResponse(activeAppServer, message, pendingRequest = null) {
  const activeRuntime = codexRuntimeStateForThreadSession(activeAppServer);
  const method = pendingRequest?.method || "";
  if (method === "account/read") {
    activeRuntime.accountReadInFlight = false;
  }
  if (method === "thread/start") {
    activeAppServer.threadStartRequested = false;
  }
  if (message.error) {
    if (method === "model/list") {
      activeRuntime.modelListRequested = false;
    }
    if (isCodexAppServerAuthError(message.error)) {
      preserveCodexAppServerPendingAuthRetry(activeAppServer, pendingRequest);
      if (activeRuntime.authFailureDetected) {
        handleCodexAppServerAuthFailureDiagnostic(
          activeAppServer,
          `Codex App Server ${method || "request"} returned an auth error after authentication had already failed.`
        );
        return;
      }
      if (activeRuntime.loginCompletedAt && activeRuntime.forcedAccountRefreshAttempted) {
        handleCodexAppServerAuthFailureDiagnostic(
          activeAppServer,
          `Codex App Server ${method || "request"} still returned an auth error after device login and account refresh.`
        );
        return;
      }
      if (!activeRuntime.forcedAccountRefreshAttempted) {
        activeRuntime.forcedAccountRefreshAttempted = true;
        appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server authentication is expired or invalid; trying one account refresh.\n");
        sendCodexAppServerAccountRead(activeAppServer, { refreshToken: true });
        return;
      }
      appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server authentication refresh failed; ChatGPT device login is required.\n");
      handleCodexAppServerAuthRequired(activeAppServer, pendingRequest);
      return;
    }
    if (method === "model/list") {
      appendCodexAppServerStatus(activeAppServer, `[TaskDeck] Codex App Server model list unavailable: ${JSON.stringify(message.error)}\n`);
      return;
    }
    if (method === "turn/interrupt") {
      appendCodexAppServerStatus(activeAppServer, `[TaskDeck] Codex App Server turn stop failed: ${JSON.stringify(message.error)}\n`);
      return;
    }
    if (codexRuntimeRequestCanMoveToAnotherThreadSession(method)) {
      finishCodexAppServerRuntime(activeRuntime, {
        exitCode: 1,
        signal: null,
        statusMessage: `[TaskDeck] Codex App Server ${method || "request"} error: ${JSON.stringify(message.error)}`,
      });
      try {
        activeRuntime.process?.kill();
      } catch {
        // The runtime is already finalized; no further action is needed if the process is gone.
      }
      return;
    }
    appendCodexAppServerStatus(activeAppServer, `[TaskDeck] Codex App Server ${method || "request"} error: ${JSON.stringify(message.error)}\n`);
    updateAgentStateFromTaskDeckEvent(activeAppServer.taskId, AgentState.FAILED, {
      reason: "Codex App Server request failed.",
      source: AgentStateSource.PROCESS,
      confidence: AgentStateConfidence.HIGH,
      attentionState: AttentionState.FAILED,
      attentionReason: "Codex App Server request failed.",
      attentionSource: AgentStateSource.PROCESS,
      attentionConfidence: AgentStateConfidence.HIGH,
    });
    return;
  }

  if (method === "initialize") {
    activeRuntime.initialized = true;
    appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server initialized; checking account.\n");
    resumeCodexAppServerRuntimeThreadStarts(activeRuntime, activeAppServer);
    return;
  }

  if (method === "account/read") {
    if (codexAppServerAccountRequiresLogin(message.result)) {
      if (activeRuntime.loginCompletedAt) {
        handleCodexAppServerAuthFailureDiagnostic(
          activeAppServer,
          "Codex App Server account still requires OpenAI authentication after device login completed."
        );
        return;
      }
      appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server account requires ChatGPT login.\n");
      handleCodexAppServerAuthRequired(activeAppServer, { method: "thread/start" });
      return;
    }
    activeRuntime.accountReady = true;
    activeRuntime.loginInProgress = false;
    sendCodexAppServerModelList(activeAppServer);
    appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server account is ready; starting thread.\n");
    resumeCodexAppServerRuntimeThreadStarts(activeRuntime, activeAppServer);
    return;
  }

  if (method === "account/login/start") {
    handleCodexAppServerLoginStartResponse(activeAppServer, message.result);
    return;
  }

  if (method === "model/list") {
    const nextModels = normalizeCodexAppServerModels(message.result?.data);
    activeRuntime.modelCatalog = normalizeCodexAppServerModels([
      ...activeRuntime.modelCatalog,
      ...nextModels,
    ]);
    codexModels = activeRuntime.modelCatalog;
    broadcast({ type: "codex-models", models: codexModels });
    const nextCursor = String(message.result?.nextCursor || "").trim();
    if (nextCursor) {
      sendCodexAppServerModelList(activeAppServer, nextCursor);
    } else {
      activeRuntime.modelListRequested = false;
    }
    return;
  }

  if (method === "thread/start") {
    const threadId = String(message.result?.thread?.id || "").trim();
    activeAppServer.threadStartRequested = false;
    const didRecordThreadSession = recordCodexAppServerThreadSession(activeAppServer, threadId);
    appendCodexAppServerStatus(activeAppServer, `[TaskDeck] Codex App Server thread ready${threadId ? `: ${threadId}` : ""}.\n`);
    if (didRecordThreadSession) {
      broadcastTasks();
    }
    flushCodexAppServerPendingInputs(activeAppServer);
    return;
  }

  if (method === "turn/start") {
    const turnId = String(message.result?.turn?.id || "").trim();
    activeAppServer.activeTurnId = turnId;
    activeAppServer.turnActive = true;
    activeAppServer.assistantMessageOpen = false;
    appendCodexAppServerStatus(activeAppServer, `[TaskDeck] Codex App Server turn accepted${turnId ? `: ${turnId}` : ""}.\n`);
    broadcastTasks();
    return;
  }

  if (method === "turn/interrupt") {
    appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server turn stop accepted.\n");
    return;
  }
}

function handleCodexAppServerAuthRequired(activeAppServer, pendingRequest) {
  const activeRuntime = codexRuntimeStateForThreadSession(activeAppServer);
  if (activeRuntime.loginCompletedAt) {
    handleCodexAppServerAuthFailureDiagnostic(
      activeAppServer,
      "Codex App Server requested ChatGPT login again after a device login had already completed."
    );
    return;
  }
  activeRuntime.accountReady = false;
  preserveCodexAppServerPendingAuthRetry(activeAppServer, pendingRequest);
  const threadSessions = codexThreadSessionsForRuntime(activeRuntime);
  for (const threadSession of threadSessions.length > 0 ? threadSessions : [activeAppServer]) {
    updateAgentStateFromTaskDeckEvent(threadSession.taskId, AgentState.WAITING_INPUT, {
      reason: "Codex App Server needs ChatGPT device login.",
      source: AgentStateSource.PROCESS,
      confidence: AgentStateConfidence.HIGH,
      attentionState: AttentionState.NEEDS_INPUT,
      attentionReason: "Open the ChatGPT device login URL and enter the user code shown in the task log.",
      attentionSource: AgentStateSource.PROCESS,
      attentionConfidence: AgentStateConfidence.HIGH,
    });
  }
  sendCodexAppServerLoginStart(activeAppServer);
}

function preserveCodexAppServerPendingAuthRetry(activeAppServer, pendingRequest) {
  if (pendingRequest?.method && pendingRequest.method !== "account/read" && pendingRequest.method !== "account/login/start") {
    activeAppServer.pendingAuthRetry = {
      method: pendingRequest.method,
      params: pendingRequest.params,
    };
  } else if (!activeAppServer.pendingAuthRetry) {
    activeAppServer.pendingAuthRetry = { method: "thread/start" };
  }
}

function handleCodexAppServerLoginStartResponse(activeAppServer, result) {
  const activeRuntime = codexRuntimeStateForThreadSession(activeAppServer);
  if (result?.type !== "chatgptDeviceCode") {
    appendCodexAppServerStatus(activeAppServer, `[TaskDeck] Codex App Server login started: ${JSON.stringify(result)}\n`);
    return;
  }

  const verificationUrl = String(result.verificationUrl || "").trim();
  const userCode = String(result.userCode || "").trim();
  const loginId = String(result.loginId || "").trim();
  activeRuntime.loginId = loginId;
  const loginMessage = [
    "[TaskDeck] ChatGPT device login required.",
    verificationUrl ? `[TaskDeck] Verification URL: ${verificationUrl}` : "",
    userCode ? `[TaskDeck] User code: ${userCode}` : "",
  ].filter(Boolean).join("\n") + "\n";
  const threadSessions = codexThreadSessionsForRuntime(activeRuntime);
  for (const threadSession of threadSessions.length > 0 ? threadSessions : [activeAppServer]) {
    appendCodexAppServerStatus(threadSession, loginMessage);
    updateAgentStateFromTaskDeckEvent(threadSession.taskId, AgentState.WAITING_INPUT, {
      reason: "Codex App Server is waiting for ChatGPT device login.",
      source: AgentStateSource.PROCESS,
      confidence: AgentStateConfidence.HIGH,
      attentionState: AttentionState.NEEDS_INPUT,
      attentionReason: "Complete ChatGPT device login with the URL and code shown in the task log.",
      attentionSource: AgentStateSource.PROCESS,
      attentionConfidence: AgentStateConfidence.HIGH,
    });
  }
}

function handleCodexAppServerLoginCompleted(activeAppServer, params) {
  const activeRuntime = codexRuntimeStateForThreadSession(activeAppServer);
  const success = Boolean(params?.success);
  const error = String(params?.error || "").trim();
  activeRuntime.loginInProgress = false;
  activeRuntime.loginId = "";
  if (!success) {
    activeRuntime.accountReady = false;
    const failureReason = error || "ChatGPT device login failed.";
    const failureMessage = [
      `[TaskDeck] Codex App Server login failed: ${failureReason}`,
      "[TaskDeck] TaskDeck will not start another device-code login automatically. Restart this task to request a fresh code.",
    ].join("\n") + "\n";
    const threadSessions = codexThreadSessionsForRuntime(activeRuntime);
    for (const threadSession of threadSessions.length > 0 ? threadSessions : [activeAppServer]) {
      appendCodexAppServerStatus(threadSession, failureMessage);
      updateAgentStateFromTaskDeckEvent(threadSession.taskId, AgentState.WAITING_INPUT, {
        reason: "Codex App Server login failed.",
        source: AgentStateSource.PROCESS,
        confidence: AgentStateConfidence.HIGH,
        attentionState: AttentionState.NEEDS_INPUT,
        attentionReason: `${failureReason} TaskDeck will not start another device-code login automatically; restart this task to request a fresh code.`,
        attentionSource: AgentStateSource.PROCESS,
        attentionConfidence: AgentStateConfidence.HIGH,
      });
    }
    return;
  }

  appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server login completed; resuming.\n");
  activeRuntime.accountReady = true;
  activeRuntime.loginCompletedAt = Date.now();
  resumeCodexAppServerAfterLogin(activeAppServer);
}

function handleCodexAppServerAccountUpdated(activeAppServer) {
  const activeRuntime = codexRuntimeStateForThreadSession(activeAppServer);
  if (activeRuntime.authFailureDetected) {
    return;
  }
  if (activeRuntime.accountReady && !codexRuntimeHasPendingAuthRetry(activeRuntime)) {
    appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server account updated.\n");
    return;
  }
  appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server account updated; resuming.\n");
  activeRuntime.loginInProgress = false;
  activeRuntime.accountReady = true;
  resumeCodexAppServerAfterLogin(activeAppServer);
}

function resumeCodexAppServerAfterLogin(activeAppServer) {
  const activeRuntime = codexRuntimeStateForThreadSession(activeAppServer);
  activeRuntime.modelListRequested = false;
  sendCodexAppServerModelList(activeAppServer);
  for (const threadSession of codexThreadSessionsForRuntime(activeRuntime)) {
    const pendingAuthRetry = threadSession.pendingAuthRetry;
    threadSession.pendingAuthRetry = null;
    updateAgentStateFromTaskDeckEvent(threadSession.taskId, AgentState.WORKING, {
      reason: "Codex App Server authentication is ready.",
      source: AgentStateSource.PROCESS,
      confidence: AgentStateConfidence.HIGH,
      attentionState: AttentionState.NONE,
      attentionReason: "Codex App Server authentication is ready.",
      attentionSource: AgentStateSource.PROCESS,
      attentionConfidence: AgentStateConfidence.HIGH,
    });

    if (pendingAuthRetry?.method === "turn/start" && pendingAuthRetry.params) {
      sendCodexAppServerRequest(threadSession, "turn/start", pendingAuthRetry.params);
      continue;
    }
    if (!threadSession.threadId) {
      activeRuntime.pendingThreadStartTaskIds?.add(threadSession.taskId);
      continue;
    }
    flushCodexAppServerPendingInputs(threadSession);
  }
  resumeCodexAppServerRuntimeThreadStarts(activeRuntime, activeAppServer);
}

function resumeCodexAppServerRuntimeThreadStarts(activeRuntime, fallbackThreadSession = null) {
  if (!activeRuntime || activeRuntime.authFailureDetected || !activeRuntime.initialized) {
    return false;
  }

  const threadSessions = codexThreadSessionsForRuntime(activeRuntime);
  const requestSession = fallbackThreadSession || threadSessions[0] || null;
  if (!activeRuntime.accountReady) {
    if (requestSession) {
      sendCodexAppServerAccountRead(requestSession);
    }
    return false;
  }

  let resumed = false;
  for (const threadSession of threadSessions) {
    activeRuntime.pendingThreadStartTaskIds?.delete(threadSession.taskId);
    if (!threadSession.threadId) {
      sendCodexAppServerThreadStart(threadSession);
      resumed = true;
      continue;
    }
    if (threadSession.pendingInputs.length > 0) {
      resumed = flushCodexAppServerPendingInputs(threadSession) || resumed;
    }
  }
  return resumed;
}

function codexRuntimeHasPendingAuthRetry(activeRuntime) {
  return codexThreadSessionsForRuntime(activeRuntime).some((threadSession) => Boolean(threadSession.pendingAuthRetry));
}

function codexAppServerAccountRequiresLogin(result) {
  return Boolean(result?.requiresOpenaiAuth || result?.account === null);
}

function handleCodexAppServerTextDiagnostic(activeAppServer, text) {
  if (!isCodexAppServerAuthError(text)) {
    return;
  }
  if (!shouldReportCodexAppServerAuthFailure(activeAppServer)) {
    return;
  }
  handleCodexAppServerAuthFailureDiagnostic(activeAppServer, text);
}

function shouldReportCodexAppServerAuthFailure(activeAppServer) {
  const activeRuntime = codexRuntimeStateForThreadSession(activeAppServer);
  return Boolean(
    activeRuntime.authFailureDetected ||
    activeRuntime.loginCompletedAt ||
    activeRuntime.accountReady ||
    activeAppServer.threadId ||
    codexThreadSessionsForRuntime(activeRuntime).some((threadSession) => Boolean(threadSession.threadId))
  );
}

function handleCodexAppServerAuthFailureDiagnostic(activeAppServer, _detail) {
  const activeRuntime = codexRuntimeStateForThreadSession(activeAppServer);
  if (activeRuntime.authFailureDetected) {
    return;
  }
  activeRuntime.authFailureDetected = true;
  activeRuntime.accountReady = false;
  activeRuntime.loginInProgress = false;
  activeRuntime.loginId = "";
  activeRuntime.pendingRequests?.clear();
  activeRuntime.pendingThreadStartTaskIds?.clear();

  const failureMessage = [
    "[TaskDeck] Codex App Server authentication failed after login.",
    "[TaskDeck] The current App Server environment still has an invalid or revoked ChatGPT token.",
    "[TaskDeck] Fix Codex login in the App Server environment, or point the codex-app-server profile at the host environment that already has a valid login, then restart this task.",
  ].join("\n") + "\n";
  const threadSessions = codexThreadSessionsForRuntime(activeRuntime);
  for (const threadSession of threadSessions.length > 0 ? threadSessions : [activeAppServer]) {
    threadSession.pendingAuthRetry = null;
    appendCodexAppServerStatus(threadSession, failureMessage);
    updateAgentStateFromTaskDeckEvent(threadSession.taskId, AgentState.WAITING_INPUT, {
      reason: "Codex App Server authentication failed after login.",
      source: AgentStateSource.PROCESS,
      confidence: AgentStateConfidence.HIGH,
      attentionState: AttentionState.NEEDS_INPUT,
      attentionReason: "Codex App Server token is invalid or revoked. Fix Codex login in the App Server environment, then restart this task.",
      attentionSource: AgentStateSource.PROCESS,
      attentionConfidence: AgentStateConfidence.HIGH,
    });
  }
}

function handleCodexAppServerRequest(activeAppServer, message) {
  const method = String(message.method || "");
  if (isCodexAppServerApprovalRequest(method)) {
    rememberCodexAppServerRequest(activeAppServer, message, "approval");
    updateAgentStateFromTaskDeckEvent(activeAppServer.taskId, AgentState.WAITING_APPROVAL, {
      reason: "Codex App Server requested approval.",
      source: AgentStateSource.PROCESS,
      confidence: AgentStateConfidence.HIGH,
      attentionState: AttentionState.NEEDS_APPROVAL,
      attentionReason: "Codex App Server requested approval.",
      attentionSource: AgentStateSource.PROCESS,
      attentionConfidence: AgentStateConfidence.HIGH,
    });
    appendCodexAppServerStatus(activeAppServer, `[TaskDeck] Codex App Server approval request is waiting for user handling: ${method}\n`);
    return;
  }
  if (isCodexAppServerUserInputRequest(method)) {
    rememberCodexAppServerRequest(activeAppServer, message, codexAppServerRequestKind(method));
    updateAgentStateFromTaskDeckEvent(activeAppServer.taskId, AgentState.WAITING_INPUT, {
      reason: "Codex App Server requested user input.",
      source: AgentStateSource.PROCESS,
      confidence: AgentStateConfidence.HIGH,
      attentionState: AttentionState.NEEDS_INPUT,
      attentionReason: "Codex App Server requested user input.",
      attentionSource: AgentStateSource.PROCESS,
      attentionConfidence: AgentStateConfidence.HIGH,
    });
    appendCodexAppServerStatus(activeAppServer, `[TaskDeck] Codex App Server user-input request is waiting for user handling: ${method}\n`);
    return;
  }
  if (message.id !== undefined) {
    sendCodexAppServerRequestError(activeAppServer, message.id, `Unsupported Codex App Server request: ${method}`, -32601);
  }
  appendCodexAppServerStatus(activeAppServer, `[TaskDeck] Unknown Codex App Server request: ${method}\n`);
}

function rememberCodexAppServerRequest(activeAppServer, message, kind) {
  activeAppServer.pendingServerRequests.set(message.id, {
    id: message.id,
    kind,
    method: String(message.method || ""),
    params: message.params ?? {},
    createdAt: Date.now(),
  });
  activeAppServer.currentServerRequestId = message.id;
}

function normalizeCodexAppServerRequestId(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function codexAppServerRequestKind(method) {
  if (method === "mcpServer/elicitation/request") {
    return "elicitation";
  }
  if (method === "item/tool/requestUserInput") {
    return "user_input";
  }
  return "user_input";
}

function resolveCodexAppServerRequest(taskId, requestId, action) {
  const activeAppServer = activeCodexThreadSessions.get(taskId);
  if (!activeAppServer) {
    return { ok: false, error: "No active Codex App Server thread session is available." };
  }
  if (requestId === null) {
    return { ok: false, error: "Codex App Server request id is invalid." };
  }
  const pendingRequest = activeAppServer.pendingServerRequests.get(requestId);
  if (!pendingRequest) {
    clearStaleCodexAppServerRequest(activeAppServer, requestId);
    broadcastTasks();
    return { ok: true };
  }

  const result = codexAppServerRequestResolution(pendingRequest, action);
  if (!result.ok) {
    return result;
  }

  sendCodexAppServerResponse(activeAppServer, requestId, result.result);
  clearCodexAppServerPendingRequest(activeAppServer, requestId);
  appendCodexAppServerStatus(
    activeAppServer,
    `[TaskDeck] Codex App Server request ${requestId} resolved: ${codexAppServerActionLabel(action)}.\n`,
  );
  updateAgentStateFromTaskDeckEvent(taskId, AgentState.WORKING, {
    reason: "Codex App Server request was resolved.",
    source: AgentStateSource.TASKDECK_EVENT,
    confidence: AgentStateConfidence.HIGH,
    attentionState: AttentionState.NONE,
    attentionReason: "Codex App Server request was resolved.",
    attentionSource: AgentStateSource.TASKDECK_EVENT,
    attentionConfidence: AgentStateConfidence.HIGH,
  });
  return { ok: true };
}

function clearStaleCodexAppServerRequest(activeAppServer, requestId) {
  if (
    activeAppServer.currentServerRequestId === requestId ||
    String(activeAppServer.currentServerRequestId ?? "") === String(requestId ?? "")
  ) {
    activeAppServer.currentServerRequestId = newestCodexAppServerPendingRequestId(activeAppServer);
  }
}

function codexAppServerRequestResolution(pendingRequest, action) {
  const normalizedAction = String(action || "").trim();
  const method = pendingRequest.method;

  if (method === "item/commandExecution/requestApproval") {
    return codexAppServerDecisionResolution(pendingRequest, normalizedAction, "command");
  }
  if (method === "item/fileChange/requestApproval") {
    return codexAppServerDecisionResolution(pendingRequest, normalizedAction, "file");
  }
  if (method === "applyPatchApproval" || method === "execCommandApproval") {
    return codexAppServerLegacyApprovalResolution(normalizedAction);
  }
  if (method === "item/permissions/requestApproval") {
    return codexAppServerPermissionsResolution(pendingRequest, normalizedAction);
  }
  if (method === "mcpServer/elicitation/request") {
    return codexAppServerElicitationResolution(normalizedAction);
  }
  if (method === "item/tool/requestUserInput") {
    if (normalizedAction !== "cancel") {
      return { ok: false, error: "This Codex App Server input request can only be canceled in TaskDeck." };
    }
    return { ok: true, result: { answers: {} } };
  }

  return { ok: false, error: `Unsupported Codex App Server request: ${method}` };
}

function codexAppServerDecisionResolution(pendingRequest, action, decisionType) {
  const decision = codexAppServerDecisionForAction(pendingRequest, action, decisionType);
  if (!decision) {
    return { ok: false, error: "Unsupported Codex App Server approval action." };
  }
  return { ok: true, result: { decision } };
}

function codexAppServerDecisionForAction(pendingRequest, action, decisionType) {
  const availableDecisions = Array.isArray(pendingRequest.params?.availableDecisions)
    ? pendingRequest.params.availableDecisions.filter((decision) => typeof decision === "string")
    : [];
  const candidates =
    action === "approve"
      ? ["accept", "acceptForSession"]
      : action === "decline"
        ? ["decline"]
        : action === "cancel"
          ? ["cancel"]
          : [];
  if (availableDecisions.length > 0) {
    return candidates.find((candidate) => availableDecisions.includes(candidate)) || "";
  }
  if (decisionType === "file" && action === "approve") return "accept";
  if (decisionType === "command" && action === "approve") return "accept";
  if (action === "decline") return "decline";
  if (action === "cancel") return "cancel";
  return "";
}

function codexAppServerLegacyApprovalResolution(action) {
  if (action === "approve") {
    return { ok: true, result: { decision: "approved" } };
  }
  if (action === "decline") {
    return { ok: true, result: { decision: "denied" } };
  }
  if (action === "cancel") {
    return { ok: true, result: { decision: "abort" } };
  }
  return { ok: false, error: "Unsupported Codex App Server approval action." };
}

function codexAppServerPermissionsResolution(pendingRequest, action) {
  if (action === "approve") {
    return {
      ok: true,
      result: {
        permissions: grantedCodexAppServerPermissions(pendingRequest.params?.permissions),
        scope: "turn",
        strictAutoReview: false,
      },
    };
  }
  if (action === "decline" || action === "cancel") {
    return { ok: true, result: { permissions: {}, scope: "turn", strictAutoReview: false } };
  }
  return { ok: false, error: "Unsupported Codex App Server permission action." };
}

function grantedCodexAppServerPermissions(permissions) {
  const grantedPermissions = {};
  if (permissions?.network) {
    grantedPermissions.network = permissions.network;
  }
  if (permissions?.fileSystem) {
    grantedPermissions.fileSystem = permissions.fileSystem;
  }
  return grantedPermissions;
}

function codexAppServerElicitationResolution(action) {
  if (action === "decline") {
    return { ok: true, result: { action: "decline", content: null, _meta: null } };
  }
  if (action === "cancel") {
    return { ok: true, result: { action: "cancel", content: null, _meta: null } };
  }
  return { ok: false, error: "This Codex App Server elicitation can only be declined or canceled in TaskDeck." };
}

function clearCodexAppServerPendingRequest(activeAppServer, requestId) {
  activeAppServer.pendingServerRequests.delete(requestId);
  if (activeAppServer.currentServerRequestId === requestId) {
    activeAppServer.currentServerRequestId = newestCodexAppServerPendingRequestId(activeAppServer);
  }
}

function newestCodexAppServerPendingRequestId(activeAppServer) {
  const requestIds = Array.from(activeAppServer.pendingServerRequests.keys());
  return requestIds.length > 0 ? requestIds[requestIds.length - 1] : null;
}

function codexAppServerActionLabel(action) {
  if (action === "approve") return "approved";
  if (action === "decline") return "declined";
  if (action === "cancel") return "canceled";
  return String(action || "resolved");
}

function handleCodexAppServerNotification(activeAppServer, message) {
  const method = String(message.method || "");
  if (method === "thread/started") {
    handleCodexAppServerThreadStarted(activeAppServer, message.params);
    return;
  }
  if (method === "mcpServer/startupStatus/updated") {
    handleCodexAppServerMcpStatusUpdated(activeAppServer, message.params);
    return;
  }
  if (method === "thread/status/changed") {
    const threadId = String(message.params?.threadId || "").trim();
    if (isCodexAppServerNativeSubagentThread(activeAppServer, threadId)) {
      updateCodexAppServerNativeSubagentStatus(activeAppServer, threadId, message.params?.status);
      return;
    }
    updateCodexAppServerStatus(activeAppServer, message.params?.status);
    return;
  }
  if (method === "remoteControl/status/changed") {
    return;
  }
  if (method === "serverRequest/resolved") {
    handleCodexAppServerRequestResolved(activeAppServer, message.params);
    return;
  }
  if (method === "turn/started") {
    const threadId = String(message.params?.threadId || "").trim();
    if (isCodexAppServerNativeSubagentThread(activeAppServer, threadId)) {
      updateCodexAppServerNativeSubagentWorking(activeAppServer, threadId, "Codex App Server native subagent turn started.");
      return;
    }
    const turnId = String(message.params?.turn?.id || message.params?.turnId || "").trim();
    if (turnId) {
      activeAppServer.activeTurnId = turnId;
    }
    activeAppServer.turnActive = true;
    activeAppServer.assistantMessageOpen = false;
    updateAgentStateFromTaskDeckEvent(activeAppServer.taskId, AgentState.WORKING, {
      reason: "Codex App Server turn started.",
      source: AgentStateSource.PROCESS,
      confidence: AgentStateConfidence.HIGH,
      attentionState: AttentionState.NONE,
      attentionReason: "Codex App Server turn started.",
      attentionSource: AgentStateSource.PROCESS,
      attentionConfidence: AgentStateConfidence.HIGH,
    });
    return;
  }
  if (method === "item/started") {
    handleCodexAppServerItemStarted(activeAppServer, message.params);
    return;
  }
  if (method === "item/agentMessage/delta") {
    handleCodexAppServerAgentMessageDelta(activeAppServer, message.params);
    return;
  }
  if (method === "item/completed") {
    handleCodexAppServerItemCompleted(activeAppServer, message.params);
    return;
  }
  if (
    method === "item/commandExecution/outputDelta" ||
    method === "command/exec/outputDelta" ||
    method === "process/outputDelta"
  ) {
    return;
  }
  if (method === "thread/tokenUsage/updated") {
    activeAppServer.tokenUsage = message.params?.tokenUsage ?? null;
    return;
  }
  if (method === "account/rateLimits/updated") {
    activeAppServer.rateLimits = message.params?.rateLimits ?? null;
    return;
  }
  if (method === "turn/completed") {
    const threadId = String(message.params?.threadId || message.params?.turn?.threadId || "").trim();
    if (isCodexAppServerNativeSubagentThread(activeAppServer, threadId)) {
      completeCodexAppServerNativeSubagent(activeAppServer, threadId);
      return;
    }
    activeAppServer.activeTurnId = "";
    activeAppServer.turnActive = false;
    activeAppServer.assistantMessageOpen = false;
    if (codexAppServerTurnWasInterrupted(message.params)) {
      appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server turn stopped; ready for next input.\n");
      updateCodexAppServerReady(activeAppServer, "Codex App Server turn stopped.");
      return;
    }
    appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server turn completed; ready for next input.\n");
    updateCodexAppServerReady(activeAppServer, "Codex App Server turn completed.");
    return;
  }
  if (method === "account/login/completed") {
    handleCodexAppServerLoginCompleted(activeAppServer, message.params);
    return;
  }
  if (method === "account/updated") {
    handleCodexAppServerAccountUpdated(activeAppServer);
    return;
  }
  if (method === "error") {
    if (isCodexAppServerAuthError(message.params) && shouldReportCodexAppServerAuthFailure(activeAppServer)) {
      handleCodexAppServerAuthFailureDiagnostic(activeAppServer, message.params);
      return;
    }
    updateAgentStateFromTaskDeckEvent(activeAppServer.taskId, AgentState.FAILED, {
      reason: "Codex App Server emitted an error notification.",
      source: AgentStateSource.PROCESS,
      confidence: AgentStateConfidence.HIGH,
      attentionState: AttentionState.FAILED,
      attentionReason: "Codex App Server emitted an error notification.",
      attentionSource: AgentStateSource.PROCESS,
      attentionConfidence: AgentStateConfidence.HIGH,
    });
    return;
  }
  if (isRoutineCodexAppServerNotification(method)) {
    appendCodexAppServerDebugDiagnostic(activeAppServer, `[TaskDeck] Ignored Codex App Server notification: ${method}\n`);
    return;
  }
  appendCodexAppServerStatus(activeAppServer, `[TaskDeck] Unknown Codex App Server notification: ${method}\n`);
}

function handleCodexAppServerRequestResolved(activeAppServer, params) {
  const requestId = normalizeCodexAppServerRequestId(params?.requestId);
  if (requestId === null) {
    return;
  }
  if (!activeAppServer.pendingServerRequests.has(requestId)) {
    return;
  }
  clearCodexAppServerPendingRequest(activeAppServer, requestId);
  broadcastTasks();
}

function handleCodexAppServerThreadStarted(activeAppServer, params) {
  const thread = params?.thread;
  const threadId = String(thread?.id || "").trim();
  const parentThreadId = String(thread?.parentThreadId || "").trim();
  if (threadId && parentThreadId && parentThreadId === activeAppServer.threadId) {
    const taskId = materializeCodexAppServerNativeSubagent(activeAppServer, threadId, {
      model: thread?.modelProvider || "",
      prompt: thread?.agentRole || thread?.agentNickname || "",
      reasoningEffort: "",
    });
    if (taskId) {
      updateCodexAppServerNativeSubagentState(
        activeAppServer,
        threadId,
        AgentState.READY,
        "Codex App Server native subagent thread started.",
      );
      broadcastTasks();
    }
    return;
  }
  if (threadId && !parentThreadId && !activeAppServer.threadId) {
    const didRecordThreadSession = recordCodexAppServerThreadSession(activeAppServer, threadId);
    if (didRecordThreadSession) {
      broadcastTasks();
    }
  }
}

function handleCodexAppServerMcpStatusUpdated(activeAppServer, params) {
  const name = String(params?.name || "").trim();
  const status = String(params?.status || "").trim();
  const error = String(params?.error || "").trim();
  const normalizedStatus = status.toLowerCase();
  const shouldLog = codexAppServerDebugEnabled || normalizedStatus === "failed" || Boolean(error);
  if (!shouldLog) {
    return;
  }
  const details = [
    name ? `name=${name}` : "",
    status ? `status=${status}` : "",
    error ? `error=${error}` : "",
  ].filter(Boolean).join(" ");
  if (
    (normalizedStatus === "failed" || error) &&
    isCodexAppServerAuthError(details) &&
    shouldReportCodexAppServerAuthFailure(activeAppServer)
  ) {
    handleCodexAppServerAuthFailureDiagnostic(activeAppServer, details);
    if (!codexAppServerDebugEnabled) {
      return;
    }
  }
  appendCodexAppServerStatus(activeAppServer, `[TaskDeck] Codex App Server MCP status updated${details ? `: ${details}` : "."}\n`);
}

function handleCodexAppServerItemStarted(activeAppServer, params) {
  const threadId = String(params?.threadId || "").trim();
  if (isCodexAppServerNativeSubagentThread(activeAppServer, threadId)) {
    handleCodexAppServerNativeSubagentItemStarted(activeAppServer, threadId, params);
    return;
  }

  const item = params?.item;
  const itemType = String(item?.type || "");
  if (isCodexAppServerNativeSubagentSpawnItem(item)) {
    updateCodexAppServerWorking(activeAppServer, "Codex App Server started a native subagent.");
    appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server native subagent spawn started.\n");
    return;
  }
  if (itemType === "reasoning") {
    updateCodexAppServerWorking(activeAppServer, "Codex App Server started reasoning.");
    return;
  }
  if (itemType === "commandExecution") {
    updateCodexAppServerWorking(activeAppServer, "Codex App Server started a command.");
    const command = compactCodexAppServerCommand(String(item.command || ""));
    appendCodexAppServerStatus(activeAppServer, `[TaskDeck] Codex App Server command started${command ? `: ${command}` : "."}\n`);
  }
}

function handleCodexAppServerAgentMessageDelta(activeAppServer, params) {
  const threadId = String(params?.threadId || "").trim();
  if (
    isCodexAppServerNativeSubagentThread(activeAppServer, threadId) &&
    !activeAppServer.nativeSubagentTaskIdsByThreadId.has(threadId)
  ) {
    return;
  }
  const taskId = codexAppServerTaskIdForThread(activeAppServer, threadId);
  const delta = String(params?.delta || "");
  if (!delta) {
    return;
  }
  appendAndBroadcast(taskId, formatCodexAppServerAssistantText(activeAppServer, delta, taskId), {
    role: "assistant",
    kind: "assistant_delta",
  });
}

function formatCodexAppServerAssistantText(activeAppServer, delta, taskId = activeAppServer.taskId) {
  const assistantMessageOpen = isCodexAppServerAssistantMessageOpen(activeAppServer, taskId);
  if (assistantMessageOpen) {
    return delta;
  }
  setCodexAppServerAssistantMessageOpen(activeAppServer, taskId, true);
  const currentLog = logs.get(taskId) || "";
  const prefix = currentLog && !currentLog.endsWith("\n") ? "\n" : "";
  return `${prefix}[Assistant]\n${delta}`;
}

function appendCodexAppServerUserInput(activeAppServer, text, taskId = activeAppServer.taskId) {
  const normalizedText = String(text || "").trimEnd();
  if (!normalizedText) {
    return;
  }
  setCodexAppServerAssistantMessageOpen(activeAppServer, taskId, false);
  const currentLog = logs.get(taskId) || "";
  const prefix = currentLog && !currentLog.endsWith("\n") ? "\n" : "";
  appendAndBroadcast(taskId, `${prefix}[You]\n${normalizedText}\n`, { role: "user", kind: "user_input" });
}

function appendCodexAppServerStatus(activeAppServer, data) {
  appendCodexAppServerStatusForTask(activeAppServer, activeAppServer.taskId, data);
}

function appendCodexAppServerStatusForTask(activeAppServer, taskId, data) {
  setCodexAppServerAssistantMessageOpen(activeAppServer, taskId, false);
  const currentLog = logs.get(taskId) || "";
  const prefix = currentLog && !currentLog.endsWith("\n") ? "\n" : "";
  const suffix = data.endsWith("\n") ? "" : "\n";
  appendAndBroadcast(taskId, `${prefix}${data}${suffix}`, { role: "taskdeck", kind: "status" });
}

function appendCodexAppServerDebugDiagnostic(activeAppServer, data, taskId = activeAppServer.taskId) {
  if (!codexAppServerDebugEnabled) {
    return;
  }
  const currentLog = logs.get(taskId) || "";
  const prefix = currentLog && !currentLog.endsWith("\n") ? "\n" : "";
  const suffix = data.endsWith("\n") ? "" : "\n";
  appendAndBroadcast(taskId, `${prefix}${data}${suffix}`, { role: "taskdeck", kind: "debug" });
}

function appendCodexAppServerCommandOutput(activeAppServer, output, taskId = activeAppServer.taskId) {
  const normalizedOutput = String(output || "").trimEnd();
  if (!normalizedOutput) {
    return;
  }
  appendCodexAppServerStatusForTask(
    activeAppServer,
    taskId,
    `[TaskDeck] Codex App Server command output:\n${normalizedOutput}\n`
  );
}

function handleCodexAppServerItemCompleted(activeAppServer, params) {
  const threadId = String(params?.threadId || "").trim();
  if (isCodexAppServerNativeSubagentThread(activeAppServer, threadId)) {
    handleCodexAppServerNativeSubagentItemCompleted(activeAppServer, threadId, params);
    return;
  }

  const item = params?.item;
  if (isCodexAppServerNativeSubagentSpawnItem(item)) {
    materializeCodexAppServerNativeSubagents(activeAppServer, item);
    return;
  }
  if (item?.type !== "commandExecution") {
    return;
  }
  const output = String(item.aggregatedOutput || "");
  if (!output) {
    return;
  }
  appendCodexAppServerCommandOutput(activeAppServer, output);
}

function isCodexAppServerAssistantMessageOpen(activeAppServer, taskId) {
  if (taskId === activeAppServer.taskId) {
    return activeAppServer.assistantMessageOpen;
  }
  return activeAppServer.assistantMessageOpenTaskIds.has(taskId);
}

function setCodexAppServerAssistantMessageOpen(activeAppServer, taskId, isOpen) {
  if (taskId === activeAppServer.taskId) {
    activeAppServer.assistantMessageOpen = isOpen;
    return;
  }
  if (isOpen) {
    activeAppServer.assistantMessageOpenTaskIds.add(taskId);
    return;
  }
  activeAppServer.assistantMessageOpenTaskIds.delete(taskId);
}

function isCodexAppServerNativeSubagentSpawnItem(item) {
  return item?.type === "collabAgentToolCall" && item.tool === "spawnAgent";
}

function isCodexAppServerNativeSubagentThread(activeAppServer, threadId) {
  return Boolean(threadId && activeAppServer.threadId && threadId !== activeAppServer.threadId);
}

function codexAppServerTaskIdForThread(activeAppServer, threadId) {
  return resolveCodexAppServerTaskIdForThread({
    threadId,
    defaultTaskId: activeAppServer.taskId,
    taskIdByThreadId: taskIdByCodexThreadId,
  });
}

function materializeCodexAppServerNativeSubagents(activeAppServer, item) {
  const receiverThreadIds = normalizeStringArray(item?.receiverThreadIds);
  if (receiverThreadIds.length === 0) {
    appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server native subagent spawn completed without a thread id.\n");
    return;
  }

  const createdTaskIds = [];
  for (const threadId of receiverThreadIds) {
    const taskId = materializeCodexAppServerNativeSubagent(activeAppServer, threadId, item);
    if (taskId) {
      createdTaskIds.push(taskId);
    }
  }

  const threadSummary = receiverThreadIds.map(shortCodexAppServerThreadId).join(", ");
  appendCodexAppServerStatus(
    activeAppServer,
    `[TaskDeck] Codex App Server native subagent spawn completed: ${threadSummary}.\n`,
  );
  if (createdTaskIds.length > 0) {
    broadcastTasks();
  }
}

function materializeCodexAppServerNativeSubagent(activeAppServer, threadId, item) {
  const existingTaskId = activeAppServer.nativeSubagentTaskIdsByThreadId.get(threadId);
  if (existingTaskId) {
    return "";
  }

  const parentTask = tasks.get(activeAppServer.taskId);
  if (!parentTask) {
    return "";
  }

  const detectedAt = new Date().toISOString();
  const subagentTask = markTaskInputLocked(
    markTaskAgentState(
      markTaskRunning(createTask({
        title: codexAppServerNativeSubagentTitle(item, threadId),
        command: `Codex App Server native subagent ${threadId}`,
        cwd: parentTask.cwd,
        agentProfileId: parentTask.agentProfileId,
        agentLabel: `${parentTask.agentLabel || "Codex App Server"} subagent`,
        agentModel: String(item?.model || parentTask.agentModel || ""),
        agentReasoningEffort: String(item?.reasoningEffort || ""),
        sessionMode: "subagent",
        initialInstruction: String(item?.prompt || ""),
        agentSessionProvider: codexAppServerAgentSessionProvider,
        agentSessionId: threadId,
        agentSessionSource: codexAppServerNativeSubagentSessionSource,
        agentSessionDetectedAt: detectedAt,
        parentSessionId: parentTask.id,
        identityColorSlot: assignTaskIdentityColorSlot(),
      })),
      AgentState.STARTING,
      {
        reason: "Codex App Server spawned a native subagent.",
        source: AgentStateSource.PROCESS,
        confidence: AgentStateConfidence.HIGH,
        attentionState: AttentionState.NONE,
        attentionReason: "Codex App Server native subagent started.",
        attentionSource: AgentStateSource.PROCESS,
        attentionConfidence: AgentStateConfidence.HIGH,
      },
    ),
    detectedAt,
  );

  tasks.set(subagentTask.id, subagentTask);
  logs.set(subagentTask.id, "");
  taskOutputSequences.set(subagentTask.id, 0);
  activeAppServer.nativeSubagentTaskIdsByThreadId.set(threadId, subagentTask.id);
  taskIdByCodexThreadId.set(threadId, subagentTask.id);
  persistTasks();
  writeTaskLog(
    subagentTask.id,
    `[TaskDeck] Codex App Server native subagent materialized from ${parentTask.title || parentTask.id}: ${threadId}.\n`,
  );
  logs.set(
    subagentTask.id,
    `[TaskDeck] Codex App Server native subagent materialized from ${parentTask.title || parentTask.id}: ${threadId}.\n`,
  );
  return subagentTask.id;
}

function codexAppServerNativeSubagentTitle(item, threadId) {
  const prompt = String(item?.prompt || "").trim().replace(/\s+/g, " ");
  if (prompt) {
    return `Codex subagent: ${prompt.slice(0, 72)}`;
  }
  return `Codex subagent ${shortCodexAppServerThreadId(threadId)}`;
}

function shortCodexAppServerThreadId(threadId) {
  return String(threadId || "").trim().slice(0, 8) || "unknown";
}

function updateCodexAppServerNativeSubagentStatus(activeAppServer, threadId, status) {
  const statusType = String(status?.type || "");
  if (statusType === "active") {
    updateCodexAppServerNativeSubagentWorking(activeAppServer, threadId, "Codex App Server native subagent is active.");
    return;
  }
  if (statusType === "idle") {
    updateCodexAppServerNativeSubagentState(activeAppServer, threadId, AgentState.READY, "Codex App Server native subagent is idle.");
    return;
  }
  if (statusType === "systemError") {
    updateCodexAppServerNativeSubagentState(activeAppServer, threadId, AgentState.FAILED, "Codex App Server native subagent reported a system error.", {
      attentionState: AttentionState.FAILED,
      attentionReason: "Codex App Server native subagent reported a system error.",
    });
  }
}

function updateCodexAppServerNativeSubagentWorking(activeAppServer, threadId, reason) {
  updateCodexAppServerNativeSubagentState(activeAppServer, threadId, AgentState.WORKING, reason);
}

function updateCodexAppServerNativeSubagentState(activeAppServer, threadId, agentState, reason, attention = {}) {
  const taskId = activeAppServer.nativeSubagentTaskIdsByThreadId.get(threadId);
  if (!taskId) {
    return false;
  }
  return updateAgentStateFromTaskDeckEvent(taskId, agentState, {
    reason,
    source: AgentStateSource.PROCESS,
    confidence: AgentStateConfidence.HIGH,
    attentionState: attention.attentionState ?? AttentionState.NONE,
    attentionReason: attention.attentionReason ?? reason,
    attentionSource: AgentStateSource.PROCESS,
    attentionConfidence: AgentStateConfidence.HIGH,
  });
}

function handleCodexAppServerNativeSubagentItemStarted(activeAppServer, threadId, params) {
  const item = params?.item;
  const itemType = String(item?.type || "");
  if (itemType === "reasoning") {
    updateCodexAppServerNativeSubagentWorking(activeAppServer, threadId, "Codex App Server native subagent started reasoning.");
    return;
  }
  if (itemType === "commandExecution") {
    updateCodexAppServerNativeSubagentWorking(activeAppServer, threadId, "Codex App Server native subagent started a command.");
    const taskId = activeAppServer.nativeSubagentTaskIdsByThreadId.get(threadId);
    const command = compactCodexAppServerCommand(String(item.command || ""));
    if (taskId) {
      appendCodexAppServerStatusForTask(
        activeAppServer,
        taskId,
        `[TaskDeck] Codex App Server native subagent command started${command ? `: ${command}` : "."}\n`,
      );
    }
  }
}

function handleCodexAppServerNativeSubagentItemCompleted(activeAppServer, threadId, params) {
  const item = params?.item;
  if (item?.type !== "commandExecution") {
    return;
  }
  const taskId = activeAppServer.nativeSubagentTaskIdsByThreadId.get(threadId);
  if (!taskId) {
    return;
  }
  appendCodexAppServerCommandOutput(activeAppServer, String(item.aggregatedOutput || ""), taskId);
}

function completeCodexAppServerNativeSubagent(activeAppServer, threadId) {
  const taskId = activeAppServer.nativeSubagentTaskIdsByThreadId.get(threadId);
  if (!taskId) {
    return false;
  }
  const task = tasks.get(taskId);
  if (!task || task.status !== TaskStatus.RUNNING) {
    return false;
  }
  const completedTask = {
    ...markTaskExited(task, { exitCode: 0, signal: null }),
    agentStateReason: "Codex App Server native subagent turn completed.",
    attentionStateReason: "Codex App Server native subagent completed successfully.",
  };
  setTask(completedTask);
  appendCodexAppServerStatusForTask(
    activeAppServer,
    taskId,
    "[TaskDeck] Codex App Server native subagent turn completed.\n",
  );
  broadcastTasks();
  return true;
}

function updateCodexAppServerReady(activeAppServer, reason) {
  if (codexRuntimeStateForThreadSession(activeAppServer).authFailureDetected) {
    return;
  }
  updateAgentStateFromTaskDeckEvent(activeAppServer.taskId, AgentState.READY, {
    reason,
    source: AgentStateSource.PROCESS,
    confidence: AgentStateConfidence.HIGH,
    attentionState: AttentionState.NONE,
    attentionReason: reason,
    attentionSource: AgentStateSource.PROCESS,
    attentionConfidence: AgentStateConfidence.HIGH,
  });
}

function updateCodexAppServerWorking(activeAppServer, reason) {
  if (codexRuntimeStateForThreadSession(activeAppServer).authFailureDetected) {
    return;
  }
  updateAgentStateFromTaskDeckEvent(activeAppServer.taskId, AgentState.WORKING, {
    reason,
    source: AgentStateSource.PROCESS,
    confidence: AgentStateConfidence.HIGH,
    attentionState: AttentionState.NONE,
    attentionReason: reason,
    attentionSource: AgentStateSource.PROCESS,
    attentionConfidence: AgentStateConfidence.HIGH,
  });
}

function updateCodexAppServerStatus(activeAppServer, status) {
  const statusType = String(status?.type || "");
  const activeFlags = Array.isArray(status?.activeFlags) ? status.activeFlags.map(String) : [];
  if (activeFlags.includes("waitingOnApproval")) {
    updateAgentStateFromTaskDeckEvent(activeAppServer.taskId, AgentState.WAITING_APPROVAL, {
      reason: "Codex App Server is waiting on approval.",
      source: AgentStateSource.PROCESS,
      confidence: AgentStateConfidence.HIGH,
      attentionState: AttentionState.NEEDS_APPROVAL,
      attentionReason: "Codex App Server is waiting on approval.",
      attentionSource: AgentStateSource.PROCESS,
      attentionConfidence: AgentStateConfidence.HIGH,
    });
    return;
  }
  if (activeFlags.includes("waitingOnUserInput")) {
    updateAgentStateFromTaskDeckEvent(activeAppServer.taskId, AgentState.WAITING_INPUT, {
      reason: "Codex App Server is waiting on user input.",
      source: AgentStateSource.PROCESS,
      confidence: AgentStateConfidence.HIGH,
      attentionState: AttentionState.NEEDS_INPUT,
      attentionReason: "Codex App Server is waiting on user input.",
      attentionSource: AgentStateSource.PROCESS,
      attentionConfidence: AgentStateConfidence.HIGH,
    });
    return;
  }
  if (statusType === "active") {
    updateCodexAppServerWorking(activeAppServer, "Codex App Server thread is active.");
    return;
  }
  if (statusType === "idle") {
    activeAppServer.turnActive = false;
    updateCodexAppServerReady(activeAppServer, "Codex App Server thread is idle.");
    return;
  }
  if (statusType === "systemError") {
    updateAgentStateFromTaskDeckEvent(activeAppServer.taskId, AgentState.FAILED, {
      reason: "Codex App Server thread reported a system error.",
      source: AgentStateSource.PROCESS,
      confidence: AgentStateConfidence.HIGH,
      attentionState: AttentionState.FAILED,
      attentionReason: "Codex App Server thread reported a system error.",
      attentionSource: AgentStateSource.PROCESS,
      attentionConfidence: AgentStateConfidence.HIGH,
    });
  }
}

function codexAppServerTurnWasInterrupted(params) {
  const status = String(params?.status || params?.turn?.status || "").trim();
  return status === "interrupted";
}

function flushCodexAppServerPendingInputs(activeAppServer) {
  if (codexRuntimeStateForThreadSession(activeAppServer).authFailureDetected) {
    return false;
  }
  const initialInstruction = String(tasks.get(activeAppServer.taskId)?.initialInstruction || "").trim();
  const pendingInputs = activeAppServer.pendingInputs.splice(0);
  if (initialInstruction) {
    appendCodexAppServerUserInput(activeAppServer, initialInstruction);
    pendingInputs.unshift(buildCodexTurnInput(tasks.get(activeAppServer.taskId), initialInstruction));
  }
  if (pendingInputs.length === 0) {
    updateCodexAppServerReady(activeAppServer, "Codex App Server adapter is ready.");
    appendCodexAppServerStatus(activeAppServer, "[TaskDeck] Codex App Server adapter is ready; send input to start a turn.\n");
    return false;
  }
  for (const input of pendingInputs) {
    sendCodexAppServerTurn(activeAppServer, input);
  }
  return true;
}

function compactCodexAppServerCommand(command) {
  return command.replace(/\s+/g, " ").trim().slice(0, 160);
}

function isCodexAppServerApprovalRequest(method) {
  return method.includes("requestApproval") || method === "applyPatchApproval" || method === "execCommandApproval";
}

function isCodexAppServerUserInputRequest(method) {
  return method.includes("requestUserInput") || method.includes("elicitation/request");
}

function appendAndBroadcast(taskId, data, metadata = {}) {
  appendLog(taskId, data);
  broadcast(buildOutputEvent(taskId, data, metadata));
}

function buildOutputEvent(taskId, data, metadata = {}) {
  outputSequence += 1;
  const taskSeq = outputSequenceForTask(taskId) + 1;
  taskOutputSequences.set(taskId, taskSeq);
  return {
    type: "output",
    taskId,
    data,
    seq: outputSequence,
    taskSeq,
    role: outputEventRole(metadata.role),
    kind: outputEventKind(metadata.kind),
  };
}

function outputSequenceForTask(taskId) {
  return taskOutputSequences.get(taskId) || 0;
}

function outputEventRole(role) {
  const normalizedRole = String(role || "").trim();
  if (normalizedRole === "user" || normalizedRole === "assistant" || normalizedRole === "taskdeck") {
    return normalizedRole;
  }
  return "taskdeck";
}

function outputEventKind(kind) {
  const normalizedKind = String(kind || "").trim();
  return normalizedKind || "log";
}

async function validateCwd(cwd) {
  const inputCwd = String(cwd || "").trim();
  const resolvedCwd = inputCwd ? path.resolve(repoRoot, inputCwd) : repoRoot;
  const statCwd = await serverAccessiblePathForHostCwd(resolvedCwd);

  try {
    const stat = await fs.stat(statCwd);
    if (!stat.isDirectory()) {
      return {
        ok: false,
        inputCwd,
        resolvedCwd,
        exists: true,
        isDirectory: false,
        isGitRepo: false,
        message: `cwd is not a directory: ${resolvedCwd}`,
      };
    }

    return {
      ok: true,
      inputCwd,
      resolvedCwd,
      exists: true,
      isDirectory: true,
      isGitRepo: await cwdIsGitRepo(statCwd),
      message: inputCwd ? "Working directory is valid." : "Using repository root.",
    };
  } catch {
    return {
      ok: false,
      inputCwd,
      resolvedCwd,
      exists: false,
      isDirectory: false,
      isGitRepo: false,
      message: `cwd does not exist: ${resolvedCwd}`,
    };
  }
}

async function ensureChildStatusFilePath(task) {
  const primaryStatusFile = defaultChildStatusFilePath(task);
  try {
    await fs.mkdir(path.dirname(primaryStatusFile), { recursive: true });
    return primaryStatusFile;
  } catch (error) {
    const fallbackStatusFile = path.join(dataRoot, "statuses", `${task.id}.json`);
    console.warn(`TaskDeck could not create task-local status directory: ${error.message}`);
    try {
      await fs.mkdir(path.dirname(fallbackStatusFile), { recursive: true });
      return fallbackStatusFile;
    } catch (fallbackError) {
      console.warn(`TaskDeck could not create fallback status directory: ${fallbackError.message}`);
      return primaryStatusFile;
    }
  }
}

function childStatusFilePathForTask(task) {
  const statusFile = String(task.childStatusFile || "").trim();
  if (statusFile) {
    return path.resolve(statusFile);
  }
  return defaultChildStatusFilePath(task);
}

function defaultChildStatusFilePath(task) {
  return path.join(dataRoot, "statuses", `${task.id}.json`);
}

async function initialInstructionForTaskLaunch({ isManagerLaunch, command, initialInstruction }) {
  const userInstruction = String(initialInstruction || "").trim();
  if (!isManagerLaunch) {
    return userInstruction;
  }

  const managerBootstrap = await buildManagerBootstrapInstruction(command);
  return [managerBootstrap, userInstruction ? `Task-specific instruction:\n${userInstruction}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

async function buildManagerBootstrapInstruction(command) {
  const visibleRepoRoot = await taskVisibleHostPath(command, repoRoot);
  const joinVisiblePath = extractDockerExecWorkdir(command) ? path.posix.join : path.join;
  const managerRoleGuide = joinVisiblePath(visibleRepoRoot, "docs", "agents", "roles", "taskdeck-manager.md");
  return [
    "You are the TaskDeck Manager.",
    "",
    "First, read:",
    `- docs/agents/roles/taskdeck-manager.md (${managerRoleGuide})`,
    "- $TASKDECK_MANAGER_CONTEXT_FILE",
    "- $TASKDECK_MANAGER_UNREAD_EVENTS_FILE",
    "",
    "If present, also read:",
    "- $TASKDECK_MANAGER_ACTIONS_FILE",
    "- $TASKDECK_MANAGER_CAPABILITIES_FILE",
    "",
    "Use only taskdeckctl commands listed in the generated manager action guide.",
    "Do not invent taskdeckctl commands.",
    "Do not call raw TaskDeck endpoints.",
    "Do not command worker sessions directly except through supported manager actions.",
    "Do not write TASKDECK_STATUS_FILE.",
  ].join("\n");
}

async function taskDeckEnvironmentForTask(task, command, hostStatusFile) {
  const childStatusFile = await childVisibleStatusFilePathForTask(task, command, hostStatusFile);
  const managerReadablePaths = await managerReadableVisiblePathsForTask(command);
  return {
    TASKDECK_TASK_ID: task.id,
    TASKDECK_STATUS_FILE: childStatusFile,
    ...(isManagerTask(task)
      ? {
          TASKDECK_MANAGER_ROLE: "manager",
          TASKDECK_MANAGER_INBOX_DIR: managerReadablePaths.inboxDir,
          TASKDECK_MANAGER_READABLE_DIR: managerReadablePaths.readableDir,
          TASKDECK_MANAGER_CONTEXT_FILE: managerReadablePaths.contextFile,
          TASKDECK_MANAGER_UNREAD_EVENTS_FILE: managerReadablePaths.unreadEventsFile,
          TASKDECK_MANAGER_ACTIONS_FILE: managerReadablePaths.actionsFile,
          TASKDECK_MANAGER_CAPABILITIES_FILE: managerReadablePaths.capabilitiesFile,
          TASKDECK_MANAGER_ACTION_SOCKET: managerReadablePaths.actionSocket,
          TASKDECK_MANAGER_ACTION_LOG_DIR: managerReadablePaths.actionLogDir,
          TASKDECK_MANAGER_ACTION_HISTORY_FILE: managerReadablePaths.actionHistoryFile,
        }
      : {}),
  };
}

async function managerReadableVisiblePathsForTask(command) {
  const visibleDataRoot = await taskVisibleHostPath(command, dataRoot);
  const joinVisiblePath = extractDockerExecWorkdir(command) ? path.posix.join : path.join;
  return {
    inboxDir: joinVisiblePath(visibleDataRoot, "manager-inbox"),
    readableDir: joinVisiblePath(visibleDataRoot, MANAGER_READABLE_DIRNAME),
    contextFile: joinVisiblePath(visibleDataRoot, MANAGER_READABLE_DIRNAME, MANAGER_READABLE_CONTEXT_FILENAME),
    unreadEventsFile: joinVisiblePath(visibleDataRoot, MANAGER_READABLE_DIRNAME, MANAGER_READABLE_UNREAD_EVENTS_FILENAME),
    actionsFile: joinVisiblePath(visibleDataRoot, MANAGER_READABLE_DIRNAME, MANAGER_READABLE_ACTIONS_FILENAME),
    capabilitiesFile: joinVisiblePath(visibleDataRoot, MANAGER_READABLE_DIRNAME, MANAGER_READABLE_CAPABILITIES_FILENAME),
    actionSocket: joinVisiblePath(visibleDataRoot, "run", path.basename(managerActionSocketPath)),
    actionLogDir: joinVisiblePath(visibleDataRoot, "manager-actions"),
    actionHistoryFile: joinVisiblePath(visibleDataRoot, "manager-actions", "history.json"),
  };
}

async function taskVisibleHostPath(command, hostPath) {
  const dockerWorkdir = extractDockerExecWorkdir(command);
  if (!dockerWorkdir) {
    return hostPath;
  }

  const containerPath = await containerCwdForHostCwd(hostPath, defaultContainerWorkspaceRoot);
  if (containerPath) {
    return containerPath;
  }

  const resolvedHostPath = path.resolve(String(hostPath || ""));
  if (isPathWithin(resolvedHostPath, repoRoot)) {
    return path.posix.join(
      dockerWorkdir.split(path.sep).join(path.posix.sep),
      ...path.relative(repoRoot, resolvedHostPath).split(path.sep).filter(Boolean),
    );
  }

  return resolvedHostPath;
}

async function childVisibleStatusFilePathForTask(task, command, hostStatusFile) {
  if (isManagerTask(task)) {
    return taskVisibleHostPath(command, hostStatusFile);
  }

  const dockerWorkdir = extractDockerExecWorkdir(command);
  if (!dockerWorkdir) {
    return hostStatusFile;
  }

  return path.posix.join(
    dockerWorkdir.split(path.sep).join(path.posix.sep),
    ".taskdeck",
    "statuses",
    `${task.id}.json`,
  );
}

function commandWithTaskDeckEnv(command, taskDeckEnv) {
  const envEntries = Object.entries(taskDeckEnv || {}).filter(([, value]) => String(value || "").trim());
  if (envEntries.length === 0) {
    return command;
  }

  const dockerExec = findDockerExecContainerToken(command);
  if (!dockerExec) {
    return command;
  }

  const dockerEnvArgs = envEntries
    .map(([name, value]) => `-e ${quoteShellToken(`${name}=${value}`)}`)
    .join(" ");
  return `${String(command).slice(0, dockerExec.start)}${dockerEnvArgs} ${String(command).slice(dockerExec.start)}`;
}

async function scanChildStatusFiles() {
  if (childStatusPollInFlight) {
    return;
  }

  childStatusPollInFlight = true;
  let changed = false;
  try {
    for (const task of tasks.values()) {
      changed = (await scanChildStatusFileForTask(task)) || changed;
    }
    if (changed) {
      await persistTasks();
      broadcastTasks();
    }
  } catch (error) {
    console.warn(`TaskDeck task status scan failed: ${error.message}`);
  } finally {
    childStatusPollInFlight = false;
  }
}

async function scanChildStatusFileForTask(task) {
  if (task.status === TaskStatus.CLOSED) {
    return false;
  }

  const statusFilePath = childStatusFilePathForTask(task);
  let fileContents;

  try {
    fileContents = await fs.readFile(statusFilePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    const errorFingerprint = `read-error:${statusFilePath}:${error.message}`;
    if (childStatusFileSnapshots.get(task.id) === errorFingerprint) {
      return false;
    }
    childStatusFileSnapshots.set(task.id, errorFingerprint);
    return updateTaskFromChildStatusResult(task.id, {
      ok: false,
      error: `Could not read task status file: ${error.message}`,
    });
  }

  const fingerprint = `contents:${statusFilePath}:${fileContents}`;
  if (childStatusFileSnapshots.get(task.id) === fingerprint) {
    return false;
  }
  childStatusFileSnapshots.set(task.id, fingerprint);
  return updateTaskFromChildStatusResult(task.id, parseChildStatusReportJson(fileContents));
}

async function updateTaskFromChildStatusResult(taskId, result) {
  const task = tasks.get(taskId);
  if (!task) {
    return false;
  }
  if (task.status === TaskStatus.CLOSED) {
    return false;
  }

  const now = new Date().toISOString();
  const nextTask = result.ok
    ? markTaskChildStatusReported(task, result.report, now)
    : markTaskChildStatusError(task, result.error, now);

  if (haveSameChildStatusFields(task, nextTask)) {
    return false;
  }

  tasks.set(task.id, nextTask);
  return true;
}

async function startManagerActionSocket() {
  await fs.mkdir(managerActionRunRoot, { recursive: true });
  managerActionSocketPath = await prepareManagerActionSocketPath();
  managerActionTcpToken = randomBytes(32).toString("hex");

  const actionServer = createManagerActionLineServer({
    label: "socket",
    handleRawMessage: handleManagerActionSocketMessage,
  });

  actionServer.on("error", (error) => {
    console.error(`TaskDeck manager action socket failed at ${managerActionSocketPath}: ${error.message}`);
  });

  await new Promise((resolve, reject) => {
    actionServer.once("error", reject);
    actionServer.listen(managerActionSocketPath, async () => {
      actionServer.off("error", reject);
      try {
        await fs.chmod(managerActionSocketPath, 0o600);
      } catch (error) {
        if (error.code !== "EINVAL") {
          console.warn(`TaskDeck could not restrict manager action socket permissions: ${error.message}`);
        }
      }
      console.log(`TaskDeck manager action socket listening at ${managerActionSocketPath}`);
      resolve();
    });
  });

  const tcpServer = createManagerActionLineServer({
    label: "tcp",
    handleRawMessage: handleManagerActionTcpMessage,
  });

  tcpServer.on("error", (error) => {
    console.error(`TaskDeck manager action TCP endpoint failed at ${managerActionTcpHost}: ${error.message}`);
  });

  await new Promise((resolve, reject) => {
    tcpServer.once("error", reject);
    tcpServer.listen(0, managerActionTcpHost, async () => {
      tcpServer.off("error", reject);
      const address = tcpServer.address();
      managerActionTcpPort = typeof address === "object" && address ? address.port : 0;
      await writeManagerActionPointer();
      console.log(`TaskDeck manager action TCP endpoint listening at ${managerActionTcpHost}:${managerActionTcpPort}`);
      resolve();
    });
  });
}

function createManagerActionLineServer({ label, handleRawMessage }) {
  return net.createServer((socket) => {
    let buffer = "";

    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const rawAction = buffer.slice(0, newlineIndex);
      buffer = "";
      handleRawMessage(rawAction)
        .then((result) => {
          socket.end(`${JSON.stringify(result)}\n`);
        })
        .catch((error) => {
          socket.end(`${JSON.stringify(managerActionError("internal_error", error.message || "Manager action failed."))}\n`);
        });
    });

    socket.on("error", (error) => {
      console.warn(`TaskDeck manager action ${label} error: ${error.message}`);
    });
  });
}

async function prepareManagerActionSocketPath() {
  try {
    await removeManagerActionSocketPath(managerActionDefaultSocketPath);
    return managerActionDefaultSocketPath;
  } catch (error) {
    if (error.code !== "ENOTSUP") {
      throw error;
    }

    const fallbackSocketPath = path.join(managerActionRunRoot, `manager-actions-${process.pid}-${Date.now()}.sock`);
    console.warn(
      `TaskDeck could not remove stale manager action socket ${managerActionDefaultSocketPath}; using ${fallbackSocketPath}.`,
    );
    await removeManagerActionSocketPath(fallbackSocketPath);
    return fallbackSocketPath;
  }
}

async function removeManagerActionSocketPath(socketPath) {
  try {
    await fs.unlink(socketPath);
  } catch (error) {
    if (error.code === "EISDIR" || error.code === "EPERM") {
      console.warn(`TaskDeck manager action path exists and cannot be removed: ${socketPath}`);
      return;
    }
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function writeManagerActionPointer() {
  await writeJsonAtomic(managerActionSocketPointerPath, {
    kind: "taskDeckManagerActionTransport",
    version: 2,
    socketPath: managerActionSocketPath,
    transports: [
      {
        type: "unix",
        path: managerActionSocketPath,
      },
      {
        type: "tcp",
        host: managerActionTcpHost,
        containerHost: managerActionContainerHost,
        port: managerActionTcpPort,
        token: managerActionTcpToken,
      },
    ],
    updatedAt: new Date().toISOString(),
  });
}

async function handleManagerActionSocketMessage(rawAction) {
  let parsed;
  try {
    parsed = JSON.parse(rawAction);
  } catch {
    const result = managerActionError("invalid_json", "Manager action must be a JSON object.");
    await writeManagerActionLog(managerActionLogRecord({ action: "invalid_json" }), result);
    return result;
  }
  return executeManagerAction(parsed);
}

async function handleManagerActionTcpMessage(rawMessage) {
  let parsed;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    const result = managerActionError("invalid_json", "Manager action TCP message must be a JSON object.");
    await writeManagerActionLog(managerActionLogRecord({ action: "invalid_json" }), result);
    return result;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const result = managerActionError("invalid_action", "Manager action TCP message must be a JSON object.");
    await writeManagerActionLog(managerActionLogRecord({ action: "invalid_tcp_message" }), result);
    return result;
  }

  if (!managerActionTcpToken || parsed.token !== managerActionTcpToken) {
    const result = managerActionError("unauthorized", "Manager action TCP token is invalid.");
    await writeManagerActionLog(managerActionLogRecord({ action: "unauthorized_tcp" }), result);
    return result;
  }

  return executeManagerAction(parsed.action);
}

async function executeManagerAction(action) {
  const validation = validateManagerAction(action);
  if (!validation.ok) {
    const result = managerActionError("invalid_action", validation.error);
    await writeManagerActionLog(managerActionLogRecord(action), result);
    return result;
  }

  const normalizedAction = validation.action;
  if (processedManagerActionIds.has(normalizedAction.actionId)) {
    const result = {
      ok: true,
      deduped: true,
      actionId: normalizedAction.actionId,
      action: normalizedAction.action,
      message: "Manager action was already processed.",
    };
    await writeManagerActionLog(normalizedAction, result);
    return result;
  }

  let result;
  if (normalizedAction.action === "ack") {
    result = await executeManagerAckAction(normalizedAction);
  } else if (normalizedAction.action === "review") {
    result = await executeManagerReviewAction(normalizedAction);
  } else if (normalizedAction.action === "close") {
    result = await executeManagerCloseAction(normalizedAction);
  } else {
    result = managerActionError("unsupported_action", "Only ack, review, and close are supported by this manager action endpoint.");
  }

  if (result.ok) {
    processedManagerActionIds.add(normalizedAction.actionId);
  }
  await writeManagerActionLog(normalizedAction, result);
  return result;
}

function validateManagerAction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Manager action must be a JSON object." };
  }

  const action = normalizeManagerActionType(value.action || value.type);
  if (!managerActionTypes.has(action)) {
    return { ok: false, error: "Manager action must be ack, review, or close." };
  }

  const actionId = sanitizeManagerEventId(value.actionId || randomUUID());
  if (!actionId) {
    return { ok: false, error: "actionId is required." };
  }

  const actorTaskId = String(value.actorTaskId || "").trim();
  if (actorTaskId) {
    const actorTask = tasks.get(actorTaskId);
    if (!actorTask) {
      return { ok: false, error: "actorTaskId does not match a known task." };
    }
    if (!isManagerTask(actorTask)) {
      return { ok: false, error: "actorTaskId must reference a manager task." };
    }
  }

  const eventId = sanitizeManagerEventId(value.eventId || value.managerEventId || "");
  const taskId = String(value.taskId || value.targetTaskId || "").trim();
  if (action === "ack" && !eventId && !taskId) {
    return { ok: false, error: "ack requires eventId or taskId." };
  }
  if ((action === "review" || action === "close") && !taskId) {
    return { ok: false, error: `${action} requires taskId.` };
  }

  return {
    ok: true,
    action: {
      action,
      actionId,
      actorTaskId,
      eventId,
      taskId,
      reason: String(value.reason || "").trim(),
      requestedAt: typeof value.requestedAt === "string" && value.requestedAt.trim() ? value.requestedAt : new Date().toISOString(),
    },
  };
}

function managerActionLogRecord(value = {}) {
  return {
    action: normalizeManagerActionType(value.action || value.type) || "invalid",
    actionId: sanitizeManagerEventId(value.actionId || randomUUID()) || randomUUID(),
    actorTaskId: String(value.actorTaskId || "").trim(),
    eventId: sanitizeManagerEventId(value.eventId || value.managerEventId || ""),
    taskId: String(value.taskId || value.targetTaskId || "").trim(),
    reason: String(value.reason || "").trim(),
    requestedAt: typeof value.requestedAt === "string" && value.requestedAt.trim() ? value.requestedAt : new Date().toISOString(),
  };
}

function normalizeManagerActionType(action) {
  const normalizedAction = String(action || "").trim();
  if (normalizedAction === "mark-reviewed" || normalizedAction === "markReviewed" || normalizedAction === "markTaskReviewed") {
    return "review";
  }
  if (normalizedAction === "archive" || normalizedAction === "archive-task" || normalizedAction === "closeTask") {
    return "close";
  }
  return normalizedAction;
}

async function executeManagerAckAction(action) {
  const ackedAt = new Date().toISOString();
  let ackedEvent = null;
  let taskId = action.taskId;
  let managerEventAcked = false;
  let managerEventAlreadyAcknowledged = false;
  let taskAttentionAcknowledged = false;
  let taskAttentionSkippedReason = "";

  if (action.eventId) {
    const eventResult = await readManagerInboxEvent(action.eventId);
    if (!eventResult.ok) {
      return managerActionError(eventResult.code, eventResult.error, action);
    }
    ackedEvent = eventResult.event;
    managerEventAlreadyAcknowledged = Boolean(eventResult.alreadyAcknowledged);
    taskId = taskId || ackedEvent.childTaskId;
    managerEventAcked = managerEventAlreadyAcknowledged ? false : await writeManagerEventAck(ackedEvent, ackedAt, action);
  }

  if (taskId) {
    const taskResult = await acknowledgeTaskAttentionFromManager(taskId, ackedAt, { requireTask: !ackedEvent });
    if (!taskResult.ok) {
      return managerActionError(taskResult.code, taskResult.error, action);
    }
    taskAttentionAcknowledged = taskResult.acknowledged;
    taskAttentionSkippedReason = taskResult.skippedReason || "";
  }

  await refreshManagerReadableFiles();
  broadcastTasks();

  return {
    ok: true,
    actionId: action.actionId,
    action: action.action,
    eventId: action.eventId || "",
    taskId: taskId || "",
    managerEventAcked,
    managerEventAlreadyAcknowledged,
    taskAttentionAcknowledged,
    taskAttentionSkippedReason,
    event: ackedEvent,
    tasks: listTasks(),
    runningTaskId: getPrimaryRunningTaskId(),
    runningTaskIds: getRunningTaskIds(),
  };
}

async function executeManagerReviewAction(action) {
  const reviewedAt = new Date().toISOString();
  const task = tasks.get(action.taskId);
  if (!task) {
    return managerActionError("task_not_found", "Task not found.", action);
  }

  const alreadyReviewed = Boolean(task.reviewedAt);
  if (!alreadyReviewed) {
    setTask(markTaskReviewed(task, { reviewedAt, reviewedByTaskId: action.actorTaskId }));
    await persistTasks();
  }

  await refreshManagerReadableFiles();
  broadcastTasks();

  return {
    ok: true,
    actionId: action.actionId,
    action: action.action,
    taskId: action.taskId,
    reviewed: !alreadyReviewed,
    alreadyReviewed,
    task: serializeTaskForClient(tasks.get(action.taskId)),
    tasks: listTasks(),
    runningTaskId: getPrimaryRunningTaskId(),
    runningTaskIds: getRunningTaskIds(),
  };
}

async function executeManagerCloseAction(action) {
  const closedAt = new Date().toISOString();
  const task = tasks.get(action.taskId);
  if (!task) {
    return managerActionError("task_not_found", "Task not found.", action);
  }

  const alreadyClosed = Boolean(task.closedAt || task.status === TaskStatus.CLOSED);
  if (!alreadyClosed) {
    setTask(markTaskClosed(task, { closedAt, closedByTaskId: action.actorTaskId }));
    await persistTasks();
    await stopTaskProcesses(action.taskId);
  }

  await refreshManagerReadableFiles();
  broadcastTasks();

  return {
    ok: true,
    actionId: action.actionId,
    action: action.action,
    taskId: action.taskId,
    closed: !alreadyClosed,
    alreadyClosed,
    task: serializeTaskForClient(tasks.get(action.taskId)),
    tasks: listTasks(),
    runningTaskId: getPrimaryRunningTaskId(),
    runningTaskIds: getRunningTaskIds(),
  };
}

async function readManagerInboxEvent(eventId) {
  const filenames = managerEventFilenames(eventId);
  const eventPath = path.join(managerInboxRoot, filenames.event);
  const ackPath = path.join(managerInboxRoot, filenames.ack);

  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(eventPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return { ok: false, code: "event_not_found", error: "Manager event not found." };
    }
    return { ok: false, code: "event_read_failed", error: error.message };
  }

  const validation = validateManagerEvent(parsed);
  if (!validation.ok) {
    return { ok: false, code: "invalid_event", error: validation.error };
  }
  if (validation.event.eventId !== eventId) {
    return { ok: false, code: "invalid_event", error: "Manager event id does not match requested event id." };
  }
  return {
    ok: true,
    event: validation.event,
    alreadyAcknowledged: await fileExists(ackPath),
  };
}

async function writeManagerEventAck(event, ackedAt, action) {
  const filenames = managerEventFilenames(event.eventId);
  const ackPath = path.join(managerInboxRoot, filenames.ack);
  const tempPath = `${ackPath}.tmp`;
  if (await fileExists(ackPath)) {
    return false;
  }

  const ack = {
    kind: "taskDeckManagerEventAck",
    version: 1,
    eventId: event.eventId,
    actionId: action.actionId,
    actorTaskId: action.actorTaskId,
    ackedAt,
  };
  await fs.writeFile(tempPath, `${JSON.stringify(ack, null, 2)}\n`);
  await fs.rename(tempPath, ackPath);
  return true;
}

async function acknowledgeTaskAttentionFromManager(taskId, acknowledgedAt, { requireTask = true } = {}) {
  const task = tasks.get(taskId);
  if (!task) {
    if (!requireTask) {
      return { ok: true, acknowledged: false, skippedReason: "task_not_found" };
    }
    return { ok: false, code: "task_not_found", error: "Task not found." };
  }
  if (task.status !== TaskStatus.RUNNING) {
    if (!requireTask) {
      return { ok: true, acknowledged: false, skippedReason: "task_not_running" };
    }
    return { ok: false, code: "task_not_running", error: "Only running tasks can acknowledge attention." };
  }
  if (!task.attentionState || task.attentionState === AttentionState.NONE) {
    return { ok: true, acknowledged: false, skippedReason: "task_attention_not_required" };
  }

  setTask(markTaskAttentionAcknowledged(task, acknowledgedAt));
  await persistTasks();
  return { ok: true, acknowledged: true };
}

async function writeManagerActionLog(action, result) {
  const filename = `${action.requestedAt.replace(/[^0-9]/g, "").slice(0, 14)}-${action.actionId}.json`;
  const filePath = path.join(managerActionLogRoot, filename);
  const tempPath = `${filePath}.tmp`;
  const loggedAt = new Date().toISOString();
  const entry = { action, result, loggedAt };
  await fs.mkdir(managerActionLogRoot, { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(entry, null, 2)}\n`);
  await fs.rename(tempPath, filePath);
  await writeManagerActionHistory(entry, filename);
}

async function writeManagerActionHistory(entry, filename) {
  let history = [];
  try {
    const parsed = JSON.parse(await fs.readFile(managerActionHistoryPath, "utf8"));
    if (Array.isArray(parsed?.actions)) {
      history = parsed.actions;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`TaskDeck could not read manager action history: ${error.message}`);
    }
  }

  const actionSummary = {
    actionId: entry.action.actionId,
    action: entry.action.action,
    actorTaskId: entry.action.actorTaskId || "",
    eventId: entry.action.eventId || "",
    taskId: entry.action.taskId || "",
    ok: Boolean(entry.result.ok),
    code: entry.result.code || "",
    error: entry.result.error || "",
    deduped: Boolean(entry.result.deduped),
    loggedAt: entry.loggedAt,
    file: filename,
  };
  const actions = [actionSummary, ...history.filter((item) => item?.actionId !== entry.action.actionId)].slice(0, 50);
  await writeJsonAtomic(managerActionHistoryPath, {
    kind: "taskDeckManagerActionHistory",
    version: 1,
    updatedAt: entry.loggedAt,
    actions,
  });
}

function managerActionError(code, message, action = null) {
  return {
    ok: false,
    code,
    error: message,
    ...(action?.actionId ? { actionId: action.actionId } : {}),
    ...(action?.action ? { action: action.action } : {}),
  };
}

async function refreshManagerReadableFiles() {
  const generatedAt = new Date().toISOString();
  const events = await readUnreadManagerInboxEvents();
  const tasksSnapshot = Array.from(tasks.values()).map(serializeTask);
  const document = createManagerReadableEventsDocument({
    events,
    tasks: tasksSnapshot,
    generatedAt,
  });
  const readablePaths = {
    managerInboxDir: ".taskdeck/manager-inbox",
    managerActionsDir: ".taskdeck/manager-actions",
    managerActionHistoryFile: path.join(".taskdeck", "manager-actions", "history.json"),
    contextFile: path.join(".taskdeck", MANAGER_READABLE_DIRNAME, MANAGER_READABLE_CONTEXT_FILENAME),
    unreadEventsFile: path.join(".taskdeck", MANAGER_READABLE_DIRNAME, MANAGER_READABLE_UNREAD_EVENTS_FILENAME),
    actionsFile: path.join(".taskdeck", MANAGER_READABLE_DIRNAME, MANAGER_READABLE_ACTIONS_FILENAME),
    capabilitiesFile: path.join(".taskdeck", MANAGER_READABLE_DIRNAME, MANAGER_READABLE_CAPABILITIES_FILENAME),
  };
  const markdown = buildManagerReadableContext({
    events,
    tasks: tasksSnapshot,
    generatedAt,
    paths: readablePaths,
  });
  const actionsMarkdown = buildManagerActionGuide({
    events,
    generatedAt,
    paths: readablePaths,
  });
  const capabilitiesDocument = createManagerActionCapabilitiesDocument({
    generatedAt,
    paths: readablePaths,
  });

  await fs.mkdir(managerReadableRoot, { recursive: true });
  await writeJsonAtomic(managerReadableUnreadEventsPath, document);
  await writeTextAtomic(managerReadableContextPath, markdown);
  await writeTextAtomic(managerReadableActionsPath, actionsMarkdown);
  await writeJsonAtomic(managerReadableCapabilitiesPath, capabilitiesDocument);
  return events;
}

async function readUnreadManagerInboxEvents() {
  let filenames;
  try {
    filenames = await fs.readdir(managerInboxRoot);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const events = [];
  for (const filename of filenames) {
    if (!isManagerEventDataFilename(filename)) {
      continue;
    }

    const eventIdFromFilename = path.basename(filename, ".json");
    const filenamesForEvent = managerEventFilenames(eventIdFromFilename);
    if (await fileExists(path.join(managerInboxRoot, filenamesForEvent.ack))) {
      continue;
    }

    try {
      const parsed = JSON.parse(await fs.readFile(path.join(managerInboxRoot, filename), "utf8"));
      const validation = validateManagerEvent(parsed);
      if (!validation.ok) {
        console.warn(`TaskDeck ignored invalid manager inbox event ${filename}: ${validation.error}`);
        continue;
      }
      if (validation.event.eventId !== eventIdFromFilename) {
        console.warn(`TaskDeck ignored manager inbox event ${filename}: eventId does not match filename.`);
        continue;
      }
      events.push(validation.event);
    } catch (error) {
      console.warn(`TaskDeck could not read manager inbox event ${filename}: ${error.message}`);
    }
  }

  return events.sort((left, right) => {
    const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
    return createdAtOrder || left.eventId.localeCompare(right.eventId);
  });
}

function isManagerEventDataFilename(filename) {
  return filename.endsWith(".json") && !filename.endsWith(".ack.json") && !filename.endsWith(".tmp");
}

async function writeJsonAtomic(filePath, value) {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, value);
  await fs.rename(tempPath, filePath);
}

function isManagerTask(task) {
  return Boolean(task?.isManager || isManagerAgentProfileId(task?.agentProfileId));
}

function isManagerAgentProfileId(agentProfileId) {
  return String(agentProfileId || "").trim() === managerAgentProfileId;
}

function isCodexAppServerAgentProfileId(agentProfileId) {
  return String(agentProfileId || "").trim() === codexAppServerAgentProfileId;
}

function isCodexAppServerTask(task) {
  return isCodexAppServerAgentProfileId(task?.agentProfileId);
}

function isCodexAppServerNativeSubagentTask(task) {
  return task?.agentSessionSource === codexAppServerNativeSubagentSessionSource;
}

function haveSameChildStatusFields(left, right) {
  return (
    left.childReportedState === right.childReportedState &&
    left.childStatusSummary === right.childStatusSummary &&
    stringArraysEqual(left.childStatusArtifacts, right.childStatusArtifacts) &&
    left.childStatusDetailsFile === right.childStatusDetailsFile &&
    left.childStatusUpdatedAt === right.childStatusUpdatedAt &&
    left.childStatusError === right.childStatusError &&
    left.attentionState === right.attentionState &&
    left.attentionStateReason === right.attentionStateReason &&
    left.attentionStateSource === right.attentionStateSource &&
    left.attentionStateConfidence === right.attentionStateConfidence
  );
}

function stringArraysEqual(left, right) {
  const normalizedLeft = normalizeStringArray(left);
  const normalizedRight = normalizeStringArray(right);
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

async function commandForTaskCwd(command, resolvedCwd) {
  if (!resolvedCwd) {
    return command;
  }

  const dockerWorkdir = extractDockerExecWorkdir(command);
  if (!dockerWorkdir) {
    return command;
  }

  const containerCwd = await containerCwdForHostCwd(resolvedCwd, defaultContainerWorkspaceRoot);
  if (!containerCwd || containerCwd === dockerWorkdir) {
    return command;
  }

  return replaceDockerExecWorkdir(command, containerCwd);
}

function extractDockerExecWorkdir(command) {
  const match = String(command || "").match(/\bdocker\s+exec\b[\s\S]*?\s-w\s+("[^"]+"|'[^']+'|[^\s]+)/);
  return match ? unquoteShellToken(match[1]) : "";
}

function replaceDockerExecWorkdir(command, containerCwd) {
  return String(command || "").replace(
    /(\bdocker\s+exec\b[\s\S]*?\s-w\s+)("[^"]+"|'[^']+'|[^\s]+)/,
    `$1${quoteShellToken(containerCwd)}`,
  );
}

function extractDockerExecContainerName(command) {
  return findDockerExecContainerToken(command)?.value || "";
}

function findDockerExecContainerToken(command) {
  const tokens = splitShellWordsWithSpans(command);
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index].value !== "docker" || tokens[index + 1].value !== "exec") {
      continue;
    }

    let optionIndex = index + 2;
    while (optionIndex < tokens.length) {
      const token = tokens[optionIndex].value;
      if (token === "--") {
        optionIndex += 1;
        break;
      }
      if (!token.startsWith("-") || token === "-") {
        break;
      }

      if (dockerExecOptionRequiresValue(token)) {
        optionIndex += 2;
        continue;
      }

      optionIndex += 1;
    }

    const containerToken = tokens[optionIndex];
    if (containerToken) {
      return containerToken;
    }
  }

  return null;
}

function dockerExecOptionRequiresValue(option) {
  if (/^(?:--env|--env-file|--workdir|--user|--hostname|--detach-keys)(?:=|$)/.test(option)) {
    return !option.includes("=");
  }
  return option === "-e" || option === "--env" || option === "--env-file" || option === "-w" || option === "--workdir" || option === "-u" || option === "--user";
}

function splitShellWordsWithSpans(input) {
  const text = String(input || "");
  const tokens = [];
  let index = 0;

  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) {
      index += 1;
    }
    if (index >= text.length) {
      break;
    }

    const start = index;
    let value = "";
    let quote = "";
    while (index < text.length) {
      const character = text[index];
      if (quote) {
        if (character === quote) {
          quote = "";
          index += 1;
          continue;
        }
        if (quote === "\"" && character === "\\" && index + 1 < text.length) {
          value += text[index + 1];
          index += 2;
          continue;
        }
        value += character;
        index += 1;
        continue;
      }

      if (/\s/.test(character)) {
        break;
      }
      if (character === "'" || character === "\"") {
        quote = character;
        index += 1;
        continue;
      }
      if (character === "\\" && index + 1 < text.length) {
        value += text[index + 1];
        index += 2;
        continue;
      }
      value += character;
      index += 1;
    }

    tokens.push({ value, start, end: index });
  }

  return tokens;
}

async function containerCwdForHostCwd(hostCwd, containerWorkspaceRoot) {
  const projectRoots = await resolveProjectRoots();
  const matchingProjectRoot = projectRoots
    .map((projectRoot) => path.resolve(projectRoot))
    .filter((projectRoot) => isPathWithin(hostCwd, projectRoot))
    .sort((left, right) => right.length - left.length)[0];

  if (!matchingProjectRoot) {
    return "";
  }

  const relativePath = path.relative(matchingProjectRoot, hostCwd);
  return path.posix.join(
    path.posix.normalize(containerWorkspaceRoot),
    ...relativePath.split(path.sep).filter(Boolean),
  );
}

function isPathWithin(candidatePath, parentPath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function unquoteShellToken(token) {
  const value = String(token || "");
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith("\"") && value.endsWith("\""))) {
    return value.slice(1, -1);
  }
  return value;
}

function quoteShellToken(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function modelFromCommand(command) {
  const match = String(command || "").match(/(?:^|\s)(?:--model|-m)\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
  return match?.[1] || match?.[2] || match?.[3] || "";
}

function logInputDebug(taskId, data, source) {
  if (!inputDebugEnabled) {
    return;
  }

  const tail = data.slice(-24);
  const codes = Array.from(tail).map((character) => character.charCodeAt(0));
  console.log(
    `[TaskDeck input] source=${source} task=${taskId} len=${data.length} hasCR=${data.includes("\r")} hasLF=${data.includes("\n")} tail=${JSON.stringify(tail)} tailCodes=${codes.join(",")}`,
  );
}

async function cwdIsGitRepo(cwd) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function buildCwdSuggestions() {
  const candidates = [
    { label: "Repository root", path: repoRoot, value: "" },
    { label: "apps/web", path: path.join(repoRoot, "apps/web"), value: "apps/web" },
    { label: "apps/server", path: path.join(repoRoot, "apps/server"), value: "apps/server" },
    { label: "packages/core", path: path.join(repoRoot, "packages/core"), value: "packages/core" },
  ];

  const suggestions = [];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate.path);
      if (stat.isDirectory()) {
        suggestions.push(candidate);
      }
    } catch {
      // Skip missing optional workspace paths.
    }
  }
  return suggestions;
}

async function buildProjectRoots() {
  return resolveProjectRoots();
}

async function buildProjectSuggestions(projectRoots = null) {
  const roots = projectRoots ?? await resolveProjectRoots();
  const childSuggestions = [];
  const suggestions = [];
  const defaultProjectRoot = roots[0] || repoRoot;
  const rootProjectPath = defaultProjectRoot;
  const accessibleRootProjectPath = serverAccessibleProjectRootForHostRoot(defaultProjectRoot) ?? defaultProjectRoot;
  const rootSuggestion = !isIgnoredProjectPath(rootProjectPath)
    ? await buildProjectSuggestion(rootProjectPath, accessibleRootProjectPath, "Workspace")
    : null;
  if (rootSuggestion) {
    suggestions.push(rootSuggestion);
  }

  for (const projectRoot of roots) {
    let entries = [];
    let readableProjectRoot = projectRoot;
    try {
      entries = await fs.readdir(readableProjectRoot, { withFileTypes: true });
    } catch (error) {
      readableProjectRoot = serverAccessibleProjectRootForHostRoot(projectRoot);
      if (readableProjectRoot) {
        try {
          entries = await fs.readdir(readableProjectRoot, { withFileTypes: true });
        } catch (fallbackError) {
          if (fallbackError.code !== "ENOENT") {
            console.warn(`TaskDeck could not read project root ${readableProjectRoot}: ${fallbackError.message}`);
          }
          entries = [];
        }
      } else {
        if (error.code !== "ENOENT") {
          console.warn(`TaskDeck could not read project root ${projectRoot}: ${error.message}`);
        }
        continue;
      }
    }

    for (const entry of entries) {
      const projectPath = path.join(projectRoot, entry.name);
      if (!entry.isDirectory() || shouldExcludeProjectDirectory(entry.name) || isIgnoredProjectPath(projectPath)) {
        continue;
      }
      childSuggestions.push(await buildProjectSuggestion(projectPath, path.join(readableProjectRoot, entry.name)));
    }
  }

  suggestions.push(...sortProjectSuggestions(childSuggestions));

  return dedupeProjectSuggestions(suggestions);
}

function selectDefaultProjectCwd(projectSuggestions, defaultProjectRoot) {
  const hostRepoRoot = hostProjectPathForRepoRoot(defaultProjectRoot);
  return (
    projectSuggestions.find((project) => project.path === hostRepoRoot)?.path ??
    projectSuggestions.find((project) => project.label === path.basename(repoRoot))?.path ??
    projectSuggestions[0]?.path ??
    hostRepoRoot ??
    defaultProjectRoot
  );
}

async function buildProjectSuggestion(projectPath, accessibleProjectPath = projectPath, label = path.basename(projectPath) || projectPath) {
  return {
    label,
    path: projectPath,
    isGitRepo: await cwdIsGitRepo(accessibleProjectPath),
  };
}

function sortProjectSuggestions(suggestions) {
  return suggestions.sort((left, right) => {
    if (left.isGitRepo !== right.isGitRepo) {
      return left.isGitRepo ? -1 : 1;
    }
    return left.label.localeCompare(right.label);
  });
}

function shouldExcludeProjectDirectory(name) {
  const excludedNames = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "vendor",
    "target",
    "out",
    "output",
    "tmp",
    "temp",
    "cache",
    ".parcel-cache",
    ".pytest_cache",
    ".cache",
    ".next",
    ".nuxt",
    ".turbo",
    ".vite",
  ]);
  return name.startsWith(".") || excludedNames.has(name);
}

function isIgnoredProjectPath(projectPath) {
  const ignoredSegments = new Set(["recicle.bin", "recycle.bin", "$recycle.bin", ".trash", "trash"]);
  return String(projectPath || "")
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((segment) => ignoredSegments.has(segment.toLowerCase()));
}

function dedupeProjectSuggestions(suggestions) {
  const seenPaths = new Set();
  return suggestions.filter((suggestion) => {
    if (seenPaths.has(suggestion.path)) {
      return false;
    }
    seenPaths.add(suggestion.path);
    return true;
  });
}

async function resolveProjectRoots() {
  const configuredRoots = await loadConfiguredProjectRoots();
  if (configuredRoots.length > 0) {
    return configuredRoots;
  }

  return [];
}

async function loadConfiguredProjectRoots() {
  const envRoots = normalizeProjectRootsFromEnv();
  if (envRoots.length > 0) {
    return dedupeProjectRoots(envRoots);
  }

  const explicitConfigCandidates = [
    { source: "taskdeck.local.json", path: localConfigPath },
    { source: "TASKDECK_CONFIG", path: envConfigPath },
    { source: "taskdeck.config.json", path: defaultConfigPath },
  ].filter((configCandidate) => configCandidate.path);

  for (const configCandidate of explicitConfigCandidates) {
    try {
      const rawContents = await fs.readFile(configCandidate.path, "utf8");
      const roots = normalizeProjectRoots(JSON.parse(rawContents));
      if (roots.length > 0) {
        return dedupeProjectRoots(roots);
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`TaskDeck could not read ${configCandidate.path}: ${error.message}`);
      }
    }
  }

  return [];
}

function normalizeProjectRoots(config) {
  const values = [];
  if (typeof config?.projectRoot === "string") {
    values.push(config.projectRoot);
  }
  if (Array.isArray(config?.projectRoots)) {
    values.push(...config.projectRoots);
  }
  return values
    .map((projectRoot) => String(projectRoot || "").trim())
    .filter(Boolean)
    .map((projectRoot) => path.resolve(projectRoot));
}

function normalizeProjectRootsFromEnv() {
  const values = [];
  if (process.env.TASKDECK_PROJECT_ROOT) {
    values.push(process.env.TASKDECK_PROJECT_ROOT);
  }
  if (process.env.TASKDECK_PROJECT_ROOTS) {
    values.push(...process.env.TASKDECK_PROJECT_ROOTS.split(path.delimiter));
  }
  return values
    .map((projectRoot) => projectRoot.trim())
    .filter(Boolean)
    .map((projectRoot) => path.resolve(projectRoot));
}

function dedupeProjectRoots(projectRoots) {
  const seenRoots = new Set();
  return projectRoots.filter((projectRoot) => {
    if (!projectRoot || seenRoots.has(projectRoot)) {
      return false;
    }
    seenRoots.add(projectRoot);
    return true;
  });
}

async function directoryExists(directoryPath) {
  try {
    const stat = await fs.stat(directoryPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function hostProjectPathForRepoRoot(projectRoot) {
  const resolvedProjectRoot = path.resolve(String(projectRoot || ""));
  if (isPathWithin(repoRoot, resolvedProjectRoot)) {
    return repoRoot;
  }
  return path.join(resolvedProjectRoot, path.basename(repoRoot));
}

function serverAccessibleProjectRootForHostRoot(projectRoot) {
  const resolvedProjectRoot = path.resolve(String(projectRoot || ""));
  if (isPathWithin(repoRoot, resolvedProjectRoot)) {
    return resolvedProjectRoot;
  }
  return path.dirname(repoRoot);
}

async function serverAccessiblePathForHostCwd(hostCwd) {
  const resolvedHostCwd = path.resolve(String(hostCwd || ""));
  if (await directoryExists(resolvedHostCwd)) {
    return resolvedHostCwd;
  }

  const projectRoots = await resolveProjectRoots();
  const matchingProjectRoot = projectRoots
    .map((projectRoot) => path.resolve(projectRoot))
    .filter((projectRoot) => isPathWithin(resolvedHostCwd, projectRoot))
    .sort((left, right) => right.length - left.length)[0];

  if (!matchingProjectRoot) {
    return resolvedHostCwd;
  }

  const readableProjectRoot = serverAccessibleProjectRootForHostRoot(matchingProjectRoot);
  const relativePath = path.relative(matchingProjectRoot, resolvedHostCwd);
  return path.join(readableProjectRoot, relativePath);
}

function normalizeStoredTaskAgentState(task) {
  return {
    ...task,
    agentModel: String(task.agentModel || ""),
    isManager: normalizeBoolean(task.isManager) || isManagerAgentProfileId(task.agentProfileId),
    agentState: task.agentState ?? inferAgentStateFromStatus(task),
    attachments: normalizeTaskAttachmentsForServer(task.attachments),
  };
}

function normalizePendingAttachmentRefs(attachments) {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .filter((attachment) => attachment && typeof attachment === "object")
    .map((attachment) => ({
      id: String(attachment.id || "").trim(),
    }))
    .filter((attachment) => attachment.id);
}

async function finalizePendingAttachments(pendingAttachments, taskId) {
  const finalizedAttachments = [];
  if (!pendingAttachments.length) {
    return finalizedAttachments;
  }

  const taskAttachmentRoot = path.join(attachmentRoot, taskId);
  await fs.mkdir(taskAttachmentRoot, { recursive: true });

  for (const pendingAttachment of pendingAttachments) {
    const id = String(pendingAttachment.id || "").trim();
    if (!isSafeAttachmentId(id)) {
      continue;
    }

    try {
      const metadataPath = path.join(pendingAttachmentRoot, `${id}.json`);
      const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
      const mimeType = normalizeImageMimeType(metadata.mimeType);
      if (!mimeType || metadata.type !== "image") {
        continue;
      }

      const storedFilename = path.basename(String(metadata.storedFilename || ""));
      const sourcePath = path.join(pendingAttachmentRoot, storedFilename);
      const filename = sanitizeAttachmentFilename(metadata.filename || "image", mimeType);
      const extension = imageAttachmentExtensions.get(mimeType) || path.extname(filename) || ".img";
      const destinationFilename = `${id}${extension}`;
      const destinationPath = path.join(taskAttachmentRoot, destinationFilename);

      await fs.rename(sourcePath, destinationPath);
      await fs.rm(metadataPath, { force: true });

      finalizedAttachments.push({
        id,
        type: "image",
        filename,
        path: destinationPath,
        mimeType,
        size: Number.isFinite(Number(metadata.size)) ? Number(metadata.size) : 0,
        createdAt: String(metadata.createdAt || new Date().toISOString()),
      });
    } catch (error) {
      console.warn(`TaskDeck could not attach pending image ${id}: ${error.message}`);
    }
  }

  return finalizedAttachments;
}

function normalizeTaskAttachmentsForServer(attachments) {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .filter((attachment) => attachment && typeof attachment === "object")
    .map((attachment) => ({
      id: String(attachment.id || ""),
      type: attachment.type === "image" ? "image" : String(attachment.type || ""),
      filename: String(attachment.filename || ""),
      path: String(attachment.path || ""),
      mimeType: String(attachment.mimeType || ""),
      size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : 0,
      createdAt: String(attachment.createdAt || ""),
    }))
    .filter((attachment) => attachment.id && attachment.type && attachment.filename && attachment.path);
}

function normalizeImageMimeType(value) {
  const mimeType = String(value || "").split(";")[0].trim().toLowerCase();
  return imageAttachmentMimeTypes.has(mimeType) ? mimeType : "";
}

function decodeHeaderValue(value) {
  if (!value) {
    return "";
  }

  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}

function sanitizeAttachmentFilename(filename, mimeType) {
  const fallbackExtension = imageAttachmentExtensions.get(mimeType) || ".img";
  const rawBasename = path.basename(String(filename || "image")).trim();
  const normalizedBasename = rawBasename
    .replace(/[^\w .()-]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  const extension = imageAttachmentExtensions.get(mimeType) || path.extname(normalizedBasename) || fallbackExtension;
  const nameWithoutExtension = path.basename(normalizedBasename, path.extname(normalizedBasename)).trim() || "image";
  return `${nameWithoutExtension}${extension}`;
}

function isSafeAttachmentId(id) {
  return /^[0-9a-f-]{36}$/i.test(id);
}

function normalizeExplicitAgentSession({
  agentSessionProvider,
  agentSessionId,
  agentSessionSource,
  agentSessionDetectedAt,
  agentSessionResumeCommand,
}) {
  if (!agentSessionProvider && !agentSessionId && !agentSessionResumeCommand) {
    return {};
  }

  return {
    agentSessionProvider,
    agentSessionId,
    agentSessionSource,
    agentSessionDetectedAt,
    agentSessionResumeCommand,
  };
}

function updateAgentStateFromTaskDeckEvent(taskId, agentState, metadata = {}) {
  const task = tasks.get(taskId);
  if (!task || task.status !== TaskStatus.RUNNING) {
    return false;
  }

  const nextMetadata = preserveChildStatusAttention(task, metadata);
  if (task.agentState === agentState && hasSameAgentStateMetadata(task, nextMetadata)) {
    return false;
  }

  setTask(markTaskAgentState(task, agentState, nextMetadata));
  broadcastTasks();
  return true;
}

function preserveChildStatusAttention(task, metadata) {
  if (
    isChildStatusAttentionActive(task) &&
    metadata.attentionState === AttentionState.NONE &&
    metadata.attentionSource !== AgentStateSource.CHILD_STATUS
  ) {
    const {
      attentionState: _attentionState,
      attentionReason: _attentionReason,
      attentionSource: _attentionSource,
      attentionConfidence: _attentionConfidence,
      ...metadataWithoutAttention
    } = metadata;
    return metadataWithoutAttention;
  }

  return metadata;
}

function hasSameAgentStateMetadata(task, metadata) {
  return (
    (metadata.reason === undefined || task.agentStateReason === metadata.reason) &&
    (metadata.source === undefined || task.agentStateSource === metadata.source) &&
    (metadata.confidence === undefined || task.agentStateConfidence === metadata.confidence) &&
    (metadata.attentionState === undefined || task.attentionState === metadata.attentionState) &&
    (metadata.attentionReason === undefined || task.attentionStateReason === metadata.attentionReason) &&
    (metadata.attentionSource === undefined || task.attentionStateSource === metadata.attentionSource) &&
    (metadata.attentionConfidence === undefined || task.attentionStateConfidence === metadata.attentionConfidence)
  );
}

function isChildStatusAttentionActive(task) {
  return (
    task.attentionStateSource === AgentStateSource.CHILD_STATUS &&
    task.attentionState &&
    task.attentionState !== AttentionState.NONE
  );
}

function setTask(task) {
  tasks.set(task.id, task);
  persistTasks();
}

function listTasks() {
  return Array.from(tasks.values()).filter(isTaskVisibleInNormalList).map(serializeTaskForClient).reverse();
}

function serializeTaskForClient(task) {
  if (!task) {
    return null;
  }
  const serializedTask = serializeTask(task);
  const activeAppServer = activeCodexThreadSessions.get(task.id);
  return {
    ...serializedTask,
    sessionLabel: taskSessionLabel(task),
    codexAppServerRequest: codexAppServerRequestForClient(task.id),
    codexAppServerTurnActive: Boolean(activeAppServer?.turnActive && activeAppServer?.activeTurnId),
  };
}

function codexAppServerRequestForClient(taskId) {
  const activeAppServer = activeCodexThreadSessions.get(taskId);
  if (!activeAppServer || activeAppServer.currentServerRequestId === null) {
    return null;
  }
  const pendingRequest = activeAppServer.pendingServerRequests.get(activeAppServer.currentServerRequestId);
  if (!pendingRequest) {
    return null;
  }
  const summary = codexAppServerRequestSummary(pendingRequest);
  return {
    id: pendingRequest.id,
    method: pendingRequest.method,
    kind: pendingRequest.kind,
    title: summary.title,
    detail: summary.detail,
    canApprove: codexAppServerRequestCanApprove(pendingRequest),
    canDecline: codexAppServerRequestCanDecline(pendingRequest),
    canCancel: true,
  };
}

function codexAppServerRequestSummary(pendingRequest) {
  const method = pendingRequest.method;
  const params = pendingRequest.params || {};
  if (method === "item/commandExecution/requestApproval") {
    const command = compactCodexAppServerCommand(String(params.command || ""));
    return {
      title: "Command approval requested",
      detail: command || String(params.reason || "").trim(),
    };
  }
  if (method === "execCommandApproval") {
    const command = Array.isArray(params.command) ? params.command.join(" ") : "";
    return {
      title: "Command approval requested",
      detail: compactCodexAppServerCommand(command) || String(params.reason || "").trim(),
    };
  }
  if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
    return {
      title: "File change approval requested",
      detail: String(params.reason || params.grantRoot || "").trim(),
    };
  }
  if (method === "item/permissions/requestApproval") {
    return {
      title: "Permission approval requested",
      detail: String(params.reason || params.cwd || "").trim(),
    };
  }
  if (method === "item/tool/requestUserInput") {
    const questions = Array.isArray(params.questions) ? params.questions : [];
    const firstQuestion = questions[0];
    return {
      title: "Input requested",
      detail: String(firstQuestion?.question || firstQuestion?.header || "").trim(),
    };
  }
  if (method === "mcpServer/elicitation/request") {
    return {
      title: "MCP input requested",
      detail: String(params.message || params.url || params.serverName || "").trim(),
    };
  }
  return {
    title: "Codex App Server request",
    detail: method,
  };
}

function codexAppServerRequestCanApprove(pendingRequest) {
  return (
    pendingRequest.method === "item/commandExecution/requestApproval" ||
    pendingRequest.method === "item/fileChange/requestApproval" ||
    pendingRequest.method === "item/permissions/requestApproval" ||
    pendingRequest.method === "applyPatchApproval" ||
    pendingRequest.method === "execCommandApproval"
  );
}

function codexAppServerRequestCanDecline(pendingRequest) {
  return (
    pendingRequest.method === "item/commandExecution/requestApproval" ||
    pendingRequest.method === "item/fileChange/requestApproval" ||
    pendingRequest.method === "item/permissions/requestApproval" ||
    pendingRequest.method === "mcpServer/elicitation/request" ||
    pendingRequest.method === "applyPatchApproval" ||
    pendingRequest.method === "execCommandApproval"
  );
}

function appendLog(taskId, data) {
  const nextLog = `${logs.get(taskId) || ""}${data}`;
  logs.set(taskId, nextLog.slice(-maxLogLength));
  appendTaskLog(taskId, data);
}

async function renameTaskDeckDisplayName(task, label) {
  const now = new Date().toISOString();
  const sessionLabelKey = taskSessionLabelKey(task);

  if (sessionLabelKey) {
    setSessionLabel(sessionLabelKey, label, now);
    for (const candidate of tasks.values()) {
      if (taskSessionLabelKey(candidate) === sessionLabelKey) {
        tasks.set(candidate.id, {
          ...candidate,
          title: label,
          updatedAt: now,
        });
      }
    }
    await Promise.all([persistTasks(), persistSessionLabels()]);
    return;
  }

  tasks.set(task.id, {
    ...task,
    title: label,
    updatedAt: now,
  });
  await persistTasks();
}

async function renameSessionLabel(sessionLabelKey, label) {
  const now = new Date().toISOString();
  setSessionLabel(sessionLabelKey, label, now);
  for (const task of tasks.values()) {
    if (taskSessionLabelKey(task) === sessionLabelKey) {
      tasks.set(task.id, {
        ...task,
        title: label,
        updatedAt: now,
      });
    }
  }
  await Promise.all([persistTasks(), persistSessionLabels()]);
}

function setSessionLabel(sessionLabelKey, label, updatedAt) {
  sessionLabels.set(sessionLabelKey, { label, updatedAt });
}

function taskSessionLabel(task) {
  const sessionLabelKey = taskSessionLabelKey(task);
  if (!sessionLabelKey) {
    return "";
  }
  return String(sessionLabels.get(sessionLabelKey)?.label || "");
}

function taskSessionLabelKey(task) {
  const provider = String(task.agentSessionProvider || "").trim();
  const sessionId = String(task.agentSessionId || "").trim();
  if (!provider || !sessionId) {
    return "";
  }
  const agentProfileId = String(task.agentProfileId || provider);
  return `${provider}:${agentProfileId}:${sessionId}`;
}

function broadcastTasks() {
  broadcast({
    type: "tasks",
    tasks: listTasks(),
    runningTaskId: getPrimaryRunningTaskId(),
    runningTaskIds: getRunningTaskIds(),
  });
}

function getRunningTaskIds() {
  return Array.from(new Set([
    ...Array.from(activeCodexThreadSessions.keys()).reverse(),
  ]));
}

function getPrimaryRunningTaskId() {
  return getRunningTaskIds()[0] ?? null;
}

function broadcastPresets() {
  broadcast({
    type: "presets",
    presets,
  });
}

async function clearTask(taskId) {
  tasks.delete(taskId);
  logs.delete(taskId);
  taskOutputSequences.delete(taskId);
  await deleteTaskLog(taskId);
  await deleteTaskAttachments(taskId);
}

async function stopTaskProcesses(taskId) {
  const task = tasks.get(taskId);
  stopActiveCodexThreadSession(taskId);

  if (!task) {
    return;
  }

  await cleanupDockerTaskProcesses(task);
}

function stopActiveCodexThreadSession(taskId) {
  const activeAppServer = activeCodexThreadSessions.get(taskId);
  if (!activeAppServer) {
    return;
  }
  const activeRuntime = codexRuntimeForThreadSession(activeAppServer);
  clearCodexThreadSession(activeAppServer);
  if (!activeRuntime) {
    return;
  }

  cleanupCodexRuntimeRequestsForStoppedThreadSession(activeRuntime, activeAppServer);
  if (activeRuntime.defaultTaskId === taskId) {
    activeRuntime.defaultTaskId = defaultCodexThreadSessionForRuntime(activeRuntime)?.taskId || "";
  }
  if (codexThreadSessionsForRuntime(activeRuntime).length > 0) {
    return;
  }

  cancelCodexAppServerLoginIfNeeded(activeRuntime, activeAppServer);
  if (activeCodexRuntimes.get(activeRuntime.id) === activeRuntime) {
    activeCodexRuntimes.delete(activeRuntime.id);
  }
  try {
    activeRuntime.process.kill();
  } catch (error) {
    console.error("TaskDeck could not stop Codex App Server for " + taskId + ": " + error.message);
  }
}

function cleanupCodexRuntimeRequestsForStoppedThreadSession(activeRuntime, stoppedThreadSession) {
  const fallbackThreadSession = defaultCodexThreadSessionForRuntime(activeRuntime);
  for (const [requestId, pendingRequest] of activeRuntime.pendingRequests.entries()) {
    if (pendingRequest.threadSession !== stoppedThreadSession) {
      continue;
    }
    if (codexRuntimeRequestCanMoveToAnotherThreadSession(pendingRequest.method) && fallbackThreadSession) {
      pendingRequest.threadSession = fallbackThreadSession;
      continue;
    }
    activeRuntime.pendingRequests.delete(requestId);
  }
}

function codexRuntimeRequestCanMoveToAnotherThreadSession(method) {
  return method === "initialize" || method === "account/read" || method === "account/login/start" || method === "model/list";
}

function cancelCodexAppServerLoginIfNeeded(activeRuntime, logThreadSession = null) {
  if (!activeRuntime?.loginInProgress || !activeRuntime.loginId) {
    return;
  }
  if (!activeRuntime?.process?.stdin?.writable || activeRuntime.process.stdin.destroyed) {
    return;
  }
  try {
    const id = activeRuntime.nextRequestId;
    activeRuntime.nextRequestId += 1;
    const message = {
      jsonrpc: "2.0",
      id,
      method: "account/login/cancel",
      params: { loginId: activeRuntime.loginId },
    };
    if (codexAppServerDebugEnabled) {
      const threadSession = logThreadSession || defaultCodexThreadSessionForRuntime(activeRuntime);
      if (threadSession) {
        appendAndBroadcast(threadSession.taskId, `[TaskDeck -> Codex App Server] ${JSON.stringify(message)}\n`, {
          role: "taskdeck",
          kind: "debug",
        });
      }
    }
    activeRuntime.process.stdin.write(`${JSON.stringify(message)}\n`);
    activeRuntime.loginInProgress = false;
    activeRuntime.loginId = "";
  } catch (error) {
    if (codexAppServerDebugEnabled) {
      const threadSession = logThreadSession || defaultCodexThreadSessionForRuntime(activeRuntime);
      if (threadSession) {
        appendCodexAppServerStatus(threadSession, `[TaskDeck] Could not cancel Codex App Server login: ${error.message}\n`);
      }
    }
  }
}

async function cleanupDockerTaskProcesses(task) {
  const taskId = String(task?.id || "").trim();
  const containerName = extractDockerExecContainerName(task?.command);
  if (!taskId || !containerName) {
    return;
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      [
        "exec",
        "-e",
        `TASKDECK_CLEANUP_TASK_ID=${taskId}`,
        containerName,
        "sh",
        "-lc",
        containerTaskCleanupScript(),
      ],
      {
        timeout: 5000,
        maxBuffer: 64 * 1024,
      },
    );
    const cleanupOutput = `${stdout || ""}${stderr || ""}`.trim();
    if (cleanupOutput) {
      console.log(`[TaskDeck cleanup] task=${taskId} container=${containerName} ${cleanupOutput}`);
    }
  } catch (error) {
    const output = `${error.stdout || ""}${error.stderr || ""}`.trim();
    const detail = output ? `${error.message}: ${output}` : error.message;
    console.warn(`TaskDeck could not clean Docker task processes for ${taskId} in ${containerName}: ${detail}`);
  }
}

function containerTaskCleanupScript() {
  const protectedPids = Array.from(protectedContainerCleanupPids).join(" ");
  return `
task_id="$TASKDECK_CLEANUP_TASK_ID"
protected_pids="${protectedPids}"

owned_pids() {
  for env_file in /proc/[0-9]*/environ; do
    [ -r "$env_file" ] || continue
    pid="\${env_file#/proc/}"
    pid="\${pid%/environ}"
    case " $protected_pids " in
      *" $pid "*) continue ;;
    esac
    if tr '\\000' '\\n' < "$env_file" 2>/dev/null | grep -Fx "TASKDECK_TASK_ID=$task_id" >/dev/null 2>&1; then
      echo "$pid"
    fi
  done
}

if [ -z "$task_id" ]; then
  echo "missing cleanup task id" >&2
  exit 1
fi

initial_pids="$(owned_pids | sort -n)"
if [ -z "$initial_pids" ]; then
  echo "no task-owned container processes found"
  exit 0
fi

echo "terminating task-owned pids: $(echo "$initial_pids" | tr '\\n' ' ')"
for pid in $(echo "$initial_pids" | sort -nr); do
  kill -TERM "$pid" 2>/dev/null || true
done

sleep 0.8

remaining_pids="$(owned_pids | sort -n)"
if [ -z "$remaining_pids" ]; then
  echo "task-owned processes exited after TERM"
  exit 0
fi

echo "force killing remaining task-owned pids: $(echo "$remaining_pids" | tr '\\n' ' ')"
for pid in $(echo "$remaining_pids" | sort -nr); do
  kill -KILL "$pid" 2>/dev/null || true
done

sleep 0.1

final_pids="$(owned_pids | sort -n)"
if [ -n "$final_pids" ]; then
  echo "task-owned pids remain after KILL: $(echo "$final_pids" | tr '\\n' ' ')" >&2
  exit 2
fi

echo "task-owned processes exited after KILL"
`;
}

function send(socket, payload) {
  if (socket && socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function broadcast(payload) {
  for (const client of clients) {
    send(client, payload);
  }
}

async function initializePersistence() {
  await fs.mkdir(logRoot, { recursive: true });
  await fs.mkdir(pendingAttachmentRoot, { recursive: true });

  const [storedTasks, storedPresets, storedSessionLabels] = await Promise.all([
    readJsonArray(taskStorePath, "tasks"),
    readJsonArray(presetStorePath, "presets"),
    readJsonObject(sessionLabelStorePath, "session labels"),
  ]);

  for (const [key, value] of Object.entries(storedSessionLabels)) {
    const label = String(value?.label || "").trim();
    if (label) {
      sessionLabels.set(key, {
        label,
        updatedAt: String(value?.updatedAt || ""),
      });
    }
  }

  presets = sanitizePresets(storedPresets);
  if (presets.length !== storedPresets.length) {
    persistPresets();
  }

  let changed = false;
  for (const storedTask of storedTasks) {
    if (!storedTask?.id) {
      changed = true;
      continue;
    }

    const task =
      storedTask.status === TaskStatus.RUNNING
        ? markTaskExited(storedTask, { exitCode: 1, signal: "server-restart" })
        : normalizeStoredTaskAgentState(storedTask);

    if (task !== storedTask) {
      changed = true;
    }
    tasks.set(task.id, task);
  }

  if (changed) {
    persistTasks();
  }
}

async function readJsonArray(filePath, label) {
  try {
    const rawContents = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(rawContents);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    console.warn(`TaskDeck ignored ${filePath} because it did not contain a ${label} array.`);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`TaskDeck could not read ${filePath}: ${error.message}`);
    }
  }

  return [];
}

async function readJsonObject(filePath, label) {
  try {
    const rawContents = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(rawContents);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    console.warn(`TaskDeck ignored ${filePath} because it did not contain a ${label} object.`);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`TaskDeck could not read ${filePath}: ${error.message}`);
    }
  }

  return {};
}

async function loadAgentProfiles() {
  return (await loadAgentProfileConfig()).profiles;
}

async function getAgentProfileConfigSummary() {
  const loadedConfig = await loadAgentProfileConfig();
  return {
    source: loadedConfig.source,
    path: loadedConfig.path,
    message: `${loadedConfig.message} Exposing ${loadedConfig.profiles.length} agent profiles.`,
  };
}

async function loadAgentProfileConfig() {
  let mergedProfiles = mergeAgentProfiles(defaultAgentProfiles);
  const loadedSources = [];

  for (const configCandidate of getAgentProfileConfigCandidates()) {
    try {
      const rawContents = await fs.readFile(configCandidate.path, "utf8");
      const parsed = JSON.parse(rawContents);
      const configuredProfiles = sanitizeAgentProfiles(parsed?.agentProfiles);
      if (configuredProfiles.length > 0) {
        mergedProfiles = mergeAgentProfiles(mergedProfiles, configuredProfiles);
        loadedSources.push({
          source: configCandidate.source,
          path: configCandidate.path,
          count: configuredProfiles.length,
        });
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(parsed || {}, "agentProfiles")) {
        console.warn(`TaskDeck ignored agentProfiles in ${configCandidate.path} because it did not contain valid profiles.`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`TaskDeck could not read ${configCandidate.path}: ${error.message}`);
      }
    }
  }

  mergedProfiles = mergedProfiles.filter(isCodexAppServerAgentProfile);

  if (loadedSources.length === 0) {
    return {
      source: "built-in",
      path: "",
      message: "Using the built-in Codex App Server profile.",
      profiles: mergedProfiles,
    };
  }

  return {
    source: loadedSources.map((source) => source.source).join(" + "),
    path: loadedSources.map((source) => source.path).join(", "),
    message: `Merged agent profiles from built-in defaults and ${loadedSources
      .map((source) => `${source.source} (${source.count})`)
      .join(", ")}; exposing Codex App Server only.`,
    profiles: mergedProfiles,
  };
}

function isCodexAppServerAgentProfile(profile) {
  return isCodexAppServerAgentProfileId(profile?.id);
}

function mergeAgentProfiles(baseProfiles, overrideProfiles = []) {
  const mergedProfiles = baseProfiles.map((profile) => ({ ...profile }));
  const idToIndex = new Map(mergedProfiles.map((profile, index) => [profile.id, index]));

  for (const profile of overrideProfiles) {
    if (idToIndex.has(profile.id)) {
      mergedProfiles[idToIndex.get(profile.id)] = {
        ...mergedProfiles[idToIndex.get(profile.id)],
        ...profile,
      };
      continue;
    }
    idToIndex.set(profile.id, mergedProfiles.length);
    mergedProfiles.push({ ...profile });
  }

  return mergedProfiles;
}

function getAgentProfileConfigCandidates() {
  return [
    { source: "taskdeck.config.json", path: defaultConfigPath },
    { source: "taskdeck.local.json", path: localConfigPath },
    ...(envConfigPath ? [{ source: "TASKDECK_CONFIG", path: envConfigPath }] : []),
  ];
}

async function loadDefaultModel() {
  let defaultModel = "";

  for (const configCandidate of getAgentProfileConfigCandidates()) {
    try {
      const rawContents = await fs.readFile(configCandidate.path, "utf8");
      const parsed = JSON.parse(rawContents);
      if (!Object.prototype.hasOwnProperty.call(parsed || {}, "defaultModel")) {
        continue;
      }
      if (typeof parsed.defaultModel !== "string") {
        console.warn(`TaskDeck ignored defaultModel in ${configCandidate.path} because it was not a string.`);
        continue;
      }
      defaultModel = parsed.defaultModel.trim();
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`TaskDeck could not read ${configCandidate.path}: ${error.message}`);
      }
    }
  }

  return defaultModel;
}

function sanitizeAgentProfiles(rawProfiles) {
  if (!Array.isArray(rawProfiles)) {
    return [];
  }

  const profiles = [];
  const seenIds = new Set();
  for (const rawProfile of rawProfiles) {
    const id = String(rawProfile?.id || "").trim();
    const label = String(rawProfile?.label || "").trim();
    const command = String(rawProfile?.command || "").trim();
    const description = String(rawProfile?.description || "").trim();
    const diagnosticContainer = String(rawProfile?.diagnosticContainer || "").trim();
    const diagnosticWorkspace = String(rawProfile?.diagnosticWorkspace || "").trim();
    const modelOptions = normalizeModelOptions(rawProfile?.modelOptions);

    if (!id || !label || seenIds.has(id)) {
      continue;
    }

    profiles.push({
      id,
      label,
      command,
      description,
      ...(diagnosticContainer ? { diagnosticContainer } : {}),
      ...(diagnosticWorkspace ? { diagnosticWorkspace } : {}),
      ...(modelOptions.length ? { modelOptions } : {}),
    });
    seenIds.add(id);
  }

  return profiles;
}

function normalizeModelOptions(modelOptions) {
  if (!Array.isArray(modelOptions)) {
    return [];
  }
  const seenIds = new Set();
  const options = [];
  for (const option of modelOptions) {
    const id = typeof option === "string" ? option.trim() : String(option?.id || "").trim();
    const label = typeof option === "string" ? id : String(option?.label || id).trim();
    if (!id || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    options.push({ id, label: label || id });
  }
  return options;
}

async function buildDiagnostics() {
  const profiles = await loadAgentProfiles();
  const containerSpecs = getDiagnosticContainerSpecs(profiles);
  const docker = await checkDocker();
  const containers = docker.ok
    ? await Promise.all(
        containerSpecs.map((containerSpec) => inspectContainer(containerSpec.name, containerSpec.workspaces)),
      )
    : containerSpecs.map((containerSpec) => ({
        name: containerSpec.name,
        present: false,
        running: false,
        status: "unknown",
        image: "",
        workspaces: containerSpec.workspaces.map((workspacePath) => ({
          path: workspacePath,
          exists: false,
          status: "unknown",
          error: docker.message,
        })),
        error: docker.message,
      }));

  const config = await getAgentProfileConfigSummary();

  return {
    checkedAt: new Date().toISOString(),
    config,
    docker,
    containers,
  };
}

function getDiagnosticContainerSpecs(profiles) {
  const containers = new Map();
  for (const profile of profiles) {
    if (!profile.diagnosticContainer) {
      continue;
    }
    if (!containers.has(profile.diagnosticContainer)) {
      containers.set(profile.diagnosticContainer, new Set());
    }
    if (profile.diagnosticWorkspace) {
      containers.get(profile.diagnosticContainer).add(profile.diagnosticWorkspace);
    }
  }

  return Array.from(containers.entries()).map(([name, workspaces]) => ({
    name,
    workspaces: Array.from(workspaces),
  }));
}

async function checkDocker() {
  try {
    const { stdout } = await execFileAsync("docker", ["version", "--format", "{{.Server.Version}}"], {
      timeout: 3000,
    });
    const version = stdout.trim();
    return {
      ok: true,
      message: version ? `Docker daemon reachable (${version}).` : "Docker daemon reachable.",
      version,
    };
  } catch (error) {
    return {
      ok: false,
      message: `Docker is not reachable: ${error.message}`,
    };
  }
}

async function startDiagnosticContainer(containerName) {
  if (!isSafeContainerName(containerName)) {
    return {
      ok: false,
      message: "Invalid container name.",
      container: null,
    };
  }

  const profiles = await loadAgentProfiles();
  const allowedContainers = new Set(profiles.map((profile) => profile.diagnosticContainer).filter(Boolean));
  if (!allowedContainers.has(containerName)) {
    return {
      ok: false,
      message: "Container is not configured for diagnostics.",
      container: null,
    };
  }

  try {
    await execFileAsync("docker", ["start", containerName], { timeout: 5000 });
    return {
      ok: true,
      message: `Started ${containerName}.`,
      container: await inspectContainer(containerName),
    };
  } catch (error) {
    return {
      ok: false,
      message: `Could not start ${containerName}: ${error.message}`,
      container: await inspectContainer(containerName),
    };
  }
}

function isSafeContainerName(containerName) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerName);
}

async function inspectContainer(containerName, workspacePaths = []) {
  try {
    const { stdout } = await execFileAsync("docker", ["inspect", containerName], {
      maxBuffer: 1024 * 1024,
      timeout: 3000,
    });
    const [container] = JSON.parse(stdout);
    const running = Boolean(container?.State?.Running);
    return {
      name: containerName,
      present: true,
      running,
      status: String(container?.State?.Status || "unknown"),
      image: String(container?.Config?.Image || container?.Image || ""),
      workspaces: await checkContainerWorkspaces(containerName, workspacePaths, running),
    };
  } catch (error) {
    return {
      name: containerName,
      present: false,
      running: false,
      status: "missing",
      image: "",
      workspaces: workspacePaths.map((workspacePath) => ({
        path: workspacePath,
        exists: false,
        status: "missing",
        error: error.message,
      })),
      error: error.message,
    };
  }
}

async function checkContainerWorkspaces(containerName, workspacePaths, isRunning) {
  return Promise.all(
    workspacePaths.map(async (workspacePath) => {
      if (!isRunning) {
        return {
          path: workspacePath,
          exists: false,
          status: "container_not_running",
        };
      }
      try {
        await execFileAsync("docker", ["exec", containerName, "test", "-d", workspacePath], { timeout: 3000 });
        return {
          path: workspacePath,
          exists: true,
          status: "ready",
        };
      } catch (error) {
        return {
          path: workspacePath,
          exists: false,
          status: "missing",
          error: error.message,
        };
      }
    }),
  );
}

function persistTasks() {
  const serializedTasks = Array.from(tasks.values()).map(serializeTask);

  persistTasksQueue = persistTasksQueue
    .then(async () => {
      await fs.mkdir(dataRoot, { recursive: true });
      const tempPath = `${taskStorePath}.tmp`;
      await fs.writeFile(tempPath, `${JSON.stringify(serializedTasks, null, 2)}\n`);
      await fs.rename(tempPath, taskStorePath);
    })
    .catch((error) => {
      console.error(`TaskDeck could not persist tasks: ${error.message}`);
    });

  return persistTasksQueue;
}

function persistSessionLabels() {
  const serializedSessionLabels = Object.fromEntries(
    Array.from(sessionLabels.entries()).map(([key, value]) => [
      key,
      {
        label: String(value?.label || ""),
        updatedAt: String(value?.updatedAt || ""),
      },
    ]),
  );

  persistSessionLabelsQueue = persistSessionLabelsQueue
    .then(async () => {
      await fs.mkdir(dataRoot, { recursive: true });
      const tempPath = `${sessionLabelStorePath}.tmp`;
      await fs.writeFile(tempPath, `${JSON.stringify(serializedSessionLabels, null, 2)}\n`);
      await fs.rename(tempPath, sessionLabelStorePath);
    })
    .catch((error) => {
      console.error(`TaskDeck could not persist session labels: ${error.message}`);
    });

  return persistSessionLabelsQueue;
}

function savePreset(taskSpec) {
  const preset = normalizePreset(taskSpec);
  if (!preset) {
    return;
  }

  presets = [preset, ...presets.filter((candidate) => !presetMatches(candidate, preset))].slice(0, 10);
  persistPresets();
  broadcastPresets();
}

function persistPresets() {
  const serializedPresets = presets.map((preset) => ({ ...preset }));

  persistPresetsQueue = persistPresetsQueue
    .then(async () => {
      await fs.mkdir(dataRoot, { recursive: true });
      const tempPath = `${presetStorePath}.tmp`;
      await fs.writeFile(tempPath, `${JSON.stringify(serializedPresets, null, 2)}\n`);
      await fs.rename(tempPath, presetStorePath);
    })
    .catch((error) => {
      console.error(`TaskDeck could not persist presets: ${error.message}`);
    });

  return persistPresetsQueue;
}

function sanitizePresets(storedPresets) {
  const sanitizedPresets = [];
  for (const storedPreset of storedPresets) {
    const preset = normalizePreset(storedPreset);
    if (!preset || sanitizedPresets.some((candidate) => presetMatches(candidate, preset))) {
      continue;
    }
    sanitizedPresets.push(preset);
    if (sanitizedPresets.length >= 10) {
      break;
    }
  }
  return sanitizedPresets;
}

function normalizePreset(taskSpec) {
  const command = String(taskSpec?.command || "").trim();
  const cwd = String(taskSpec?.cwd || "").trim();
  if (!command) {
    return null;
  }

  return {
    title: String(taskSpec?.title || "").trim() || command,
    command,
    cwd,
  };
}

function presetMatches(left, right) {
  return left.command === right.command && left.cwd === right.cwd;
}

async function readTaskLog(taskId) {
  const cachedLog = logs.get(taskId);
  if (cachedLog !== undefined) {
    return cachedLog;
  }

  try {
    const taskLog = await fs.readFile(logPathForTask(taskId), "utf8");
    logs.set(taskId, taskLog.slice(-maxLogLength));
    return taskLog;
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function readTaskLogTail(taskId, tailLength) {
  const taskLog = await readTaskLog(taskId);
  const boundedTailLength = Math.max(0, Math.min(Number(tailLength) || 0, maxLogLength));
  return boundedTailLength > 0 ? taskLog.slice(-boundedTailLength) : "";
}

function writeTaskLog(taskId, data) {
  enqueueTaskLogWrite(taskId, "write", () => fs.writeFile(logPathForTask(taskId), data));
}

function appendTaskLog(taskId, data) {
  enqueueTaskLogWrite(taskId, "append", () => fs.appendFile(logPathForTask(taskId), data));
}

async function deleteTaskLog(taskId) {
  await enqueueTaskLogWrite(taskId, "delete", () => fs.rm(logPathForTask(taskId), { force: true }));
}

function enqueueTaskLogWrite(taskId, operationLabel, operation) {
  const previousWrite = taskLogWriteQueues.get(taskId) || Promise.resolve();
  const queuedWrite = previousWrite
    .catch(() => {})
    .then(operation)
    .catch((error) => {
      console.error(`TaskDeck could not ${operationLabel} log for ${taskId}: ${error.message}`);
    });

  taskLogWriteQueues.set(taskId, queuedWrite);
  queuedWrite.finally(() => {
    if (taskLogWriteQueues.get(taskId) === queuedWrite) {
      taskLogWriteQueues.delete(taskId);
    }
  });
  return queuedWrite;
}

async function deleteTaskAttachments(taskId) {
  try {
    await fs.rm(path.join(attachmentRoot, taskId), { force: true, recursive: true });
  } catch (error) {
    console.error(`TaskDeck could not delete attachments for ${taskId}: ${error.message}`);
  }
}

function logPathForTask(taskId) {
  return path.join(logRoot, `${taskId}.log`);
}

async function configureWebApp() {
  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "API route not found." });
  });

  if (process.env.NODE_ENV === "production") {
    app.use(express.static(webDist));
    app.get("*", (_request, response) => {
      response.sendFile(path.join(webDist, "index.html"));
    });
    return;
  }

  const [{ createServer }, { default: react }] = await Promise.all([
    import("vite"),
    import("@vitejs/plugin-react"),
  ]);
  const vite = await createServer({
    configFile: false,
    root: webRoot,
    plugins: [react()],
    server: {
      middlewareMode: true,
      hmr: { server },
    },
    appType: "spa",
  });

  app.use(vite.middlewares);
}
