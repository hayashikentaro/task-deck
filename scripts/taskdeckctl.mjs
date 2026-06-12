#!/usr/bin/env node
import net from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const defaultSocketPath = path.join(repoRoot, ".taskdeck", "run", "manager-actions.sock");

function usage() {
  return `Usage:
  taskdeckctl ack --event <eventId> [--task <taskId>] [--actor-task <taskId>] [--action-id <id>]
  taskdeckctl ack --task <taskId> [--actor-task <taskId>] [--action-id <id>]

Options:
  --socket <path>       Override the manager action Unix socket.
  --json                Print the full JSON result.
`;
}

function parseArgs(args) {
  const command = args.shift();
  if (!command || command === "--help" || command === "-h") {
    return { help: true };
  }
  if (command !== "ack") {
    throw new Error("Only ack is supported.");
  }

  const parsed = {
    action: command,
    actionId: randomUUID(),
    actorTaskId: process.env.TASKDECK_MANAGER_ROLE === "manager" ? process.env.TASKDECK_TASK_ID || "" : "",
    eventId: "",
    taskId: "",
    socketPath: process.env.TASKDECK_MANAGER_ACTION_SOCKET || defaultSocketPath,
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--event":
      case "--event-id":
        parsed.eventId = requiredValue(args, ++index, arg);
        break;
      case "--task":
      case "--task-id":
      case "--target-task":
        parsed.taskId = requiredValue(args, ++index, arg);
        break;
      case "--actor-task":
      case "--actor-task-id":
        parsed.actorTaskId = requiredValue(args, ++index, arg);
        break;
      case "--action-id":
        parsed.actionId = requiredValue(args, ++index, arg);
        break;
      case "--socket":
        parsed.socketPath = requiredValue(args, ++index, arg);
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!parsed.eventId && !parsed.taskId) {
    throw new Error("ack requires --event or --task.");
  }

  return parsed;
}

function requiredValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function sendManagerAction(socketPath, action) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let response = "";

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(action)}\n`);
    });
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.on("end", () => {
      try {
        resolve(JSON.parse(response));
      } catch {
        reject(new Error("TaskDeck server returned an invalid manager action response."));
      }
    });
    socket.on("error", (error) => {
      reject(error);
    });
  });
}

try {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(usage());
    process.exit(0);
  }

  const { socketPath, json, ...action } = parsed;
  const result = await sendManagerAction(socketPath, {
    ...action,
    requestedAt: new Date().toISOString(),
  });

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(`Acked${result.eventId ? ` event ${result.eventId}` : ""}${result.taskId ? ` task ${result.taskId}` : ""}.\n`);
  } else {
    process.stderr.write(`${result.error || "Manager action failed."}\n`);
  }

  process.exit(result.ok ? 0 : 1);
} catch (error) {
  process.stderr.write(`${error.message}\n\n${usage()}`);
  process.exit(1);
}
