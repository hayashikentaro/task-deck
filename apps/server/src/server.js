import express from "express";
import { execFile } from "node:child_process";
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
  createTask,
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
const logRoot = path.join(dataRoot, "logs");
const defaultConfigPath = path.join(repoRoot, "taskdeck.config.json");
const localConfigPath = path.join(repoRoot, "taskdeck.local.json");
const envConfigPath = process.env.TASKDECK_CONFIG ? path.resolve(process.env.TASKDECK_CONFIG) : "";
const defaultAgentProfiles = [
  {
    id: "codex",
    label: "Codex CLI",
    command: "codex",
    description: "High-quality cloud coding agent",
  },
  {
    id: "goose",
    label: "Goose",
    command: "goose",
    description: "Local/alternative agent option",
  },
  {
    id: "goose-container-shell",
    label: "Goose Container Shell",
    command: "docker exec -it chrome-goose-1 bash",
    description: "Enter the existing chrome-goose-1 shell; run goose manually inside the container when needed",
    diagnosticContainer: "chrome-goose-1",
    diagnosticWorkspace: "/workspace",
  },
  {
    id: "goose-container-direct",
    label: "Goose Container",
    command: "docker exec -it -w /workspace chrome-goose-1 bash -lc 'goose'",
    description: "Run Goose directly in the existing chrome-goose-1 container workspace",
    diagnosticContainer: "chrome-goose-1",
    diagnosticWorkspace: "/workspace",
  },
  {
    id: "aider",
    label: "aider",
    command: "aider",
    description: "Git-aware coding assistant",
  },
  {
    id: "shell-zsh",
    label: "zsh",
    command: "zsh",
    description: "Interactive shell fallback",
  },
  {
    id: "custom",
    label: "Custom command",
    command: "",
    description: "Run a custom PTY command",
  },
];

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const shell = process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "bash");

const clients = new Set();
const tasks = new Map();
const logs = new Map();
let presets = [];
const maxLogLength = 250_000;
const activePtys = new Map();
let persistTasksQueue = Promise.resolve();
let persistPresetsQueue = Promise.resolve();

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

app.get("/api/tasks", (_request, response) => {
  response.json({
    tasks: listTasks(),
    runningTaskId: getPrimaryRunningTaskId(),
    runningTaskIds: getRunningTaskIds(),
  });
});

app.get("/api/agent-sessions", (_request, response) => {
  response.json({
    sessions: listSavedCodexSessions(),
  });
});

app.delete("/api/tasks", async (_request, response) => {
  const runningTaskIds = getRunningTaskIds();
  const taskIdsToClear = Array.from(tasks.keys()).filter((taskId) => !activePtys.has(taskId));

  for (const taskId of taskIdsToClear) {
    await clearTask(taskId);
  }

  await persistTasks();
  broadcastTasks();

  response.json({
    ok: true,
    clearedTaskIds: taskIdsToClear,
    tasks: listTasks(),
    runningTaskId: runningTaskIds[0] ?? null,
    runningTaskIds,
  });
});

app.delete("/api/tasks/:taskId", async (request, response) => {
  const { taskId } = request.params;
  const task = tasks.get(taskId);

  if (!task) {
    response.status(404).json({ error: "Task not found." });
    return;
  }

  const activePty = activePtys.get(taskId);
  if (activePty) {
    activePtys.delete(taskId);
    try {
      activePty.process.kill();
    } catch (error) {
      console.error("TaskDeck could not stop PTY for " + taskId + ": " + error.message);
    }
  }

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

  response.json({ task: serializeTask(task) });
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
          sessionMode: String(message.sessionMode || "").trim(),
          resumeCommand: String(message.resumeCommand || "").trim(),
          agentSessionProvider: String(message.agentSessionProvider || "").trim(),
          agentSessionId: String(message.agentSessionId || "").trim(),
          agentSessionSource: String(message.agentSessionSource || "").trim(),
          agentSessionDetectedAt: String(message.agentSessionDetectedAt || "").trim(),
          agentSessionResumeCommand: String(message.agentSessionResumeCommand || "").trim(),
          initialInstruction: String(message.initialInstruction || "").trim(),
        },
        socket,
      );
      return;
    }

    if (message.type === "input") {
      const activePty = activePtys.get(message.taskId);
      if (activePty && typeof message.data === "string") {
        const task = tasks.get(message.taskId);
        if (task) {
          setTask(markTaskAgentState(task, AgentState.WORKING));
          broadcastTasks();
        }
        activePty.process.write(message.data);
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

async function startTask({
  title,
  command,
  cwd,
  agentProfileId,
  agentLabel,
  sessionMode,
  resumeCommand,
  agentSessionProvider,
  agentSessionId,
  agentSessionSource,
  agentSessionDetectedAt,
  agentSessionResumeCommand,
  initialInstruction,
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

  const task = markTaskRunning(createTask({
    title,
    command,
    cwd: resolvedCwd,
    agentProfileId,
    agentLabel,
    sessionMode,
    resumeCommand,
    initialInstruction,
    ...detectedAgentSession,
    ...explicitAgentSession,
  }));
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

    activePtys.set(task.id, { taskId: task.id, process: terminalProcess });
    setTask(markTaskAgentState(task, AgentState.THINKING));
    send(socket, { type: "started", taskId: task.id });
    broadcastTasks();

    terminalProcess.onData((data) => {
      if (!tasks.has(task.id)) {
        return;
      }
      appendLog(task.id, data);
      updateAgentSessionFromOutput(task.id, data);
      updateAgentStateFromOutput(task.id, data);
      broadcast({ type: "output", taskId: task.id, data });
    });

    if (initialInstruction) {
      setTimeout(() => {
        if (activePtys.has(task.id)) {
          terminalProcess.write(`${initialInstruction}\r`);
        }
      }, 350);
    }

    terminalProcess.onExit(({ exitCode, signal }) => {
      const currentTask = tasks.get(task.id);
      activePtys.delete(task.id);
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
  const normalizedTask = { ...task, agentState: task.agentState ?? inferAgentStateFromStatus(task) };
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

function updateAgentStateFromOutput(taskId, data) {
  const task = tasks.get(taskId);
  if (!task || task.status !== TaskStatus.RUNNING) {
    return;
  }

  const nextAgentState = inferAgentStateFromOutput(data);
  if (!nextAgentState || task.agentState === nextAgentState) {
    return;
  }

  setTask(markTaskAgentState(task, nextAgentState));
  broadcastTasks();
}

function inferAgentStateFromOutput(data) {
  const text = stripTerminalControlSequences(String(data));
  const normalized = text.toLowerCase();
  const lastLine = lastMeaningfulLine(text).toLowerCase();

  if (!normalized.trim()) {
    return null;
  }

  if (/(approval required|requires approval|approve\?|allow\?|deny\?|permission requested|confirm\?|continue\?|yes\/no|\by\/n\b)/.test(normalized)) {
    return AgentState.WAITING_APPROVAL;
  }

  if (isInteractivePrompt(lastLine) || /(waiting for input|press enter|enter your|select an? |choose an? |type .*:|\?\s*$)/.test(normalized)) {
    return AgentState.WAITING_INPUT;
  }

  if (/(ready for review|review ready|please review|changes are ready|diff is ready|summary of changes|task complete|completed successfully)/.test(normalized)) {
    return AgentState.REVIEW_READY;
  }

  if (/(thinking|reasoning|analyzing|planning|inspecting|checking|reading|searching)/.test(normalized)) {
    return AgentState.THINKING;
  }

  return AgentState.WORKING;
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
  if (task.agentProfileId === "ai-dev-container-codex" || /\bdocker\b[\s\S]*\bai-agent-sandbox-codex-1\b/.test(command)) {
    return `docker start ai-agent-sandbox-codex-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-codex-1 sh -lc 'codex resume ${sessionId}'`;
  }
  return `codex resume ${sessionId}`;
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

function lastMeaningfulLine(value) {
  return value
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? "";
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
  return Array.from(tasks.values()).map(serializeTask).reverse();
}

function listSavedCodexSessions() {
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

  return Array.from(sessionsByKey.values()).sort((left, right) => timestampForSort(right.updatedAt) - timestampForSort(left.updatedAt));
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
  return {
    key: `${provider}:${agentProfileId}:${commandEnvironment}:${sessionId}`,
    provider,
    sessionId,
    source: String(task.agentSessionSource || ""),
    resumeCommand,
    title: normalizeSavedSessionTitle(task.title),
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

  if (agentProfileId === "ai-dev-container-codex" || /\bdocker\b[\s\S]*\bai-agent-sandbox-codex-1\b/.test(command)) {
    return "ai-agent-sandbox-codex-1";
  }

  if (/\bdocker\b[\s\S]*\bchrome-goose-1\b/.test(command)) {
    return "chrome-goose-1";
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

  const [storedTasks, storedPresets] = await Promise.all([
    readJsonArray(taskStorePath, "tasks"),
    readJsonArray(presetStorePath, "presets"),
  ]);

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

async function loadAgentProfiles() {
  return ensureCustomAgentProfile((await loadAgentProfileConfig()).profiles);
}

async function getAgentProfileConfigSummary() {
  const loadedConfig = await loadAgentProfileConfig();
  return {
    source: loadedConfig.source,
    path: loadedConfig.path,
    message: loadedConfig.message,
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
    });
    seenIds.add(id);
  }

  return profiles;
}

function ensureCustomAgentProfile(profiles) {
  if (profiles.some((profile) => profile.id === "custom")) {
    return profiles;
  }

  return [
    ...profiles,
    {
      id: "custom",
      label: "Custom command",
      command: "",
      description: "Run a custom PTY command",
    },
  ];
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
