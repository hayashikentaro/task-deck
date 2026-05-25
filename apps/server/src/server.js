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
  createTask,
  markTaskExited,
  markTaskRunning,
  serializeTask,
  TaskStatus,
} from "@taskdeck/core";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const webRoot = path.join(repoRoot, "apps/web");
const webDist = path.join(webRoot, "dist");
const dataRoot = path.join(repoRoot, ".taskdeck");
const taskStorePath = path.join(dataRoot, "tasks.json");
const logRoot = path.join(dataRoot, "logs");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const shell = process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "bash");

const clients = new Set();
const tasks = new Map();
const logs = new Map();
const maxLogLength = 250_000;
let activePty = null;
let persistTasksQueue = Promise.resolve();

app.use(express.json());

app.get("/api/tasks", (_request, response) => {
  response.json({
    tasks: listTasks(),
    runningTaskId: activePty?.taskId ?? null,
  });
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
      response.json({
        taskId: request.params.taskId,
        logs: taskLog,
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
        ok: true,
        isGitRepo: false,
        diff: "",
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
    runningTaskId: activePty?.taskId ?? null,
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
        },
        socket,
      );
      return;
    }

    if (message.type === "input") {
      if (activePty && activePty.taskId === message.taskId && typeof message.data === "string") {
        activePty.process.write(message.data);
      }
      return;
    }

    if (message.type === "resize") {
      if (activePty && activePty.taskId === message.taskId) {
        activePty.process.resize(Number(message.cols) || 100, Number(message.rows) || 28);
      }
      return;
    }

    if (message.type === "interrupt") {
      if (activePty && activePty.taskId === message.taskId) {
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

async function startTask({ title, command, cwd }, socket) {
  if (!command) {
    send(socket, { type: "error", message: "Enter a command before starting a task." });
    return;
  }

  if (activePty) {
    send(socket, {
      type: "error",
      message: "A task is already running. Interrupt or wait for it to exit before starting another.",
    });
    return;
  }

  const resolvedCwd = await resolveCwd(cwd, socket);
  if (!resolvedCwd) {
    return;
  }

  const task = markTaskRunning(createTask({ title, command, cwd: resolvedCwd }));
  tasks.set(task.id, task);
  logs.set(task.id, "");
  persistTasks();
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

    activePty = { taskId: task.id, process: terminalProcess };
    broadcastTasks();

    terminalProcess.onData((data) => {
      appendLog(task.id, data);
      broadcast({ type: "output", taskId: task.id, data });
    });

    terminalProcess.onExit(({ exitCode, signal }) => {
      setTask(markTaskExited(tasks.get(task.id), { exitCode, signal }));
      activePty = null;
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
  const candidate = cwd ? path.resolve(repoRoot, cwd) : repoRoot;

  try {
    const stat = await fs.stat(candidate);
    if (!stat.isDirectory()) {
      send(socket, { type: "error", message: `cwd is not a directory: ${candidate}` });
      return null;
    }
    return candidate;
  } catch {
    send(socket, { type: "error", message: `cwd does not exist: ${candidate}` });
    return null;
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

function setTask(task) {
  tasks.set(task.id, task);
  persistTasks();
}

function listTasks() {
  return Array.from(tasks.values()).map(serializeTask).reverse();
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
    runningTaskId: activePty?.taskId ?? null,
  });
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

  let storedTasks = [];
  try {
    const rawTasks = await fs.readFile(taskStorePath, "utf8");
    storedTasks = JSON.parse(rawTasks);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`TaskDeck could not read ${taskStorePath}: ${error.message}`);
    }
  }

  if (!Array.isArray(storedTasks)) {
    console.warn(`TaskDeck ignored ${taskStorePath} because it did not contain a task array.`);
    storedTasks = [];
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
        : storedTask;

    if (task !== storedTask) {
      changed = true;
    }
    tasks.set(task.id, task);
  }

  if (changed) {
    persistTasks();
  }
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
