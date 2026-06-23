export const DECISION_GATEWAY_RECENT_OUTPUT_LIMIT = 4000;
export const DECISION_GATEWAY_CONTEXT_FIELD_LIMIT = 2000;
export const DECISION_GATEWAY_MAILBOX_TEXT_FIELD_LIMIT = 2000;

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
