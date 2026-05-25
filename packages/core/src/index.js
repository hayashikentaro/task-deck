export const TaskStatus = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  INTERRUPTED: "interrupted",
});

const dangerousPatterns = [
  /\brm\s+-rf\b/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  />\s*\/dev\/sd[a-z]/,
];

export function createTask({ title, command, cwd }) {
  const now = new Date().toISOString();
  const normalizedCommand = command.trim();
  const normalizedTitle = title.trim() || normalizedCommand;

  return {
    id: cryptoRandomId(),
    title: normalizedTitle,
    command: normalizedCommand,
    cwd,
    status: TaskStatus.IDLE,
    risk: assessCommandRisk(normalizedCommand),
    createdAt: now,
    startedAt: null,
    updatedAt: now,
    endedAt: null,
    exitCode: null,
    signal: null,
  };
}

export function markTaskRunning(task) {
  const now = new Date().toISOString();

  return {
    ...task,
    status: TaskStatus.RUNNING,
    startedAt: now,
    updatedAt: now,
    endedAt: null,
    exitCode: null,
    signal: null,
  };
}

export function markTaskExited(task, { exitCode, signal }) {
  const now = new Date().toISOString();
  const status = exitCode === 0 ? TaskStatus.SUCCEEDED : signal ? TaskStatus.INTERRUPTED : TaskStatus.FAILED;

  return {
    ...task,
    status,
    updatedAt: now,
    endedAt: now,
    exitCode,
    signal,
  };
}

export function serializeTask(task) {
  return {
    id: task.id,
    title: task.title,
    command: task.command,
    cwd: task.cwd,
    status: task.status,
    risk: task.risk,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    updatedAt: task.updatedAt,
    endedAt: task.endedAt,
    exitCode: task.exitCode,
    signal: task.signal,
  };
}

export function assessCommandRisk(command) {
  if (!command.trim()) {
    return {
      level: "unknown",
      reasons: ["No command has been provided."],
    };
  }

  const reasons = dangerousPatterns
    .filter((pattern) => pattern.test(command))
    .map((pattern) => `Matched risk pattern ${pattern.source}.`);

  if (reasons.length > 0) {
    return {
      level: "high",
      reasons,
    };
  }

  if (/(\bgit\s+push\b|\bnpm\s+install\b|\bcurl\b|\bwget\b)/.test(command)) {
    return {
      level: "medium",
      reasons: ["Command may change remote state, dependencies, or local files."],
    };
  }

  return {
    level: "low",
    reasons: ["No high-risk command pattern detected."],
  };
}

function cryptoRandomId() {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
