import type { ProjectSuggestion, Task, TaskDeckContext } from "./types";
import { isNativeSubagentTask } from "./composer";

type TaskListSelectionTask = Pick<Task, "id" | "status"> &
  Partial<Pick<Task, "agentProfileId" | "agentSessionSource" | "command" | "inputLockedAt" | "sessionMode">>;

export function sortTasksForDisplay(tasks: Task[]) {
  return [...tasks].sort((left, right) => {
    const leftOrder = normalizedTaskOrderIndex(left.taskOrderIndex);
    const rightOrder = normalizedTaskOrderIndex(right.taskOrderIndex);
    if (leftOrder !== null || rightOrder !== null) {
      if (leftOrder === null) return 1;
      if (rightOrder === null) return -1;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    }

    const leftNeedsYou = supervisionBucket(left) === "needs_you";
    const rightNeedsYou = supervisionBucket(right) === "needs_you";
    if (leftNeedsYou !== rightNeedsYou) {
      return leftNeedsYou ? -1 : 1;
    }
    return timestampForSort(right.updatedAt) - timestampForSort(left.updatedAt);
  });
}

export function supervisionBucket(task: Task) {
  if (task.status !== "running") return "not_now";
  if (task.agentState === "ready") return "needs_you";
  return task.attentionState === "none" || !task.attentionState ? "not_now" : "needs_you";
}

export function selectTaskIdForTaskList<T extends TaskListSelectionTask>(
  currentTaskId: string | null,
  tasks: T[],
  runningTaskIds: string[],
) {
  if (currentTaskId && tasks.some((task) => task.id === currentTaskId)) {
    return currentTaskId;
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  for (const taskId of runningTaskIds) {
    const task = taskById.get(taskId);
    if (task && !isNativeSubagentTask(task)) {
      return taskId;
    }
  }

  return (
    tasks.find((task) => task.status === "running" && !task.inputLockedAt && !isNativeSubagentTask(task))?.id ??
    tasks.find((task) => !isNativeSubagentTask(task))?.id ??
    tasks[0]?.id ??
    null
  );
}

export function taskDisplayName(task: Task) {
  return displayTaskTitle(task.sessionLabel || task.title);
}

export function workspaceLabel(cwd: string) {
  const trimmed = cwd.replace(/[\\/]+$/, "");
  const basename = trimmed.split(/[\\/]/).filter(Boolean).pop();
  return basename || "Repository root";
}

export function taskStateLabel(task: Task) {
  if (task.status !== "running") {
    return readableLabel(task.status);
  }
  const attentionState = task.attentionState || "none";
  if (attentionState !== "none") {
    return readableLabel(attentionState);
  }
  return readableLabel(task.agentState);
}

export function buildProjectSuggestions(context: TaskDeckContext | null): ProjectSuggestion[] {
  const suggestions = context?.projectSuggestions?.length
    ? context.projectSuggestions
    : context?.defaultCwd
      ? [{ label: workspaceLabel(context.defaultCwd), path: context.defaultCwd, isGitRepo: context.isGitRepo }]
      : [];
  const seenPaths = new Set<string>();
  return suggestions.filter((suggestion) => {
    if (!suggestion.path || seenPaths.has(suggestion.path)) {
      return false;
    }
    seenPaths.add(suggestion.path);
    return true;
  });
}

export function selectDefaultProjectPath(projectSuggestions: ProjectSuggestion[], defaultCwd?: string) {
  return (
    projectSuggestions.find((project) => project.path === defaultCwd)?.path ??
    projectSuggestions.find((project) => project.label === "task-deck")?.path ??
    projectSuggestions[0]?.path ??
    ""
  );
}

export function buildTaskTitle(agentLabel: string, cwd: string) {
  return workspaceLabel(cwd) || `${agentLabel} session`;
}

export function supervisionTitle(task: Task) {
  if (supervisionBucket(task) === "needs_you") {
    if (task.agentState === "ready" && (task.attentionState || "none") === "none") {
      return task.agentStateReason || "This task is ready for input.";
    }
    return task.attentionStateReason || "This running task may need human attention.";
  }
  return task.status === "running" ? "Task is running." : "Task is not running.";
}

function displayTaskTitle(title: string | undefined) {
  return String(title || "").trim().replace(/^(?:Resume saved:\s*)+/i, "") || "Untitled task";
}

function normalizedTaskOrderIndex(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function timestampForSort(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function readableLabel(value: string) {
  return value.replace(/_/g, " ");
}
