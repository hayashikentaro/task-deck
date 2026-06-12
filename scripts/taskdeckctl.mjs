#!/usr/bin/env node
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const defaultSocketPath = path.join(repoRoot, ".taskdeck", "run", "manager-actions.sock");
const socketPointerPath = path.join(repoRoot, ".taskdeck", "run", "manager-actions.json");

function usage() {
  return `Usage:
  taskdeckctl ack --event <eventId> [--task <taskId>] [--actor-task <taskId>] [--action-id <id>]
  taskdeckctl ack --task <taskId> [--actor-task <taskId>] [--action-id <id>]
  taskdeckctl review --task <taskId> [--actor-task <taskId>] [--action-id <id>]
  taskdeckctl close --task <taskId> [--actor-task <taskId>] [--action-id <id>]

Options:
  --socket <path>       Override the manager action Unix socket.
  --host <host>         Override the manager action TCP host.
  --port <port>         Override the manager action TCP port.
  --json                Print the full JSON result.
`;
}

function parseArgs(args) {
  const command = args.shift();
  if (!command || command === "--help" || command === "-h") {
    return { help: true };
  }
  const action = normalizeCommand(command);
  if (!["ack", "review", "close"].includes(action)) {
    throw new Error("Only ack, review, and close are supported.");
  }

  const parsed = {
    action,
    actionId: randomUUID(),
    actorTaskId: process.env.TASKDECK_MANAGER_ROLE === "manager" ? process.env.TASKDECK_TASK_ID || "" : "",
    eventId: "",
    taskId: "",
    reason: "",
    socketPath: process.env.TASKDECK_MANAGER_ACTION_SOCKET || "",
    tcpHost: process.env.TASKDECK_MANAGER_ACTION_HOST || "",
    tcpPort: Number(process.env.TASKDECK_MANAGER_ACTION_PORT || 0),
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
      case "--reason":
        parsed.reason = requiredValue(args, ++index, arg);
        break;
      case "--socket":
        parsed.socketPath = requiredValue(args, ++index, arg);
        break;
      case "--host":
        parsed.tcpHost = requiredValue(args, ++index, arg);
        break;
      case "--port":
        parsed.tcpPort = Number(requiredValue(args, ++index, arg));
        if (!Number.isInteger(parsed.tcpPort) || parsed.tcpPort <= 0) {
          throw new Error("--port requires a positive integer.");
        }
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (parsed.action === "ack" && !parsed.eventId && !parsed.taskId) {
    throw new Error("ack requires --event or --task.");
  }
  if ((parsed.action === "review" || parsed.action === "close") && !parsed.taskId) {
    throw new Error(`${parsed.action} requires --task.`);
  }

  return parsed;
}

function normalizeCommand(command) {
  switch (command) {
    case "mark-reviewed":
    case "markReviewed":
    case "mark-task-reviewed":
      return "review";
    case "archive":
    case "archive-task":
    case "close-task":
      return "close";
    default:
      return command;
  }
}

async function resolveManagerActionTransports({ explicitSocketPath, explicitTcpHost, explicitTcpPort }) {
  let pointer = null;
  try {
    pointer = JSON.parse(await fs.readFile(socketPointerPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      process.stderr.write(`Warning: could not read manager action transport pointer: ${error.message}\n`);
    }
  }

  const transports = [];
  const socketPath = explicitSocketPath || String(pointer?.socketPath || "").trim() || defaultSocketPath;
  if (socketPath) {
    transports.push({ type: "unix", path: socketPath });
  }

  const tcpTransport = Array.isArray(pointer?.transports)
    ? pointer.transports.find((transport) => transport?.type === "tcp")
    : null;
  const pointerHost = String(tcpTransport?.host || "").trim();
  const pointerContainerHost = String(tcpTransport?.containerHost || "").trim();
  const pointerPort = Number(tcpTransport?.port || 0);
  const pointerToken = String(tcpTransport?.token || "").trim();
  const tcpPort = explicitTcpPort || pointerPort;
  const tcpHosts = [...new Set([explicitTcpHost, pointerHost, pointerContainerHost].filter(Boolean))];

  if (tcpPort > 0 && pointerToken) {
    for (const host of tcpHosts) {
      transports.push({
        type: "tcp",
        host,
        port: tcpPort,
        token: pointerToken,
      });
    }
  }

  return transports;
}

function requiredValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function sendManagerAction(transport, action) {
  return new Promise((resolve, reject) => {
    const socket =
      transport.type === "tcp"
        ? net.createConnection({ host: transport.host, port: transport.port })
        : net.createConnection(transport.path);
    let response = "";

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      const payload = transport.type === "tcp" ? { token: transport.token, action } : action;
      socket.write(`${JSON.stringify(payload)}\n`);
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

async function sendManagerActionWithFallback(transports, action) {
  const errors = [];
  for (const transport of transports) {
    try {
      return await sendManagerAction(transport, action);
    } catch (error) {
      const label =
        transport.type === "tcp" ? `tcp://${transport.host}:${transport.port}` : transport.path || "Unix socket";
      errors.push(`${label}: ${error.message}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`No manager action transport succeeded. Tried ${errors.join("; ")}`);
  }
  throw new Error("No manager action transport is available.");
}

try {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(usage());
    process.exit(0);
  }

  const {
    socketPath: explicitSocketPath,
    tcpHost: explicitTcpHost,
    tcpPort: explicitTcpPort,
    json,
    ...action
  } = parsed;
  const transports = await resolveManagerActionTransports({ explicitSocketPath, explicitTcpHost, explicitTcpPort });
  const result = await sendManagerActionWithFallback(transports, {
    ...action,
    requestedAt: new Date().toISOString(),
  });

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(formatSuccess(result));
  } else {
    process.stderr.write(`${result.error || "Manager action failed."}\n`);
  }

  process.exit(result.ok ? 0 : 1);
} catch (error) {
  process.stderr.write(`${error.message}\n\n${usage()}`);
  process.exit(1);
}

function formatSuccess(result) {
  if (result.action === "ack") {
    return `Acked${result.eventId ? ` event ${result.eventId}` : ""}${result.taskId ? ` task ${result.taskId}` : ""}.\n`;
  }
  if (result.action === "review") {
    return `${result.alreadyReviewed ? "Already reviewed" : "Reviewed"} task ${result.taskId}.\n`;
  }
  if (result.action === "close") {
    return `${result.alreadyClosed ? "Already closed" : "Closed"} task ${result.taskId}.\n`;
  }
  return `${result.action || "Action"} succeeded.\n`;
}
