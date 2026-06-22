export const DECISION_GATEWAY_RECENT_OUTPUT_LIMIT = 4000;

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

export function buildTaskDeckDecisionRequest({ task, recentOutput = "" }) {
  const taskId = String(task?.id || "").trim();
  const sessionId = String(task?.agentSessionId || "").trim();
  const title = String(task?.sessionLabel || task?.title || "").trim();
  const goal = title || String(task?.initialInstruction || "").trim() || "Decide what this TaskDeck session should do next.";
  const currentState = [
    task?.status ? `Process status: ${task.status}.` : "",
    task?.agentState ? `Agent state: ${task.agentState}.` : "",
    task?.attentionState ? `Attention state: ${task.attentionState}.` : "",
    task?.attentionStateReason ? `Attention reason: ${task.attentionStateReason}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const safeRecentOutput = boundedDecisionGatewayRecentOutput(recentOutput);

  return {
    source: {
      type: "taskdeck",
      taskId,
      ...(sessionId ? { sessionId } : {}),
      ...(task?.agentProfileId ? { agentProfileId: String(task.agentProfileId) } : {}),
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
            agentKind: task?.agentLabel || task?.agentProfileId || "",
            agentProfileId: task?.agentProfileId || "",
            workingDirectory: task?.cwd || "",
            currentGoal: goal,
            taskTitle: title,
            initialInstruction: task?.initialInstruction || "",
            attentionState: task?.attentionState || "",
            attentionStateReason: task?.attentionStateReason || "",
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

function decisionQuestionForTask(task) {
  const title = String(task?.sessionLabel || task?.title || "").trim();
  if (title) {
    return `This TaskDeck session needs human judgment for "${title}". What should the agent do next?`;
  }

  return "This TaskDeck session needs human judgment. What should the agent do next?";
}
