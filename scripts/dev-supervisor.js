import { spawn } from "node:child_process";
import process from "node:process";

const restartExitCode = 42;
const restartDelayMs = 500;
const serverCommand = process.execPath;
const serverArgs = ["apps/server/src/server.js"];

let child = null;
let isShuttingDown = false;
let restartTimer = null;

function startServer() {
  if (child) {
    return;
  }

  child = spawn(serverCommand, serverArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    child = null;

    if (isShuttingDown) {
      process.exit(code ?? signalToExitCode(signal));
      return;
    }

    if (code === restartExitCode) {
      console.log(`TaskDeck server exited with ${restartExitCode}; restarting...`);
      restartTimer = setTimeout(() => {
        restartTimer = null;
        startServer();
      }, restartDelayMs);
      return;
    }

    if (signal) {
      console.log(`TaskDeck server exited from signal ${signal}.`);
      process.exit(signalToExitCode(signal));
      return;
    }

    process.exit(code ?? 0);
  });
}

function forwardSignal(signal) {
  isShuttingDown = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (child) {
    child.kill(signal);
    return;
  }
  process.exit(signalToExitCode(signal));
}

function signalToExitCode(signal) {
  if (signal === "SIGINT") {
    return 130;
  }
  if (signal === "SIGTERM") {
    return 143;
  }
  return 1;
}

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

startServer();
