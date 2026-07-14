import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import { taskIdentityCssProperties } from "../taskIdentity";
import type { AttentionState, DecisionGatewayDecisionLease, DecisionGatewayMailboxItem, Task } from "../types";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import {
  isNativeSubagentTask,
  sortTasksForDisplay as sharedSortTasksForDisplay,
  supervisionBucket,
  supervisionTitle,
  taskDisplayName,
  workspaceLabel,
} from "@taskdeck/web-shared";

export const sortTasksForDisplay = sharedSortTasksForDisplay;

type TaskFilter = "all" | "needs_you" | "not_now";

type TaskListProps = {
  decisionGatewayConfigured: boolean;
  tasks: Task[];
  selectedTaskId: string | null;
  runningTaskIds: string[];
  onClearTask: (taskId: string) => void;
  onClearTasks: () => void | Promise<void>;
  onRenameTask: (taskId: string, title: string) => Promise<boolean>;
  onReorderTasks: (taskIds: string[]) => void | Promise<boolean>;
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
  onReorderTasks,
  onSendDecisionRequest,
  onSelectTask,
  onToggleInputLock,
}: TaskListProps) {
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [isClearAllConfirmOpen, setIsClearAllConfirmOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [isTaskClearTemporarilyDisabled, setIsTaskClearTemporarilyDisabled] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [isTaskReorderSaving, setIsTaskReorderSaving] = useState(false);
  const [decisionRequestByTaskId, setDecisionRequestByTaskId] = useState<
    Record<string, { status: "sending" | "sent" | "failed"; decisionUrl?: string; error?: string }>
  >({});
  const [copiedDecisionUrlTaskId, setCopiedDecisionUrlTaskId] = useState<string | null>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const previousRectsRef = useRef(new Map<string, DOMRect>());
  const reorderAnimationFrameRef = useRef<number | null>(null);
  const reorderClearGuardTimeoutRef = useRef<number | null>(null);
  const runningTaskIdSet = useMemo(() => new Set(runningTaskIds), [runningTaskIds]);
  const orderedTasks = useMemo(() => sortTasksForDisplay(tasks), [tasks]);
  const visibleTasks = useMemo(() => orderedTasks.filter((task) => matchesFilter(task, filter)), [filter, orderedTasks]);
  const visibleTaskOrderKey = visibleTasks.map((task) => task.id).join("|");
  const taskClearDisabled = isTaskClearTemporarilyDisabled || isTaskReorderSaving;

  useEffect(() => {
    return () => {
      if (reorderClearGuardTimeoutRef.current !== null) {
        window.clearTimeout(reorderClearGuardTimeoutRef.current);
        reorderClearGuardTimeoutRef.current = null;
      }
    };
  }, []);

  const startTaskClearGuard = () => {
    if (reorderClearGuardTimeoutRef.current !== null) {
      window.clearTimeout(reorderClearGuardTimeoutRef.current);
    }
    setIsTaskClearTemporarilyDisabled(true);
    reorderClearGuardTimeoutRef.current = window.setTimeout(() => {
      setIsTaskClearTemporarilyDisabled(false);
      reorderClearGuardTimeoutRef.current = null;
    }, 220);
  };

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
        startTaskClearGuard();
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
    setCopiedDecisionUrlTaskId((current) => (current === task.id ? null : current));
    const result = await onSendDecisionRequest(task.id);
    setDecisionRequestByTaskId((current) => ({
      ...current,
      [task.id]: result.ok
        ? { status: "sent", decisionUrl: result.decisionUrl }
        : { status: "failed", error: result.error },
    }));
  };

  const copyDecisionGatewayUrl = async (taskId: string, decisionUrl: string) => {
    try {
      await navigator.clipboard.writeText(decisionUrl);
      setCopiedDecisionUrlTaskId(taskId);
      window.setTimeout(() => {
        setCopiedDecisionUrlTaskId((current) => (current === taskId ? null : current));
      }, 1600);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Unable to copy Decision Gateway URL.");
    }
  };

  const handleTaskDragStart = (event: DragEvent<HTMLElement>, taskId: string) => {
    event.stopPropagation();
    if (isTaskReorderSaving) {
      event.preventDefault();
      return;
    }
    setDraggedTaskId(taskId);
    setDragOverTaskId(null);
    startTaskClearGuard();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", taskId);
  };

  const handleTaskDragOver = (event: DragEvent<HTMLElement>, taskId: string) => {
    if (!draggedTaskId || draggedTaskId === taskId || isTaskReorderSaving) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverTaskId(taskId);
  };

  const handleTaskDragEnd = () => {
    setDraggedTaskId(null);
    setDragOverTaskId(null);
    startTaskClearGuard();
  };

  const handleTaskDrop = (event: DragEvent<HTMLElement>, targetTaskId: string) => {
    event.preventDefault();
    event.stopPropagation();

    const sourceTaskId = draggedTaskId || event.dataTransfer.getData("text/plain");
    setDraggedTaskId(null);
    setDragOverTaskId(null);

    if (!sourceTaskId || sourceTaskId === targetTaskId || isTaskReorderSaving) {
      startTaskClearGuard();
      return;
    }

    const visibleTaskIds = visibleTasks.map((task) => task.id);
    const nextVisibleTaskIds = moveTaskIdInOrder(visibleTaskIds, sourceTaskId, targetTaskId);
    if (nextVisibleTaskIds === visibleTaskIds) {
      startTaskClearGuard();
      return;
    }

    const nextTaskIds = mergeVisibleTaskOrder(
      orderedTasks.map((task) => task.id),
      visibleTaskIds,
      nextVisibleTaskIds,
    );
    setIsTaskReorderSaving(true);
    startTaskClearGuard();
    Promise.resolve(onReorderTasks(nextTaskIds)).finally(() => {
      setIsTaskReorderSaving(false);
      startTaskClearGuard();
    });
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
          const latestDecisionResult = latestDecisionResultForTask(task);
          const latestDecisionLease = latestDecisionLeaseForTask(task);
          const hasPendingDecisionLease = latestDecisionLease?.status === "pending" && !latestDecisionResult;
          const hasReceivedDecisionLease = latestDecisionLease?.status === "received" && Boolean(latestDecisionResult);
          const hasDeliveredDecisionLease = latestDecisionLease?.status === "delivered";
          const hasFailedDecisionDelivery = latestDecisionLease?.status === "delivery_failed";
          const hasLocalDecisionUrl =
            decisionRequestState?.status === "sent" && Boolean(decisionRequestState.decisionUrl);
          const inputLockLabel = isNativeSubagent
            ? "Native subagent input is read-only"
            : isInputLocked
              ? "Unlock input"
              : "Lock input";
          const lineageBadge = taskLineageBadge(task);
          return (
            <article
              className="task-list-item"
              data-drag-over={dragOverTaskId === task.id ? "true" : "false"}
              data-selected={isSelected}
              data-tone={taskTone(task, runningTaskIdSet)}
              key={task.id}
              onDragOver={(event) => handleTaskDragOver(event, task.id)}
              onDrop={(event) => handleTaskDrop(event, task.id)}
              onClick={() => selectTask(task.id)}
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
                <form
                  className="task-title-edit-form"
                  onClick={(event) => event.stopPropagation()}
                  onSubmit={(event) => submitTitleEdit(event, task)}
                >
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
                >
                  <span className="task-card-header">
                    <button
                      aria-label={`Reorder ${taskDisplayName(task)}`}
                      className="task-drag-handle"
                      disabled={isTaskReorderSaving}
                      draggable={!isTaskReorderSaving}
                      onClick={(event) => event.stopPropagation()}
                      onDragEnd={handleTaskDragEnd}
                      onDragStart={(event) => handleTaskDragStart(event, task.id)}
                      title="Drag to reorder task"
                      type="button"
                    >
                      <svg aria-hidden="true" className="task-drag-icon" focusable="false" viewBox="0 0 16 16">
                        <path d="M6 3.5h.01M10 3.5h.01M6 8h.01M10 8h.01M6 12.5h.01M10 12.5h.01" />
                      </svg>
                    </button>
                    <span
                      className="task-row-heading"
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectTask(task.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <span className="task-title">{taskDisplayName(task)}</span>
                    </span>
                    <span className="task-card-actions" onClick={(event) => event.stopPropagation()}>
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
                      <IconButton
                        className="task-decision-gateway-button"
                        disabled={!decisionGatewayConfigured || decisionRequestState?.status === "sending"}
                        label={
                          decisionRequestState?.status === "sending"
                            ? "Sending decision request"
                            : "Ask for decision"
                        }
                        onClick={() => sendTaskToDecisionGateway(task)}
                        size="sm"
                        title={
                          decisionRequestState?.status === "sending"
                            ? "Sending decision request"
                            : decisionGatewayConfigured
                              ? "Send a manual decision request to Decision Gateway"
                              : "Set DECISION_GATEWAY_URL to enable Decision Gateway"
                        }
                        variant="ghost"
                      >
                        <svg aria-hidden="true" className="task-decision-gateway-icon" focusable="false" viewBox="0 0 16 16">
                          <path d="M8 2.5v7" />
                          <path d="M5.5 5 8 2.5 10.5 5" />
                          <path d="M4.5 7.5h-1a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-1" />
                          <path d="M5.25 10.5h5.5" />
                        </svg>
                      </IconButton>
                      <button
                        aria-label="Clear task"
                        className="task-clear-button"
                        disabled={taskClearDisabled || isInputLocked}
                        onClick={() => onClearTask(task.id)}
                        title={
                          taskClearDisabled
                            ? "Task cards are being reordered; wait a moment before clearing"
                            : isInputLocked
                              ? "Unlock input before clearing this task"
                            : "Clear task"
                        }
                        type="button"
                      >
                        <svg aria-hidden="true" className="task-clear-icon" focusable="false" viewBox="0 0 16 16">
                          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                        </svg>
                      </button>
                    </span>
                  </span>
                  <span className="task-badge-row">
                    <span className="task-human-signal" data-kind={`supervision-${bucket}`} title={supervisionTitle(task)}>
                      {supervisionBucketLabel(bucket)}
                    </span>
                    <span className="task-detail-state" data-kind={stateBadge.kind} title={stateBadge.title}>
                      {stateBadge.label}
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
                    {hasDeliveredDecisionLease ? (
                      <span className="task-badge" data-kind="decision-delivered" title={decisionLeaseTitle(latestDecisionLease)}>
                        Decision delivered
                      </span>
                    ) : null}
                    {hasFailedDecisionDelivery ? (
                      <span className="task-badge" data-kind="decision-delivery-failed" title={decisionLeaseTitle(latestDecisionLease)}>
                        Decision delivery failed
                      </span>
                    ) : null}
                    {hasReceivedDecisionLease ? (
                      <span className="task-badge" data-kind="decision-received" title={decisionResultTitle(latestDecisionResult)}>
                        Decision received
                      </span>
                    ) : null}
                    {hasPendingDecisionLease ? (
                      <span className="task-badge" data-kind="decision-pending" title={decisionLeaseTitle(latestDecisionLease)}>
                        Decision pending
                      </span>
                    ) : null}
                  </span>
                  <span className="task-card-meta">
                    <span className="task-cwd" title={task.cwd}>
                      {workspaceLabel(task.cwd)}
                    </span>
                    <span className="task-meta-spacer" />
                    <span className="task-updated">{formatTime(task.updatedAt)}</span>
                    <button
                      aria-label={inputLockLabel}
                      aria-pressed={isInputLocked}
                      className="task-input-lock-button"
                      data-active={isInputLocked ? "true" : "false"}
                      disabled={task.status !== "running" || isNativeSubagent}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleInputLock(task.id, !isInputLocked);
                      }}
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
                  </span>
                </div>
              )}
              {hasLocalDecisionUrl ? (
                <div
                  className="task-action-status task-decision-gateway-result"
                  data-kind="success"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span>Decision pending</span>
                  <a
                    className="task-decision-gateway-url"
                    href={decisionRequestState.decisionUrl}
                    rel="noreferrer"
                    target="_blank"
                    title={decisionRequestState.decisionUrl}
                  >
                    {decisionRequestState.decisionUrl}
                  </a>
                  <Button
                    className="task-decision-gateway-copy-button"
                    onClick={() => copyDecisionGatewayUrl(task.id, decisionRequestState.decisionUrl || "")}
                    size="sm"
                    title="Copy Decision Gateway URL"
                    variant="secondary"
                  >
                    {copiedDecisionUrlTaskId === task.id ? "Copied" : "Copy URL"}
                  </Button>
                </div>
              ) : null}
              {decisionRequestState?.status === "failed" ? (
                <p className="task-action-error">{decisionRequestState.error || "Unable to send decision request."}</p>
              ) : null}
              {hasDeliveredDecisionLease ? (
                <div className="task-action-status task-decision-received" data-kind="decision">
                  <span>Decision delivered</span>
                  <span className="task-decision-received-detail">
                    {decisionActionLabel(latestDecisionLease?.actionType)}
                    <span>{formatDecisionDateTime(latestDecisionLease?.deliveredAt || latestDecisionLease?.receivedAt)}</span>
                  </span>
                </div>
              ) : null}
              {hasFailedDecisionDelivery ? (
                <div className="task-action-status task-decision-received" data-kind="decision-error">
                  <span>Decision delivery failed</span>
                  <span className="task-decision-received-detail">
                    {latestDecisionLease?.deliveryError || "Unable to deliver decision to Codex App Server"}
                  </span>
                </div>
              ) : null}
              {hasReceivedDecisionLease && latestDecisionResult ? (
                <div className="task-action-status task-decision-received" data-kind="decision">
                  <span>Decision received</span>
                  <span className="task-decision-received-detail">
                    {decisionActionLabel(latestDecisionResult.actionType)}
                    <span>{formatDecisionDateTime(latestDecisionResult.decidedAt || latestDecisionResult.receivedAt)}</span>
                  </span>
                </div>
              ) : null}
              {hasPendingDecisionLease && !hasLocalDecisionUrl ? (
                <div className="task-action-status task-decision-pending" data-kind="decision">
                  <span>Decision pending</span>
                  <span className="task-decision-received-detail">
                    Expires {formatDecisionDateTime(latestDecisionLease?.expiresAt)}
                  </span>
                </div>
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

export function moveTaskIdInOrder(taskIds: string[], sourceTaskId: string, targetTaskId: string) {
  const sourceIndex = taskIds.indexOf(sourceTaskId);
  const targetIndex = taskIds.indexOf(targetTaskId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return taskIds;
  }

  const nextTaskIds = [...taskIds];
  const [source] = nextTaskIds.splice(sourceIndex, 1);
  nextTaskIds.splice(targetIndex, 0, source);
  return nextTaskIds;
}

export function mergeVisibleTaskOrder(allTaskIds: string[], visibleTaskIds: string[], nextVisibleTaskIds: string[]) {
  const visibleTaskIdSet = new Set(visibleTaskIds);
  const nextVisibleQueue = [...nextVisibleTaskIds];

  return allTaskIds.map((taskId) => {
    if (!visibleTaskIdSet.has(taskId)) {
      return taskId;
    }
    return nextVisibleQueue.shift() ?? taskId;
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

function supervisionBucketLabel(bucket: ReturnType<typeof supervisionBucket>) {
  return bucket === "needs_you" ? "Needs you" : "Not now";
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

function childReportedStatusLabel(state: NonNullable<Task["childReportedState"]>) {
  return `Reported ${String(state).replace(/_/g, " ")}`;
}

function childReportedStatusTitle(task: Task) {
  const state = task.childReportedState ? String(task.childReportedState).replace(/_/g, " ") : "unknown";
  const summary = task.childStatusSummary ? `: ${task.childStatusSummary}` : "";
  return `Reported ${state}${summary}`;
}

function latestDecisionResultForTask(task: Task) {
  const results = Array.isArray(task.decisionResults) ? task.decisionResults : [];
  return results.find((item) => item.validationStatus === "valid") ?? null;
}

function latestDecisionLeaseForTask(task: Task) {
  const leases = Array.isArray(task.decisionLeases) ? task.decisionLeases : [];
  return leases.find((item) =>
    item.status === "pending" ||
    item.status === "received" ||
    item.status === "delivered" ||
    item.status === "delivery_failed"
  ) ?? leases[0] ?? null;
}

function decisionResultTitle(item: DecisionGatewayMailboxItem) {
  return [item.validationReason, item.condition, item.reason].filter(Boolean).join(" ");
}

function decisionLeaseTitle(item: DecisionGatewayDecisionLease | null) {
  if (!item) {
    return "Decision pending";
  }
  const label = item.status === "delivered"
    ? "Decision delivered"
    : item.status === "delivery_failed"
      ? "Decision delivery failed"
      : item.status === "received"
        ? "Decision received"
        : "Decision pending";
  return [
    label,
    item.requestId ? `request ${item.requestId}` : "",
    item.deliveryError || "",
    item.expiresAt && item.status === "pending" ? `expires ${item.expiresAt}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function decisionActionLabel(value: string | undefined) {
  return String(value || "decision").replace(/_/g, " ");
}

function formatDecisionDateTime(value: string | undefined) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) {
    return "unknown time";
  }
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
