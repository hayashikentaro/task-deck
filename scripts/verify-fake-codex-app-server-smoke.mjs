import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const host = "127.0.0.1";
const timeoutMs = Number(process.env.TASKDECK_VERIFY_FAKE_APP_SERVER_TIMEOUT_MS || 15_000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const fakeServerPath = path.join(repoRoot, "scripts/fake-codex-app-server.js");
const serverCommand = process.execPath;
const serverArgs = ["apps/server/src/server.js"];
const output = [];

const port = await findAvailablePort();
const child = spawn(serverCommand, serverArgs, {
  cwd: repoRoot,
  env: {
    ...process.env,
    HOST: host,
    PORT: String(port),
    NODE_ENV: "production",
    TASKDECK_CODEX_APP_SERVER_COMMAND: `${shellQuote(process.execPath)} ${shellQuote(fakeServerPath)}`,
    TASKDECK_CODEX_APP_SERVER_DEBUG: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let settled = false;
let taskId = "";
let socket;
const timeout = setTimeout(() => {
  fail(`Fake Codex App Server smoke did not finish within ${timeoutMs}ms.`);
}, timeoutMs);

child.stdout.on("data", (chunk) => recordOutput(chunk));
child.stderr.on("data", (chunk) => recordOutput(chunk));
child.on("error", (error) => fail(`Could not start TaskDeck server: ${error.message}`));
child.on("exit", (code, signal) => {
  if (settled) return;
  fail(`TaskDeck server exited before fake smoke completed. code=${code ?? ""} signal=${signal ?? ""}`);
});

try {
  await waitForContextEndpoint(port);
  socket = await connectWebSocket();
  taskId = await startFakeTask(socket);
  await waitForLog(taskId, (log) => log.includes("Codex App Server adapter is ready"), "fake App Server readiness");

  socket.send(JSON.stringify({ type: "input", taskId, data: "first fake smoke input" }));
  await waitForLog(taskId, (log) => turnOutputIsPresent(log, 1, 1), "fake turn 1 output");
  await assertReadyForInput(taskId, "turn 1");

  socket.send(JSON.stringify({ type: "input", taskId, data: "second fake smoke input" }));
  await waitForLog(taskId, (log) => turnOutputIsPresent(log, 2, 2), "fake turn 2 output");
  await assertReadyForInput(taskId, "turn 2");

  await cleanupTask(taskId);
  pass();
} catch (error) {
  fail(error.message || String(error));
}

function startFakeTask(openSocket) {
  return new Promise((resolve, reject) => {
    const title = `Fake Codex App Server smoke ${Date.now()}`;
    const timeoutId = setTimeout(() => reject(new Error("Timed out waiting for fake task start.")), timeoutMs);

    const handleMessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "started") {
        clearTimeout(timeoutId);
        openSocket.removeEventListener("message", handleMessage);
        resolve(message.taskId);
      }
      if (message.type === "error") {
        clearTimeout(timeoutId);
        openSocket.removeEventListener("message", handleMessage);
        reject(new Error(message.message || "TaskDeck returned an error while starting fake task."));
      }
    };

    openSocket.addEventListener("message", handleMessage);
    openSocket.send(JSON.stringify({
      type: "start",
      title,
      command: "codex app-server --listen stdio://",
      cwd: repoRoot,
      agentProfileId: "codex-app-server",
      agentLabel: "Codex App Server (experimental)",
      sessionMode: "new",
    }));
  });
}

function turnOutputIsPresent(log, turnNumber, expectedAssistantLabelCount) {
  const normalizedLog = stripAnsi(log);
  const sequence = [
    "[TaskDeck] Codex App Server command output:",
    `FAKE_COMMAND_OUTPUT turn=${turnNumber}`,
    "[Assistant]",
    `FAKE_ASSISTANT_TEXT turn=${turnNumber}`,
    "[TaskDeck] Codex App Server turn completed; ready for next input.",
  ];

  return orderedIncludes(normalizedLog, sequence)
    && countOccurrences(normalizedLog, "[Assistant]") === expectedAssistantLabelCount;
}

async function assertReadyForInput(nextTaskId, label) {
  const payload = await requestJson("GET", `/api/tasks/${encodeURIComponent(nextTaskId)}`);
  const task = payload.task;
  if (!task) {
    throw new Error(`Task was missing after ${label}.`);
  }
  if (task.status !== "running") {
    throw new Error(`Expected fake task to remain running after ${label}; status=${task.status}.`);
  }
  if (task.agentState === "working") {
    throw new Error(`Expected fake task to leave working state after ${label}.`);
  }
  if (task.attentionState && task.attentionState !== "none") {
    throw new Error(`Expected no attention after ${label}; attentionState=${task.attentionState}.`);
  }
}

async function waitForLog(nextTaskId, predicate, label) {
  const deadline = Date.now() + timeoutMs;
  let lastLog = "";

  while (Date.now() < deadline) {
    const payload = await requestJson("GET", `/api/tasks/${encodeURIComponent(nextTaskId)}/logs`);
    lastLog = String(payload.logs || "");
    if (predicate(lastLog)) {
      return lastLog;
    }
    await sleep(100);
  }

  throw new Error(`Timed out waiting for ${label}.\n\nLast log:\n${stripAnsi(lastLog).slice(-4000)}`);
}

async function cleanupTask(nextTaskId) {
  if (!nextTaskId) return;
  try {
    await requestJson("DELETE", `/api/tasks/${encodeURIComponent(nextTaskId)}`);
  } catch {
    // The process is about to exit; cleanup is best-effort.
  }
}

async function connectWebSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}:${port}/ws`);
    const timeoutId = setTimeout(() => reject(new Error("Timed out opening TaskDeck WebSocket.")), 3000);
    ws.addEventListener("open", () => {
      clearTimeout(timeoutId);
      resolve(ws);
    });
    ws.addEventListener("error", (event) => {
      clearTimeout(timeoutId);
      reject(new Error(event.message || "TaskDeck WebSocket failed."));
    });
  });
}

async function waitForContextEndpoint(portNumber) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await requestRaw("GET", "/api/context", undefined, portNumber);
      if (response.statusCode >= 200 && response.statusCode < 500) {
        return;
      }
      lastError = new Error(`Unexpected /api/context status ${response.statusCode}.`);
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }

  throw lastError || new Error("TaskDeck server did not respond to /api/context.");
}

async function requestJson(method, requestPath, body) {
  const response = await requestRaw(method, requestPath, body, port);
  const text = response.body || "{}";
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = {};
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(payload.error || `${method} ${requestPath} returned ${response.statusCode}.`);
  }
  return payload;
}

function requestRaw(method, requestPath, body, portNumber) {
  return new Promise((resolve, reject) => {
    const bodyText = body === undefined ? "" : JSON.stringify(body);
    const request = http.request(
      {
        host,
        port: portNumber,
        method,
        path: requestPath,
        timeout: 1000,
        headers: bodyText ? {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(bodyText),
        } : undefined,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("timeout", () => {
      request.destroy(new Error(`${method} ${requestPath} timed out.`));
    });
    request.on("error", reject);
    if (bodyText) {
      request.write(bodyText);
    }
    request.end();
  });
}

async function findAvailablePort() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = 43_000 + Math.floor(Math.random() * 10_000);
    if (await portIsAvailable(candidate)) {
      return candidate;
    }
  }
  throw new Error("Could not find an available local port for fake App Server verification.");
}

function portIsAvailable(candidate) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(candidate, host, () => {
      server.close(() => resolve(true));
    });
  });
}

function orderedIncludes(value, parts) {
  let position = 0;
  for (const part of parts) {
    const nextPosition = value.indexOf(part, position);
    if (nextPosition === -1) {
      return false;
    }
    position = nextPosition + part.length;
  }
  return true;
}

function countOccurrences(value, needle) {
  let count = 0;
  let position = 0;
  while (position < value.length) {
    const nextPosition = value.indexOf(needle, position);
    if (nextPosition === -1) break;
    count += 1;
    position = nextPosition + needle.length;
  }
  return count;
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function recordOutput(chunk) {
  output.push(String(chunk));
  if (output.join("").length > 12_000) {
    output.splice(0, output.length - 20);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pass() {
  settled = true;
  clearTimeout(timeout);
  socket?.close();
  stopChild();
  console.log(`Fake Codex App Server smoke verified on ${host}:${port}.`);
}

function fail(message) {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  socket?.close();
  stopChild();
  console.error(message);
  const capturedOutput = output.join("").trim();
  if (capturedOutput) {
    console.error("\nCaptured server output:\n");
    console.error(capturedOutput);
  }
  process.exitCode = 1;
}

function stopChild() {
  if (!child.killed) {
    child.kill("SIGTERM");
  }
}
