export const DECISION_GATEWAY_RECENT_OUTPUT_LIMIT = 4000;
export const DECISION_GATEWAY_CONTEXT_FIELD_LIMIT = 2000;
export const DECISION_GATEWAY_MAILBOX_TEXT_FIELD_LIMIT = 2000;
export const DEFAULT_DECISION_GATEWAY_DECISION_LEASE_TTL_MS = 30 * 60 * 1000;

export const DecisionGatewayDecisionLeaseStatus = Object.freeze({
  PENDING: "pending",
  RECEIVED: "received",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
});

export const DecisionGatewayMailboxValidationStatus = Object.freeze({
  VALID: "valid",
  UNMATCHED: "unmatched",
  STALE: "stale",
});

const redactionPatterns = [
  {
    pattern: /\b(sk-[A-Za-z0-9_-]{12,})\b/g,
    replacement: "[REDACTED_OPENAI_KEY]",
  },
  {
    pattern: /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s]+/gi,
    replacement: (match) => `${match.split(/[:=]/)[0].trim()}=[REDACTED]`,
  },
  {
    pattern: /\bauthorization\s*:\s*bearer\s+[^"'\s]+/gi,
    replacement: "authorization: Bearer [REDACTED]",
  },
  {
    pattern: /\b[A-Za-z0-9._%+-]+:[A-Za-z0-9._~+/-]{16,}@/g,
    replacement: "[REDACTED_CREDENTIALS]@",
  },
  {
    pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
  },
];

export function normalizeDecisionGatewayUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.replace(/\/+$/, "");
}

export function redactDecisionGatewayText(value) {
  let redacted = String(value || "");
  for (const { pattern, replacement } of redactionPatterns) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

export function boundedDecisionGatewayRecentOutput(value, limit = DECISION_GATEWAY_RECENT_OUTPUT_LIMIT) {
  const redacted = redactDecisionGatewayText(value);
  if (redacted.length <= limit) {
    return redacted;
  }

  return `[TaskDeck truncated recent output to the last ${limit} characters.]\n${redacted.slice(-limit)}`;
}

export function boundedDecisionGatewayContextField(value, limit = DECISION_GATEWAY_CONTEXT_FIELD_LIMIT) {
  const redacted = redactDecisionGatewayText(value);
  if (redacted.length <= limit) {
    return redacted;
  }

  return `${redacted.slice(0, limit)}\n[TaskDeck truncated this field to ${limit} characters.]`;
}

export function buildTaskDeckDecisionRequest({ task, recentOutput = "" }) {
  const taskId = String(task?.id || "").trim();
  const sessionId = String(task?.agentSessionId || "").trim();
  const title = boundedDecisionGatewayContextField(String(task?.sessionLabel || task?.title || "").trim(), 500);
  const initialInstruction = boundedDecisionGatewayContextField(String(task?.initialInstruction || "").trim());
  const attentionStateReason = boundedDecisionGatewayContextField(String(task?.attentionStateReason || "").trim(), 1000);
  const workingDirectory = boundedDecisionGatewayContextField(String(task?.cwd || "").trim(), 1000);
  const agentKind = boundedDecisionGatewayContextField(String(task?.agentLabel || task?.agentProfileId || "").trim(), 500);
  const agentProfileId = boundedDecisionGatewayContextField(String(task?.agentProfileId || "").trim(), 500);
  const goal = title || initialInstruction || "Decide what this TaskDeck session should do next.";
  const currentState = [
    task?.status ? `Process status: ${task.status}.` : "",
    task?.agentState ? `Agent state: ${task.agentState}.` : "",
    task?.attentionState ? `Attention state: ${task.attentionState}.` : "",
    attentionStateReason ? `Attention reason: ${attentionStateReason}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const safeRecentOutput = boundedDecisionGatewayRecentOutput(recentOutput);

  return {
    source: {
      type: "taskdeck",
      taskId,
      ...(sessionId ? { sessionId } : {}),
      ...(agentProfileId ? { agentProfileId } : {}),
      label: "TaskDeck",
    },
    goal,
    axis: "ambiguous_product_decision",
    urgency: "blocking",
    decisionQuestion: decisionQuestionForTask(task),
    semanticSummary: currentState || "This TaskDeck session needs human judgment before the agent continues.",
    relevantFacts: [
      "TaskDeck sent this request manually from an existing task/session.",
      task?.attentionState && task.attentionState !== "none"
        ? "TaskDeck marked this session as needing attention."
        : "TaskDeck did not infer a structured decision request from the agent.",
      safeRecentOutput ? "A bounded, redacted recent output snippet is included as material." : "No recent output snippet was available.",
    ],
    risks: [
      "The decision request may be generic until agents emit structured decision_request files.",
      "Recent output is bounded and redacted, so the Decision Workspace may not include all context.",
    ],
    recommendedDecision: null,
    materials: [
      {
        type: "text",
        label: "TaskDeck source context",
        text: JSON.stringify(
          {
            taskId,
            sessionId: sessionId || null,
            agentKind,
            agentProfileId,
            workingDirectory,
            currentGoal: goal,
            taskTitle: title,
            initialInstruction,
            attentionState: task?.attentionState || "",
            attentionStateReason,
          },
          null,
          2,
        ),
      },
      ...(safeRecentOutput
        ? [
            {
              type: "text",
              label: "Bounded recent output",
              text: safeRecentOutput,
            },
          ]
        : []),
    ],
  };
}

export function normalizeDecisionGatewayMailboxItem(value, { receivedAt = new Date().toISOString() } = {}) {
  if (!isPlainObject(value)) {
    return null;
  }

  const mailboxItemId = normalizedString(value.id);
  const payload = isPlainObject(value.payload) ? value.payload : null;
  if (!mailboxItemId || !payload || payload.type !== "decision_result") {
    return null;
  }

  const action = isPlainObject(payload.action) ? payload.action : null;
  const actionType = normalizedString(action?.type);
  if (!action || !actionType) {
    return null;
  }

  const source = isPlainObject(payload.source) ? payload.source : {};

  return {
    mailboxItemId,
    mailboxStatus: normalizedString(value.status),
    decisionRequestId: normalizedString(payload.decisionRequestId),
    decisionActionId: normalizedString(payload.decisionActionId),
    requestId: normalizedString(payload.requestId),
    taskId: normalizedString(payload.taskId || source.taskId),
    sessionId: normalizedString(payload.sessionId || source.sessionId),
    actionType,
    condition: boundedDecisionGatewayContextField(
      normalizedString(action.condition),
      DECISION_GATEWAY_MAILBOX_TEXT_FIELD_LIMIT,
    ),
    reason: boundedDecisionGatewayContextField(normalizedString(action.reason), DECISION_GATEWAY_MAILBOX_TEXT_FIELD_LIMIT),
    decidedAt: normalizedString(action.decidedAt),
    receivedAt: normalizedString(receivedAt) || new Date().toISOString(),
    createdAt: normalizedString(value.createdAt),
    pickedUpAt: normalizedString(value.pickedUpAt),
    goal: boundedDecisionGatewayContextField(normalizedString(payload.goal), DECISION_GATEWAY_MAILBOX_TEXT_FIELD_LIMIT),
    axis: normalizedString(payload.axis),
    urgency: normalizedString(payload.urgency),
  };
}

export function createDecisionGatewayDecisionLease({
  leaseId,
  decisionGatewayDecisionId = "",
  decisionGatewayUrl = "",
  requestId,
  taskId,
  sessionId = "",
  taskdeckInstanceId,
  createdAt = new Date().toISOString(),
  ttlMs = DEFAULT_DECISION_GATEWAY_DECISION_LEASE_TTL_MS,
}) {
  const normalizedLeaseId = normalizedString(leaseId);
  const normalizedRequestId = normalizedString(requestId);
  const normalizedTaskId = normalizedString(taskId);
  const normalizedTaskdeckInstanceId = normalizedString(taskdeckInstanceId);
  const rawCreatedAt = normalizedString(createdAt);
  const createdAtTimestamp = Date.parse(rawCreatedAt);
  const normalizedCreatedAt = Number.isFinite(createdAtTimestamp) ? rawCreatedAt : new Date().toISOString();
  const normalizedTtlMs = normalizePositiveDurationMs(ttlMs, DEFAULT_DECISION_GATEWAY_DECISION_LEASE_TTL_MS);

  if (!normalizedLeaseId || !normalizedRequestId || !normalizedTaskId || !normalizedTaskdeckInstanceId) {
    return null;
  }

  return {
    leaseId: normalizedLeaseId,
    decisionGatewayDecisionId: normalizedString(decisionGatewayDecisionId),
    decisionGatewayUrl: normalizedString(decisionGatewayUrl),
    requestId: normalizedRequestId,
    taskId: normalizedTaskId,
    sessionId: normalizedString(sessionId),
    taskdeckInstanceId: normalizedTaskdeckInstanceId,
    status: DecisionGatewayDecisionLeaseStatus.PENDING,
    createdAt: normalizedCreatedAt,
    expiresAt: new Date(Date.parse(normalizedCreatedAt) + normalizedTtlMs).toISOString(),
    receivedAt: "",
    mailboxItemId: "",
    actionType: "",
  };
}

export function normalizeDecisionGatewayDecisionLease(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const leaseId = normalizedString(value.leaseId);
  const requestId = normalizedString(value.requestId);
  const taskId = normalizedString(value.taskId);
  const taskdeckInstanceId = normalizedString(value.taskdeckInstanceId);
  if (!leaseId || !requestId || !taskId || !taskdeckInstanceId) {
    return null;
  }

  const status = Object.values(DecisionGatewayDecisionLeaseStatus).includes(value.status)
    ? value.status
    : DecisionGatewayDecisionLeaseStatus.PENDING;

  return {
    leaseId,
    decisionGatewayDecisionId: normalizedString(value.decisionGatewayDecisionId || value.decisionRequestId),
    decisionGatewayUrl: normalizedString(value.decisionGatewayUrl),
    requestId,
    taskId,
    sessionId: normalizedString(value.sessionId),
    taskdeckInstanceId,
    status,
    createdAt: normalizedString(value.createdAt || value.sentAt),
    expiresAt: normalizedString(value.expiresAt),
    receivedAt: normalizedString(value.receivedAt),
    mailboxItemId: normalizedString(value.mailboxItemId || value.receivedMailboxItemId),
    actionType: normalizedString(value.actionType),
  };
}

export function validateDecisionGatewayMailboxItemAgainstLease(
  mailboxItem,
  lease,
  {
    now = new Date().toISOString(),
    taskExists = true,
    taskSessionId = "",
  } = {},
) {
  if (!lease) {
    return {
      validationStatus: DecisionGatewayMailboxValidationStatus.UNMATCHED,
      validationReason: "Mailbox requestId does not match a local pending Decision Gateway lease.",
    };
  }

  if (lease.status === DecisionGatewayDecisionLeaseStatus.EXPIRED || isDecisionGatewayDecisionLeaseExpired(lease, now)) {
    return {
      validationStatus: DecisionGatewayMailboxValidationStatus.STALE,
      validationReason: "The local Decision Gateway decision lease is expired.",
    };
  }

  if (lease.status === DecisionGatewayDecisionLeaseStatus.CANCELLED) {
    return {
      validationStatus: DecisionGatewayMailboxValidationStatus.STALE,
      validationReason: "The local Decision Gateway decision lease was cancelled.",
    };
  }

  if (lease.status !== DecisionGatewayDecisionLeaseStatus.PENDING) {
    return {
      validationStatus: DecisionGatewayMailboxValidationStatus.STALE,
      validationReason: "The local Decision Gateway decision lease was already resolved.",
    };
  }

  if (!taskExists) {
    return {
      validationStatus: DecisionGatewayMailboxValidationStatus.UNMATCHED,
      validationReason: "Mailbox taskId does not match a local TaskDeck task.",
    };
  }

  const mailboxTaskId = normalizedString(mailboxItem?.taskId);
  if (mailboxTaskId && lease.taskId && mailboxTaskId !== lease.taskId) {
    return {
      validationStatus: DecisionGatewayMailboxValidationStatus.UNMATCHED,
      validationReason: "Mailbox taskId does not match the local Decision Gateway decision lease.",
    };
  }

  const mailboxSessionId = normalizedString(mailboxItem?.sessionId);
  const expectedSessionId = normalizedString(lease.sessionId);
  const currentTaskSessionId = normalizedString(taskSessionId);

  if (mailboxSessionId && expectedSessionId && mailboxSessionId !== expectedSessionId) {
    return {
      validationStatus: DecisionGatewayMailboxValidationStatus.UNMATCHED,
      validationReason: "Mailbox sessionId does not match the local Decision Gateway decision lease.",
    };
  }

  if (mailboxSessionId && currentTaskSessionId && mailboxSessionId !== currentTaskSessionId) {
    return {
      validationStatus: DecisionGatewayMailboxValidationStatus.UNMATCHED,
      validationReason: "Mailbox sessionId does not match the local TaskDeck task session.",
    };
  }

  if (expectedSessionId && currentTaskSessionId && expectedSessionId !== currentTaskSessionId) {
    return {
      validationStatus: DecisionGatewayMailboxValidationStatus.UNMATCHED,
      validationReason: "Decision lease sessionId does not match the local TaskDeck task session.",
    };
  }

  return {
    validationStatus: DecisionGatewayMailboxValidationStatus.VALID,
    validationReason: "Mailbox item matches a pending local Decision Gateway decision lease.",
  };
}

export function markDecisionGatewayDecisionLeaseReceived(lease, { receivedAt, mailboxItemId, actionType }) {
  if (!lease || lease.status !== DecisionGatewayDecisionLeaseStatus.PENDING) {
    return lease;
  }

  return {
    ...lease,
    status: DecisionGatewayDecisionLeaseStatus.RECEIVED,
    receivedAt: normalizedString(receivedAt) || new Date().toISOString(),
    mailboxItemId: normalizedString(mailboxItemId),
    actionType: normalizedString(actionType),
  };
}

export function isDecisionGatewayDecisionLeaseExpired(lease, now = new Date().toISOString()) {
  const expiresAt = Date.parse(String(lease?.expiresAt || ""));
  const nowTimestamp = Date.parse(String(now || ""));
  return Number.isFinite(expiresAt) && Number.isFinite(nowTimestamp) && expiresAt <= nowTimestamp;
}

function decisionQuestionForTask(task) {
  const title = boundedDecisionGatewayContextField(String(task?.sessionLabel || task?.title || "").trim(), 500);
  if (title) {
    return `This TaskDeck session needs human judgment for "${title}". What should the agent do next?`;
  }

  return "This TaskDeck session needs human judgment. What should the agent do next?";
}

function normalizedString(value) {
  return String(value || "").trim();
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizePositiveDurationMs(value, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return Math.floor(numericValue);
}
