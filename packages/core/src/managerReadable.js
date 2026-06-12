export const MANAGER_READABLE_DIRNAME = "manager-readable";
export const MANAGER_READABLE_CONTEXT_FILENAME = "context.md";
export const MANAGER_READABLE_UNREAD_EVENTS_FILENAME = "unread-events.json";
export const MANAGER_READABLE_EVENTS_KIND = "taskDeckManagerReadableEvents";
export const MANAGER_READABLE_VERSION = 1;

const managerReadableInstructions = [
  "Read the manager inbox and generated readable context before judging.",
  "Report your judgment in this terminal response only.",
  "Do not write TASKDECK_STATUS_FILE.",
  "Do not command worker sessions directly.",
  "Do not call taskdeckctl for this MVP.",
  "Do not mutate TaskDeck state directly.",
];

export function managerReadableFilenames() {
  return {
    context: MANAGER_READABLE_CONTEXT_FILENAME,
    unreadEvents: MANAGER_READABLE_UNREAD_EVENTS_FILENAME,
  };
}

export function createManagerReadableEventsDocument({
  events = [],
  tasks = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const taskList = normalizeTaskList(tasks);
  const taskById = new Map(taskList.map((task) => [task.id, task]));

  return {
    kind: MANAGER_READABLE_EVENTS_KIND,
    version: MANAGER_READABLE_VERSION,
    generatedAt,
    instructions: [...managerReadableInstructions],
    events: normalizeEventList(events).map((event) => ({
      ...event,
      childTask: taskSummary(taskById.get(event.childTaskId)),
      parentTask: taskSummary(taskById.get(event.parentTaskId)),
    })),
  };
}

export function buildManagerReadableContext({
  events = [],
  tasks = [],
  generatedAt = new Date().toISOString(),
  paths = {},
} = {}) {
  const document = createManagerReadableEventsDocument({ events, tasks, generatedAt });
  const lines = [
    "# TaskDeck Manager Context",
    "",
    `Generated: ${document.generatedAt}`,
    "",
    "## Manager Rules",
  ];

  for (const instruction of document.instructions) {
    lines.push(`- ${instruction}`);
  }

  lines.push("", "## Files");
  if (paths.managerInboxDir) lines.push(`- Manager inbox: ${paths.managerInboxDir}`);
  if (paths.contextFile) lines.push(`- Context: ${paths.contextFile}`);
  if (paths.unreadEventsFile) lines.push(`- Unread events JSON: ${paths.unreadEventsFile}`);
  lines.push("- Judgment output: this terminal response only");

  lines.push("", `## Unread Manager Events (${document.events.length})`);
  if (document.events.length === 0) {
    lines.push("", "No unread manager events.");
    return `${lines.join("\n")}\n`;
  }

  for (const event of document.events) {
    lines.push("");
    lines.push(`### [${event.type}] ${event.state}`);
    lines.push(`- Event id: ${event.eventId}`);
    lines.push(`- Created at: ${event.createdAt}`);
    lines.push(`- Child task id: ${event.childTaskId}`);
    lines.push(`- Parent task id: ${event.parentTaskId}`);
    if (event.workPackageId) lines.push(`- Work package id: ${event.workPackageId}`);
    if (event.childTask) lines.push(`- Child task: ${formatTaskSummary(event.childTask)}`);
    if (event.parentTask) lines.push(`- Parent task: ${formatTaskSummary(event.parentTask)}`);
    lines.push(`- Child reported state: ${event.state}`);
    lines.push(`- Summary: ${event.summary || "(none)"}`);
    if (event.artifacts.length > 0) {
      lines.push("- Artifacts:");
      for (const artifact of event.artifacts) {
        lines.push(`  - ${artifact}`);
      }
    }
    if (event.detailsFile) lines.push(`- Details file: ${event.detailsFile}`);
  }

  return `${lines.join("\n")}\n`;
}

function normalizeEventList(events) {
  if (!Array.isArray(events)) {
    return [];
  }

  return events.map((event) => ({
    kind: String(event?.kind || ""),
    version: Number(event?.version),
    type: String(event?.type || ""),
    eventId: String(event?.eventId || ""),
    parentTaskId: String(event?.parentTaskId || ""),
    childTaskId: String(event?.childTaskId || ""),
    workPackageId: String(event?.workPackageId || ""),
    state: String(event?.state || ""),
    summary: String(event?.summary || ""),
    artifacts: normalizeStringArray(event?.artifacts),
    detailsFile: String(event?.detailsFile || ""),
    createdAt: String(event?.createdAt || ""),
  }));
}

function normalizeTaskList(tasks) {
  if (Array.isArray(tasks)) {
    return tasks;
  }
  if (tasks && typeof tasks.values === "function") {
    return Array.from(tasks.values());
  }
  return [];
}

function taskSummary(task) {
  if (!task) {
    return null;
  }

  return {
    id: String(task.id || ""),
    title: String(task.title || ""),
    status: String(task.status || ""),
    agentState: String(task.agentState || ""),
    attentionState: String(task.attentionState || ""),
    parentSessionId: String(task.parentSessionId || ""),
    workPackageId: String(task.workPackageId || ""),
    childReportedState: String(task.childReportedState || ""),
    childStatusSummary: String(task.childStatusSummary || ""),
    childStatusArtifacts: normalizeStringArray(task.childStatusArtifacts),
    childStatusDetailsFile: String(task.childStatusDetailsFile || ""),
    childStatusUpdatedAt: String(task.childStatusUpdatedAt || ""),
    isManager: task.isManager === true,
  };
}

function formatTaskSummary(task) {
  const title = task.title || task.id;
  const state = [task.status, task.agentState].filter(Boolean).join("/");
  const parts = [`${title} (${task.id})`];
  if (state) parts.push(state);
  if (task.attentionState) parts.push(`attention=${task.attentionState}`);
  return parts.join(" - ");
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item || "").trim()).filter(Boolean);
}
