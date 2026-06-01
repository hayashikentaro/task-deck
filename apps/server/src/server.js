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
  createTask,
  markTaskAttentionState,
  markTaskAgentState,
  markTaskExited,
  markTaskRunning,
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
    ],
    runtimeModelSwitchCommand: "/model {model}",
  },
  {
    id: "goose",
    label: "Goose",
    command: "docker start ai-agent-sandbox-agent-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-agent-1 goose",
    description: "Run Goose inside the AI agent sandbox container",
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
const inputPromptStabilizationMs = 750;
const ptyActivityWindowMs = 3000;
const maxPtyActivityFrames = 40;
const quietAttentionMs = 5000;
const imageAttachmentMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const imageAttachmentExtensions = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);
const activePtys = new Map();
let persistTasksQueue = Promise.resolve();
let persistPresetsQueue = Promise.resolve();
let persistSessionLabelsQueue = Promise.resolve();

app.use(express.json());

app.get("/api/context", async (_request, response) => {
  response.json({
    repoRoot,
    defaultCwd: repoRoot,
    serverCwd: process.cwd(),
    shell,
    pathSeparator: path.sep,
    isGitRepo: await cwdIsGitRepo(repoRoot),
    cwdSuggestions: await buildCwdSuggestions(),
    agentProfiles: await loadAgentProfiles(),
    agentProfileConfig: await getAgentProfileConfigSummary(),
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
    response.status(500).json({ error: error.message });
  }
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

app.delete("/api/tasks", async (_request, response) => {
  const taskIdsToClear = Array.from(tasks.keys());

  for (const taskId of taskIdsToClear) {
    stopActivePty(taskId);
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

  stopActivePty(taskId);

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

    if (message.type === "apply_model") {
      applyRuntimeModelSwitch(message, socket);
      return;
    }

    if (message.type === "input") {
      const activePty = activePtys.get(message.taskId);
      if (activePty && typeof message.data === "string") {
        logInputDebug(message.taskId, message.data, message.source || "client");
        updateAgentStateFromTaskDeckEvent(message.taskId, AgentState.WORKING, {
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
      const activePty = activePtys.get(message.taskId);
      if (activePty) {
        resetPendingInputPrompt(activePty);
        clearQueuedPtyInput(activePty);
        activePty.process.write("\x03");
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

async function startTask({
  title,
  command,
  cwd,
  agentProfileId,
  agentLabel,
  agentPermissionLevel,
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
  if (!command) {
    send(socket, { type: "error", message: "Enter a command before starting a task." });
    return;
  }

  const resolvedCwd = await resolveCwd(cwd, socket);
  if (!resolvedCwd) {
    return;
  }

  const detectedAgentSession = detectInitialAgentSession(command, agentProfileId, agentLabel);
  const explicitAgentSession = normalizeExplicitAgentSession({
    agentSessionProvider,
    agentSessionId,
    agentSessionSource,
    agentSessionDetectedAt,
    agentSessionResumeCommand,
  });
  const taskTitle = buildUniqueNewSessionTitle(title, sessionMode);
  const baseTask = createTask({
    title: taskTitle,
    command,
    cwd: resolvedCwd,
    agentProfileId,
    agentLabel,
    agentPermissionLevel,
    agentModel: agentModel || modelFromCommand(command),
    sessionMode,
    resumeCommand,
    initialInstruction,
    ...detectedAgentSession,
    ...explicitAgentSession,
  });
  const finalizedAttachments = await finalizePendingAttachments(attachments, baseTask.id);
  const launchInitialInstruction = appendAttachmentContext(initialInstruction, finalizedAttachments);

  const task = markTaskRunning({
    ...baseTask,
    attachments: finalizedAttachments,
  });
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
    const terminalProcess = pty.spawn(shell, ["-lc", command], {
      name: "xterm-256color",
      cols: 100,
      rows: 28,
      cwd: resolvedCwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
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

    if (launchInitialInstruction) {
      setTimeout(() => {
        const activePty = activePtys.get(task.id);
        if (activePty) {
          writeOrQueuePtyInput(activePty, formatAgentInputForPty(launchInitialInstruction), "initial-instruction");
        }
      }, 350);
    }

    terminalProcess.onExit(({ exitCode, signal }) => {
      const currentTask = tasks.get(task.id);
      clearActivePty(task.id);
      if (!currentTask) {
        return;
      }
      setTask(markTaskExited(currentTask, { exitCode, signal }));
      broadcastTasks();
    });
  } catch (error) {
    appendLog(task.id, `\r\n[TaskDeck] Failed to start PTY: ${error.message}\r\n`);
    setTask(markTaskExited(tasks.get(task.id), { exitCode: 1, signal: null }));
    broadcast({ type: "output", taskId: task.id, data: logs.get(task.id) });
    broadcastTasks();
  }
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

async function applyRuntimeModelSwitch(message, socket) {
  const taskId = String(message.taskId || "").trim();
  const model = String(message.model || "").trim();
  const task = tasks.get(taskId);
  const activePty = activePtys.get(taskId);

  if (!task || !activePty || task.status !== TaskStatus.RUNNING) {
    send(socket, { type: "error", message: "Select a running task before changing models." });
    return;
  }

  if (!model || model === "default") {
    send(socket, { type: "error", message: "Select a concrete model before applying it." });
    return;
  }

  try {
    const profile = await findAgentProfileForTask(task);
    const modelOptions = modelOptionsForTask(task, profile);
    const runtimeModelSwitchCommand = runtimeModelSwitchCommandForTask(task, profile);
    if (!runtimeModelSwitchCommand || modelOptions.length === 0) {
      send(socket, { type: "error", message: "This agent profile does not support runtime model switching." });
      return;
    }
    if (!modelOptions.some((option) => option.id === model && option.id !== "default")) {
      send(socket, { type: "error", message: "Selected model is not allowed for this agent profile." });
      return;
    }

    const runtimeCommand = buildRuntimeModelSwitchCommand(runtimeModelSwitchCommand, model);
    logInputDebug(taskId, runtimeCommand, "apply-model");
    resetPendingInputPrompt(activePty);
    writeOrQueuePtyInput(activePty, formatAgentInputForPty(runtimeCommand), "apply-model");
    setTask({
      ...task,
      agentModel: model,
      updatedAt: new Date().toISOString(),
    });
    broadcastTasks();
  } catch (error) {
    send(socket, { type: "error", message: error.message || "Unable to change model." });
  }
}

async function findAgentProfileForTask(task) {
  const profiles = await loadAgentProfiles();
  return (
    profiles.find((profile) => profile.id === task.agentProfileId) ??
    profiles.find((profile) => profile.label === task.agentLabel) ??
    null
  );
}

function buildRuntimeModelSwitchCommand(template, model) {
  const commandTemplate = String(template || "").trim();
  const modelValue = String(model || "").trim();
  const expandedCommand = commandTemplate
    .replace(/\{\{\s*model\s*\}\}/g, modelValue)
    .replace(/\{\s*model\s*\}/g, modelValue);
  return expandedCommand === commandTemplate ? `${commandTemplate} ${modelValue}`.trim() : expandedCommand;
}

const codexFallbackModelOptions = [
  { id: "default", label: "Default" },
  { id: "gpt-5.5", label: "gpt-5.5" },
  { id: "gpt-5.5-thinking", label: "gpt-5.5 Thinking" },
];

function modelOptionsForTask(task, profile) {
  const configuredOptions = normalizeModelOptions(profile?.modelOptions);
  if (configuredOptions.length > 0) {
    return configuredOptions;
  }
  return isCodexRuntimeSwitchTask(task, profile) ? codexFallbackModelOptions : [];
}

function runtimeModelSwitchCommandForTask(task, profile) {
  const configuredCommand = String(profile?.runtimeModelSwitchCommand || "").trim();
  if (configuredCommand) {
    return configuredCommand;
  }
  return isCodexRuntimeSwitchTask(task, profile) ? "/model {model}" : "";
}

function isCodexRuntimeSwitchTask(task, profile) {
  const haystack = `${profile?.id || ""} ${profile?.label || ""} ${task.agentProfileId || ""} ${task.agentLabel || ""} ${task.command}`.toLowerCase();
  return /\bcodex\b/.test(haystack);
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

  try {
    const stat = await fs.stat(resolvedCwd);
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
      isGitRepo: await cwdIsGitRepo(resolvedCwd),
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

function formatAgentInputForPty(input) {
  const text = normalizeTerminalInput(input);
  return `${bracketedPasteStart}${text}${bracketedPasteEnd}${terminalEnter}`;
}

function normalizeTerminalInput(input) {
  return String(input).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function modelFromCommand(command) {
  const match = String(command || "").match(/(?:^|\s)(?:--model|-m)\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
  return match?.[1] || match?.[2] || match?.[3] || "";
}

function appendAttachmentContext(initialInstruction, attachments) {
  if (!attachments.length) {
    return initialInstruction;
  }

  const attachmentBlock = [
    "Attached images:",
    ...attachments.map((attachment) => `- ${attachment.path}`),
  ].join("\n");
  const instruction = String(initialInstruction || "").trim();
  return instruction ? `${instruction}\n\n${attachmentBlock}` : attachmentBlock;
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

  if (task.agentState === agentState && hasSameAgentStateMetadata(task, metadata)) {
    return false;
  }

  setTask(markTaskAgentState(task, agentState, metadata));
  broadcastTasks();
  return true;
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
    if (!task || task.status !== TaskStatus.RUNNING || isStrongAttentionState(task.attentionState)) {
      continue;
    }

    const lastActivityAt = activePty.activity?.lastOutputAt || activePty.createdAt || now;
    if (now - lastActivityAt < quietAttentionMs) {
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

function buildCodexSessionResumeCommand(task, sessionId) {
  const command = String(task.command || "");
  const codexCommand = `codex ${codexPermissionArgsForTask(task)} resume ${sessionId}`;
  if (task.agentProfileId === "ai-dev-container-codex" || /\bdocker\b[\s\S]*\bai-agent-sandbox-agent-1\b/.test(command)) {
    return `docker start ai-agent-sandbox-agent-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-agent-1 sh -lc 'TERM=xterm-256color ${codexCommand}'`;
  }
  if (/\bdocker\b[\s\S]*\bai-agent-sandbox-codex-1\b/.test(command)) {
    return `docker start ai-agent-sandbox-codex-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-codex-1 sh -lc 'TERM=xterm-256color ${codexCommand}'`;
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
    const session = savedCodexSessionFromTask(task);
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
  const resumeCommand = buildCodexSessionResumeCommand({ command: profile.command, agentProfileId }, sessionId);
  const detectedAt = String(event?.payload?.timestamp || timestampFromCodexSessionPath(filePath) || "");
  const containerCwd = String(event?.payload?.cwd || "/workspace");
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

function savedCodexSessionFromTask(task) {
  if (task.agentSessionProvider !== "codex" || !String(task.agentSessionId || "").trim()) {
    return null;
  }

  const resumeCommand = String(task.agentSessionResumeCommand || task.resumeCommand || "").trim();
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
    cwd: String(task.cwd || repoRoot),
    agentProfileId,
    agentLabel,
    commandEnvironment,
    detectedAt: String(task.agentSessionDetectedAt || ""),
    updatedAt: String(task.updatedAt || task.agentSessionDetectedAt || task.createdAt || ""),
  };
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
      console.warn(`TaskDeck ignored ${configCandidate.path} because it did not contain valid agentProfiles.`);
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
    const runtimeModelSwitchCommand = String(rawProfile?.runtimeModelSwitchCommand || "").trim();

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
      ...(runtimeModelSwitchCommand ? { runtimeModelSwitchCommand } : {}),
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
