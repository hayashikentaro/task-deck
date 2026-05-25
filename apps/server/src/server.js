import express from "express";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import pty from "node-pty";
import {
  createTask,
  markTaskExited,
  markTaskRunning,
  serializeTask,
} from "@taskdeck/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const webRoot = path.join(repoRoot, "apps/web/src");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const shell = process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "bash");

let activeTask = null;
let activePty = null;
const clients = new Set();
const outputBuffer = [];
const maxBufferedChunks = 500;

app.use(express.static(webRoot));

app.get("/api/task", (_request, response) => {
  response.json({
    task: activeTask ? serializeTask(activeTask) : null,
    hasPty: Boolean(activePty),
  });
});

wss.on("connection", (socket) => {
  clients.add(socket);
  send(socket, {
    type: "snapshot",
    task: activeTask ? serializeTask(activeTask) : null,
    output: outputBuffer.join(""),
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
      startTask(String(message.command || "").trim(), socket);
      return;
    }

    if (message.type === "input") {
      if (activePty && typeof message.data === "string") {
        activePty.write(message.data);
      }
      return;
    }

    if (message.type === "resize") {
      if (activePty) {
        activePty.resize(Number(message.cols) || 100, Number(message.rows) || 28);
      }
      return;
    }

    if (message.type === "interrupt") {
      if (activePty) {
        activePty.write("\x03");
      }
      return;
    }

    send(socket, { type: "error", message: `Unsupported message type: ${message.type}` });
  });

  socket.on("close", () => {
    clients.delete(socket);
  });
});

server.on("error", (error) => {
  console.error(`TaskDeck failed to listen on ${host}:${port}`);
  console.error(error);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`TaskDeck listening on http://${host}:${port}`);
});

function startTask(command, socket) {
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

  outputBuffer.length = 0;
  activeTask = markTaskRunning(createTask({ command }));
  broadcast({ type: "task", task: serializeTask(activeTask) });

  try {
    activePty = pty.spawn(shell, ["-lc", command], {
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
    activeTask = markTaskExited(activeTask, { exitCode: 1, signal: null });
    broadcast({ type: "output", data: `\r\n[TaskDeck] Failed to start PTY: ${error.message}\r\n` });
    broadcast({ type: "task", task: serializeTask(activeTask) });
    return;
  }

  activePty.onData((data) => {
    outputBuffer.push(data);
    if (outputBuffer.length > maxBufferedChunks) {
      outputBuffer.shift();
    }
    broadcast({ type: "output", data });
  });

  activePty.onExit(({ exitCode, signal }) => {
    activeTask = markTaskExited(activeTask, { exitCode, signal });
    activePty = null;
    broadcast({ type: "task", task: serializeTask(activeTask) });
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
