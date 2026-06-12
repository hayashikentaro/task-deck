export const CHILD_SESSION_MESSAGE_FILE_REQUEST_KIND = "childSessionMessageRequest";
export const CHILD_SESSION_MESSAGE_FILE_RESULT_KIND = "childSessionMessageRequestResult";
export const CHILD_SESSION_MESSAGE_FILE_VERSION = 1;

const forbiddenFields = new Set(["command", "rawCommand", "shell", "env", "secrets", "autoApprove"]);

export function createChildSessionMessageFileRequestDraft({
  requestId,
  parentTaskId = "",
  target,
  message,
  reason = "Parent follow-up instruction.",
  createdAt = new Date().toISOString(),
}) {
  return {
    kind: CHILD_SESSION_MESSAGE_FILE_REQUEST_KIND,
    version: CHILD_SESSION_MESSAGE_FILE_VERSION,
    requestId,
    createdAt,
    ...(parentTaskId ? { parentTaskId } : {}),
    target: normalizeTargetDraft(target),
    message,
    reason,
  };
}

export function validateChildSessionMessageFileRequest(value) {
  const forbiddenPath = findForbiddenFieldPath(value);
  if (forbiddenPath) {
    return { ok: false, error: `Forbidden field in child session message request file: ${forbiddenPath}` };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Request file must contain a JSON object." };
  }
  if (value.kind !== CHILD_SESSION_MESSAGE_FILE_REQUEST_KIND) {
    return { ok: false, error: `Request kind must be ${CHILD_SESSION_MESSAGE_FILE_REQUEST_KIND}.` };
  }
  if (value.version !== CHILD_SESSION_MESSAGE_FILE_VERSION) {
    return { ok: false, error: `Request version must be ${CHILD_SESSION_MESSAGE_FILE_VERSION}.` };
  }

  const requestId = String(value.requestId || "").trim();
  if (!requestId) {
    return { ok: false, error: "requestId is required." };
  }
  if (sanitizeMessageRequestId(requestId) !== requestId) {
    return { ok: false, error: "requestId contains unsupported characters." };
  }

  const parentTaskId = String(value.parentTaskId || "").trim();
  if (!parentTaskId) {
    return { ok: false, error: "parentTaskId is required." };
  }

  const targetResult = validateTarget(value.target);
  if (!targetResult.ok) {
    return targetResult;
  }

  const message = typeof value.message === "string" ? value.message : "";
  if (typeof value.message !== "string") {
    return { ok: false, error: "message must be a string." };
  }
  if (!message.trim()) {
    return { ok: false, error: "message must not be empty." };
  }

  if (value.reason !== undefined && typeof value.reason !== "string") {
    return { ok: false, error: "reason must be a string when provided." };
  }
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";

  return {
    ok: true,
    request: {
      kind: CHILD_SESSION_MESSAGE_FILE_REQUEST_KIND,
      version: CHILD_SESSION_MESSAGE_FILE_VERSION,
      requestId,
      parentTaskId,
      target: targetResult.target,
      message,
      ...(reason ? { reason } : {}),
      createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    },
  };
}

export function createChildSessionMessageRequestResult({
  requestId,
  state,
  targetTaskId = "",
  error = "",
  processedAt = new Date().toISOString(),
}) {
  return {
    kind: CHILD_SESSION_MESSAGE_FILE_RESULT_KIND,
    version: CHILD_SESSION_MESSAGE_FILE_VERSION,
    requestId,
    state,
    ...(state === "accepted" ? { targetTaskId } : { error }),
    processedAt,
  };
}

export function childSessionMessageFileRequestResultFilenames(requestId) {
  const safeRequestId = sanitizeMessageRequestId(requestId);
  return {
    accepted: `${safeRequestId}.accepted.json`,
    rejected: `${safeRequestId}.rejected.json`,
  };
}

export function sanitizeMessageRequestId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function generateChildSessionMessageRequestId(
  targetId,
  now = new Date(),
  randomSuffix = Math.random().toString(36).slice(2, 8),
) {
  const timestamp = now.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const base = sanitizeMessageRequestId(targetId) || "child";
  const suffix = sanitizeMessageRequestId(randomSuffix) || "request";
  return sanitizeMessageRequestId(`message-${base}-${timestamp}-${suffix}`);
}

export function buildChildSessionMessageDelivery({ parentTask, request, tasks, formatInput }) {
  if (!parentTask) {
    return { ok: false, error: `parentTaskId "${request.parentTaskId}" does not match an existing task.` };
  }
  if (parentTask.spawnedFromParentRequest) {
    return { ok: false, error: "parentTaskId must identify a parent task, not a child task." };
  }

  const targetResult = resolveChildSessionMessageTargetForParent({
    parentTaskId: request.parentTaskId,
    target: request.target,
    tasks,
  });
  if (!targetResult.ok) {
    return targetResult;
  }

  const childTask = targetResult.childTask;
  if (childTask.status !== "running") {
    return { ok: false, error: `target child session "${childTask.title || childTask.id}" is not running.` };
  }
  if (childTask.terminalInputLockedAt) {
    return { ok: false, error: `target child session "${childTask.title || childTask.id}" has terminal input locked.` };
  }

  return {
    ok: true,
    childTask,
    data: formatInput(parentTask, request.message),
  };
}

export function resolveChildSessionMessageTargetForParent({ parentTaskId, target, tasks }) {
  const normalizedParentTaskId = String(parentTaskId || "").trim();
  const targetChildSessionId = String(target?.childSessionId || "").trim();
  const targetWorkPackageId = String(target?.workPackageId || "").trim();
  const taskList = Array.isArray(tasks) ? tasks : Array.from(tasks?.values?.() || []);

  if (targetChildSessionId) {
    const childTask = taskList.find((task) => task.id === targetChildSessionId) ?? null;
    if (!childTask || !isChildTaskFromParent(childTask, normalizedParentTaskId)) {
      return { ok: false, error: `No child session matched childSessionId ${targetChildSessionId} for this parent.` };
    }
    if (targetWorkPackageId && childTask.workPackageId !== targetWorkPackageId) {
      return {
        ok: false,
        error: `childSessionId ${targetChildSessionId} does not match workPackageId ${targetWorkPackageId}.`,
      };
    }
    return { ok: true, childTask };
  }

  if (!targetWorkPackageId) {
    return { ok: false, error: "Target must include childSessionId or workPackageId." };
  }

  const matchingChildren = taskList.filter(
    (task) => isChildTaskFromParent(task, normalizedParentTaskId) && task.workPackageId === targetWorkPackageId,
  );
  if (matchingChildren.length === 0) {
    return { ok: false, error: `No child matched workPackageId ${targetWorkPackageId} for this parent.` };
  }
  if (matchingChildren.length > 1) {
    return { ok: false, error: `Multiple children matched workPackageId ${targetWorkPackageId} for this parent.` };
  }

  return { ok: true, childTask: matchingChildren[0] };
}

function validateTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return { ok: false, error: "target must be an object." };
  }

  const childSessionId = typeof target.childSessionId === "string" ? target.childSessionId.trim() : "";
  const workPackageId = typeof target.workPackageId === "string" ? target.workPackageId.trim() : "";

  if (target.childSessionId !== undefined && !childSessionId) {
    return { ok: false, error: "target.childSessionId must be a non-empty string when provided." };
  }
  if (target.workPackageId !== undefined && !workPackageId) {
    return { ok: false, error: "target.workPackageId must be a non-empty string when provided." };
  }
  if (!childSessionId && !workPackageId) {
    return { ok: false, error: "target must include childSessionId or workPackageId." };
  }

  return {
    ok: true,
    target: {
      ...(childSessionId ? { childSessionId } : {}),
      ...(workPackageId ? { workPackageId } : {}),
    },
  };
}

function isChildTaskFromParent(task, parentTaskId) {
  return Boolean(task?.spawnedFromParentRequest && task.parentSessionId === parentTaskId);
}

function normalizeTargetDraft(target) {
  const childSessionId = String(target?.childSessionId || "").trim();
  const workPackageId = String(target?.workPackageId || "").trim();
  return {
    ...(childSessionId ? { childSessionId } : {}),
    ...(workPackageId ? { workPackageId } : {}),
  };
}

function findForbiddenFieldPath(value, path = "$") {
  if (!value || typeof value !== "object") {
    return "";
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findForbiddenFieldPath(item, `${path}[${index}]`);
      if (found) return found;
    }
    return "";
  }

  for (const [key, childValue] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (forbiddenFields.has(key)) {
      return childPath;
    }
    const found = findForbiddenFieldPath(childValue, childPath);
    if (found) return found;
  }
  return "";
}
