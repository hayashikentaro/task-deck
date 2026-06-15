import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const host = "127.0.0.1";
const timeoutMs = Number(process.env.TASKDECK_VERIFY_FAKE_APP_SERVER_TIMEOUT_MS || 45_000);
const requestTimeoutMs = Number(process.env.TASKDECK_VERIFY_FAKE_APP_SERVER_REQUEST_TIMEOUT_MS || 2_500);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const fakeServerPath = path.join(repoRoot, "scripts/fake-codex-app-server.js");
const serverCommand = process.execPath;
const serverArgs = ["apps/server/src/server.js"];
const output = [];
const port = await findAvailablePort();
const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskdeck-fake-app-server-"));

let phase = "starting";
let child;
let socket;
let taskId = "";
let lastTaskLog = "";
let stoppingServer = false;

try {
  child = startServer();
  await withTimeout(runSmoke(), timeoutMs);
  console.log(`Fake Codex App Server smoke verified on ${host}:${port}.`);
} catch (error) {
  process.exitCode = 1;
  console.error(error.message || String(error));
  printFailureContext();
} finally {
  await cleanup();
}

function startServer() {
  setPhase("start TaskDeck server");
  const nextChild = spawn(serverCommand, serverArgs, {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port),
      NODE_ENV: "production",
      TASKDECK_DATA_ROOT: dataRoot,
      TASKDECK_CODEX_APP_SERVER_COMMAND: `${shellQuote(process.execPath)} ${shellQuote(fakeServerPath)}`,
      TASKDECK_CODEX_APP_SERVER_DEBUG: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  nextChild.stdout.on("data", (chunk) => recordOutput(chunk));
  nextChild.stderr.on("data", (chunk) => recordOutput(chunk));
  nextChild.on("error", (error) => {
    recordOutput(`TaskDeck server process error: ${error.message}\n`);
  });

  return nextChild;
}

async function runSmoke() {
  await waitForServerProcess();
  setPhase("wait for /api/context");
  await waitForContextEndpoint();

  setPhase("open WebSocket");
  const queue = await openMessageQueue();

  setPhase("wait for initial snapshot");
  await queue.waitFor((message) => message.type === "snapshot", "initial WebSocket snapshot");

  setPhase("start fake Codex App Server task");
  taskId = await startFakeTask(queue);

  setPhase("wait for fake App Server readiness");
  await waitForLog((log) => log.includes("Codex App Server adapter is ready"), "fake App Server readiness");

  await runFakeTurn(queue, 1, "first fake smoke input");
  await runFakeTurn(queue, 2, "second fake smoke input");

  setPhase("cleanup fake task");
  await cleanupTask();
}

async function waitForServerProcess() {
  await Promise.race([
    new Promise((resolve, reject) => {
      child.once("exit", (code, signal) => {
        if (stoppingServer) {
          resolve();
          return;
        }
        reject(new Error(`TaskDeck server exited during "${phase}". code=${code ?? ""} signal=${signal ?? ""}`));
      });
      child.once("error", (error) => reject(new Error(`Could not start TaskDeck server: ${error.message}`)));
    }),
    waitForContextEndpoint(),
  ]);
}

async function runFakeTurn(queue, turnNumber, inputText) {
  setPhase(`send fake turn ${turnNumber} input`);
  queue.send({ type: "input", taskId, data: inputText });

  setPhase(`wait for fake turn ${turnNumber} log output`);
  await waitForLog(
    (log) => turnOutputIsPresent(log, turnNumber, turnNumber),
    `fake turn ${turnNumber} command and assistant output`,
  );

  setPhase(`wait for fake turn ${turnNumber} ready state`);
  await waitForTaskReady(`turn ${turnNumber}`);
}

async function startFakeTask(queue) {
  const title = `Fake Codex App Server smoke ${Date.now()}`;
  queue.send({
    type: "start",
    title,
    command: "codex app-server --listen stdio://",
    cwd: repoRoot,
    agentProfileId: "codex-app-server",
    agentLabel: "Codex App Server (experimental)",
    sessionMode: "new",
  });

  const message = await queue.waitFor((candidate) => candidate.type === "started" || candidate.type === "error", "fake task start");
  if (message.type === "error") {
    throw new Error(message.message || "TaskDeck returned an error while starting fake task.");
  }
  if (!message.taskId) {
    throw new Error("TaskDeck started message did not include a task id.");
  }
  return message.taskId;
}

async function openMessageQueue() {
  const ws = await openWebSocket();
  socket = ws;
  const messages = [];
  const waiters = [];

  ws.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      rejectWaiters(new Error(`TaskDeck WebSocket sent invalid JSON: ${error.message}`));
      return;
    }

    for (let index = 0; index < waiters.length; index += 1) {
      const waiter = waiters[index];
      if (waiter.predicate(message)) {
        waiters.splice(index, 1);
        clearTimeout(waiter.timeout);
        waiter.resolve(message);
        return;
      }
    }
    messages.push(message);
  });

  ws.on("close", () => {
    rejectWaiters(new Error(`TaskDeck WebSocket closed during "${phase}".`));
  });
  ws.on("error", (error) => {
    rejectWaiters(new Error(`TaskDeck WebSocket failed during "${phase}": ${error.message}`));
  });

  return {
    send(payload) {
      ws.send(JSON.stringify(payload));
    },
    waitFor(predicate, label) {
      const existingIndex = messages.findIndex(predicate);
      if (existingIndex !== -1) {
        const [message] = messages.splice(existingIndex, 1);
        return Promise.resolve(message);
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.reject === reject);
          if (index !== -1) {
            waiters.splice(index, 1);
          }
          reject(new Error(`Timed out waiting for ${label} during "${phase}".`));
        }, timeoutMs);
        waiters.push({ predicate, resolve, reject, timeout });
      });
    },
  };

  function rejectWaiters(error) {
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
  }
}

function openWebSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}:${port}/ws`);
    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Timed out opening TaskDeck WebSocket during "${phase}".`));
    }, requestTimeoutMs);

    ws.once("open", () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.once("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`TaskDeck WebSocket failed during "${phase}": ${error.message}`));
    });
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

async function waitForTaskReady(label) {
  let lastTask = null;
  await pollUntil(async () => {
    const payload = await requestJson("GET", `/api/tasks/${encodeURIComponent(taskId)}`);
    lastTask = payload.task || null;
    return Boolean(
      lastTask &&
        lastTask.status === "running" &&
        lastTask.agentState !== "working" &&
        (!lastTask.attentionState || lastTask.attentionState === "none"),
    );
  }, `ready state after ${label}`);

  if (!lastTask) {
    throw new Error(`Task was missing after ${label}.`);
  }
}

async function waitForLog(predicate, label) {
  await pollUntil(async () => {
    const payload = await requestJson("GET", `/api/tasks/${encodeURIComponent(taskId)}/logs`);
    lastTaskLog = String(payload.logs || "");
    return predicate(lastTaskLog);
  }, label);
}

async function pollUntil(predicate, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      if (await predicate()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }

  if (lastError) {
    throw new Error(`Timed out waiting for ${label} during "${phase}". Last error: ${lastError.message}`);
  }
  throw new Error(`Timed out waiting for ${label} during "${phase}".`);
}

async function waitForContextEndpoint() {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await requestRaw("GET", "/api/context", undefined, port);
      if (response.statusCode >= 200 && response.statusCode < 500) {
        return;
      }
      lastError = new Error(`Unexpected /api/context status ${response.statusCode}.`);
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }

  throw lastError || new Error(`TaskDeck server did not respond to /api/context during "${phase}".`);
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
        timeout: requestTimeoutMs,
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
      request.destroy(new Error(`${method} ${requestPath} timed out during "${phase}".`));
    });
    request.on("error", reject);
    if (bodyText) {
      request.write(bodyText);
    }
    request.end();
  });
}

async function cleanupTask() {
  if (!taskId) return;
  try {
    await requestJson("DELETE", `/api/tasks/${encodeURIComponent(taskId)}`);
    taskId = "";
  } catch (error) {
    recordOutput(`Could not delete fake smoke task ${taskId}: ${error.message}\n`);
  }
}

async function cleanup() {
  setPhase("cleanup");
  if (taskId) {
    await cleanupTask();
  }
  if (socket) {
    socket.close();
  }
  await stopChild();
  try {
    await fs.rm(dataRoot, { recursive: true, force: true });
  } catch (error) {
    console.error(`Could not remove temporary TaskDeck data root ${dataRoot}: ${error.message}`);
  }
}

function stopChild() {
  return new Promise((resolve) => {
    if (!child || child.killed || child.exitCode !== null) {
      resolve();
      return;
    }

    stoppingServer = true;
    const timeout = setTimeout(() => {
      if (!child.killed && child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
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

function setPhase(nextPhase) {
  phase = nextPhase;
}

function recordOutput(chunk) {
  output.push(String(chunk));
  if (output.join("").length > 20_000) {
    output.splice(0, output.length - 30);
  }
}

function printFailureContext() {
  console.error(`\nPhase: ${phase}`);
  console.error(`Port: ${port}`);
  console.error(`Data root: ${dataRoot}`);
  if (taskId) {
    console.error(`Task: ${taskId}`);
  }

  const capturedOutput = output.join("").trim();
  if (capturedOutput) {
    console.error("\nCaptured server output:\n");
    console.error(capturedOutput);
  }

  const strippedLog = stripAnsi(lastTaskLog).trim();
  if (strippedLog) {
    console.error("\nLast task log:\n");
    console.error(strippedLog.slice(-6000));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, milliseconds) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Fake Codex App Server smoke timed out after ${milliseconds}ms during "${phase}".`));
    }, milliseconds);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
