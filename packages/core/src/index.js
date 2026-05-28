export const TaskStatus = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  INTERRUPTED: "interrupted",
});

export const AgentState = Object.freeze({
  STARTING: "starting",
  THINKING: "thinking",
  WORKING: "working",
  WAITING_INPUT: "waiting_input",
  WAITING_APPROVAL: "waiting_approval",
  REVIEW_READY: "review_ready",
  DONE: "done",
  FAILED: "failed",
  STOPPED: "stopped",
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
    agentState: AgentState.STARTING,
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
    agentState: task.agentState ?? AgentState.STARTING,
    startedAt: now,
    updatedAt: now,
    endedAt: null,
    exitCode: null,
    signal: null,
  };
}

export function markTaskAgentState(task, agentState) {
  return {
    ...task,
    agentState,
    updatedAt: new Date().toISOString(),
  };
}

export function markTaskExited(task, { exitCode, signal }) {
  const now = new Date().toISOString();
  const status = exitCode === 0 ? TaskStatus.SUCCEEDED : signal ? TaskStatus.INTERRUPTED : TaskStatus.FAILED;
  const agentState = exitCode === 0 ? AgentState.DONE : signal ? AgentState.STOPPED : AgentState.FAILED;

  return {
    ...task,
    status,
    agentState,
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
    agentState: task.agentState ?? inferAgentStateFromStatus(task),
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

export function inferAgentStateFromStatus(task) {
  if (task.status === TaskStatus.RUNNING) return AgentState.WORKING;
  if (task.status === TaskStatus.SUCCEEDED) return AgentState.DONE;
  if (task.status === TaskStatus.INTERRUPTED) return AgentState.STOPPED;
  if (task.status === TaskStatus.FAILED) return AgentState.FAILED;
  return AgentState.STARTING;
}

function cryptoRandomId() {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
