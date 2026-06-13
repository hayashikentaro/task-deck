import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import process from "node:process";

const host = "127.0.0.1";
const startupTimeoutMs = Number(process.env.TASKDECK_VERIFY_STARTUP_TIMEOUT_MS || 12_000);
const serverCommand = process.execPath;
const serverArgs = ["apps/server/src/server.js"];

const port = await findAvailablePort();
const output = [];
const child = spawn(serverCommand, serverArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOST: host,
    PORT: String(port),
    NODE_ENV: process.env.NODE_ENV || "development",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let settled = false;
const timeout = setTimeout(() => {
  fail(`TaskDeck server did not become reachable within ${startupTimeoutMs}ms.`);
}, startupTimeoutMs);

child.stdout.on("data", (chunk) => recordOutput(chunk));
child.stderr.on("data", (chunk) => recordOutput(chunk));
child.on("error", (error) => fail(`Could not start TaskDeck server: ${error.message}`));
child.on("exit", (code, signal) => {
  if (settled) return;
  fail(`TaskDeck server exited before startup verification completed. code=${code ?? ""} signal=${signal ?? ""}`);
});

try {
  await waitForContextEndpoint(port);
  pass();
} catch (error) {
  fail(error.message || String(error));
}

function recordOutput(chunk) {
  output.push(String(chunk));
  if (output.join("").length > 12_000) {
    output.splice(0, output.length - 20);
  }
}

async function findAvailablePort() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = 43_000 + Math.floor(Math.random() * 10_000);
    if (await portIsAvailable(candidate)) {
      return candidate;
    }
  }
  throw new Error("Could not find an available local port for startup verification.");
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

async function waitForContextEndpoint(portNumber) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await requestContext(portNumber);
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

function requestContext(portNumber) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        host,
        port: portNumber,
        path: "/api/context",
        timeout: 1000,
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve({ statusCode: response.statusCode || 0 }));
      },
    );
    request.on("timeout", () => {
      request.destroy(new Error("Timed out waiting for /api/context."));
    });
    request.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pass() {
  settled = true;
  clearTimeout(timeout);
  stopChild();
  console.log(`TaskDeck server startup verified on ${host}:${port}.`);
}

function fail(message) {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
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
