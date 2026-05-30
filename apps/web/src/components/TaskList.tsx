import { useEffect, useMemo, useState } from "react";
import type { AgentState, AttentionState, Task } from "../types";

type TaskFilter = "all" | "needs_you" | "not_now";

type TaskListProps = {
  actionError: string;
  tasks: Task[];
  selectedTaskId: string | null;
  runningTaskIds: string[];
  onClearTask: (taskId: string) => void;
  onClearTasks: () => void;
  onInterruptTask: () => void;
  onRerunTask: () => void;
  onResumeLastTask: (task: Task) => void;
  onResumeTask: (task: Task) => void;
  pendingResumeKeys: string[];
  onSelectTask: (taskId: string) => void;
};

export function TaskList({
  actionError,
  tasks,
  selectedTaskId,
  runningTaskIds,
  onClearTask,
  onClearTasks,
  onInterruptTask,
  onRerunTask,
  onResumeLastTask,
  onResumeTask,
  pendingResumeKeys,
  onSelectTask,
}: TaskListProps) {
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [confirmResumeLastTaskId, setConfirmResumeLastTaskId] = useState<string | null>(null);
  const runningTaskIdSet = useMemo(() => new Set(runningTaskIds), [runningTaskIds]);
  const visibleTasks = useMemo(() => tasks.filter((task) => matchesFilter(task, filter)), [filter, tasks]);

  const toggleExpanded = (taskId: string) => {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const selectTask = (taskId: string) => {
    onSelectTask(taskId);
  };

  const confirmResumeLast = (task: Task) => {
    onResumeLastTask(task);
    setConfirmResumeLastTaskId(null);
  };

  return (
    <aside className="task-list" aria-label="Tasks">
      <div className="pane-heading">
        <h2>Tasks</h2>
        <div className="pane-actions">
          <span>{tasks.length}</span>
          <button disabled={tasks.length === 0} onClick={onClearTasks} type="button">
            Clear
          </button>
        </div>
      </div>
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
      <div className="task-list-items">
        {tasks.length === 0 ? <p className="empty-state">No tasks yet.</p> : null}
        {tasks.length > 0 && visibleTasks.length === 0 ? (
          <p className="empty-state">No tasks match this filter.</p>
        ) : null}
        {visibleTasks.map((task) => {
          const isSelected = task.id === selectedTaskId;
          const isExpanded = expandedTaskIds.has(task.id);
          const canRerun = task.status !== "running" && runningTaskIds.length === 0;
          const resumeCommand = task.resumeCommand?.trim() || task.agentSessionResumeCommand?.trim() || "";
          const resumeLastCommand = !resumeCommand && isCodexTask(task) ? "codex resume --last" : "";
          const isResumePending = resumeCommand
            ? pendingResumeKeys.includes(resumeTaskKey(task.id, resumeCommand))
            : false;
          const isResumeLastPending = resumeLastCommand
            ? pendingResumeKeys.includes(resumeTaskKey(task.id, resumeLastCommand))
            : false;
          const canResume = Boolean(resumeCommand) && !isResumePending;
          const canResumeLast = Boolean(resumeLastCommand) && !isResumeLastPending;
          const resumePreviewCommand = resumeCommand || resumeLastCommand;
          const isConfirmingResumeLast = confirmResumeLastTaskId === task.id;
          const bucket = supervisionBucket(task);
          return (
            <article
              className="task-list-item"
              data-expanded={isExpanded}
              data-selected={isSelected}
              data-tone={taskTone(task, runningTaskIdSet)}
              key={task.id}
            >
              <button
                aria-expanded={isExpanded}
                aria-label={isExpanded ? "Collapse task details" : "Expand task details"}
                className="task-expand-button"
                onClick={() => toggleExpanded(task.id)}
                title={isExpanded ? "Collapse task details" : "Expand task details"}
                type="button"
              >
                {isExpanded ? "⌄" : "⌃"}
              </button>
              <button className="task-select-button" onClick={() => selectTask(task.id)} type="button">
                <span className="task-row-heading">
                  <span className="task-title">{displayTaskTitle(task.title)}</span>
                  <span className="task-updated">{formatTime(task.updatedAt)}</span>
                </span>
                <span className="task-badge-row">
                  <span className="task-badge" data-kind={`supervision-${bucket}`} title={supervisionTitle(task)}>
                    {supervisionBucketLabel(bucket)}
                  </span>
                  <span className="task-badge" data-kind={`process-${task.status}`}>
                    {task.status}
                  </span>
                  <span className="task-badge" data-kind={`risk-${task.risk.level}`}>
                    {task.risk.level}
                  </span>
                  {task.exitCode === null ? null : (
                    <span className="task-badge" data-kind="exit">
                      exit {task.exitCode}
                    </span>
                  )}
                </span>
                <span className="task-card-meta">
                  <span className="task-cwd" title={task.cwd}>
                    {workspaceLabel(task.cwd)}
                  </span>
                  <span className="task-command" title={task.command}>
                    {task.agentLabel || agentOrCommandLabel(task.command)}
                  </span>
                </span>
              </button>
              <div className="task-card-actions">
                <button aria-label="Clear task" className="task-clear-button" onClick={() => onClearTask(task.id)} title="Clear task" type="button">
                  ×
                </button>
              </div>
              {isExpanded ? (
                <div className="task-card-detail">
                  {isSelected && actionError ? <p className="task-action-error">{actionError}</p> : null}
                  <dl className="task-detail-grid">
                    <Info label="Agent" value={task.agentLabel || agentOrCommandLabel(task.command)} />
                    <Info label="Session mode" value={sessionModeLabel(task.sessionMode)} />
                    {task.agentSessionId ? <Info label="Session id" value={task.agentSessionId} /> : null}
                    {task.agentSessionSource ? <Info label="Session source" value={task.agentSessionSource} /> : null}
                    {task.agentSessionProvider ? <Info label="Session provider" value={task.agentSessionProvider} /> : null}
                    {task.agentSessionDetectedAt ? (
                      <Info label="Session detected" value={formatDate(task.agentSessionDetectedAt)} />
                    ) : null}
                    {task.agentSessionResumeCommand ? (
                      <Info label="Session resume command" value={task.agentSessionResumeCommand} wide />
                    ) : null}
                    {task.resumeCommand ? <Info label="Resume command" value={task.resumeCommand} wide /> : null}
                    <Info label="Command" value={task.command} />
                    <Info label="CWD" value={task.cwd} />
                    <SectionLabel label="User attention" />
                    <Info label="Attention state" value={attentionStateLabel(attentionState(task))} />
                    <Info label="Attention source" value={stateSourceLabel(task.attentionStateSource)} />
                    <Info label="Attention confidence" value={stateConfidenceLabel(task.attentionStateConfidence)} />
                    {task.attentionStateReason ? <Info label="Attention reason" value={task.attentionStateReason} wide /> : null}
                    <SectionLabel label="Observed process" />
                    <Info label="Process status" value={task.status} />
                    <Info label="Exit" value={task.exitCode === null ? "-" : String(task.exitCode)} />
                    <Info label="Started" value={formatDate(task.startedAt)} />
                    <Info label="Updated" value={formatDate(task.updatedAt)} />
                    <SectionLabel label="Agent signal" />
                    <Info label="Agent state" value={agentStateLabel(task.agentState)} />
                    <Info label="Signal source" value={stateSourceLabel(task.agentStateSource)} />
                    <Info label="Signal confidence" value={stateConfidenceLabel(task.agentStateConfidence)} />
                    {task.agentStateReason ? <Info label="Signal reason" value={task.agentStateReason} wide /> : null}
                    {task.initialInstruction ? (
                      <Info label="Initial instruction" value={task.initialInstruction} wide />
                    ) : null}
                    <div className="task-detail-item">
                      <dt>Diff</dt>
                      <dd>
                        <TaskDiffStatus task={task} />
                      </dd>
                    </div>
                  </dl>
                  {isSelected ? (
                    <>
                      {resumePreviewCommand ? (
                        <p className="resume-command-preview" title={resumePreviewCommand}>
                          <span>Resume command:</span>
                          <code>{resumePreviewCommand}</code>
                        </p>
                      ) : null}
                      <div className="task-detail-actions">
                        <button disabled={!canRerun} onClick={onRerunTask} type="button">
                          Rerun command
                        </button>
                        <button disabled={task.status !== "running"} onClick={onInterruptTask} type="button">
                          Interrupt
                        </button>
                        {resumeCommand ? (
                          <button disabled={!canResume} onClick={() => onResumeTask(task)} type="button">
                            Resume saved
                          </button>
                        ) : null}
                        {canResumeLast ? (
                          <button
                            data-priority="secondary"
                            disabled={isResumeLastPending}
                            onClick={() => setConfirmResumeLastTaskId(task.id)}
                            type="button"
                          >
                            Resume last
                          </button>
                        ) : null}
                      </div>
                      {isConfirmingResumeLast ? (
                        <div className="resume-last-confirmation">
                          <p>Resume last uses the latest Codex session, not necessarily this task.</p>
                          <div>
                            <button disabled={isResumeLastPending} onClick={() => confirmResumeLast(task)} type="button">
                              Confirm resume last
                            </button>
                            <button
                              data-priority="secondary"
                              onClick={() => setConfirmResumeLastTaskId(null)}
                              type="button"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </aside>
  );
}

function TaskDiffStatus({ task }: { task: Task }) {
  const [summary, setSummary] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    setSummary("loading");
    fetch(`/api/tasks/${task.id}/diff`)
      .then((response) => response.json())
      .then((payload: { diff?: string; isGitRepo?: boolean; message?: string; error?: string }) => {
        if (cancelled) {
          return;
        }
        if (payload.isGitRepo === false) {
          setSummary(payload.message || "Not a git repository");
          return;
        }
        if (payload.error) {
          setSummary("Diff unavailable");
          return;
        }
        setSummary(payload.diff ? "Diff ready" : "No diff");
      })
      .catch(() => {
        if (!cancelled) {
          setSummary("Diff unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [task.id, task.updatedAt]);

  return <span className="task-diff-summary">{summary}</span>;
}

function Info({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className="task-detail-item" data-wide={wide}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="task-detail-section-label">
      <span>{label}</span>
    </div>
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

function agentStateLabel(agentState: AgentState) {
  return agentState.replace(/_/g, " ");
}

function attentionState(task: Task): AttentionState {
  return task.attentionState || "none";
}

function attentionStateLabel(nextAttentionState: AttentionState) {
  return nextAttentionState.replace(/_/g, " ");
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

function stateSourceLabel(source?: string) {
  return source ? source.replace(/_/g, " ") : "-";
}

function stateConfidenceLabel(confidence?: string) {
  return confidence || "-";
}

function sessionModeLabel(sessionMode: string | undefined) {
  if (sessionMode === "resume_last") return "Resume last";
  if (sessionMode === "saved_codex") return "Resume saved session";
  if (sessionMode === "custom_resume") return "Legacy custom resume";
  if (sessionMode === "new") return "New session";
  return "-";
}

function displayTaskTitle(title: string) {
  return title.trim().replace(/^(?:Resume saved:\s*)+/i, "") || "Untitled task";
}

function resumeTaskKey(taskId: string, resumeCommand: string) {
  return `${taskId}:${resumeCommand}`;
}

function isCodexTask(task: Task) {
  const haystack = `${task.agentProfileId || ""} ${task.agentLabel || ""} ${task.command}`.toLowerCase();
  return /\bcodex\b/.test(haystack);
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

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleTimeString();
}
