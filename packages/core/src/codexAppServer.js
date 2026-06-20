export function isCodexAppServerAuthError(error) {
  const text = (typeof error === "string" ? error : JSON.stringify(error || {})).toLowerCase();
  return (
    text.includes("auth expired") ||
    text.includes("token_revoked") ||
    text.includes("token_invalidated") ||
    text.includes("token invalidated") ||
    text.includes("invalidated oauth token") ||
    text.includes("refresh_token_invalidated") ||
    text.includes("refresh token invalidated") ||
    text.includes("your session has ended") ||
    text.includes("please log in again") ||
    text.includes("unauthorized") ||
    text.includes("401")
  );
}

export function shouldIgnoreCodexAppServerMessageAfterAuthFailure(activeThreadSession) {
  return Boolean(activeThreadSession?.authFailureDetected);
}

export function shouldSuppressCodexAppServerAuthErrorLine({ authFailureDetected, line }) {
  return Boolean(authFailureDetected && isCodexAppServerAuthError(line));
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

export function buildCodexAppServerThreadStartParams({ cwd, model = "" }) {
  const normalizedModel = String(model || "").trim();
  return {
    cwd,
    ephemeral: true,
    sandbox: "danger-full-access",
    approvalPolicy: "never",
    ...(normalizedModel ? { model: normalizedModel } : {}),
  };
}

export function buildCodexAppServerTurnStartParams({ threadId, text, model = "", effort = "" }) {
  const normalizedModel = String(model || "").trim();
  const normalizedEffort = String(effort || "").trim();
  return {
    threadId,
    approvalPolicy: "never",
    sandboxPolicy: { type: "dangerFullAccess" },
    input: [{ type: "text", text }],
    ...(normalizedModel ? { model: normalizedModel } : {}),
    ...(normalizedEffort ? { effort: normalizedEffort } : {}),
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
