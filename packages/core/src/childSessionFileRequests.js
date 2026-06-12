export const CHILD_SESSION_FILE_REQUEST_KIND = "childSessionRequest";
export const CHILD_SESSION_FILE_RESULT_KIND = "childSessionRequestResult";
export const CHILD_SESSION_FILE_VERSION = 1;

const forbiddenFields = new Set(["command", "rawCommand", "shell", "env", "secrets", "autoApprove"]);
const permissionLevels = new Set(["full_access", "workspace_write", "read_only"]);
const reasoningEfforts = new Set(["low", "medium", "high", "xhigh"]);

export function createChildSessionFileRequestDraft({
  requestId,
  parentTaskId = "",
  reason = "Create a child session using the file-based TaskDeck request writer.",
  title,
  agentProfileId = "codex",
  agentPermissionLevel = "full_access",
  agentReasoningEffort = "low",
  cwd = ".",
  workPackageId,
  filesLikelyToChange = [],
  initialInstruction,
  createdAt = new Date().toISOString(),
}) {
  return {
    kind: CHILD_SESSION_FILE_REQUEST_KIND,
    version: CHILD_SESSION_FILE_VERSION,
    requestId,
    createdAt,
    ...(parentTaskId ? { parentTaskId } : {}),
    reason,
    sessions: [
      {
        title,
        agentProfileId,
        agentPermissionLevel,
        agentReasoningEffort,
        cwd,
        workPackageId,
        filesLikelyToChange,
        initialInstruction,
      },
    ],
  };
}

export function validateChildSessionFileRequest(value) {
  const forbiddenPath = findForbiddenFieldPath(value);
  if (forbiddenPath) {
    return { ok: false, error: `Forbidden field in child session request file: ${forbiddenPath}` };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Request file must contain a JSON object." };
  }
  if (value.kind !== CHILD_SESSION_FILE_REQUEST_KIND) {
    return { ok: false, error: `Request kind must be ${CHILD_SESSION_FILE_REQUEST_KIND}.` };
  }
  if (value.version !== CHILD_SESSION_FILE_VERSION) {
    return { ok: false, error: `Request version must be ${CHILD_SESSION_FILE_VERSION}.` };
  }

  const requestId = String(value.requestId || "").trim();
  if (!requestId) {
    return { ok: false, error: "requestId is required." };
  }

  const parentTaskId = String(value.parentTaskId || "").trim();
  if (!parentTaskId) {
    return { ok: false, error: "parentTaskId is required." };
  }

  const reason = value.reason === undefined ? "" : String(value.reason || "").trim();
  const sessions = Array.isArray(value.sessions) ? value.sessions : null;
  if (!sessions) {
    return { ok: false, error: "sessions must be an array." };
  }
  if (sessions.length === 0) {
    return { ok: false, error: "sessions must not be empty." };
  }

  const normalizedSessions = [];
  for (const [index, session] of sessions.entries()) {
    const normalized = validateChildSessionFileRequestSession(session, index);
    if (!normalized.ok) {
      return normalized;
    }
    normalizedSessions.push(normalized.session);
  }

  return {
    ok: true,
    request: {
      kind: CHILD_SESSION_FILE_REQUEST_KIND,
      version: CHILD_SESSION_FILE_VERSION,
      requestId,
      parentTaskId,
      ...(reason ? { reason } : {}),
      createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
      sessions: normalizedSessions,
    },
  };
}

export function createChildSessionRequestResult({ requestId, state, createdTaskIds = [], error = "", processedAt = new Date().toISOString() }) {
  return {
    kind: CHILD_SESSION_FILE_RESULT_KIND,
    version: CHILD_SESSION_FILE_VERSION,
    requestId,
    state,
    ...(state === "accepted" ? { createdTaskIds } : { error }),
    processedAt,
  };
}

export function childSessionFileRequestResultFilenames(requestId) {
  const safeRequestId = sanitizeRequestId(requestId);
  return {
    accepted: `${safeRequestId}.accepted.json`,
    rejected: `${safeRequestId}.rejected.json`,
  };
}

export function sanitizeRequestId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function generateChildSessionRequestId(workPackageId, now = new Date(), randomSuffix = Math.random().toString(36).slice(2, 8)) {
  const timestamp = now.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const base = sanitizeRequestId(workPackageId) || "child-session";
  const suffix = sanitizeRequestId(randomSuffix) || "request";
  return sanitizeRequestId(`${base}-${timestamp}-${suffix}`);
}

function validateChildSessionFileRequestSession(session, index) {
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    return { ok: false, error: `sessions[${index}] must be an object.` };
  }

  const title = String(session.title || "").trim();
  const agentProfileId = String(session.agentProfileId || "").trim();
  const agentPermissionLevel = String(session.agentPermissionLevel || "").trim();
  const agentReasoningEffort = String(session.agentReasoningEffort || "").trim();
  const cwd = String(session.cwd || "").trim();
  const workPackageId = String(session.workPackageId || "").trim();
  const initialInstruction = String(session.initialInstruction || "");

  if (!title) return { ok: false, error: `sessions[${index}].title is required.` };
  if (!agentProfileId) return { ok: false, error: `sessions[${index}].agentProfileId is required.` };
  if (agentPermissionLevel && !permissionLevels.has(agentPermissionLevel)) {
    return { ok: false, error: `sessions[${index}].agentPermissionLevel is invalid.` };
  }
  if (agentReasoningEffort && !reasoningEfforts.has(agentReasoningEffort)) {
    return { ok: false, error: `sessions[${index}].agentReasoningEffort is invalid.` };
  }
  if (!cwd) return { ok: false, error: `sessions[${index}].cwd is required.` };
  if (!workPackageId) return { ok: false, error: `sessions[${index}].workPackageId is required.` };
  if (!initialInstruction.trim()) return { ok: false, error: `sessions[${index}].initialInstruction is required.` };

  const filesLikelyToChange = normalizeStringArray(session.filesLikelyToChange);
  if (session.filesLikelyToChange !== undefined && !Array.isArray(session.filesLikelyToChange)) {
    return { ok: false, error: `sessions[${index}].filesLikelyToChange must be an array of strings.` };
  }

  return {
    ok: true,
    session: {
      title,
      agentProfileId,
      ...(agentPermissionLevel ? { agentPermissionLevel } : {}),
      ...(agentReasoningEffort ? { agentReasoningEffort } : {}),
      cwd,
      workPackageId,
      filesLikelyToChange,
      initialInstruction,
    },
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry || "").trim()).filter(Boolean);
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
