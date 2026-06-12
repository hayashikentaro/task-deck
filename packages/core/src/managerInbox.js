import { ChildReportedState } from "./index.js";

export const MANAGER_EVENT_KIND = "taskDeckManagerEvent";
export const MANAGER_EVENT_VERSION = 1;

export const ManagerEventType = Object.freeze({
  CHILD_STATUS_CHANGED: "childStatusChanged",
});

const managerEventTypes = new Set(Object.values(ManagerEventType));
const managerNotifiableChildStates = new Set([
  ChildReportedState.BLOCKED,
  ChildReportedState.READY_FOR_REVIEW,
  ChildReportedState.FAILED,
]);

export function createManagerChildStatusEvent({
  eventId,
  parentTaskId,
  childTaskId,
  workPackageId = "",
  state,
  summary = "",
  artifacts = [],
  detailsFile = "",
  createdAt = new Date().toISOString(),
}) {
  return {
    kind: MANAGER_EVENT_KIND,
    version: MANAGER_EVENT_VERSION,
    type: ManagerEventType.CHILD_STATUS_CHANGED,
    eventId: String(eventId || "").trim(),
    parentTaskId: String(parentTaskId || "").trim(),
    childTaskId: String(childTaskId || "").trim(),
    workPackageId: String(workPackageId || "").trim(),
    state,
    summary: String(summary || ""),
    artifacts: normalizeStringArray(artifacts),
    detailsFile: String(detailsFile || ""),
    createdAt,
  };
}

export function validateManagerEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Manager event must be a JSON object." };
  }
  if (value.kind !== MANAGER_EVENT_KIND) {
    return { ok: false, error: `Manager event kind must be ${MANAGER_EVENT_KIND}.` };
  }
  if (value.version !== MANAGER_EVENT_VERSION) {
    return { ok: false, error: `Manager event version must be ${MANAGER_EVENT_VERSION}.` };
  }
  if (!managerEventTypes.has(value.type)) {
    return { ok: false, error: "Manager event type is unsupported." };
  }

  const eventId = String(value.eventId || "").trim();
  if (!eventId) {
    return { ok: false, error: "eventId is required." };
  }
  if (sanitizeManagerEventId(eventId) !== eventId) {
    return { ok: false, error: "eventId contains unsupported characters." };
  }

  const parentTaskId = String(value.parentTaskId || "").trim();
  if (!parentTaskId) {
    return { ok: false, error: "parentTaskId is required." };
  }

  const childTaskId = String(value.childTaskId || "").trim();
  if (!childTaskId) {
    return { ok: false, error: "childTaskId is required." };
  }

  if (!isManagerNotifiableChildState(value.state)) {
    return { ok: false, error: "Manager child status event state must be blocked, ready_for_review, or failed." };
  }
  if (typeof value.summary !== "string") {
    return { ok: false, error: "summary must be a string." };
  }
  if (!isStringArray(value.artifacts)) {
    return { ok: false, error: "artifacts must be an array of strings." };
  }
  if (typeof value.detailsFile !== "string") {
    return { ok: false, error: "detailsFile must be a string." };
  }
  if (typeof value.createdAt !== "string" || !value.createdAt.trim()) {
    return { ok: false, error: "createdAt must be a non-empty string." };
  }

  return {
    ok: true,
    event: {
      kind: MANAGER_EVENT_KIND,
      version: MANAGER_EVENT_VERSION,
      type: value.type,
      eventId,
      parentTaskId,
      childTaskId,
      workPackageId: String(value.workPackageId || "").trim(),
      state: value.state,
      summary: value.summary,
      artifacts: normalizeStringArray(value.artifacts),
      detailsFile: value.detailsFile,
      createdAt: value.createdAt,
    },
  };
}

export function managerEventFilenames(eventId) {
  const safeEventId = sanitizeManagerEventId(eventId);
  return {
    event: `${safeEventId}.json`,
    temp: `${safeEventId}.json.tmp`,
    ack: `${safeEventId}.ack.json`,
  };
}

export function sanitizeManagerEventId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function generateManagerChildStatusEventId({
  parentTaskId = "",
  childTaskId = "",
  workPackageId = "",
  state = "",
  now = new Date(),
  randomSuffix = Math.random().toString(36).slice(2, 8),
} = {}) {
  const date = now instanceof Date ? now : new Date(now);
  const timestamp = Number.isNaN(date.valueOf())
    ? new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)
    : date.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const base = sanitizeManagerEventId(workPackageId) || sanitizeManagerEventId(childTaskId) || "child";
  const suffix = sanitizeManagerEventId(randomSuffix) || "event";
  return sanitizeManagerEventId(
    `child-status-${base}-${sanitizeManagerEventId(state)}-${timestamp}-${sanitizeManagerEventId(parentTaskId)}-${suffix}`,
  );
}

export function isManagerNotifiableChildState(state) {
  return managerNotifiableChildStates.has(state);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
