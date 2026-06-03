import { FormEvent, useEffect, useMemo, useState } from "react";
import { taskIdentityCssPropertiesForVisibleTasks } from "../taskIdentity";
import type { AttentionState, Task } from "../types";

type TaskFilter = "all" | "needs_you" | "not_now";

type TaskListProps = {
  tasks: Task[];
  selectedTaskId: string | null;
  runningTaskIds: string[];
  onAcknowledgeTask: (taskId: string) => void | Promise<boolean>;
  onClearTask: (taskId: string) => void;
  onClearTasks: () => void | Promise<void>;
  onRenameTask: (taskId: string, title: string) => Promise<boolean>;
  onVisibleTaskIdsChange: (taskIds: string[]) => void;
  onSelectTask: (taskId: string) => void;
};

export function TaskList({
  tasks,
  selectedTaskId,
  runningTaskIds,
  onAcknowledgeTask,
  onClearTask,
  onClearTasks,
  onRenameTask,
  onVisibleTaskIdsChange,
  onSelectTask,
}: TaskListProps) {
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [isClearAllConfirmOpen, setIsClearAllConfirmOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const runningTaskIdSet = useMemo(() => new Set(runningTaskIds), [runningTaskIds]);
  const visibleTasks = useMemo(() => sortTasksBySupervision(tasks.filter((task) => matchesFilter(task, filter))), [filter, tasks]);
  const visibleTaskIds = useMemo(() => visibleTasks.map((task) => task.id), [visibleTasks]);
  const visibleTaskIdentityStyles = useMemo(() => taskIdentityCssPropertiesForVisibleTasks(visibleTaskIds), [visibleTaskIds]);

  useEffect(() => {
    onVisibleTaskIdsChange(visibleTaskIds);
  }, [onVisibleTaskIdsChange, visibleTaskIds]);

  const selectTask = (taskId: string) => {
    onSelectTask(taskId);
  };

  const confirmClearAll = async () => {
    await onClearTasks();
    setIsClearAllConfirmOpen(false);
  };

  const startEditingTitle = (task: Task) => {
    onSelectTask(task.id);
    setEditingTaskId(task.id);
    setEditingTitle(taskDisplayName(task));
  };

  const cancelEditingTitle = () => {
    setEditingTaskId(null);
    setEditingTitle("");
  };

  const submitTitleEdit = async (event: FormEvent, task: Task) => {
    event.preventDefault();
    const nextTitle = editingTitle.trim();
    if (!nextTitle || isRenaming) {
      return;
    }
    setIsRenaming(true);
    const didRename = await onRenameTask(task.id, nextTitle);
    setIsRenaming(false);
    if (didRename) {
      cancelEditingTitle();
    }
  };

  return (
    <aside className="task-list" aria-label="Tasks">
      <div className="task-list-toolbar">
        <div className="task-filters" aria-label="Task filters">
          {(["all", "needs_you", "not_now"] as TaskFilter[]).map((nextFilter) => (
            <button
              aria-pressed={filter === nextFilter}
              data-active={filter === nextFilter}
              key={nextFilter}
              onClick={() => setFilter(nextFilter)}
              type="button"
            >
              {filterLabel(nextFilter)}
            </button>
          ))}
        </div>
        <div className="task-management-actions">
          <span>{tasks.length}</span>
          <button disabled={tasks.length === 0} onClick={() => setIsClearAllConfirmOpen(true)} type="button">
            Clear
          </button>
        </div>
      </div>
      {isClearAllConfirmOpen ? (
        <div aria-labelledby="clear-all-title" aria-modal="true" className="modal-backdrop" role="dialog">
          <div className="confirmation-modal">
            <h3 id="clear-all-title">Clear all tasks?</h3>
            <p>This will stop running PTYs and remove all task records and logs from TaskDeck.</p>
            <div className="confirmation-actions">
              <button data-priority="secondary" onClick={() => setIsClearAllConfirmOpen(false)} type="button">
                Cancel
              </button>
              <button data-priority="danger" onClick={confirmClearAll} type="button">
                Clear
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="task-list-items">
        {tasks.length === 0 ? <p className="empty-state">No tasks yet.</p> : null}
        {tasks.length > 0 && visibleTasks.length === 0 ? (
          <p className="empty-state">No tasks match this filter.</p>
        ) : null}
        {visibleTasks.map((task) => {
          const isSelected = task.id === selectedTaskId;
          const bucket = supervisionBucket(task);
          const isEditingTitle = editingTaskId === task.id;
          return (
            <article
              className="task-list-item"
              data-selected={isSelected}
              data-tone={taskTone(task, runningTaskIdSet)}
              key={task.id}
              style={visibleTaskIdentityStyles.get(task.id)}
            >
              {isEditingTitle ? (
                <form className="task-title-edit-form" onSubmit={(event) => submitTitleEdit(event, task)}>
                  <input
                    aria-label="TaskDeck display name"
                    autoFocus
                    value={editingTitle}
                    onChange={(event) => setEditingTitle(event.target.value)}
                  />
                  <div className="task-title-edit-actions">
                    <button disabled={isRenaming || !editingTitle.trim()} type="submit">
                      Save
                    </button>
                    <button data-priority="secondary" disabled={isRenaming} onClick={cancelEditingTitle} type="button">
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div
                  className="task-select-button"
                  onClick={() => selectTask(task.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectTask(task.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span className="task-row-heading">
                    <span className="task-title">{taskDisplayName(task)}</span>
                  </span>
                  <span className="task-badge-row">
                    <span className="task-badge" data-kind={`supervision-${bucket}`} title={supervisionTitle(task)}>
                      {supervisionBucketLabel(bucket)}
                    </span>
                    {bucket === "needs_you" ? (
                      <button
                        aria-label="Acknowledge attention"
                        className="task-acknowledge-button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onAcknowledgeTask(task.id);
                        }}
                        title="Acknowledge attention"
                        type="button"
                      >
                        <svg aria-hidden="true" className="task-acknowledge-icon" focusable="false" viewBox="0 0 16 16">
                          <path d="M3.5 8.2l2.8 2.8 6.2-6.5" />
                        </svg>
                      </button>
                    ) : null}
                  </span>
                  <span className="task-card-meta">
                    <span className="task-cwd" title={task.cwd}>
                      {workspaceLabel(task.cwd)}
                    </span>
                    <span className="task-meta-separator">·</span>
                    <span className="task-command" title={task.command}>
                      {task.agentLabel || agentOrCommandLabel(task.command)}
                    </span>
                    <span className="task-meta-spacer" />
                    <span className="task-updated">{formatTime(task.updatedAt)}</span>
                  </span>
                </div>
              )}
              <div className="task-card-actions">
                <button
                  aria-label="Edit TaskDeck display name"
                  className="task-edit-title-button"
                  onClick={() => startEditingTitle(task)}
                  title="Edit TaskDeck display name"
                  type="button"
                >
                  <svg aria-hidden="true" className="task-edit-title-icon" focusable="false" viewBox="0 0 16 16">
                    <path d="M3.5 11.5l1 1 6.7-6.7-1-1L3.5 11.5z" />
                    <path d="M9.5 4.5l1-1 2 2-1 1" />
                  </svg>
                </button>
                <button aria-label="Clear task" className="task-clear-button" onClick={() => onClearTask(task.id)} title="Clear task" type="button">
                  <svg aria-hidden="true" className="task-clear-icon" focusable="false" viewBox="0 0 16 16">
                    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                  </svg>
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}

function matchesFilter(task: Task, filter: TaskFilter) {
  if (filter === "needs_you") {
    return supervisionBucket(task) === "needs_you";
  }
  if (filter === "not_now") {
    return task.status === "running" && supervisionBucket(task) === "not_now";
  }
  return true;
}

function sortTasksBySupervision(tasks: Task[]) {
  return [...tasks].sort((left, right) => {
    const leftNeedsYou = supervisionBucket(left) === "needs_you";
    const rightNeedsYou = supervisionBucket(right) === "needs_you";
    if (leftNeedsYou !== rightNeedsYou) {
      return leftNeedsYou ? -1 : 1;
    }
    return timestampForSort(right.updatedAt) - timestampForSort(left.updatedAt);
  });
}

function filterLabel(filter: TaskFilter) {
  if (filter === "needs_you") return "Needs you";
  if (filter === "not_now") return "Not now";
  return "All";
}

function taskTone(task: Task, runningTaskIds: Set<string>) {
  if (supervisionBucket(task) === "needs_you") {
    return "waiting_input";
  }

  const nextAttentionState = attentionState(task);
  if (nextAttentionState === "failed") {
    return "failed";
  }
  if (nextAttentionState === "may_need_user" || nextAttentionState === "needs_input") {
    return "waiting_input";
  }
  if (nextAttentionState === "needs_approval") {
    return "waiting_approval";
  }
  if (nextAttentionState === "review_ready") {
    return "review_ready";
  }
  if (
    runningTaskIds.has(task.id) ||
    task.agentState === "starting" ||
    task.agentState === "thinking" ||
    task.agentState === "working"
  ) {
    return task.agentState;
  }
  if (task.risk.level === "high" || task.risk.level === "medium") {
    return "risk";
  }
  if (task.agentState === "done") {
    return "done";
  }
  return "neutral";
}

function attentionState(task: Task): AttentionState {
  return task.attentionState || "none";
}

function supervisionBucket(task: Task) {
  if (task.status !== "running") return "not_now";
  return task.attentionState === "none" || !task.attentionState ? "not_now" : "needs_you";
}

function supervisionBucketLabel(bucket: ReturnType<typeof supervisionBucket>) {
  return bucket === "needs_you" ? "Needs you" : "Not now";
}

function supervisionTitle(task: Task) {
  if (supervisionBucket(task) === "needs_you") {
    return task.attentionStateReason || "This running task may need human attention.";
  }
  return task.status === "running" ? "Recent PTY activity observed." : "Task is not running.";
}

function taskDisplayName(task: Task) {
  return displayTaskTitle(task.sessionLabel || task.title);
}

function displayTaskTitle(title: string | undefined) {
  return String(title || "").trim().replace(/^(?:Resume saved:\s*)+/i, "") || "Untitled task";
}

function agentOrCommandLabel(command: string) {
  const lowered = command.toLowerCase();
  if (/\bcodex\b/.test(lowered)) return "Codex CLI";
  if (/\bgoose\b/.test(lowered)) return "Goose";
  if (/\baider\b/.test(lowered)) return "aider";
  return shortCommand(command);
}

function shortCommand(command: string) {
  return command.length > 54 ? `${command.slice(0, 51)}...` : command;
}

function workspaceLabel(cwd: string) {
  const trimmed = cwd.replace(/\/+$/, "");
  const basename = trimmed.split("/").filter(Boolean).pop();
  return basename || "Repository root";
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function timestampForSort(value: string | null | undefined) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}
