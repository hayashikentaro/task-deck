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
