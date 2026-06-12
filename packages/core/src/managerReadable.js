export const MANAGER_READABLE_DIRNAME = "manager-readable";
export const MANAGER_READABLE_CONTEXT_FILENAME = "context.md";
export const MANAGER_READABLE_UNREAD_EVENTS_FILENAME = "unread-events.json";
export const MANAGER_READABLE_ACTIONS_FILENAME = "actions.md";
export const MANAGER_READABLE_CAPABILITIES_FILENAME = "capabilities.json";
export const MANAGER_READABLE_EVENTS_KIND = "taskDeckManagerReadableEvents";
export const MANAGER_READABLE_CAPABILITIES_KIND = "taskDeckManagerCapabilities";
export const MANAGER_READABLE_VERSION = 1;

const managerReadableInstructions = [
  "Read the manager inbox and generated readable context before judging.",
  "Read the generated manager action guide before taking action.",
  "Report your judgment in this terminal response only.",
  "Do not write TASKDECK_STATUS_FILE.",
  "Do not command worker sessions directly.",
  "Use only taskdeckctl commands listed in the generated manager action guide.",
  "Do not invent taskdeckctl subcommands from memory or future-looking design docs.",
  "Do not mutate TaskDeck state directly.",
];

const supportedManagerActions = [
  {
    action: "ack",
    command: "taskdeckctl ack --event <eventId>",
    description: "Acknowledge a manager inbox event after it has been handled.",
    required: ["eventId"],
  },
  {
    action: "ack",
    command: "taskdeckctl ack --task <taskId>",
    description: "Acknowledge a task's attention state after it has been handled.",
    required: ["taskId"],
  },
  {
    action: "review",
    command: "taskdeckctl review --task <taskId>",
    description: "Mark a review-ready task as reviewed.",
    required: ["taskId"],
  },
  {
    action: "close",
    command: "taskdeckctl close --task <taskId>",
    description: "Close a task and stop its active process when closing is clearly intended.",
    required: ["taskId"],
  },
];

export function managerReadableFilenames() {
  return {
    context: MANAGER_READABLE_CONTEXT_FILENAME,
    unreadEvents: MANAGER_READABLE_UNREAD_EVENTS_FILENAME,
    actions: MANAGER_READABLE_ACTIONS_FILENAME,
    capabilities: MANAGER_READABLE_CAPABILITIES_FILENAME,
  };
}

export function createManagerActionCapabilitiesDocument({
  generatedAt = new Date().toISOString(),
  actions = supportedManagerActions,
} = {}) {
  return {
    kind: MANAGER_READABLE_CAPABILITIES_KIND,
    version: MANAGER_READABLE_VERSION,
    generatedAt,
    instructions: [...managerReadableInstructions],
    actions: actions.map((action) => ({
      action: String(action.action || ""),
      command: String(action.command || ""),
      description: String(action.description || ""),
      required: normalizeStringArray(action.required),
    })),
  };
}

export function buildManagerActionGuide({
  generatedAt = new Date().toISOString(),
  actions = supportedManagerActions,
  paths = {},
  events = [],
} = {}) {
  const capabilities = createManagerActionCapabilitiesDocument({ generatedAt, actions });
  const normalizedEvents = normalizeEventList(events);
  const lines = [
    "# TaskDeck Manager Actions",
    "",
    `Generated: ${capabilities.generatedAt}`,
    "",
    "This file is the execution-time action guide for the running TaskDeck instance.",
    "Use only commands listed here. Do not infer commands from static docs or future design notes.",
    "",
    "## Files",
  ];

  if (paths.actionsFile) lines.push(`- Actions guide: ${paths.actionsFile}`);
  if (paths.capabilitiesFile) lines.push(`- Capabilities JSON: ${paths.capabilitiesFile}`);
  if (paths.contextFile) lines.push(`- Context: ${paths.contextFile}`);
  if (paths.unreadEventsFile) lines.push(`- Unread events JSON: ${paths.unreadEventsFile}`);

  lines.push("", "## Supported Commands");
  for (const action of capabilities.actions) {
    lines.push("", `### ${action.command}`);
    lines.push(action.description || "No description.");
    if (action.required.length > 0) {
      lines.push(`Required: ${action.required.join(", ")}`);
    }
  }

  lines.push("", "## Unsupported Commands");
  lines.push("- Manager-to-worker messaging is unavailable unless it appears in this guide.");
  lines.push("- Do not call raw TaskDeck endpoints.");
  lines.push("- Do not command worker sessions directly.");

  lines.push("", `## Suggested Actions For Unread Events (${normalizedEvents.length})`);
  if (normalizedEvents.length === 0) {
    lines.push("", "No unread manager events.");
    return `${lines.join("\n")}\n`;
  }

  for (const event of normalizedEvents) {
    const suggestedActions = suggestedManagerActionsForEvent(event);
    lines.push("", `### ${event.eventId || "unknown-event"}`);
    lines.push(`- State: ${event.state || "(unknown)"}`);
    if (event.summary) lines.push(`- Summary: ${event.summary}`);
    if (event.childTaskId) lines.push(`- Child task id: ${event.childTaskId}`);
    if (event.parentTaskId) lines.push(`- Parent task id: ${event.parentTaskId}`);
    if (suggestedActions.length === 0) {
      lines.push("- No suggested action.");
      continue;
    }
    lines.push("- Suggested commands:");
    for (const command of suggestedActions) {
      lines.push(`  - ${command}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function createManagerReadableEventsDocument({
  events = [],
  tasks = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const taskList = normalizeTaskList(tasks);
  const taskById = new Map(taskList.map((task) => [task.id, task]));
  const capabilities = createManagerActionCapabilitiesDocument({ generatedAt });

  return {
    kind: MANAGER_READABLE_EVENTS_KIND,
    version: MANAGER_READABLE_VERSION,
    generatedAt,
    instructions: [...managerReadableInstructions],
    supportedActions: capabilities.actions,
    events: normalizeEventList(events).map((event) => ({
      ...event,
      childTask: taskSummary(taskById.get(event.childTaskId)),
      parentTask: taskSummary(taskById.get(event.parentTaskId)),
      suggestedActions: suggestedManagerActionsForEvent(event),
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
  if (paths.managerActionsDir) lines.push(`- Manager action logs: ${paths.managerActionsDir}`);
  if (paths.managerActionHistoryFile) lines.push(`- Manager action history: ${paths.managerActionHistoryFile}`);
  if (paths.contextFile) lines.push(`- Context: ${paths.contextFile}`);
  if (paths.unreadEventsFile) lines.push(`- Unread events JSON: ${paths.unreadEventsFile}`);
  if (paths.actionsFile) lines.push(`- Manager actions guide: ${paths.actionsFile}`);
  if (paths.capabilitiesFile) lines.push(`- Manager capabilities JSON: ${paths.capabilitiesFile}`);
  lines.push("- Judgment output: this terminal response only");

  lines.push("", "## Supported Manager Actions");
  lines.push("Use only these currently supported commands:");
  for (const action of document.supportedActions) {
    lines.push(`- ${action.command} — ${action.description}`);
  }
  lines.push("- If a command is not listed here or in the generated action guide, treat it as unavailable.");

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
    if (event.suggestedActions.length > 0) {
      lines.push("- Suggested actions:");
      for (const command of event.suggestedActions) {
        lines.push(`  - ${command}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function suggestedManagerActionsForEvent(event) {
  const eventId = String(event?.eventId || "").trim();
  const childTaskId = String(event?.childTaskId || "").trim();
  const state = String(event?.state || "").trim();
  const actions = [];

  if (eventId) {
    actions.push(`taskdeckctl ack --event ${eventId}`);
  }
  if (childTaskId) {
    actions.push(`taskdeckctl ack --task ${childTaskId}`);
  }
  if (childTaskId && state === "ready_for_review") {
    actions.push(`taskdeckctl review --task ${childTaskId}`);
  }
  if (childTaskId && state === "failed") {
    actions.push(`taskdeckctl close --task ${childTaskId}`);
  }

  return actions;
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
    reviewedAt: String(task.reviewedAt || ""),
    closedAt: String(task.closedAt || ""),
    isManager: task.isManager === true,
  };
}

function formatTaskSummary(task) {
  const title = task.title || task.id;
  const state = [task.status, task.agentState].filter(Boolean).join("/");
  const parts = [`${title} (${task.id})`];
  if (state) parts.push(state);
  if (task.attentionState) parts.push(`attention=${task.attentionState}`);
  if (task.reviewedAt) parts.push(`reviewed=${task.reviewedAt}`);
  if (task.closedAt) parts.push(`closed=${task.closedAt}`);
  return parts.join(" - ");
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item || "").trim()).filter(Boolean);
}
