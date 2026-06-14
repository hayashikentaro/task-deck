#!/usr/bin/env node
import readline from "node:readline";

let turnCount = 0;
const threadId = "fake-taskdeck-thread";

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

input.on("line", (line) => {
  const trimmedLine = line.trim();
  if (!trimmedLine) {
    return;
  }

  let message;
  try {
    message = JSON.parse(trimmedLine);
  } catch (error) {
    respond(null, undefined, {
      code: -32700,
      message: `Parse error: ${error.message}`,
    });
    return;
  }

  handleMessage(message);
});

function handleMessage(message) {
  const id = message.id;
  const method = String(message.method || "");

  if (method === "initialize") {
    respond(id, {
      serverInfo: {
        name: "fake-codex-app-server",
        version: "0.1.0",
      },
      protocolVersion: 1,
    });
    return;
  }

  if (method === "account/read") {
    respond(id, {
      requiresOpenaiAuth: false,
      account: {
        id: "fake-account",
        email: "fake-codex-app-server@example.invalid",
      },
    });
    return;
  }

  if (method === "thread/start") {
    respond(id, {
      thread: {
        id: threadId,
      },
    });
    return;
  }

  if (method === "turn/start") {
    turnCount += 1;
    const turnId = `fake-taskdeck-turn-${turnCount}`;
    respond(id, {
      turn: {
        id: turnId,
      },
    });
    emitFakeTurn(turnId);
    return;
  }

  respond(id, undefined, {
    code: -32601,
    message: `Unsupported fake Codex App Server method: ${method}`,
  });
}

function emitFakeTurn(turnId) {
  const commandItemId = `${turnId}-command`;
  const messageItemId = `${turnId}-assistant`;
  const commandOutput = `FAKE_COMMAND_OUTPUT turn=${turnCount}: deterministic shell-style output only.\n`;
  const assistantText = `FAKE_ASSISTANT_TEXT turn=${turnCount}: deterministic assistant response only.`;

  setTimeout(() => {
    notify("turn/started", {
      threadId,
      turn: {
        id: turnId,
      },
    });
    notify("item/started", {
      item: {
        id: commandItemId,
        type: "commandExecution",
        command: `printf '${commandOutput.replace(/\n$/, "\\n")}'`,
      },
    });
    notify("item/completed", {
      item: {
        id: commandItemId,
        type: "commandExecution",
        aggregatedOutput: commandOutput,
      },
    });
    notify("item/agentMessage/delta", {
      itemId: messageItemId,
      delta: assistantText.slice(0, 30),
    });
    notify("item/agentMessage/delta", {
      itemId: messageItemId,
      delta: assistantText.slice(30),
    });
    notify("turn/completed", {
      threadId,
      turn: {
        id: turnId,
      },
    });
  }, 20);
}

function respond(id, result, error) {
  const message = {
    jsonrpc: "2.0",
    id,
  };
  if (error) {
    message.error = error;
  } else {
    message.result = result ?? {};
  }
  write(message);
}

function notify(method, params = {}) {
  write({
    jsonrpc: "2.0",
    method,
    params,
  });
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
