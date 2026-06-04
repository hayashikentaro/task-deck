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

export const AgentStateSource = Object.freeze({
  TASKDECK_EVENT: "taskdeck_event",
  TUI_FALLBACK: "tui_fallback",
  PROCESS: "process",
  MANUAL: "manual",
});

export const AgentStateConfidence = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

export const AttentionState = Object.freeze({
  NONE: "none",
  MAY_NEED_USER: "may_need_user",
  NEEDS_INPUT: "needs_input",
  NEEDS_APPROVAL: "needs_approval",
  REVIEW_READY: "review_ready",
  FAILED: "failed",
});

export const TASK_IDENTITY_COLOR_SLOT_COUNT = 24;

const dangerousPatterns = [
  /\brm\s+-rf\b/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  />\s*\/dev\/sd[a-z]/,
];

export function createTask({
  title,
  command,
  cwd,
  agentProfileId = "",
  agentLabel = "",
  agentPermissionLevel = "",
  agentModel = "",
  sessionMode = "",
  resumeCommand = "",
  initialInstruction = "",
  agentSessionId = "",
  agentSessionSource = "",
  agentSessionProvider = "",
  agentSessionDetectedAt = "",
  agentSessionResumeCommand = "",
  identityColorSlot,
  attachments = [],
}) {
  const now = new Date().toISOString();
  const normalizedCommand = command.trim();
  const normalizedTitle = title.trim() || normalizedCommand;

  return {
    id: cryptoRandomId(),
    title: normalizedTitle,
    command: normalizedCommand,
    cwd,
    agentProfileId,
    agentLabel,
    agentPermissionLevel,
    agentModel,
    sessionMode,
    resumeCommand,
    agentSessionId,
    agentSessionSource,
    agentSessionProvider,
    agentSessionDetectedAt,
    agentSessionResumeCommand,
    identityColorSlot: normalizeIdentityColorSlot(identityColorSlot),
    status: TaskStatus.IDLE,
    agentState: AgentState.STARTING,
    agentStateReason: "Task created.",
    agentStateSource: AgentStateSource.TASKDECK_EVENT,
    agentStateConfidence: AgentStateConfidence.HIGH,
    attentionState: AttentionState.NONE,
    attentionStateReason: "No user attention needed yet.",
    attentionStateSource: AgentStateSource.TASKDECK_EVENT,
    attentionStateConfidence: AgentStateConfidence.HIGH,
    attentionAcknowledgedAt: null,
    risk: assessCommandRisk(normalizedCommand),
    createdAt: now,
    startedAt: null,
    updatedAt: now,
    endedAt: null,
    exitCode: null,
    signal: null,
    initialInstruction,
    attachments: normalizeTaskAttachments(attachments),
  };
}

export function markTaskRunning(task) {
  const now = new Date().toISOString();

  return {
    ...task,
    status: TaskStatus.RUNNING,
    agentState: task.agentState ?? AgentState.STARTING,
    agentStateReason: task.agentStateReason || "Process started.",
    agentStateSource: task.agentStateSource || AgentStateSource.PROCESS,
    agentStateConfidence: task.agentStateConfidence || AgentStateConfidence.HIGH,
    attentionState: AttentionState.NONE,
    attentionStateReason: "Task is running.",
    attentionStateSource: AgentStateSource.TASKDECK_EVENT,
    attentionStateConfidence: AgentStateConfidence.HIGH,
    startedAt: now,
    updatedAt: now,
    endedAt: null,
    exitCode: null,
    signal: null,
  };
}

export function markTaskAgentState(task, agentState, metadata = {}) {
  return {
    ...task,
    agentState,
    agentStateReason: metadata.reason ?? task.agentStateReason ?? "",
    agentStateSource: metadata.source ?? task.agentStateSource ?? "",
    agentStateConfidence: metadata.confidence ?? task.agentStateConfidence ?? "",
    attentionState: metadata.attentionState ?? task.attentionState ?? AttentionState.NONE,
    attentionStateReason: metadata.attentionReason ?? task.attentionStateReason ?? "",
    attentionStateSource: metadata.attentionSource ?? task.attentionStateSource ?? "",
    attentionStateConfidence: metadata.attentionConfidence ?? task.attentionStateConfidence ?? "",
    updatedAt: new Date().toISOString(),
  };
}

export function markTaskAttentionState(task, attentionState, metadata = {}) {
  return {
    ...task,
    attentionState,
    attentionStateReason: metadata.reason ?? task.attentionStateReason ?? "",
    attentionStateSource: metadata.source ?? task.attentionStateSource ?? "",
    attentionStateConfidence: metadata.confidence ?? task.attentionStateConfidence ?? "",
    updatedAt: new Date().toISOString(),
  };
}

export function markTaskAttentionAcknowledged(task, acknowledgedAt = new Date().toISOString()) {
  return {
    ...task,
    attentionState: AttentionState.NONE,
    attentionStateReason: "User acknowledged this attention event.",
    attentionStateSource: AgentStateSource.MANUAL,
    attentionStateConfidence: AgentStateConfidence.HIGH,
    attentionAcknowledgedAt: acknowledgedAt,
    updatedAt: acknowledgedAt,
  };
}

export function markTaskExited(task, { exitCode, signal }) {
  const now = new Date().toISOString();
  const status = exitCode === 0 ? TaskStatus.SUCCEEDED : signal ? TaskStatus.INTERRUPTED : TaskStatus.FAILED;
  const agentState = exitCode === 0 ? AgentState.DONE : signal ? AgentState.STOPPED : AgentState.FAILED;
  const attentionState = exitCode === 0 ? AttentionState.NONE : AttentionState.FAILED;

  return {
    ...task,
    status,
    agentState,
    agentStateReason: signal ? `Process interrupted by signal ${signal}.` : `Process exited with code ${exitCode}.`,
    agentStateSource: AgentStateSource.PROCESS,
    agentStateConfidence: AgentStateConfidence.HIGH,
    attentionState,
    attentionStateReason: exitCode === 0 ? "Process completed successfully." : "Process stopped or failed.",
    attentionStateSource: AgentStateSource.PROCESS,
    attentionStateConfidence: AgentStateConfidence.HIGH,
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
    agentProfileId: task.agentProfileId || "",
    agentLabel: task.agentLabel || "",
    agentPermissionLevel: task.agentPermissionLevel || "",
    agentModel: task.agentModel || "",
    sessionMode: task.sessionMode || "",
    resumeCommand: task.resumeCommand || "",
    agentSessionId: task.agentSessionId || "",
    agentSessionSource: task.agentSessionSource || "",
    agentSessionProvider: task.agentSessionProvider || "",
    agentSessionDetectedAt: task.agentSessionDetectedAt || "",
    agentSessionResumeCommand: task.agentSessionResumeCommand || "",
    identityColorSlot: normalizeIdentityColorSlot(task.identityColorSlot),
    status: task.status,
    agentState: task.agentState ?? inferAgentStateFromStatus(task),
    agentStateReason: task.agentStateReason || "",
    agentStateSource: task.agentStateSource || "",
    agentStateConfidence: task.agentStateConfidence || "",
    attentionState: task.attentionState ?? inferAttentionStateFromTask(task),
    attentionStateReason: task.attentionStateReason || "",
    attentionStateSource: task.attentionStateSource || inferAttentionStateSourceFromTask(task),
    attentionStateConfidence: task.attentionStateConfidence || inferAttentionStateConfidenceFromTask(task),
    attentionAcknowledgedAt: task.attentionAcknowledgedAt || null,
    risk: task.risk,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    updatedAt: task.updatedAt,
    endedAt: task.endedAt,
    exitCode: task.exitCode,
    signal: task.signal,
    initialInstruction: task.initialInstruction || "",
    attachments: normalizeTaskAttachments(task.attachments),
  };
}

export function normalizeIdentityColorSlot(identityColorSlot) {
  const slot = Number(identityColorSlot);
  if (!Number.isFinite(slot) || slot < 0) {
    return undefined;
  }
  return Math.floor(slot);
}

function normalizeTaskAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .filter((attachment) => attachment && typeof attachment === "object")
    .map((attachment) => ({
      id: String(attachment.id || ""),
      type: attachment.type === "image" ? "image" : String(attachment.type || ""),
      filename: String(attachment.filename || ""),
      path: String(attachment.path || ""),
      mimeType: String(attachment.mimeType || ""),
      size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : 0,
      createdAt: String(attachment.createdAt || ""),
    }))
    .filter((attachment) => attachment.id && attachment.type && attachment.filename && attachment.path);
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

export function inferAttentionStateFromTask(task) {
  if (task.status === TaskStatus.FAILED || task.status === TaskStatus.INTERRUPTED) return AttentionState.FAILED;
  if (task.agentState === AgentState.FAILED || task.agentState === AgentState.STOPPED) return AttentionState.FAILED;
  if (task.agentState === AgentState.WAITING_APPROVAL) return AttentionState.NEEDS_APPROVAL;
  if (task.agentState === AgentState.WAITING_INPUT) return AttentionState.NEEDS_INPUT;
  if (task.agentState === AgentState.REVIEW_READY) return AttentionState.REVIEW_READY;
  return AttentionState.NONE;
}

export function inferAttentionStateSourceFromTask(task) {
  if ((task.attentionState ?? inferAttentionStateFromTask(task)) === AttentionState.NONE) return "";
  if (task.status === TaskStatus.FAILED || task.status === TaskStatus.INTERRUPTED) return AgentStateSource.PROCESS;
  if (task.agentState === AgentState.FAILED || task.agentState === AgentState.STOPPED) return AgentStateSource.PROCESS;
  return task.agentStateSource || "";
}

export function inferAttentionStateConfidenceFromTask(task) {
  if ((task.attentionState ?? inferAttentionStateFromTask(task)) === AttentionState.NONE) return "";
  if (task.status === TaskStatus.FAILED || task.status === TaskStatus.INTERRUPTED) return AgentStateConfidence.HIGH;
  if (task.agentState === AgentState.FAILED || task.agentState === AgentState.STOPPED) return AgentStateConfidence.HIGH;
  return task.agentStateConfidence || "";
}

function cryptoRandomId() {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
