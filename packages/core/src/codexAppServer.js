export const CodexAppServerAuthFailureReason = Object.freeze({
  AUTH_EXPIRED: "auth_expired",
  TOKEN_REVOKED: "token_revoked",
  TOKEN_INVALIDATED: "token_invalidated",
  REFRESH_TOKEN_INVALIDATED: "refresh_token_invalidated",
  SESSION_ENDED: "session_ended",
  LOGIN_REQUIRED: "login_required",
  UNAUTHORIZED: "unauthorized",
  AUTH_ERROR: "auth_error",
});

export const CodexAppServerInputRejectReason = Object.freeze({
  INPUT_LOCKED: "input_locked",
  EMPTY_INPUT: "empty_input",
  INVALID_INPUT: "invalid_input",
  RUNTIME_UNAVAILABLE: "runtime_unavailable",
  RUNTIME_NOT_WRITABLE: "runtime_not_writable",
  AUTH_FAILED: "auth_failed",
  UNKNOWN: "unknown",
});

export function isCodexAppServerAuthError(error) {
  return Boolean(codexAppServerAuthFailureReason(error));
}

export function codexAppServerAuthFailureReason(error) {
  const text = (typeof error === "string" ? error : JSON.stringify(error || {})).toLowerCase();
  if (!text) {
    return "";
  }
  if (text.includes("refresh_token_invalidated") || text.includes("refresh token invalidated")) {
    return CodexAppServerAuthFailureReason.REFRESH_TOKEN_INVALIDATED;
  }
  if (text.includes("token_revoked")) {
    return CodexAppServerAuthFailureReason.TOKEN_REVOKED;
  }
  if (
    text.includes("token_invalidated") ||
    text.includes("token invalidated") ||
    text.includes("invalidated oauth token")
  ) {
    return CodexAppServerAuthFailureReason.TOKEN_INVALIDATED;
  }
  if (text.includes("auth expired")) {
    return CodexAppServerAuthFailureReason.AUTH_EXPIRED;
  }
  if (text.includes("your session has ended")) {
    return CodexAppServerAuthFailureReason.SESSION_ENDED;
  }
  if (text.includes("please log in again")) {
    return CodexAppServerAuthFailureReason.LOGIN_REQUIRED;
  }
  if (text.includes("unauthorized") || text.includes("401")) {
    return CodexAppServerAuthFailureReason.UNAUTHORIZED;
  }
  return "";
}

export function shouldIgnoreCodexAppServerMessageAfterAuthFailure(activeThreadSession) {
  return Boolean(activeThreadSession?.authFailureDetected);
}

export function shouldSuppressCodexAppServerAuthErrorLine({ authFailureDetected, line }) {
  return Boolean(authFailureDetected && isCodexAppServerAuthError(line));
}

export function isRoutineCodexAppServerNotification(method) {
  const normalizedMethod = String(method || "").trim();
  return (
    normalizedMethod === "thread/settings/updated" ||
    normalizedMethod === "turn/diff/updated" ||
    normalizedMethod === "item/commandExecution/terminalInteraction"
  );
}

export function codexAppServerThreadIdFromMessage(message) {
  const params = message?.params ?? {};
  const result = message?.result ?? {};
  return String(
    params.threadId ||
      params.turn?.threadId ||
      params.thread?.id ||
      result.thread?.id ||
      result.turn?.threadId ||
      "",
  ).trim();
}

export function resolveCodexAppServerTaskIdForThread({ threadId, defaultTaskId, taskIdByThreadId }) {
  const normalizedThreadId = String(threadId || "").trim();
  if (!normalizedThreadId) {
    return defaultTaskId;
  }
  return taskIdByThreadId?.get?.(normalizedThreadId) || defaultTaskId;
}

export const TASKDECK_DYNAMIC_DECISION_TOOL_NAMESPACE = "taskdeck";
export const TASKDECK_DYNAMIC_DECISION_TOOL_NAME = "request_decision";

export const taskDeckDynamicDecisionTool = Object.freeze({
  namespace: TASKDECK_DYNAMIC_DECISION_TOOL_NAMESPACE,
  name: TASKDECK_DYNAMIC_DECISION_TOOL_NAME,
  description: [
    "Request a human decision through TaskDeck when human approval, product or UX judgment,",
    "or a project-direction choice is required before continuing.",
    "Use only when the next action is blocked by human judgment, has multiple plausible paths,",
    "or may be risky, irreversible, or broad in scope.",
    "Do not use for routine progress updates, questions answerable by reading code/tests,",
    "or ordinary implementation choices.",
    "TaskDeck infers routing identity from the App Server session; do not include taskId, sessionId,",
    "or taskdeckInstanceId in the arguments.",
    "The tool returns pending status and a decisionUrl; continue only after TaskDeck reports a decision.",
  ].join(" "),
  inputSchema: {
    type: "object",
    required: [
      "decisionQuestion",
      "goal",
      "urgency",
      "semanticSummary",
      "materials",
    ],
    properties: {
      decisionQuestion: { type: "string" },
      goal: { type: "string" },
      axis: { type: "string" },
      urgency: {
        type: "string",
        enum: ["normal", "blocking"],
      },
      semanticSummary: { type: "string" },
      materials: {
        type: "array",
        items: {
          type: "object",
          required: ["type", "text"],
          properties: {
            type: { type: "string", enum: ["text"] },
            label: { type: "string" },
            text: { type: "string" },
          },
        },
      },
      recommendedDecision: { type: ["string", "null"] },
      relevantFacts: {
        type: "array",
        items: { type: "string" },
      },
      risks: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
});

export function isTaskDeckDynamicDecisionToolEnabledFromEnv(env = {}) {
  return String(env?.TASKDECK_DISABLE_DYNAMIC_DECISION_TOOL || "").trim() !== "1";
}

export function taskDeckDynamicDecisionTools({ enabled = true } = {}) {
  return enabled ? [taskDeckDynamicDecisionTool] : [];
}

export function isTaskDeckDynamicDecisionToolCall(params) {
  return (
    String(params?.namespace || "").trim() === TASKDECK_DYNAMIC_DECISION_TOOL_NAMESPACE &&
    String(params?.tool || "").trim() === TASKDECK_DYNAMIC_DECISION_TOOL_NAME
  );
}

export function codexAppServerDynamicToolCallDedupeKey(params) {
  const threadId = String(params?.threadId || "").trim();
  const turnId = String(params?.turnId || "").trim();
  const callId = String(params?.callId || "").trim();
  if (!threadId || !turnId || !callId) {
    return "";
  }
  return `${threadId}:${turnId}:${callId}`;
}

export function getOrCreateCodexAppServerDynamicToolCallEntry(cache, key, createEntry) {
  if (!cache || typeof cache.get !== "function" || typeof cache.set !== "function" || !key) {
    return { created: false, entry: null };
  }
  const existingEntry = cache.get(key);
  if (existingEntry) {
    return { created: false, entry: existingEntry };
  }
  const entry = createEntry();
  cache.set(key, entry);
  return { created: true, entry };
}

export function buildCodexAppServerDynamicToolCallResponse(payload, success) {
  return {
    success,
    contentItems: [
      {
        type: "inputText",
        text: JSON.stringify(payload),
      },
    ],
  };
}

export function buildCodexAppServerThreadStartParams({
  cwd,
  model = "",
  enableDynamicDecisionTool = true,
} = {}) {
  const normalizedModel = String(model || "").trim();
  const dynamicTools = taskDeckDynamicDecisionTools({ enabled: enableDynamicDecisionTool });
  return {
    cwd,
    ephemeral: true,
    sandbox: "danger-full-access",
    approvalPolicy: "never",
    ...(normalizedModel ? { model: normalizedModel } : {}),
    ...(dynamicTools.length > 0 ? { dynamicTools } : {}),
  };
}

export function buildCodexAppServerTurnStartParams({ threadId, text, attachments = [], model = "", effort = "" }) {
  const normalizedModel = String(model || "").trim();
  const normalizedEffort = String(effort || "").trim();
  const normalizedAttachments = Array.isArray(attachments) ? attachments : [];
  const fileAttachments = normalizedAttachments.filter((attachment) => attachment?.type === "file" && attachment.path);
  const textWithFileContext = appendFileAttachmentContext(text, fileAttachments);
  const input = [
    ...(textWithFileContext ? [{ type: "text", text: textWithFileContext }] : []),
    ...normalizedAttachments
      .filter((attachment) => attachment?.type === "image" && attachment.path)
      .map((attachment) => ({ type: "localImage", path: String(attachment.path) })),
  ];
  return {
    threadId,
    approvalPolicy: "never",
    sandboxPolicy: { type: "dangerFullAccess" },
    input,
    ...(normalizedModel ? { model: normalizedModel } : {}),
    ...(normalizedEffort ? { effort: normalizedEffort } : {}),
  };
}

function appendFileAttachmentContext(text, attachments) {
  const normalizedText = String(text || "").trim();
  if (!attachments.length) {
    return normalizedText;
  }
  const attachmentBlock = [
    "Attached files:",
    ...attachments.map((attachment) => `- ${attachment.path}`),
  ].join("\n");
  return normalizedText ? `${normalizedText}\n\n${attachmentBlock}` : attachmentBlock;
}

export function buildCodexAppServerTurnInterruptParams({ threadId, turnId }) {
  return {
    threadId: String(threadId || "").trim(),
    turnId: String(turnId || "").trim(),
  };
}

export function normalizeCodexAppServerModels(rawModels) {
  if (!Array.isArray(rawModels)) {
    return [];
  }

  const models = [];
  const seenModels = new Set();
  for (const rawModel of rawModels) {
    const model = String(rawModel?.model || rawModel?.id || "").trim();
    if (!model || seenModels.has(model)) {
      continue;
    }
    seenModels.add(model);
    const supportedReasoningEfforts = Array.isArray(rawModel?.supportedReasoningEfforts)
      ? rawModel.supportedReasoningEfforts
          .map((option) => ({
            reasoningEffort: typeof option === "string"
              ? option.trim()
              : String(option?.reasoningEffort || "").trim(),
            description: typeof option === "object" ? String(option?.description || "").trim() : "",
          }))
          .filter((option) => option.reasoningEffort)
      : [];
    models.push({
      id: String(rawModel?.id || model).trim() || model,
      model,
      displayName: String(rawModel?.displayName || model).trim() || model,
      description: String(rawModel?.description || "").trim(),
      isDefault: rawModel?.isDefault === true,
      defaultReasoningEffort: String(rawModel?.defaultReasoningEffort || "").trim(),
      supportedReasoningEfforts,
    });
  }
  return models;
}
