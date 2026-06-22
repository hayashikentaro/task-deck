import { FormEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { taskIdentityCssProperties } from "../taskIdentity";
import type { AttentionState, Task } from "../types";

type TaskFilter = "all" | "needs_you" | "not_now";

type TaskListProps = {
  decisionGatewayConfigured: boolean;
  tasks: Task[];
  selectedTaskId: string | null;
  runningTaskIds: string[];
  onClearTask: (taskId: string) => void;
  onClearTasks: () => void | Promise<void>;
  onRenameTask: (taskId: string, title: string) => Promise<boolean>;
  onSendDecisionRequest: (
    taskId: string,
  ) => Promise<{ ok: true; decisionUrl: string; decisionId: string; requestId: string } | { ok: false; error: string }>;
  onSelectTask: (taskId: string) => void;
  onToggleInputLock: (taskId: string, locked: boolean) => void | Promise<boolean>;
};

export function TaskList({
  decisionGatewayConfigured,
  tasks,
  selectedTaskId,
  runningTaskIds,
  onClearTask,
  onClearTasks,
  onRenameTask,
  onSendDecisionRequest,
  onSelectTask,
  onToggleInputLock,
}: TaskListProps) {
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [isClearAllConfirmOpen, setIsClearAllConfirmOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [decisionRequestByTaskId, setDecisionRequestByTaskId] = useState<
    Record<string, { status: "sending" | "sent" | "failed"; decisionUrl?: string; error?: string }>
  >({});
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const previousRectsRef = useRef(new Map<string, DOMRect>());
  const reorderAnimationFrameRef = useRef<number | null>(null);
  const runningTaskIdSet = useMemo(() => new Set(runningTaskIds), [runningTaskIds]);
  const visibleTasks = useMemo(() => sortTasksBySupervision(tasks.filter((task) => matchesFilter(task, filter))), [filter, tasks]);
  const visibleTaskOrderKey = visibleTasks.map((task) => task.id).join("|");

  useLayoutEffect(() => {
    if (reorderAnimationFrameRef.current !== null) {
      cancelAnimationFrame(reorderAnimationFrameRef.current);
      reorderAnimationFrameRef.current = null;
    }

    const nextRects = new Map<string, DOMRect>();
    itemRefs.current.forEach((element, taskId) => {
      nextRects.set(taskId, element.getBoundingClientRect());
    });

    const movedElements: HTMLElement[] = [];
    if (previousRectsRef.current.size > 0 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      itemRefs.current.forEach((element, taskId) => {
        const previousRect = previousRectsRef.current.get(taskId);
        const nextRect = nextRects.get(taskId);
        if (!previousRect || !nextRect) {
          return;
        }
        const deltaY = previousRect.top - nextRect.top;
        if (Math.abs(deltaY) < 1) {
          return;
        }
        element.style.transition = "none";
        element.style.transform = `translateY(${deltaY}px)`;
        movedElements.push(element);
      });

      if (movedElements.length > 0) {
        reorderAnimationFrameRef.current = requestAnimationFrame(() => {
          movedElements.forEach((element) => {
            element.style.transition = "";
            element.style.transform = "";
          });
          reorderAnimationFrameRef.current = null;
        });
      }
    }

    previousRectsRef.current = nextRects;

    return () => {
      if (reorderAnimationFrameRef.current !== null) {
        cancelAnimationFrame(reorderAnimationFrameRef.current);
        reorderAnimationFrameRef.current = null;
      }
      movedElements.forEach((element) => {
        element.style.transition = "";
        element.style.transform = "";
      });
    };
  }, [visibleTaskOrderKey]);

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

  const sendTaskToDecisionGateway = async (task: Task) => {
    setDecisionRequestByTaskId((current) => ({
      ...current,
      [task.id]: { status: "sending" },
    }));
    const result = await onSendDecisionRequest(task.id);
    setDecisionRequestByTaskId((current) => ({
      ...current,
      [task.id]: result.ok
        ? { status: "sent", decisionUrl: result.decisionUrl }
        : { status: "failed", error: result.error },
    }));
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
            <p>This will stop running App Server sessions and remove all task records and logs from TaskDeck.</p>
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
          const stateBadge = taskStateBadge(task);
          const isEditingTitle = editingTaskId === task.id;
          const isInputLocked = Boolean(task.inputLockedAt);
          const isNativeSubagent = isNativeSubagentTask(task);
          const decisionRequestState = decisionRequestByTaskId[task.id] ?? null;
          const inputLockLabel = isNativeSubagent
            ? "Native subagent input is read-only"
            : isInputLocked
              ? "Unlock input"
              : "Lock input";
          const lineageBadge = taskLineageBadge(task);
          return (
            <article
              className="task-list-item"
              data-selected={isSelected}
              data-tone={taskTone(task, runningTaskIdSet)}
              key={task.id}
              ref={(element) => {
                if (element) {
                  itemRefs.current.set(task.id, element);
                } else {
                  itemRefs.current.delete(task.id);
                }
              }}
              style={taskIdentityCssProperties({ taskId: task.id, identityColorSlot: task.identityColorSlot })}
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
                    <span className="task-badge" data-kind="agent-profile" title={agentBadgeTitle(task)}>
                      {agentBadgeLabel(task)}
                    </span>
                    <span className="task-badge" data-kind={stateBadge.kind} title={stateBadge.title}>
                      {stateBadge.label}
                    </span>
                    <span className="task-badge" data-kind={`supervision-${bucket}`} title={supervisionTitle(task)}>
                      {supervisionBucketLabel(bucket)}
                    </span>
                    {task.isManager ? (
                      <span className="task-badge" data-kind="manager-session" title="TaskDeck manager session">
                        Manager
                      </span>
                    ) : null}
                    {lineageBadge ? (
                      <span className="task-badge" data-kind={lineageBadge.kind} title={lineageBadge.title}>
                        {lineageBadge.label}
                      </span>
                    ) : null}
                    {task.childReportedState ? (
                      <span
                        className="task-badge"
                        data-kind={`child-status-${task.childReportedState}`}
                        title={childReportedStatusTitle(task)}
                      >
                        {childReportedStatusLabel(task.childReportedState)}
                      </span>
                    ) : null}
                    {task.childStatusError ? (
                      <span className="task-badge" data-kind="child-status-error" title={task.childStatusError}>
                        Status error
                      </span>
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
                <button
                  className="task-decision-gateway-button"
                  disabled={!decisionGatewayConfigured || decisionRequestState?.status === "sending"}
                  onClick={() => sendTaskToDecisionGateway(task)}
                  title={
                    decisionGatewayConfigured
                      ? "Send a manual decision request to Decision Gateway"
                      : "Set DECISION_GATEWAY_URL to enable Decision Gateway"
                  }
                  type="button"
                >
                  {decisionRequestState?.status === "sending" ? "Sending..." : "Ask for decision"}
                </button>
                <button aria-label="Clear task" className="task-clear-button" onClick={() => onClearTask(task.id)} title="Clear task" type="button">
                  <svg aria-hidden="true" className="task-clear-icon" focusable="false" viewBox="0 0 16 16">
                    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                  </svg>
                </button>
              </div>
              <button
                aria-label={inputLockLabel}
                aria-pressed={isInputLocked}
                className="task-input-lock-button"
                data-active={isInputLocked ? "true" : "false"}
                disabled={task.status !== "running" || isNativeSubagent}
                onClick={() => onToggleInputLock(task.id, !isInputLocked)}
                title={inputLockLabel}
                type="button"
              >
                {isInputLocked ? (
                  <svg aria-hidden="true" className="task-input-lock-icon" focusable="false" viewBox="0 0 16 16">
                    <path d="M5 7V5.5a3 3 0 0 1 6 0V7" />
                    <path d="M4.5 7.5h7v6h-7z" />
                    <path d="M8 10v1.5" />
                  </svg>
                ) : (
                  <svg aria-hidden="true" className="task-input-lock-icon" focusable="false" viewBox="0 0 16 16">
                    <path d="M5 7V5.5a3 3 0 0 1 5.6-1.5" />
                    <path d="M4.5 7.5h7v6h-7z" />
                    <path d="M8 10v1.5" />
                  </svg>
                )}
              </button>
              {decisionRequestState?.status === "sent" && decisionRequestState.decisionUrl ? (
                <p className="task-action-status" data-kind="success">
                  Decision request sent:{" "}
                  <a href={decisionRequestState.decisionUrl} rel="noreferrer" target="_blank">
                    Open workspace
                  </a>
                </p>
              ) : null}
              {decisionRequestState?.status === "failed" ? (
                <p className="task-action-error">{decisionRequestState.error || "Unable to send decision request."}</p>
              ) : null}
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

function taskStateBadge(task: Task) {
  const nextAttentionState = attentionState(task);
  if (task.status === "running" && nextAttentionState !== "none") {
    const label = readableStateLabel(nextAttentionState);
    return {
      kind: `attention-${nextAttentionState}`,
      label,
      title: task.attentionStateReason ? `${label}: ${task.attentionStateReason}` : `Attention state: ${label}`,
    };
  }

  if (task.status !== "running") {
    const label = readableStateLabel(task.status);
    const exit = task.exitCode === null ? "" : ` exit ${task.exitCode}`;
    return {
      kind: `process-${task.status}`,
      label,
      title: `Process status: ${label}${exit}`,
    };
  }

  const label = readableStateLabel(task.agentState);
  return {
    kind: `agent-${task.agentState}`,
    label,
    title: task.agentStateReason ? `${label}: ${task.agentStateReason}` : `Agent state: ${label}`,
  };
}

function readableStateLabel(value: string) {
  return value.replace(/_/g, " ");
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
    task.agentState === "ready" ||
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
  return task.status === "running" ? "Task is running." : "Task is not running.";
}

function taskLineageBadge(task: Task) {
  if (task.agentSessionSource === "codex_app_server_native_subagent") {
    return {
      kind: "native-subagent",
      label: "Subagent",
      title: task.parentSessionId
        ? `Codex App Server native subagent from parent ${task.parentSessionId}`
        : "Codex App Server native subagent",
    };
  }
  if (task.parentSessionId) {
    return {
      kind: "linked-task",
      label: "Linked",
      title: task.parentSessionId ? `Linked task from parent ${task.parentSessionId}` : "Linked task",
    };
  }
  return null;
}

function isNativeSubagentTask(task: Task) {
  return task.agentSessionSource === "codex_app_server_native_subagent";
}

function childReportedStatusLabel(state: NonNullable<Task["childReportedState"]>) {
  return `Reported ${String(state).replace(/_/g, " ")}`;
}

function childReportedStatusTitle(task: Task) {
  const state = task.childReportedState ? String(task.childReportedState).replace(/_/g, " ") : "unknown";
  const summary = task.childStatusSummary ? `: ${task.childStatusSummary}` : "";
  return `Reported ${state}${summary}`;
}

function agentBadgeLabel(task: Task) {
  const profileId = String(task.agentProfileId || "").trim();
  if (profileId === "codex-app-server") return "App Server";
  if (profileId === "zsh-host") return "zsh host";
  return task.agentLabel || agentOrCommandLabel(task.command);
}

function agentBadgeTitle(task: Task) {
  const profileId = String(task.agentProfileId || "").trim();
  const label = task.agentLabel || agentOrCommandLabel(task.command);
  return profileId ? `${label} (${profileId})` : label;
}

function taskDisplayName(task: Task) {
  return displayTaskTitle(task.sessionLabel || task.title);
}

function displayTaskTitle(title: string | undefined) {
  return String(title || "").trim().replace(/^(?:Resume saved:\s*)+/i, "") || "Untitled task";
}

function agentOrCommandLabel(command: string) {
  const lowered = command.toLowerCase();
  if (/\bcodex\b/.test(lowered)) return "Codex";
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
