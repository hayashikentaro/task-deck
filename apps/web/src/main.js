const terminal = document.querySelector("#terminal");
const commandForm = document.querySelector("#commandForm");
const commandInput = document.querySelector("#commandInput");
const startButton = document.querySelector("#startButton");
const interruptButton = document.querySelector("#interruptButton");
const connectionValue = document.querySelector("#connectionValue");
const stateValue = document.querySelector("#stateValue");
const riskValue = document.querySelector("#riskValue");
const exitValue = document.querySelector("#exitValue");
const runtimeValue = document.querySelector("#runtimeValue");
const commandValue = document.querySelector("#commandValue");
const startedValue = document.querySelector("#startedValue");
const updatedValue = document.querySelector("#updatedValue");

let socket;
let task = null;
let runtimeTimer = null;

connect();

commandForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearTerminal();
  send({ type: "start", command: commandInput.value });
  terminal.focus();
});

interruptButton.addEventListener("click", () => {
  send({ type: "interrupt" });
  terminal.focus();
});

terminal.addEventListener("keydown", (event) => {
  if (event.metaKey || event.altKey) {
    return;
  }

  if (event.ctrlKey && event.key.toLowerCase() === "c") {
    event.preventDefault();
    send({ type: "input", data: "\x03" });
    return;
  }

  const data = keyToData(event);
  if (data) {
    event.preventDefault();
    send({ type: "input", data });
  }
});

window.addEventListener("resize", () => {
  send({ type: "resize", cols: 100, rows: 28 });
});

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

  socket.addEventListener("open", () => {
    connectionValue.textContent = "Connected";
    connectionValue.dataset.status = "connected";
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "snapshot") {
      task = message.task;
      terminal.textContent = message.output || "";
      renderTask();
      scrollTerminal();
      return;
    }

    if (message.type === "task") {
      task = message.task;
      renderTask();
      return;
    }

    if (message.type === "output") {
      terminal.textContent += message.data;
      scrollTerminal();
      return;
    }

    if (message.type === "error") {
      terminal.textContent += `\r\n[TaskDeck] ${message.message}\r\n`;
      scrollTerminal();
    }
  });

  socket.addEventListener("close", () => {
    connectionValue.textContent = "Disconnected. Reconnecting...";
    connectionValue.dataset.status = "disconnected";
    window.setTimeout(connect, 1000);
  });
}

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    terminal.textContent += "\r\n[TaskDeck] Server connection is not ready.\r\n";
    scrollTerminal();
    return;
  }
  socket.send(JSON.stringify(payload));
}

function renderTask() {
  if (!task) {
    stateValue.textContent = "idle";
    riskValue.textContent = "unknown";
    exitValue.textContent = "-";
    runtimeValue.textContent = "0s";
    commandValue.textContent = "No task started.";
    startedValue.textContent = "-";
    updatedValue.textContent = "-";
    startButton.disabled = false;
    stopRuntimeTimer();
    return;
  }

  stateValue.textContent = task.status;
  riskValue.textContent = task.risk.level;
  exitValue.textContent = task.exitCode === null ? "-" : String(task.exitCode);
  commandValue.textContent = task.command;
  startedValue.textContent = formatDate(task.startedAt);
  updatedValue.textContent = formatDate(task.updatedAt);
  startButton.disabled = task.status === "running";

  updateRuntime();
  if (task.status === "running") {
    startRuntimeTimer();
  } else {
    stopRuntimeTimer();
  }
}

function startRuntimeTimer() {
  if (!runtimeTimer) {
    runtimeTimer = window.setInterval(updateRuntime, 1000);
  }
}

function stopRuntimeTimer() {
  if (runtimeTimer) {
    window.clearInterval(runtimeTimer);
    runtimeTimer = null;
  }
}

function updateRuntime() {
  if (!task?.startedAt) {
    runtimeValue.textContent = "0s";
    return;
  }

  const end = task.endedAt ? new Date(task.endedAt).getTime() : Date.now();
  const start = new Date(task.startedAt).getTime();
  runtimeValue.textContent = `${Math.max(0, Math.round((end - start) / 1000))}s`;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleTimeString();
}

function clearTerminal() {
  terminal.textContent = "";
}

function scrollTerminal() {
  terminal.scrollTop = terminal.scrollHeight;
}

function keyToData(event) {
  if (event.key === "Enter") {
    return "\r";
  }
  if (event.key === "Backspace") {
    return "\x7f";
  }
  if (event.key === "Tab") {
    return "\t";
  }
  if (event.key === "ArrowUp") {
    return "\x1b[A";
  }
  if (event.key === "ArrowDown") {
    return "\x1b[B";
  }
  if (event.key === "ArrowRight") {
    return "\x1b[C";
  }
  if (event.key === "ArrowLeft") {
    return "\x1b[D";
  }
  if (event.key.length === 1 && !event.ctrlKey) {
    return event.key;
  }
  return "";
}

