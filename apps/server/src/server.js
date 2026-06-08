import express from "express";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WebSocketServer } from "ws";
import pty from "node-pty";
import {
  AgentState,
  AgentStateConfidence,
  AgentStateSource,
  AttentionState,
  TASK_IDENTITY_COLOR_SLOT_COUNT,
  createTask,
  markTaskChildStatusError,
  markTaskChildStatusReported,
  markTaskAttentionAcknowledged,
  markTaskAttentionState,
  markTaskAgentState,
  markTaskExited,
  markTaskRunning,
  markTaskTerminalInputLocked,
  markTaskTerminalInputUnlocked,
  normalizeIdentityColorSlot,
  parseChildStatusReportJson,
  serializeTask,
  TaskStatus,
  inferAgentStateFromStatus,
} from "@taskdeck/core";

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
const defaultConfigPath = path.join(repoRoot, "taskdeck.config.json");
const localConfigPath = path.join(repoRoot, "taskdeck.local.json");
const envConfigPath = process.env.TASKDECK_CONFIG ? path.resolve(process.env.TASKDECK_CONFIG) : "";
const defaultAgentProfiles = [
  {
    id: "codex",
    label: "Codex CLI",
    command: "docker start ai-agent-sandbox-agent-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-agent-1 sh -lc 'TERM=xterm-256color codex'",
    description: "Run Codex CLI inside the AI agent sandbox container",
    diagnosticContainer: "ai-agent-sandbox-agent-1",
    diagnosticWorkspace: "/workspace",
    modelOptions: [
      { id: "default", label: "Default" },
      { id: "gpt-5.5", label: "gpt-5.5" },
      { id: "gpt-5.5-thinking", label: "gpt-5.5 Thinking" },
      { id: "gpt-5.4-codex", label: "gpt-5.4 Codex" },
    ],
  },
  {
    id: "goose",
    label: "Goose",
    command: "docker start ai-agent-sandbox-agent-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-agent-1 goose",
    description: "Run Goose inside the AI agent sandbox container",
    diagnosticContainer: "ai-agent-sandbox-agent-1",
    diagnosticWorkspace: "/workspace",
  },
  {
    id: "zsh",
    label: "zsh",
    command: "docker start ai-agent-sandbox-agent-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-agent-1 sh -lc 'if command -v zsh >/dev/null 2>&1; then exec zsh; elif command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi'",
    description: "Plain interactive zsh shell",
    diagnosticContainer: "ai-agent-sandbox-agent-1",
    diagnosticWorkspace: "/workspace",
  },
];

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const shell = process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "bash");
const inputDebugEnabled = process.env.TASKDECK_INPUT_DEBUG === "1";

const clients = new Set();
const tasks = new Map();
const logs = new Map();
const sessionLabels = new Map();
let presets = [];
const maxLogLength = 250_000;
const terminalEnter = "\r";
const bracketedPasteStart = "\x1b[200~";
const bracketedPasteEnd = "\x1b[201~";
const codexInputHoldMs = 5000;
const codexStatusRefreshTimeoutMs = 16_000;
const inputPromptStabilizationMs = 750;
const ptyActivityWindowMs = 3000;
const maxPtyActivityFrames = 40;
const quietAttentionMs = 5000;
const childStatusPollIntervalMs = 2000;
const childSessionStartCoalesceMs = 200;
const defaultContainerWorkspaceRoot = "/workspace";
const protectedContainerCleanupPids = new Set(["1", "7", "8", "130"]);
const imageAttachmentMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const imageAttachmentExtensions = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);
const activePtys = new Map();
const startedChildSessionRequestKeys = new Set();
const pendingChildSessionStarts = new Map();
const childStatusFileSnapshots = new Map();
let persistTasksQueue = Promise.resolve();
let persistPresetsQueue = Promise.resolve();
let persistSessionLabelsQueue = Promise.resolve();
let childStatusPollInFlight = false;

app.use(express.json());

app.get("/api/context", async (_request, response) => {
  const projectRoots = await buildProjectRoots();
  const projectSuggestions = await buildProjectSuggestions(projectRoots);
  const defaultProjectRoot = projectRoots[0] || repoRoot;
  response.json({
    repoRoot,
    projectRoot: defaultProjectRoot,
    defaultCwd: selectDefaultProjectCwd(projectSuggestions, defaultProjectRoot),
    serverCwd: process.cwd(),
    shell,
    pathSeparator: path.sep,
    isGitRepo: await cwdIsGitRepo(repoRoot),
    cwdSuggestions: await buildCwdSuggestions(),
    projectRoots,
    projectSuggestions,
    agentProfiles: await loadAgentProfiles(),
    agentProfileConfig: await getAgentProfileConfigSummary(),
  });
});

app.get("/api/diagnostics", async (_request, response) => {
  response.json(await buildDiagnostics());
});

app.post("/api/codex-status/refresh", async (_request, response) => {
  try {
    response.json({
      status: await refreshCodexStatusInHiddenSession(),
    });
  } catch (error) {
    if (error instanceof CodexStatusRefreshError) {
      console.warn("TaskDeck hidden Codex status refresh failed:", {
        message: error.message,
        ...error.debug,
      });
      response.status(500).json({ error: error.message, debug: error.debug });
      return;
    }
    console.warn(`TaskDeck hidden Codex status refresh failed: ${error.message || error}`);
    response.status(500).json({ error: error.message || "Unable to refresh Codex status." });
  }
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
  });
});

app.get("/api/agent-sessions", async (_request, response) => {
  response.json({
    sessions: await listSavedCodexSessions(),
  });
});

app.patch("/api/agent-sessions/:sessionKey/label", async (request, response) => {
  const sessionKey = String(request.params.sessionKey || "").trim();
  const label = String(request.body?.label || "").trim();

  if (!label) {
    response.status(400).json({ error: "TaskDeck display name is required." });
    return;
  }

  const sessions = await listSavedCodexSessions();
  if (!sessions.some((session) => session.key === sessionKey)) {
    response.status(404).json({ error: "Saved session not found." });
    return;
  }

  await renameSessionLabel(sessionKey, label);
  broadcastTasks();

  response.json({
    ok: true,
    sessions: await listSavedCodexSessions(),
    tasks: listTasks(),
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
    sessions: await listSavedCodexSessions(),
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

  resetPendingInputPrompt(activePtys.get(taskId));
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

app.patch("/api/tasks/:taskId/terminal-input-lock", async (request, response) => {
  const { taskId } = request.params;
  const task = tasks.get(taskId);
  const locked = Boolean(request.body?.locked);

  if (!task) {
    response.status(404).json({ error: "Task not found." });
    return;
  }

  if (task.status !== TaskStatus.RUNNING) {
    response.status(409).json({ error: "Only running tasks can toggle terminal input lock." });
    return;
  }

  const activePty = activePtys.get(taskId);
  if (locked && activePty) {
    resetPendingInputPrompt(activePty);
    clearQueuedPtyInput(activePty);
  }

  setTask(locked ? markTaskTerminalInputLocked(task) : markTaskTerminalInputUnlocked(task));
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

app.get("/api/server/restart", (_request, response) => {
  response.status(405).json({ error: "Use POST to restart TaskDeck." });
});

app.post("/api/server/restart", (_request, response) => {
  console.log("TaskDeck restart requested from UI.");
  response.json({ ok: true, message: "Restarting TaskDeck." });
  setTimeout(() => {
    process.exit(42);
  }, 250);
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
          agentPermissionLevel: String(message.agentPermissionLevel || "").trim(),
          agentReasoningEffort: String(message.agentReasoningEffort || "").trim(),
          agentModel: String(message.agentModel || "").trim(),
          sessionMode: String(message.sessionMode || "").trim(),
          resumeCommand: String(message.resumeCommand || "").trim(),
          agentSessionProvider: String(message.agentSessionProvider || "").trim(),
          agentSessionId: String(message.agentSessionId || "").trim(),
          agentSessionSource: String(message.agentSessionSource || "").trim(),
          agentSessionDetectedAt: String(message.agentSessionDetectedAt || "").trim(),
          agentSessionResumeCommand: String(message.agentSessionResumeCommand || "").trim(),
          parentSessionId: String(message.parentSessionId || "").trim(),
          spawnedFromParentRequest: normalizeBoolean(message.spawnedFromParentRequest),
          childSessionRequestKey: String(message.childSessionRequestKey || "").trim(),
          workPackageId: String(message.workPackageId || "").trim(),
          filesLikelyToChange: normalizeStringArray(message.filesLikelyToChange),
          initialInstruction: String(message.initialInstruction || "").trim(),
          attachments: normalizePendingAttachmentRefs(message.attachments),
        },
        socket,
      );
      return;
    }

    if (message.type === "input") {
      const taskId = String(message.taskId || "").trim();
      const task = tasks.get(taskId);
      const activePty = activePtys.get(taskId);
      if (task?.terminalInputLockedAt) {
        send(socket, { type: "error", message: "Terminal input is locked for this task." });
        if (inputDebugEnabled) {
          console.log(`[TaskDeck input] ignored task=${taskId || "-"} reason=terminal-input-locked`);
        }
        return;
      }
      if (activePty && typeof message.data === "string") {
        logInputDebug(message.taskId, message.data, message.source || "client");
        updateAgentStateFromTaskDeckEvent(taskId, AgentState.WORKING, {
          reason: "User input was sent to the PTY.",
          source: AgentStateSource.TASKDECK_EVENT,
          confidence: AgentStateConfidence.HIGH,
          attentionState: AttentionState.NONE,
          attentionReason: "User input was sent to the task.",
          attentionSource: AgentStateSource.TASKDECK_EVENT,
          attentionConfidence: AgentStateConfidence.HIGH,
        });
        resetPendingInputPrompt(activePty);
        writeOrQueuePtyInput(activePty, message.data, message.source || "client");
      } else if (inputDebugEnabled) {
        console.log(`[TaskDeck input] ignored task=${message.taskId || "-"} reason=no-active-pty-or-invalid-data`);
      }
      return;
    }

    if (message.type === "resize") {
      const activePty = activePtys.get(message.taskId);
      if (activePty) {
        activePty.process.resize(Number(message.cols) || 100, Number(message.rows) || 28);
      }
      return;
    }

    if (message.type === "interrupt") {
      const taskId = String(message.taskId || "").trim();
      const task = tasks.get(taskId);
      const activePty = activePtys.get(taskId);
      if (!task || task.status !== TaskStatus.RUNNING) {
        send(socket, { type: "error", message: "Select a running task before canceling the current instruction." });
        return;
      }
      if (!activePty) {
        send(socket, { type: "error", message: "No active PTY is available for the selected task." });
        return;
      }
      resetPendingInputPrompt(activePty);
      clearQueuedPtyInput(activePty);
      activePty.process.write("\x03");
      const marker = "\r\n[TaskDeck] Sent interrupt to running PTY.\r\n";
      appendLog(taskId, marker);
      broadcast({ type: "output", taskId, data: marker });
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
await configureWebApp();

server.on("error", (error) => {
  console.error(`TaskDeck failed to listen on ${host}:${port}`);
  console.error(error);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`TaskDeck listening on http://${host}:${port}`);
});

const attentionTimer = setInterval(updateQuietAttentionStates, 1000);
attentionTimer.unref?.();

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

function childSessionStartDedupeKeys({ childSessionRequestKey, parentSessionId, workPackageId }) {
  const keys = [];
  const requestKey = String(childSessionRequestKey || "").trim();
  const parentId = String(parentSessionId || "").trim();
  const packageId = String(workPackageId || "").trim();

  if (requestKey) {
    keys.push(`request:${requestKey}`);
  }

  if (parentId && packageId) {
    keys.push(`parent-work-package:${parentId}:${packageId}`);
  }

  return keys;
}

function childSessionStartGroupKey({ childSessionRequestKey, parentSessionId, workPackageId }) {
  const parentId = String(parentSessionId || "").trim();
  const packageId = String(workPackageId || "").trim();
  const requestKey = String(childSessionRequestKey || "").trim();

  if (parentId && packageId) {
    return `parent-work-package:${parentId}:${packageId}`;
  }

  return requestKey ? `request:${requestKey}` : "";
}

function childSessionStartPreferenceScore({ agentReasoningEffort, command }) {
  let score = 0;
  if (String(agentReasoningEffort || "").trim()) {
    score += 2;
  }
  if (String(command || "").includes("model_reasoning_effort")) {
    score += 1;
  }
  return score;
}

function hasExistingChildForParentWorkPackage(parentSessionId, workPackageId) {
  const parentId = String(parentSessionId || "").trim();
  const packageId = String(workPackageId || "").trim();

  if (!parentId || !packageId) {
    return false;
  }

  return Array.from(tasks.values()).some((task) => {
    return Boolean(
      task.spawnedFromParentRequest &&
        task.parentSessionId === parentId &&
        task.workPackageId === packageId,
    );
  });
}

function hasStartedChildSessionDedupeKey(dedupeKeys) {
  return dedupeKeys.some((dedupeKey) => startedChildSessionRequestKeys.has(dedupeKey));
}

function rejectDuplicateChildSessionStart(socket) {
  send(socket, { type: "error", message: "Duplicate child session request ignored." });
}

function reserveChildSessionDedupeKeys(dedupeKeys) {
  for (const dedupeKey of dedupeKeys) {
    startedChildSessionRequestKeys.add(dedupeKey);
  }
}

function childSessionStartIsDuplicate(startInput) {
  const dedupeKeys = childSessionStartDedupeKeys(startInput);
  return (
    hasStartedChildSessionDedupeKey(dedupeKeys) ||
    hasExistingChildForParentWorkPackage(startInput.parentSessionId, startInput.workPackageId)
  );
}

function scheduleChildSessionStart(startInput, socket) {
  const dedupeKeys = childSessionStartDedupeKeys(startInput);
  if (childSessionStartIsDuplicate(startInput)) {
    rejectDuplicateChildSessionStart(socket);
    return;
  }

  const groupKey = childSessionStartGroupKey(startInput);
  if (!groupKey) {
    rejectDuplicateChildSessionStart(socket);
    return;
  }

  const existing = pendingChildSessionStarts.get(groupKey);
  const preferenceScore = childSessionStartPreferenceScore(startInput);

  if (existing) {
    for (const dedupeKey of dedupeKeys) {
      existing.dedupeKeys.add(dedupeKey);
    }

    if (preferenceScore > existing.preferenceScore) {
      existing.startInput = startInput;
      existing.socket = socket;
      existing.preferenceScore = preferenceScore;
    } else {
      rejectDuplicateChildSessionStart(socket);
    }
    return;
  }

  const pending = {
    startInput,
    socket,
    preferenceScore,
    dedupeKeys: new Set(dedupeKeys),
    timeout: null,
  };
  pending.timeout = setTimeout(() => {
    pendingChildSessionStarts.delete(groupKey);

    if (
      hasStartedChildSessionDedupeKey(Array.from(pending.dedupeKeys)) ||
      hasExistingChildForParentWorkPackage(pending.startInput.parentSessionId, pending.startInput.workPackageId)
    ) {
      rejectDuplicateChildSessionStart(pending.socket);
      return;
    }

    reserveChildSessionDedupeKeys(Array.from(pending.dedupeKeys));
    startTaskNow(pending.startInput, pending.socket);
  }, childSessionStartCoalesceMs);
  pendingChildSessionStarts.set(groupKey, pending);
}

async function startTask(startInput, socket) {
  const {
    command,
    spawnedFromParentRequest,
    childSessionRequestKey,
  } = startInput;

  if (!command) {
    send(socket, { type: "error", message: "Enter a command before starting a task." });
    return;
  }

  if (spawnedFromParentRequest && !childSessionRequestKey) {
    send(socket, { type: "error", message: "Child session request key is required." });
    return;
  }

  if (spawnedFromParentRequest) {
    scheduleChildSessionStart(startInput, socket);
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
  agentPermissionLevel,
  agentReasoningEffort,
  agentModel,
  sessionMode,
  resumeCommand,
  agentSessionProvider,
  agentSessionId,
  agentSessionSource,
  agentSessionDetectedAt,
  agentSessionResumeCommand,
  parentSessionId,
  spawnedFromParentRequest,
  childSessionRequestKey,
  workPackageId,
  filesLikelyToChange = [],
  initialInstruction,
  attachments = [],
}, socket) {
  const resolvedCwd = await resolveCwd(cwd, socket);
  if (!resolvedCwd) {
    return;
  }

  const processCwd = await serverAccessiblePathForHostCwd(resolvedCwd);
  const effectiveCommand = await commandForTaskCwd(command, resolvedCwd, sessionMode);
  const detectedAgentSession = detectInitialAgentSession(effectiveCommand, agentProfileId, agentLabel);
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
    agentPermissionLevel,
    agentReasoningEffort,
    agentModel: agentModel || modelFromCommand(effectiveCommand),
    sessionMode,
    resumeCommand,
    identityColorSlot,
    initialInstruction,
    parentSessionId,
    spawnedFromParentRequest,
    workPackageId,
    filesLikelyToChange,
    ...detectedAgentSession,
    ...explicitAgentSession,
  });
  const childStatusFile = await ensureChildStatusFilePath(baseTask);
  const finalizedAttachments = await finalizePendingAttachments(attachments, baseTask.id);

  const task = markTaskRunning({
    ...baseTask,
    childStatusFile,
    attachments: finalizedAttachments,
  });
  const taskDeckEnv = taskDeckEnvironmentForTask(task, effectiveCommand, childStatusFile);
  const commandForProcess = commandWithTaskDeckEnv(effectiveCommand, taskDeckEnv);
  tasks.set(task.id, task);
  logs.set(task.id, "");
  persistTasks();
  savePreset({
    title: task.title,
    command: task.command,
    cwd: task.cwd,
  });
  writeTaskLog(task.id, "");

  try {
    const terminalProcess = pty.spawn(shell, ["-lc", commandForProcess], {
      name: "xterm-256color",
      cols: 100,
      rows: 28,
      cwd: processCwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        ...taskDeckEnv,
      },
    });

    const activePty = createActivePty(task, terminalProcess);
    activePtys.set(task.id, activePty);
    updateAgentStateFromTaskDeckEvent(task.id, AgentState.THINKING, {
      reason: "PTY process started; waiting for agent output.",
      source: AgentStateSource.TASKDECK_EVENT,
      confidence: AgentStateConfidence.MEDIUM,
      attentionState: AttentionState.NONE,
      attentionReason: "Task has started.",
      attentionSource: AgentStateSource.TASKDECK_EVENT,
      attentionConfidence: AgentStateConfidence.HIGH,
    });
    send(socket, { type: "started", taskId: task.id });

    terminalProcess.onData((data) => {
      if (!tasks.has(task.id)) {
        return;
      }
      appendLog(task.id, data);
      updateAgentSessionFromOutput(task.id, data);
      updateAgentStateFromPtyOutput(activePty, data);
      broadcast({ type: "output", taskId: task.id, data });
    });

    terminalProcess.onExit(({ exitCode, signal }) => {
      const currentTask = tasks.get(task.id);
      clearActivePty(task.id);
      if (!currentTask) {
        return;
      }
      setTask(markTaskExited(currentTask, { exitCode, signal }));
      broadcastTasks();
    });

    const initialInstructionInput = String(initialInstruction || "").trim();
    if (initialInstructionInput) {
      const marker = "\r\n[TaskDeck] Sending initial instruction.\r\n";
      appendLog(task.id, marker);
      broadcast({ type: "output", taskId: task.id, data: marker });
      writeOrQueuePtyInput(activePty, `${initialInstructionInput}${terminalEnter}`, "initial-instruction");
    }
  } catch (error) {
    appendLog(task.id, `\r\n[TaskDeck] Failed to start PTY: ${error.message}\r\n`);
    setTask(markTaskExited(tasks.get(task.id), { exitCode: 1, signal: null }));
    broadcast({ type: "output", taskId: task.id, data: logs.get(task.id) });
    broadcastTasks();
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

function createActivePty(task, process) {
  const inputHoldUntil = isCodexLikeTask(task) ? Date.now() + codexInputHoldMs : 0;
  const activePty = {
    taskId: task.id,
    process,
    createdAt: Date.now(),
    inputHoldUntil,
    inputQueue: [],
    flushTimer: null,
    activity: createPtyActivity(),
    pendingInputPrompt: null,
  };
  scheduleQueuedPtyInputFlush(activePty);
  return activePty;
}

function writeOrQueuePtyInput(activePty, data, source) {
  const waitMs = activePty.inputHoldUntil - Date.now();
  if (waitMs > 0) {
    activePty.inputQueue.push(data);
    if (inputDebugEnabled) {
      console.log(`[TaskDeck input] queued source=${source} task=${activePty.taskId} waitMs=${waitMs}`);
    }
    scheduleQueuedPtyInputFlush(activePty);
    return;
  }

  flushQueuedPtyInput(activePty);
  activePty.process.write(data);
}

function scheduleQueuedPtyInputFlush(activePty) {
  const waitMs = activePty.inputHoldUntil - Date.now();
  if (waitMs <= 0 || activePty.flushTimer) {
    return;
  }

  activePty.flushTimer = setTimeout(() => {
    activePty.flushTimer = null;
    flushQueuedPtyInput(activePty);
  }, waitMs);
}

function flushQueuedPtyInput(activePty) {
  if (activePty.inputQueue.length === 0) {
    return;
  }

  const queuedInput = activePty.inputQueue.splice(0).join("");
  if (inputDebugEnabled) {
    console.log(`[TaskDeck input] flushing task=${activePty.taskId} len=${queuedInput.length}`);
  }
  activePty.process.write(queuedInput);
}

function clearQueuedPtyInput(activePty) {
  activePty.inputQueue.splice(0);
  if (activePty.flushTimer) {
    clearTimeout(activePty.flushTimer);
    activePty.flushTimer = null;
  }
}

function clearActivePty(taskId) {
  const activePty = activePtys.get(taskId);
  if (activePty) {
    resetPendingInputPrompt(activePty);
    clearQueuedPtyInput(activePty);
  }
  activePtys.delete(taskId);
}

async function resolveCwd(cwd, socket) {
  const validation = await validateCwd(cwd);

  if (!validation.ok) {
    send(socket, { type: "error", message: validation.message });
    return null;
  }

  return validation.resolvedCwd;
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
  const taskCwd = path.resolve(repoRoot, String(task.cwd || ""));
  return path.join(taskCwd, ".taskdeck", "statuses", `${task.id}.json`);
}

function taskDeckEnvironmentForTask(task, command, hostStatusFile) {
  const childStatusFile = childVisibleStatusFilePathForTask(task, command, hostStatusFile);
  return {
    TASKDECK_TASK_ID: task.id,
    ...(task.parentSessionId ? { TASKDECK_PARENT_TASK_ID: task.parentSessionId } : {}),
    ...(task.workPackageId ? { TASKDECK_WORK_PACKAGE_ID: task.workPackageId } : {}),
    TASKDECK_STATUS_FILE: childStatusFile,
  };
}

function childVisibleStatusFilePathForTask(task, command, hostStatusFile) {
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
    console.warn(`TaskDeck child status scan failed: ${error.message}`);
  } finally {
    childStatusPollInFlight = false;
  }
}

async function scanChildStatusFileForTask(task) {
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
      error: `Could not read child status file: ${error.message}`,
    });
  }

  const fingerprint = `contents:${statusFilePath}:${fileContents}`;
  if (childStatusFileSnapshots.get(task.id) === fingerprint) {
    return false;
  }
  childStatusFileSnapshots.set(task.id, fingerprint);
  return updateTaskFromChildStatusResult(task.id, parseChildStatusReportJson(fileContents));
}

function updateTaskFromChildStatusResult(taskId, result) {
  const task = tasks.get(taskId);
  if (!task) {
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

async function commandForTaskCwd(command, resolvedCwd, sessionMode) {
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

function formatAgentInputForPty(input) {
  const text = normalizeTerminalInput(input);
  return `${bracketedPasteStart}${text}${bracketedPasteEnd}${terminalEnter}`;
}

function normalizeTerminalInput(input) {
  return String(input).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

async function refreshCodexStatusInHiddenSession() {
  const profile = await findCodexStatusProfile();
  if (!profile) {
    throw new Error("No Codex container profile is configured.");
  }

  const status = await queryCodexStatusWithHiddenPty(profile.command);
  return {
    ...status,
    updatedAt: new Date().toISOString(),
  };
}

async function findCodexStatusProfile() {
  const profiles = await loadAgentProfiles();
  return (
    profiles.find((profile) => profile.id === "codex" && isCodexStatusProfile(profile)) ??
    profiles.find((profile) => isCodexStatusProfile(profile)) ??
    null
  );
}

function isCodexStatusProfile(profile) {
  const haystack = `${profile.id || ""} ${profile.label || ""} ${profile.command || ""}`.toLowerCase();
  return Boolean(profile.diagnosticContainer) && /\bcodex\b/.test(haystack) && /\bdocker\b[\s\S]*\bexec\b/.test(profile.command || "");
}

class CodexStatusRefreshError extends Error {
  constructor(message, debug) {
    super(message);
    this.name = "CodexStatusRefreshError";
    this.debug = debug;
  }
}

function queryCodexStatusWithHiddenPty(command) {
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    let terminalProcess;
    let exited = false;
    let timedOut = false;
    let sentStatusCount = 0;
    const timers = [];

    const buildDebug = () => codexStatusDebug(output, {
      sentStatusCount,
      exited,
      timedOut,
    });

    const settle = (error, status) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      timers.forEach((timer) => clearTimeout(timer));
      if (terminalProcess) {
        try {
          terminalProcess.kill();
        } catch {
          // Hidden status sessions are best-effort and may already have exited.
        }
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(status);
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      settle(new CodexStatusRefreshError("Codex status refresh timed out.", buildDebug()));
    }, codexStatusRefreshTimeoutMs);

    try {
      terminalProcess = pty.spawn(shell, ["-lc", command], {
        name: "xterm-256color",
        cols: 100,
        rows: 28,
        cwd: repoRoot,
        env: {
          ...process.env,
          TERM: "xterm-256color",
        },
      });
    } catch (error) {
      settle(new CodexStatusRefreshError(error.message || "Unable to start hidden Codex status session.", buildDebug()));
      return;
    }

    const sendStatus = (reason) => {
      if (settled || !terminalProcess || sentStatusCount >= 2) {
        return;
      }
      sentStatusCount += 1;
      if (inputDebugEnabled) {
        console.log(`[TaskDeck codex-status] sent /status reason=${reason} count=${sentStatusCount}`);
      }
      terminalProcess.write(formatAgentInputForPty("/status"));
    };

    terminalProcess.onData((data) => {
      output = `${output}${data}`.slice(-16_000);
      const status = parseCodexStatusOutput(output);
      if (status?.fiveHour && status?.weekly) {
        settle(null, status);
        return;
      }
      if (sentStatusCount === 0 && hiddenCodexOutputLooksReady(output)) {
        sendStatus("ready-output");
      }
    });

    terminalProcess.onExit(() => {
      exited = true;
      const status = parseCodexStatusOutput(output);
      if (status?.fiveHour && status?.weekly) {
        settle(null, status);
        return;
      }
      settle(new CodexStatusRefreshError("Codex status output was unavailable.", buildDebug()));
    });

    timers.push(
      setTimeout(() => sendStatus("startup-fallback"), 3_000),
      setTimeout(() => {
        if (!parseCodexStatusOutput(output)) {
          sendStatus("retry-no-status");
        }
      }, 8_000),
    );
  });
}

function hiddenCodexOutputLooksReady(output) {
  const text = normalizeCodexStatusOutput(output).toLowerCase();
  return (
    /\bcodex\b/.test(text) &&
    (/(input|prompt|type|enter|ready)/.test(text) || /(?:^|\n)\s*[>›]\s*$/.test(text) || text.length > 800)
  );
}

function codexStatusDebug(output, details) {
  const normalizedOutput = normalizeCodexStatusOutput(output);
  return {
    outputTail: normalizedOutput.slice(-1500),
    sawFiveHour: /5h\s+limit\s*:/i.test(normalizedOutput),
    sawWeekly: /weekly\s+limit\s*:/i.test(normalizedOutput),
    sentStatusCount: details.sentStatusCount,
    exited: details.exited,
    timedOut: details.timedOut,
  };
}

function normalizeCodexStatusOutput(output) {
  return stripTerminalControlSequences(String(output))
    .split("\n")
    .map((line) => removeTerminalBoxDrawing(line).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function parseCodexStatusOutput(output) {
  const statusBlock = latestCompleteCodexStatusBlock(output);
  if (!statusBlock) {
    return null;
  }

  const fiveHour = parseCodexStatusLine(statusBlock.fiveHourLine, "5h limit");
  const weekly = parseCodexStatusLine(statusBlock.weeklyLine, "Weekly limit");

  return {
    ...(fiveHour ? { fiveHour: { remainingPercent: fiveHour.percent, resetLabel: fiveHour.resetLabel } } : {}),
    ...(weekly ? { weekly: { remainingPercent: weekly.percent, resetLabel: weekly.resetLabel } } : {}),
  };
}

function latestCompleteCodexStatusBlock(output) {
  const lines = normalizeCodexStatusOutput(output).split("\n").filter(Boolean);

  for (let weeklyIndex = lines.length - 1; weeklyIndex >= 0; weeklyIndex -= 1) {
    if (!statusLineHasLabel(lines[weeklyIndex], "Weekly limit")) {
      continue;
    }

    const fiveHourIndex = findPreviousStatusLineIndex(lines, weeklyIndex - 1, "5h limit");
    if (fiveHourIndex === -1) {
      continue;
    }

    return {
      fiveHourLine: lines[fiveHourIndex],
      weeklyLine: lines[weeklyIndex],
    };
  }

  return null;
}

function findPreviousStatusLineIndex(lines, startIndex, label) {
  for (let index = startIndex; index >= 0; index -= 1) {
    if (statusLineHasLabel(lines[index], label)) {
      return index;
    }
  }
  return -1;
}

function statusLineHasLabel(line, label) {
  return new RegExp(`${labelPatternForRegex(label)}\\s*:`, "i").test(line);
}

function parseCodexStatusLine(line, label) {
  const labelPattern = labelPatternForRegex(label);
  const match = line.match(new RegExp(`${labelPattern}\\s*:\\s*.*?(\\d{1,3})%\\s+left(?:\\s+\\(resets\\s+([^)]+)\\))?`, "i"));
  if (!match) {
    return null;
  }
  return {
    percent: clampPercent(Number(match[1])),
    resetLabel: String(match[2] || "").trim(),
  };
}

function labelPatternForRegex(label) {
  return label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function removeTerminalBoxDrawing(value) {
  return String(value).replace(/[\u2500-\u257f]/g, " ");
}

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
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
    `[TaskDeck input] source=${source} task=${taskId} len=${data.length} hasCR=${data.includes("\r")} hasLF=${data.includes("\n")} hasBracketedPaste=${data.includes(bracketedPasteStart)} tail=${JSON.stringify(tail)} tailCodes=${codes.join(",")}`,
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
  const normalizedTask = {
    ...task,
    agentModel: String(task.agentModel || ""),
    agentState: task.agentState ?? inferAgentStateFromStatus(task),
    attachments: normalizeTaskAttachmentsForServer(task.attachments),
  };
  if (normalizedTask.agentSessionId && isCodexLikeTask(normalizedTask)) {
    const agentSessionResumeCommand =
      normalizedTask.agentSessionResumeCommand || buildCodexSessionResumeCommand(normalizedTask, normalizedTask.agentSessionId);
    const nextTask = {
      ...normalizedTask,
      agentSessionProvider: normalizedTask.agentSessionProvider || "codex",
      agentSessionResumeCommand,
    };
    return withDetectedResumeCommand(nextTask, agentSessionResumeCommand);
  }
  return normalizedTask;
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

function detectInitialAgentSession(command, agentProfileId, agentLabel) {
  if (!isCodexLikeTask({ command, agentProfileId, agentLabel })) {
    return {};
  }

  const explicitResumeId = extractCodexResumeId(command);
  if (!explicitResumeId) {
    return {};
  }

  const agentSessionResumeCommand = buildCodexSessionResumeCommand({ command, agentProfileId }, explicitResumeId);
  return withDetectedResumeCommand({
    agentSessionId: explicitResumeId,
    agentSessionSource: "codex resume command",
    agentSessionProvider: "codex",
    agentSessionDetectedAt: new Date().toISOString(),
    agentSessionResumeCommand,
    resumeCommand: "",
  }, agentSessionResumeCommand);
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

  return withDetectedResumeCommand({
    agentSessionProvider,
    agentSessionId,
    agentSessionSource,
    agentSessionDetectedAt,
    agentSessionResumeCommand,
  }, agentSessionResumeCommand);
}

function updateAgentSessionFromOutput(taskId, data) {
  const task = tasks.get(taskId);
  if (!task || task.agentSessionId || !isCodexLikeTask(task)) {
    return;
  }

  const sessionId = extractCodexSessionIdFromOutput(data);
  if (!sessionId) {
    return;
  }

  const agentSessionResumeCommand = buildCodexSessionResumeCommand(task, sessionId);
  setTask(withDetectedResumeCommand({
    ...task,
    agentSessionId: sessionId,
    agentSessionSource: "codex output",
    agentSessionProvider: "codex",
    agentSessionDetectedAt: new Date().toISOString(),
    agentSessionResumeCommand,
    updatedAt: new Date().toISOString(),
  }, agentSessionResumeCommand));
  broadcastTasks();
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

function updateAgentStateFromPtyOutput(activePty, data) {
  const task = tasks.get(activePty.taskId);
  if (!task || task.status !== TaskStatus.RUNNING) {
    return;
  }

  const activity = recordPtyActivity(activePty, data);
  const adapter = getAgentStateInferenceAdapter(task);

  // TUI text is an unreliable protocol. Agent adapters keep that fallback
  // isolated so Goose/Codex behavior can evolve without broad shared guesses.
  const recentOutput = logs.get(activePty.taskId)?.slice(-8000) || data;
  const nextSignal = adapter.infer({ recentOutput, latestOutput: data, activity, task, activePty });
  const attentionState = nextSignal.attentionState ?? AttentionState.NONE;
  const attentionReason = nextSignal.attentionReason ?? "No user attention needed.";
  const attentionSource = nextSignal.attentionSource ?? nextSignal.source;
  const attentionConfidence = nextSignal.attentionConfidence ?? nextSignal.confidence;

  updateAgentStateFromTaskDeckEvent(activePty.taskId, nextSignal.state, {
    reason: nextSignal.reason,
    source: nextSignal.source,
    confidence: nextSignal.confidence,
    attentionState,
    attentionReason,
    attentionSource,
    attentionConfidence,
  });
}

function updateQuietAttentionStates() {
  const now = Date.now();
  let changed = updatePendingInputAttentionStates(now);

  for (const activePty of activePtys.values()) {
    const task = tasks.get(activePty.taskId);
    if (
      !task ||
      task.status !== TaskStatus.RUNNING ||
      isStrongAttentionState(task.attentionState) ||
      isChildStatusAttentionActive(task)
    ) {
      continue;
    }

    const lastActivityAt = activePty.activity?.lastOutputAt || activePty.createdAt || now;
    if (now - lastActivityAt < quietAttentionMs) {
      continue;
    }

    if (isAttentionEventAcknowledged(task, lastActivityAt)) {
      continue;
    }

    const reason = "Running PTY has been quiet; user attention may be needed.";
    if (task.attentionState !== AttentionState.MAY_NEED_USER || task.attentionStateReason !== reason) {
      setTask(markTaskAttentionState(task, AttentionState.MAY_NEED_USER, {
        reason,
        source: AgentStateSource.PROCESS,
        confidence: AgentStateConfidence.LOW,
      }));
      changed = true;
    }
  }

  if (changed) {
    broadcastTasks();
  }
}

function updatePendingInputAttentionStates(now) {
  let changed = false;

  for (const activePty of activePtys.values()) {
    const task = tasks.get(activePty.taskId);
    const pendingInputPrompt = activePty.pendingInputPrompt;
    if (!task || task.status !== TaskStatus.RUNNING || !pendingInputPrompt) {
      continue;
    }

    if (now - pendingInputPrompt.firstSeenAt < inputPromptStabilizationMs) {
      continue;
    }

    if (isAttentionEventAcknowledged(task, pendingInputPrompt.firstSeenAt)) {
      continue;
    }

    if (isPtyActivelyRepainting(activePty.activity, now)) {
      continue;
    }

    const reason = "Input prompt persisted and terminal is quiet.";
    const attentionReason = "Stable input prompt detected.";
    if (
      task.agentState !== AgentState.WAITING_INPUT ||
      task.agentStateReason !== reason ||
      task.attentionState !== AttentionState.NEEDS_INPUT ||
      task.attentionStateReason !== attentionReason
    ) {
      setTask(markTaskAgentState(task, AgentState.WAITING_INPUT, {
        reason,
        source: AgentStateSource.TUI_FALLBACK,
        confidence: AgentStateConfidence.MEDIUM,
        attentionState: AttentionState.NEEDS_INPUT,
        attentionReason,
        attentionSource: AgentStateSource.TUI_FALLBACK,
        attentionConfidence: AgentStateConfidence.MEDIUM,
      }));
      changed = true;
    }
  }

  return changed;
}

function isStrongAttentionState(attentionState) {
  return (
    attentionState === AttentionState.NEEDS_APPROVAL ||
    attentionState === AttentionState.NEEDS_INPUT ||
    attentionState === AttentionState.REVIEW_READY ||
    attentionState === AttentionState.FAILED
  );
}

function isChildStatusAttentionActive(task) {
  return (
    task.attentionStateSource === AgentStateSource.CHILD_STATUS &&
    task.attentionState &&
    task.attentionState !== AttentionState.NONE
  );
}

function isAttentionEventAcknowledged(task, eventStartedAt) {
  const acknowledgedAt = Date.parse(String(task.attentionAcknowledgedAt || ""));
  return Number.isFinite(acknowledgedAt) && acknowledgedAt >= eventStartedAt;
}

function createPtyActivity() {
  return {
    lastOutputAt: 0,
    lastTextOutputAt: 0,
    lastAnsiFrameAt: 0,
    recentOutputFrames: [],
    recentAnsiFrames: [],
    recentCarriageReturns: [],
    signals: {
      containsAnsiControl: false,
      containsCarriageReturn: false,
      containsCursorMovementOrLineClear: false,
      hasVisibleTextAfterStrip: false,
    },
  };
}

function recordPtyActivity(activePty, data) {
  const now = Date.now();
  const signals = classifyPtyOutputChunk(data);
  const activity = activePty.activity || createPtyActivity();

  activity.signals = signals;
  activity.lastOutputAt = now;
  activity.recentOutputFrames = appendRecentTimestamp(activity.recentOutputFrames, now);

  if (signals.hasVisibleTextAfterStrip) {
    activity.lastTextOutputAt = now;
  }

  if (signals.containsAnsiControl || signals.containsCursorMovementOrLineClear) {
    activity.lastAnsiFrameAt = now;
    activity.recentAnsiFrames = appendRecentTimestamp(activity.recentAnsiFrames, now);
  }

  if (signals.containsCarriageReturn) {
    activity.recentCarriageReturns = appendRecentTimestamp(activity.recentCarriageReturns, now);
  }

  activePty.activity = activity;
  return { ...activity, signals };
}

function appendRecentTimestamp(timestamps, timestamp) {
  return [...timestamps, timestamp]
    .filter((candidate) => timestamp - candidate <= ptyActivityWindowMs)
    .slice(-maxPtyActivityFrames);
}

function classifyPtyOutputChunk(data) {
  const value = String(data);
  const visibleText = stripTerminalControlSequences(value).replace(/\s+/g, "");

  return {
    containsAnsiControl: /\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~])/.test(value),
    containsCarriageReturn: /\r/.test(value),
    containsCursorMovementOrLineClear: /\x1b\[[0-?]*[ -/]*(?:[ABCDEFGHJKSTfhl])/.test(value),
    hasVisibleTextAfterStrip: visibleText.length > 0,
  };
}

function getAgentStateInferenceAdapter(task) {
  if (isGooseLikeTask(task)) {
    return gooseAgentStateAdapter;
  }

  if (isCodexLikeTask(task)) {
    return codexAgentStateAdapter;
  }

  return genericAgentStateAdapter;
}

const gooseAgentStateAdapter = {
  id: "goose",
  infer({ recentOutput, latestOutput, activity, activePty }) {
    return inferWithExplicitPromptFallback({ recentOutput, latestOutput, activity, activePty, agentKind: this.id });
  },
};

const codexAgentStateAdapter = {
  id: "codex",
  infer({ recentOutput, latestOutput, activity, activePty }) {
    return inferWithExplicitPromptFallback({ recentOutput, latestOutput, activity, activePty, agentKind: this.id });
  },
};

const genericAgentStateAdapter = {
  id: "generic",
  infer({ recentOutput, latestOutput, activity, activePty }) {
    return inferWithExplicitPromptFallback({ recentOutput, latestOutput, activity, activePty, agentKind: this.id });
  },
};

function inferWithExplicitPromptFallback({ recentOutput, latestOutput, activity, activePty, agentKind }) {
  const tuiSignal = inferFromExplicitTuiPrompts({ recentOutput, latestOutput, activity, activePty, agentKind });
  const processSignal = inferFromPtyActivity(activity);

  if (tuiSignal?.state) {
    return tuiSignal;
  }

  return {
    ...processSignal,
    attentionState: tuiSignal?.attentionState ?? processSignal.attentionState,
    attentionReason: tuiSignal?.attentionReason ?? processSignal.attentionReason,
    attentionSource: tuiSignal?.attentionSource ?? processSignal.attentionSource,
    attentionConfidence: tuiSignal?.attentionConfidence ?? processSignal.attentionConfidence,
  };
}

function inferFromPtyActivity(activity) {
  const { signals } = activity;
  const isAnimationLikeOutput = isPtyActivelyRepainting(activity);

  if (isAnimationLikeOutput) {
    return {
      state: AgentState.WORKING,
      reason: "PTY is actively repainting terminal frames; TaskDeck infers the agent may be active.",
      source: AgentStateSource.PROCESS,
      confidence: AgentStateConfidence.MEDIUM,
      attentionState: AttentionState.NONE,
      attentionReason: "PTY is actively repainting.",
      attentionSource: AgentStateSource.PROCESS,
      attentionConfidence: AgentStateConfidence.MEDIUM,
    };
  }

  if (signals.hasVisibleTextAfterStrip) {
    return {
      state: AgentState.WORKING,
      reason: "PTY emitted visible output; TaskDeck infers the agent may be active.",
      source: AgentStateSource.PROCESS,
      confidence: AgentStateConfidence.MEDIUM,
      attentionState: AttentionState.NONE,
      attentionReason: "PTY emitted visible output.",
      attentionSource: AgentStateSource.PROCESS,
      attentionConfidence: AgentStateConfidence.MEDIUM,
    };
  }

  return {
    state: AgentState.WORKING,
    reason: "PTY emitted terminal output; TaskDeck infers the agent may be active.",
    source: AgentStateSource.PROCESS,
    confidence: AgentStateConfidence.LOW,
    attentionState: AttentionState.NONE,
    attentionReason: "PTY emitted terminal output.",
    attentionSource: AgentStateSource.PROCESS,
    attentionConfidence: AgentStateConfidence.LOW,
  };
}

function isPtyActivelyRepainting(activity, now = Date.now()) {
  const { signals } = activity;
  const recentAnsiFrames = activity.recentAnsiFrames.filter((timestamp) => now - timestamp <= ptyActivityWindowMs).length;
  const recentCarriageReturns = activity.recentCarriageReturns.filter((timestamp) => now - timestamp <= ptyActivityWindowMs).length;
  const recentRepaintFrames = recentAnsiFrames + recentCarriageReturns;
  const lastOutputIsCurrent = !activity.lastOutputAt || now - activity.lastOutputAt <= 250;
  return (
    recentRepaintFrames >= 3 ||
    (lastOutputIsCurrent && signals.containsCarriageReturn && !signals.hasVisibleTextAfterStrip) ||
    (lastOutputIsCurrent && signals.containsCursorMovementOrLineClear && !signals.hasVisibleTextAfterStrip)
  );
}

function inferFromExplicitTuiPrompts({ recentOutput, latestOutput, activity, activePty, agentKind }) {
  const rawText = String(recentOutput);
  const text = stripTerminalControlSequences(String(recentOutput));
  const latestText = stripTerminalControlSequences(String(latestOutput));
  const normalizedRaw = rawText.toLowerCase();
  const normalized = text.toLowerCase();
  const lastLine = lastMeaningfulLine(latestText).toLowerCase();
  const promptWindow = lastMeaningfulLines(latestText, 8).join("\n").toLowerCase();

  if (!normalized.trim()) {
    return null;
  }

  if (/(you approved|approved .* to run|✔ .*approved)/.test(normalized)) {
    resetPendingInputPrompt(activePty);
    return {
      state: AgentState.WORKING,
      reason: "TUI output indicates an approval was accepted.",
      source: AgentStateSource.TUI_FALLBACK,
      confidence: AgentStateConfidence.MEDIUM,
      attentionState: AttentionState.NONE,
      attentionReason: "Approval appears to have been accepted.",
      attentionSource: AgentStateSource.TUI_FALLBACK,
      attentionConfidence: AgentStateConfidence.MEDIUM,
    };
  }

  if (isApprovalPrompt(normalized, normalizedRaw)) {
    resetPendingInputPrompt(activePty);
    return {
      state: AgentState.WAITING_APPROVAL,
      reason: "TUI output appears to be requesting approval.",
      source: AgentStateSource.TUI_FALLBACK,
      confidence: AgentStateConfidence.MEDIUM,
      attentionState: AttentionState.NEEDS_APPROVAL,
      attentionReason: "Approval prompt detected.",
      attentionSource: AgentStateSource.TUI_FALLBACK,
      attentionConfidence: AgentStateConfidence.MEDIUM,
    };
  }

  const hasInputLikePrompt =
    isInteractivePrompt(lastLine) ||
    /(waiting for input|press enter|enter your|select an? |choose an? |type .*:|\?\s*$)/.test(promptWindow);

  if (hasInputLikePrompt) {
    const inputPromptSignal = updatePendingInputPrompt(activePty, {
      agentKind,
      textFingerprint: fingerprintInputPrompt(lastLine || normalized),
    });

    if (!isPtyActivelyRepainting(activity) && inputPromptSignal.isStable) {
      return {
        state: AgentState.WAITING_INPUT,
        reason: "Input prompt persisted and terminal is quiet.",
        source: AgentStateSource.TUI_FALLBACK,
        confidence: AgentStateConfidence.MEDIUM,
        attentionState: AttentionState.NEEDS_INPUT,
        attentionReason: "Stable input prompt detected.",
        attentionSource: AgentStateSource.TUI_FALLBACK,
        attentionConfidence: AgentStateConfidence.MEDIUM,
      };
    }

    return {
      attentionState: AttentionState.MAY_NEED_USER,
      attentionReason: "Input-like prompt is visible but not yet stable.",
      attentionSource: AgentStateSource.TUI_FALLBACK,
      attentionConfidence: AgentStateConfidence.LOW,
    };
  }

  if (/(ready for review|review ready|please review|changes are ready|diff is ready|summary of changes|task complete|completed successfully)/.test(normalized)) {
    resetPendingInputPrompt(activePty);
    return {
      state: AgentState.REVIEW_READY,
      reason: "TUI output indicates the work may be ready for review.",
      source: AgentStateSource.TUI_FALLBACK,
      confidence: AgentStateConfidence.MEDIUM,
      attentionState: AttentionState.REVIEW_READY,
      attentionReason: "Review-ready output detected.",
      attentionSource: AgentStateSource.TUI_FALLBACK,
      attentionConfidence: AgentStateConfidence.MEDIUM,
    };
  }

  resetPendingInputPrompt(activePty);
  return null;
}

function updatePendingInputPrompt(activePty, { agentKind, textFingerprint }) {
  const now = Date.now();
  const currentPrompt = activePty?.pendingInputPrompt;
  const isSamePrompt =
    currentPrompt &&
    currentPrompt.agentKind === agentKind &&
    currentPrompt.textFingerprint === textFingerprint;

  if (!activePty) {
    return { isStable: false };
  }

  if (!isSamePrompt) {
    activePty.pendingInputPrompt = {
      firstSeenAt: now,
      lastSeenAt: now,
      textFingerprint,
      agentKind,
    };
    return { isStable: false };
  }

  activePty.pendingInputPrompt = {
    ...currentPrompt,
    lastSeenAt: now,
  };

  return {
    isStable: now - currentPrompt.firstSeenAt >= inputPromptStabilizationMs,
  };
}

function resetPendingInputPrompt(activePty) {
  if (activePty) {
    activePty.pendingInputPrompt = null;
  }
}

function fingerprintInputPrompt(value) {
  return String(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(-240);
}

function isApprovalPrompt(normalized, normalizedRaw) {
  return (
    /action required/.test(normalizedRaw) ||
    /(approval required|requires approval|permission requested)/.test(normalized) ||
    /(approve\?|allow\?|deny\?|confirm\?|continue\?|yes\/no|\by\/n\b)/.test(normalized) ||
    /would you like to run the following command\?/.test(normalized) ||
    /do you want to allow\b/.test(normalized) ||
    /yes,\s*proceed\s*\(y\)/.test(normalized) ||
    /press enter to confirm or esc to cancel/.test(normalized)
  );
}

function stripTerminalControlSequences(value) {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "\n");
}

function extractCodexSessionIdFromOutput(data) {
  const text = stripTerminalControlSequences(String(data));
  const patterns = [
    /\b(?:codex\s+)?session(?:\s+id)?\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9_.:-]{5,})/i,
    /\bconversation(?:\s+id)?\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9_.:-]{5,})/i,
    /\bresume\s+([A-Za-z0-9][A-Za-z0-9_.:-]{5,})\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const sessionId = normalizeDetectedSessionId(match?.[1]);
    if (sessionId) {
      return sessionId;
    }
  }

  return "";
}

function extractCodexResumeId(command) {
  const match = String(command).match(/\bcodex\b[\s\S]*?\bresume\s+([^\s"';&|()]+)/i);
  return normalizeDetectedSessionId(match?.[1]);
}

function buildCodexSessionResumeCommand(task, sessionId, options = {}) {
  const command = String(task.command || "");
  const codexCommand = `codex ${codexPermissionArgsForTask(task)} resume ${sessionId}`;
  const dockerWorkdir = String(options.containerCwd || extractDockerExecWorkdir(command) || "/workspace").trim();
  if (task.agentProfileId === "ai-dev-container-codex" || /\bdocker\b[\s\S]*\bai-agent-sandbox-agent-1\b/.test(command)) {
    return `docker start ai-agent-sandbox-agent-1 >/dev/null && docker exec -it -w ${quoteShellToken(dockerWorkdir)} ai-agent-sandbox-agent-1 sh -lc 'TERM=xterm-256color ${codexCommand}'`;
  }
  if (/\bdocker\b[\s\S]*\bai-agent-sandbox-codex-1\b/.test(command)) {
    return `docker start ai-agent-sandbox-codex-1 >/dev/null && docker exec -it -w ${quoteShellToken(dockerWorkdir)} ai-agent-sandbox-codex-1 sh -lc 'TERM=xterm-256color ${codexCommand}'`;
  }
  return codexCommand;
}

function codexPermissionArgsForTask(task) {
  const permissionLevel = String(task.agentPermissionLevel || "").trim();
  if (permissionLevel === "workspace_write") {
    return "--sandbox workspace-write";
  }
  if (permissionLevel === "read_only") {
    return "--sandbox read-only";
  }
  if (permissionLevel === "full_access") {
    return "--dangerously-bypass-approvals-and-sandbox";
  }

  const command = String(task.command || task.agentSessionResumeCommand || task.resumeCommand || "");
  const explicitSandbox = command.match(/\bcodex\b[\s\S]*?(--sandbox\s+(?:read-only|workspace-write|danger-full-access))/i);
  if (explicitSandbox) {
    return explicitSandbox[1];
  }
  if (/\bcodex\b[\s\S]*?--dangerously-bypass-approvals-and-sandbox\b/i.test(command)) {
    return "--dangerously-bypass-approvals-and-sandbox";
  }
  return "--dangerously-bypass-approvals-and-sandbox";
}

function withDetectedResumeCommand(task, agentSessionResumeCommand) {
  if (!agentSessionResumeCommand || !canReplaceResumeCommand(task.resumeCommand)) {
    return task;
  }
  return {
    ...task,
    resumeCommand: agentSessionResumeCommand,
  };
}

function canReplaceResumeCommand(resumeCommand) {
  const command = String(resumeCommand || "").trim();
  return !command || /\bcodex\b[\s\S]*?\bresume\s+--last\b/i.test(command);
}

function normalizeDetectedSessionId(value) {
  const sessionId = String(value || "").trim().replace(/[),.;\]]+$/, "");
  if (!sessionId || sessionId.startsWith("-") || sessionId.toLowerCase() === "last") {
    return "";
  }
  return sessionId;
}

function isCodexLikeTask(task) {
  const haystack = `${task.agentProfileId || ""} ${task.agentLabel || ""} ${task.command || ""}`.toLowerCase();
  return /\bcodex\b/.test(haystack);
}

function isGooseLikeTask(task) {
  const haystack = `${task.agentProfileId || ""} ${task.agentLabel || ""} ${task.command || ""}`.toLowerCase();
  return /\bgoose\b/.test(haystack);
}

function lastMeaningfulLine(value) {
  return lastMeaningfulLines(value, 1).at(-1) ?? "";
}

function lastMeaningfulLines(value, limit) {
  return value
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-limit);
}

function isInteractivePrompt(line) {
  return (
    /^gpt-[\w.-]+\s+default\s+[·•-]\s+\S+/.test(line) ||
    /^>\s*$/.test(line) ||
    /^[^\s]+@[^^]+:[^$#]+[$#]\s*$/.test(line)
  );
}

function setTask(task) {
  tasks.set(task.id, task);
  persistTasks();
}

function listTasks() {
  return Array.from(tasks.values()).map(serializeTaskForClient).reverse();
}

function serializeTaskForClient(task) {
  if (!task) {
    return null;
  }
  const serializedTask = serializeTask(task);
  return {
    ...serializedTask,
    sessionLabel: taskSessionLabel(task),
  };
}

async function listSavedCodexSessions() {
  const sessionsByKey = new Map();

  for (const task of tasks.values()) {
    const session = await savedCodexSessionFromTask(task);
    if (!session) {
      continue;
    }
    const current = sessionsByKey.get(session.key);
    if (!current || timestampForSort(session.updatedAt) > timestampForSort(current.updatedAt)) {
      sessionsByKey.set(session.key, session);
    }
  }

  for (const session of await listCodexStorageSessions()) {
    const current = sessionsByKey.get(session.key);
    if (!current || timestampForSort(session.updatedAt) > timestampForSort(current.updatedAt)) {
      sessionsByKey.set(session.key, session);
    }
  }

  return Array.from(sessionsByKey.values()).sort((left, right) => timestampForSort(right.updatedAt) - timestampForSort(left.updatedAt));
}

async function listCodexStorageSessions() {
  const profiles = (await loadAgentProfiles()).filter((profile) =>
    isCodexLikeTask({ agentProfileId: profile.id, agentLabel: profile.label, command: profile.command }) && profile.diagnosticContainer,
  );
  const sessions = [];

  for (const profile of profiles) {
    sessions.push(...(await listCodexStorageSessionsForProfile(profile)));
  }

  return sessions;
}

async function listCodexStorageSessionsForProfile(profile) {
  const containerName = String(profile.diagnosticContainer || "").trim();
  if (!isSafeContainerName(containerName)) {
    return [];
  }

  try {
    const [storageOutput, mounts] = await Promise.all([
      readCodexStorageSessionMetadata(containerName),
      inspectContainerMounts(containerName),
    ]);
    const sessions = [];
    for (const line of storageOutput.split("\n")) {
      const session = codexStorageSessionFromLine(line, profile, mounts);
      if (session) {
        sessions.push(session);
      }
    }
    return sessions;
  } catch (_error) {
    return [];
  }
}

async function readCodexStorageSessionMetadata(containerName) {
  const script =
    "find /home/dev/.codex/sessions -maxdepth 6 -type f -name '*.jsonl' 2>/dev/null | sort | " +
    "while IFS= read -r file; do " +
    "first_line=$(sed -n '1p' \"$file\"); " +
    "user_line=$(grep -m 1 '\"type\":\"user_message\"' \"$file\" || true); " +
    "printf '%s\\t%s\\t%s\\n' \"$file\" \"$first_line\" \"$user_line\"; " +
    "done";
  const { stdout } = await execFileAsync("docker", ["exec", containerName, "sh", "-lc", script], {
    maxBuffer: 5 * 1024 * 1024,
    timeout: 5000,
  });
  return stdout;
}

async function inspectContainerMounts(containerName) {
  const { stdout } = await execFileAsync("docker", ["inspect", containerName, "--format", "{{json .Mounts}}"], {
    maxBuffer: 1024 * 1024,
    timeout: 3000,
  });
  return JSON.parse(stdout);
}

function codexStorageSessionFromLine(line, profile, mounts) {
  const separatorIndex = line.indexOf("\t");
  if (separatorIndex === -1) {
    return null;
  }

  const filePath = line.slice(0, separatorIndex);
  const remainder = line.slice(separatorIndex + 1);
  const secondSeparatorIndex = remainder.indexOf("\t");
  const jsonText = secondSeparatorIndex === -1 ? remainder : remainder.slice(0, secondSeparatorIndex);
  const userJsonText = secondSeparatorIndex === -1 ? "" : remainder.slice(secondSeparatorIndex + 1);
  let event;
  try {
    event = JSON.parse(jsonText);
  } catch (_error) {
    return null;
  }

  if (event?.type !== "session_meta") {
    return null;
  }

  const sessionId = normalizeDetectedSessionId(event?.payload?.id);
  if (!sessionId || isLikelySyntheticSession({ agentSessionSource: "codex storage" }, sessionId)) {
    return null;
  }

  const provider = "codex";
  const agentProfileId = String(profile.id || "codex");
  const agentLabel = String(profile.label || "Codex CLI");
  const commandEnvironment = codexCommandEnvironment({ command: profile.command, agentProfileId });
  const detectedAt = String(event?.payload?.timestamp || timestampFromCodexSessionPath(filePath) || "");
  const containerCwd = String(event?.payload?.cwd || "/workspace");
  const resumeCommand = buildCodexSessionResumeCommand(
    { command: profile.command, agentProfileId },
    sessionId,
    { containerCwd },
  );
  const cwd = mapContainerPathToHostPath(containerCwd, mounts) || repoRoot;
  const key = `${provider}:${agentProfileId}:${commandEnvironment}:${sessionId}`;
  const title = sessionLabelForKey(key) || titleFromCodexStorageUserEvent(userJsonText) || "Codex storage session";

  return {
    key,
    provider,
    sessionId,
    source: "codex storage",
    resumeCommand,
    title,
    cwd,
    agentProfileId,
    agentLabel,
    commandEnvironment,
    detectedAt,
    updatedAt: detectedAt,
  };
}

function titleFromCodexStorageUserEvent(userJsonText) {
  if (!userJsonText) {
    return "";
  }
  try {
    const event = JSON.parse(userJsonText);
    const message = String(event?.payload?.message || "").trim().replace(/^›\s*/, "");
    return message.length > 72 ? `${message.slice(0, 69)}...` : message;
  } catch (_error) {
    return "";
  }
}

function timestampFromCodexSessionPath(filePath) {
  const match = String(filePath).match(/rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!match) {
    return "";
  }
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
}

function mapContainerPathToHostPath(containerPath, mounts) {
  const normalizedContainerPath = path.posix.normalize(String(containerPath || ""));
  const matchingMounts = Array.isArray(mounts)
    ? mounts
        .filter((mount) => mount?.Type === "bind" && mount?.Source && mount?.Destination)
        .sort((left, right) => String(right.Destination).length - String(left.Destination).length)
    : [];

  for (const mount of matchingMounts) {
    const destination = path.posix.normalize(String(mount.Destination));
    if (normalizedContainerPath !== destination && !normalizedContainerPath.startsWith(`${destination}/`)) {
      continue;
    }
    const relativePath = normalizedContainerPath.slice(destination.length).replace(/^\/+/, "");
    return path.join(String(mount.Source), relativePath);
  }

  return "";
}

async function mapKnownContainerPathToHostPath(containerPath) {
  const normalizedContainerPath = path.posix.normalize(String(containerPath || ""));
  if (!normalizedContainerPath || normalizedContainerPath === ".") {
    return "";
  }

  const projectRoots = await resolveProjectRoots();
  for (const projectRoot of projectRoots) {
    const containerProjectRoot = serverAccessibleProjectRootForHostRoot(projectRoot).split(path.sep).join(path.posix.sep);
    const normalizedContainerProjectRoot = path.posix.normalize(containerProjectRoot);
    if (
      normalizedContainerPath !== normalizedContainerProjectRoot &&
      !normalizedContainerPath.startsWith(`${normalizedContainerProjectRoot}/`)
    ) {
      continue;
    }
    const relativePath = normalizedContainerPath.slice(normalizedContainerProjectRoot.length).replace(/^\/+/, "");
    return path.join(projectRoot, relativePath);
  }

  return "";
}

async function hostCwdForSavedSessionTask(task) {
  const cwd = String(task.cwd || "").trim();
  if (!cwd) {
    const projectRoots = await resolveProjectRoots();
    return hostProjectPathForRepoRoot(projectRoots[0] || repoRoot);
  }

  const mappedCwd = await mapKnownContainerPathToHostPath(cwd);
  return mappedCwd || cwd;
}

async function savedCodexSessionFromTask(task) {
  if (task.agentSessionProvider !== "codex" || !String(task.agentSessionId || "").trim()) {
    return null;
  }

  const resumeCommand = savedCodexResumeCommandForTask(task);
  if (!resumeCommand) {
    return null;
  }

  const provider = String(task.agentSessionProvider).trim();
  const sessionId = String(task.agentSessionId).trim();
  if (isLikelySyntheticSession(task, sessionId)) {
    return null;
  }

  const agentProfileId = String(task.agentProfileId || "codex");
  const agentLabel = String(task.agentLabel || "Codex CLI");
  const commandEnvironment = codexCommandEnvironment(task);
  const key = `${provider}:${agentProfileId}:${commandEnvironment}:${sessionId}`;
  return {
    key,
    provider,
    sessionId,
    source: String(task.agentSessionSource || ""),
    resumeCommand,
    title: sessionLabelForKey(key) || normalizeSavedSessionTitle(task.title),
    cwd: await hostCwdForSavedSessionTask(task),
    agentProfileId,
    agentLabel,
    commandEnvironment,
    detectedAt: String(task.agentSessionDetectedAt || ""),
    updatedAt: String(task.updatedAt || task.agentSessionDetectedAt || task.createdAt || ""),
  };
}

function savedCodexResumeCommandForTask(task) {
  const resumeCommand = String(task.agentSessionResumeCommand || task.resumeCommand || "").trim();
  if (!resumeCommand) {
    return "";
  }

  const resumeWorkdir = extractDockerExecWorkdir(resumeCommand);
  const taskWorkdir = extractDockerExecWorkdir(task.command);
  if (resumeWorkdir === "/workspace" && taskWorkdir && taskWorkdir !== resumeWorkdir) {
    return replaceDockerExecWorkdir(resumeCommand, taskWorkdir);
  }

  return resumeCommand;
}

function isLikelySyntheticSession(task, sessionId) {
  const source = String(task.agentSessionSource || "");
  return /(?:^|[^a-z0-9])(e2e|smoke|fake|test|fixture|example|mock|manual-codex)(?:$|[^a-z0-9])/i.test(sessionId) || source === "manual session id";
}

function normalizeSavedSessionTitle(title) {
  const normalizedTitle = String(title || "").trim().replace(/^(?:Resume saved:\s*)+/i, "");
  return normalizedTitle || "Codex session";
}

function codexCommandEnvironment(task) {
  const command = String(task.command || task.agentSessionResumeCommand || task.resumeCommand || "").toLowerCase();
  const agentProfileId = String(task.agentProfileId || "").toLowerCase();

  if (agentProfileId === "ai-dev-container-codex" || /\bdocker\b[\s\S]*\bai-agent-sandbox-agent-1\b/.test(command)) {
    return "ai-agent-sandbox-agent-1";
  }

  if (/\bdocker\b[\s\S]*\bai-agent-sandbox-codex-1\b/.test(command)) {
    return "ai-agent-sandbox-codex-1";
  }

  return "local";
}

function timestampForSort(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
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
  const commandEnvironment = codexCommandEnvironment(task);
  return `${provider}:${agentProfileId}:${commandEnvironment}:${sessionId}`;
}

function sessionLabelForKey(sessionKey) {
  return String(sessionLabels.get(sessionKey)?.label || "").trim();
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
  return Array.from(activePtys.keys()).reverse();
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
  await deleteTaskLog(taskId);
  await deleteTaskAttachments(taskId);
}

async function stopTaskProcesses(taskId) {
  const task = tasks.get(taskId);
  stopActivePty(taskId);

  if (!task) {
    return;
  }

  await cleanupDockerTaskProcesses(task);
}

function stopActivePty(taskId) {
  const activePty = activePtys.get(taskId);
  if (!activePty) {
    return;
  }
  clearActivePty(taskId);
  try {
    activePty.process.kill();
  } catch (error) {
    console.error("TaskDeck could not stop PTY for " + taskId + ": " + error.message);
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
  if (socket.readyState === socket.OPEN) {
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
  return filterContainerAgentProfiles((await loadAgentProfileConfig()).profiles);
}

async function getAgentProfileConfigSummary() {
  const loadedConfig = await loadAgentProfileConfig();
  const exposedCount = filterContainerAgentProfiles(loadedConfig.profiles).length;
  return {
    source: loadedConfig.source,
    path: loadedConfig.path,
    message: `${loadedConfig.message} Exposing ${exposedCount} container-backed agent profiles.`,
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

  if (loadedSources.length === 0) {
    return {
      source: "built-in",
      path: "",
      message: `Using ${mergedProfiles.length} built-in agent profiles.`,
      profiles: mergedProfiles,
    };
  }

  return {
    source: loadedSources.map((source) => source.source).join(" + "),
    path: loadedSources.map((source) => source.path).join(", "),
    message: `Merged ${mergedProfiles.length} agent profiles from built-in defaults and ${loadedSources
      .map((source) => `${source.source} (${source.count})`)
      .join(", ")}.`,
    profiles: mergedProfiles,
  };
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

function filterContainerAgentProfiles(profiles) {
  return profiles.filter((profile) => {
    const command = String(profile.command || "");
    return Boolean(profile.diagnosticContainer) && /\bdocker\b[\s\S]*\b(exec|start)\b/.test(command);
  });
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

function writeTaskLog(taskId, data) {
  fs.writeFile(logPathForTask(taskId), data).catch((error) => {
    console.error(`TaskDeck could not write log for ${taskId}: ${error.message}`);
  });
}

function appendTaskLog(taskId, data) {
  fs.appendFile(logPathForTask(taskId), data).catch((error) => {
    console.error(`TaskDeck could not append log for ${taskId}: ${error.message}`);
  });
}

async function deleteTaskLog(taskId) {
  try {
    await fs.rm(logPathForTask(taskId), { force: true });
  } catch (error) {
    console.error(`TaskDeck could not delete log for ${taskId}: ${error.message}`);
  }
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
  if (process.env.NODE_ENV === "production") {
    app.use(express.static(webDist));
    app.get("*", (_request, response) => {
      response.sendFile(path.join(webDist, "index.html"));
    });
    return;
  }

  const { createServer } = await import("vite");
  const vite = await createServer({
    root: webRoot,
    server: {
      middlewareMode: true,
      hmr: { server },
    },
    appType: "spa",
  });

  app.use(vite.middlewares);
}
