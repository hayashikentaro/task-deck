export const TaskStatus = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  INTERRUPTED: "interrupted",
  CLOSED: "closed",
});

export const AgentState = Object.freeze({
  STARTING: "starting",
  READY: "ready",
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
  PROCESS: "process",
  MANUAL: "manual",
  CHILD_STATUS: "child_status",
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

export const ChildReportedState = Object.freeze({
  WORKING: "working",
  BLOCKED: "blocked",
  READY_FOR_REVIEW: "ready_for_review",
  DONE: "done",
  FAILED: "failed",
});

const childReportedStates = new Set(Object.values(ChildReportedState));
const agentStateSources = new Set(Object.values(AgentStateSource));
const agentReasoningEfforts = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

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
  agentReasoningEffort = "",
  agentModel = "",
  sessionMode = "",
  resumeCommand = "",
  initialInstruction = "",
  agentSessionId = "",
  agentSessionSource = "",
  agentSessionProvider = "",
  agentSessionDetectedAt = "",
  agentSessionResumeCommand = "",
  parentSessionId = "",
  childStatusFile = "",
  isManager = false,
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
    agentReasoningEffort: normalizeAgentReasoningEffort(agentReasoningEffort),
    agentModel,
    sessionMode,
    resumeCommand,
    agentSessionId,
    agentSessionSource,
    agentSessionProvider,
    agentSessionDetectedAt,
    agentSessionResumeCommand,
    parentSessionId: String(parentSessionId || "").trim(),
    childStatusFile: String(childStatusFile || "").trim(),
    childReportedState: "",
    childStatusSummary: "",
    childStatusArtifacts: [],
    childStatusDetailsFile: "",
    childStatusUpdatedAt: "",
    childStatusError: "",
    isManager: normalizeBoolean(isManager),
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
    reviewedAt: null,
    reviewedByTaskId: "",
    closedAt: null,
    closedByTaskId: "",
    inputLockedAt: null,
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
    agentStateSource: normalizeAgentStateSource(task.agentStateSource) || AgentStateSource.PROCESS,
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
    agentStateSource: normalizeAgentStateSource(metadata.source ?? task.agentStateSource),
    agentStateConfidence: metadata.confidence ?? task.agentStateConfidence ?? "",
    attentionState: metadata.attentionState ?? task.attentionState ?? AttentionState.NONE,
    attentionStateReason: metadata.attentionReason ?? task.attentionStateReason ?? "",
    attentionStateSource: normalizeAgentStateSource(metadata.attentionSource ?? task.attentionStateSource),
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

export function markTaskReviewed(task, { reviewedAt = new Date().toISOString(), reviewedByTaskId = "" } = {}) {
  const clearsReviewAttention = task.attentionState === AttentionState.REVIEW_READY;
  return {
    ...task,
    ...(clearsReviewAttention
      ? {
          attentionState: AttentionState.NONE,
          attentionStateReason: "Manager marked this task reviewed.",
          attentionStateSource: AgentStateSource.MANUAL,
          attentionStateConfidence: AgentStateConfidence.HIGH,
          attentionAcknowledgedAt: reviewedAt,
        }
      : {}),
    reviewedAt,
    reviewedByTaskId: String(reviewedByTaskId || "").trim(),
    updatedAt: reviewedAt,
  };
}

export function markTaskClosed(task, { closedAt = new Date().toISOString(), closedByTaskId = "" } = {}) {
  return {
    ...task,
    status: TaskStatus.CLOSED,
    agentState: AgentState.STOPPED,
    agentStateReason: "Manager closed this task.",
    agentStateSource: AgentStateSource.MANUAL,
    agentStateConfidence: AgentStateConfidence.HIGH,
    attentionState: AttentionState.NONE,
    attentionStateReason: "Manager closed this task.",
    attentionStateSource: AgentStateSource.MANUAL,
    attentionStateConfidence: AgentStateConfidence.HIGH,
    closedAt,
    closedByTaskId: String(closedByTaskId || "").trim(),
    updatedAt: closedAt,
    endedAt: task.endedAt || closedAt,
  };
}

export function markTaskInputLocked(task, lockedAt = new Date().toISOString()) {
  const { terminalInputLockedAt: _legacyTerminalInputLockedAt, ...rest } = task;
  return {
    ...rest,
    inputLockedAt: lockedAt,
  };
}

export function markTaskInputUnlocked(task, unlockedAt = new Date().toISOString()) {
  const { terminalInputLockedAt: _legacyTerminalInputLockedAt, ...rest } = task;
  return {
    ...rest,
    inputLockedAt: null,
    updatedAt: unlockedAt,
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
    agentReasoningEffort: normalizeAgentReasoningEffort(task.agentReasoningEffort),
    agentModel: task.agentModel || "",
    sessionMode: task.sessionMode || "",
    resumeCommand: task.resumeCommand || "",
    agentSessionId: task.agentSessionId || "",
    agentSessionSource: task.agentSessionSource || "",
    agentSessionProvider: task.agentSessionProvider || "",
    agentSessionDetectedAt: task.agentSessionDetectedAt || "",
    agentSessionResumeCommand: task.agentSessionResumeCommand || "",
    parentSessionId: task.parentSessionId || "",
    childStatusFile: task.childStatusFile || "",
    childReportedState: childReportedStates.has(task.childReportedState) ? task.childReportedState : "",
    childStatusSummary: task.childStatusSummary || "",
    childStatusArtifacts: normalizeStringArray(task.childStatusArtifacts),
    childStatusDetailsFile: task.childStatusDetailsFile || "",
    childStatusUpdatedAt: task.childStatusUpdatedAt || "",
    childStatusError: task.childStatusError || "",
    isManager: normalizeBoolean(task.isManager),
    identityColorSlot: normalizeIdentityColorSlot(task.identityColorSlot),
    status: task.status,
    agentState: task.agentState ?? inferAgentStateFromStatus(task),
    agentStateReason: task.agentStateReason || "",
    agentStateSource: normalizeAgentStateSource(task.agentStateSource),
    agentStateConfidence: task.agentStateConfidence || "",
    attentionState: task.attentionState ?? inferAttentionStateFromTask(task),
    attentionStateReason: task.attentionStateReason || "",
    attentionStateSource: normalizeAgentStateSource(task.attentionStateSource) || inferAttentionStateSourceFromTask(task),
    attentionStateConfidence: task.attentionStateConfidence || inferAttentionStateConfidenceFromTask(task),
    attentionAcknowledgedAt: task.attentionAcknowledgedAt || null,
    reviewedAt: task.reviewedAt || null,
    reviewedByTaskId: task.reviewedByTaskId || "",
    closedAt: task.closedAt || null,
    closedByTaskId: task.closedByTaskId || "",
    inputLockedAt: task.inputLockedAt || task.terminalInputLockedAt || null,
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

export function parseChildStatusReportJson(rawContents) {
  let parsed;

  try {
    parsed = JSON.parse(rawContents);
  } catch {
    return {
      ok: false,
      error: "Task status file must contain valid JSON.",
    };
  }

  return validateChildStatusReport(parsed);
}

export function validateChildStatusReport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      error: "Task status report must be a JSON object.",
    };
  }

  if (value.kind !== "childStatus") {
    return {
      ok: false,
      error: "Task status report kind must be childStatus.",
    };
  }

  if (value.version !== 1) {
    return {
      ok: false,
      error: "Task status report version must be 1.",
    };
  }

  if (!childReportedStates.has(value.state)) {
    return {
      ok: false,
      error: "Task status report state must be one of working, blocked, ready_for_review, done, or failed.",
    };
  }

  if ("summary" in value && typeof value.summary !== "string") {
    return {
      ok: false,
      error: "Task status report summary must be a string when provided.",
    };
  }

  if ("artifacts" in value && !isStringArray(value.artifacts)) {
    return {
      ok: false,
      error: "Task status report artifacts must be an array of strings when provided.",
    };
  }

  if ("detailsFile" in value && typeof value.detailsFile !== "string") {
    return {
      ok: false,
      error: "Task status report detailsFile must be a string when provided.",
    };
  }

  if ("updatedAt" in value && typeof value.updatedAt !== "string") {
    return {
      ok: false,
      error: "Task status report updatedAt must be a string when provided.",
    };
  }

  return {
    ok: true,
    report: {
      state: value.state,
      summary: typeof value.summary === "string" ? value.summary : "",
      artifacts: isStringArray(value.artifacts) ? value.artifacts : [],
      detailsFile: typeof value.detailsFile === "string" ? value.detailsFile : "",
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    },
  };
}

export function markTaskChildStatusReported(task, report, observedAt = new Date().toISOString()) {
  if (task.status === TaskStatus.CLOSED) {
    return task;
  }

  const nextAttentionState = attentionStateForChildReportedState(report.state);
  const hasAttentionFromChildStatus =
    task.attentionStateSource === AgentStateSource.CHILD_STATUS &&
    task.attentionState &&
    task.attentionState !== AttentionState.NONE;
  const nextTask = {
    ...task,
    childReportedState: report.state,
    childStatusSummary: report.summary || "",
    childStatusArtifacts: normalizeStringArray(report.artifacts),
    childStatusDetailsFile: report.detailsFile || "",
    childStatusUpdatedAt: report.updatedAt || observedAt,
    childStatusError: "",
    updatedAt: observedAt,
  };

  if (nextAttentionState !== AttentionState.NONE) {
    return {
      ...nextTask,
      attentionState: nextAttentionState,
      attentionStateReason: childStatusAttentionReason(report),
      attentionStateSource: AgentStateSource.CHILD_STATUS,
      attentionStateConfidence: AgentStateConfidence.HIGH,
      attentionAcknowledgedAt: null,
    };
  }

  if (hasAttentionFromChildStatus) {
    return {
      ...nextTask,
      attentionState: AttentionState.NONE,
      attentionStateReason: `Task reported ${report.state}.`,
      attentionStateSource: AgentStateSource.CHILD_STATUS,
      attentionStateConfidence: AgentStateConfidence.HIGH,
    };
  }

  return nextTask;
}

export function markTaskChildStatusError(task, error, observedAt = new Date().toISOString()) {
  if (task.status === TaskStatus.CLOSED) {
    return task;
  }

  return {
    ...task,
    childStatusError: String(error || "Invalid task status report."),
    updatedAt: observedAt,
  };
}

export function attentionStateForChildReportedState(state) {
  if (state === ChildReportedState.BLOCKED) return AttentionState.MAY_NEED_USER;
  if (state === ChildReportedState.READY_FOR_REVIEW) return AttentionState.REVIEW_READY;
  if (state === ChildReportedState.FAILED) return AttentionState.FAILED;
  return AttentionState.NONE;
}

export function isTaskVisibleInNormalList(task) {
  return task?.status !== TaskStatus.CLOSED;
}

export function normalizeIdentityColorSlot(identityColorSlot) {
  const slot = Number(identityColorSlot);
  if (!Number.isFinite(slot) || slot < 0) {
    return undefined;
  }
  return Math.floor(slot);
}

function normalizeAgentReasoningEffort(value) {
  const normalizedValue = String(value || "").trim();
  return agentReasoningEfforts.has(normalizedValue) ? normalizedValue : "";
}

function normalizeAgentStateSource(value) {
  const normalizedValue = String(value || "").trim();
  return agentStateSources.has(normalizedValue) ? normalizedValue : "";
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function childStatusAttentionReason(report) {
  if (report.summary) {
    return `Task reported ${report.state}: ${report.summary}`;
  }
  return `Task reported ${report.state}.`;
}

function normalizeBoolean(value) {
  return value === true || String(value || "").toLowerCase() === "true";
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
  if (task.status === TaskStatus.CLOSED) return AgentState.STOPPED;
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
  return normalizeAgentStateSource(task.agentStateSource);
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
