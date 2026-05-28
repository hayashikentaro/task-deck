import { useEffect, useMemo, useState } from "react";
import type { AgentState, Task } from "../types";

type TaskFilter = "all" | "active" | "needs_input" | "review" | "done" | "failed" | "risk";

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
        {(["all", "active", "needs_input", "review", "done", "failed", "risk"] as TaskFilter[]).map((nextFilter) => (
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
          const resumeCommand = task.resumeCommand?.trim() || "";
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
          return (
            <article
              className="task-list-item"
              data-expanded={isExpanded}
              data-selected={isSelected}
              data-tone={taskTone(task, runningTaskIdSet)}
              key={task.id}
            >
              <button className="task-select-button" onClick={() => selectTask(task.id)} type="button">
                <span className="task-row-heading">
                  <span className="task-title">{task.title}</span>
                  <span className="task-updated">{formatTime(task.updatedAt)}</span>
                </span>
                <span className="task-badge-row">
                  <span className="task-badge" data-kind={`agent-${task.agentState}`}>
                    {agentStateLabel(task.agentState)}
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
                <button
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? "Collapse task details" : "Expand task details"}
                  className="task-expand-button"
                  onClick={() => toggleExpanded(task.id)}
                  title={isExpanded ? "Collapse task details" : "Expand task details"}
                  type="button"
                >
                  {isExpanded ? "⌃" : "⌄"}
                </button>
                <button onClick={() => onClearTask(task.id)} type="button">
                  Clear
                </button>
              </div>
              {isExpanded ? (
                <div className="task-card-detail">
                  {isSelected && actionError ? <p className="task-action-error">{actionError}</p> : null}
                  <dl className="task-detail-grid">
                    <Info label="Agent" value={task.agentLabel || agentOrCommandLabel(task.command)} />
                    <Info label="Session mode" value={sessionModeLabel(task.sessionMode)} />
                    {task.resumeCommand ? <Info label="Resume command" value={task.resumeCommand} wide /> : null}
                    <Info label="Command" value={task.command} />
                    <Info label="CWD" value={task.cwd} />
                    <Info label="Process" value={task.status} />
                    <Info label="Exit" value={task.exitCode === null ? "-" : String(task.exitCode)} />
                    <Info label="Started" value={formatDate(task.startedAt)} />
                    <Info label="Updated" value={formatDate(task.updatedAt)} />
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

function matchesFilter(task: Task, filter: TaskFilter) {
  if (filter === "active") {
    return task.agentState === "starting" || task.agentState === "thinking" || task.agentState === "working";
  }
  if (filter === "needs_input") {
    return task.agentState === "waiting_input" || task.agentState === "waiting_approval";
  }
  if (filter === "review") {
    return task.agentState === "review_ready";
  }
  if (filter === "done") {
    return task.agentState === "done";
  }
  if (filter === "failed") {
    return task.agentState === "failed" || task.agentState === "stopped";
  }
  if (filter === "risk") {
    return task.risk.level === "high" || task.risk.level === "medium";
  }
  return true;
}

function filterLabel(filter: TaskFilter) {
  if (filter === "active") return "Active";
  if (filter === "needs_input") return "Needs input";
  if (filter === "review") return "Review";
  if (filter === "done") return "Done";
  if (filter === "failed") return "Failed/stopped";
  if (filter === "risk") return "Risk";
  return "All";
}

function taskTone(task: Task, runningTaskIds: Set<string>) {
  if (task.agentState === "failed" || task.agentState === "stopped") {
    return task.agentState;
  }
  if (
    task.agentState === "waiting_input" ||
    task.agentState === "waiting_approval" ||
    task.agentState === "review_ready"
  ) {
    return task.agentState;
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

function sessionModeLabel(sessionMode: string | undefined) {
  if (sessionMode === "resume_last") return "Resume last";
  if (sessionMode === "custom_resume") return "Custom resume command";
  if (sessionMode === "new") return "New session";
  return "-";
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
