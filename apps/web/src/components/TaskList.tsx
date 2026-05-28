import { useMemo, useState } from "react";
import type { Task } from "../types";

type TaskFilter = "all" | "running" | "failed" | "completed" | "risk";

type TaskListProps = {
  tasks: Task[];
  selectedTaskId: string | null;
  runningTaskIds: string[];
  onClearTask: (taskId: string) => void;
  onClearTasks: () => void;
  onSelectTask: (taskId: string) => void;
};

export function TaskList({
  tasks,
  selectedTaskId,
  runningTaskIds,
  onClearTask,
  onClearTasks,
  onSelectTask,
}: TaskListProps) {
  const [filter, setFilter] = useState<TaskFilter>("all");
  const runningTaskIdSet = useMemo(() => new Set(runningTaskIds), [runningTaskIds]);
  const visibleTasks = useMemo(() => tasks.filter((task) => matchesFilter(task, filter)), [filter, tasks]);

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
        {(["all", "running", "failed", "completed", "risk"] as TaskFilter[]).map((nextFilter) => (
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
        {visibleTasks.map((task) => (
          <div
            className="task-list-item"
            data-selected={task.id === selectedTaskId}
            data-tone={taskTone(task, runningTaskIdSet)}
            key={task.id}
          >
            <button className="task-select-button" onClick={() => onSelectTask(task.id)} type="button">
              <span className="task-row-heading">
                <span className="task-title">{task.title}</span>
                <span className="task-updated">{formatTime(task.updatedAt)}</span>
              </span>
              <span className="task-badge-row">
                <span className="task-badge" data-kind="status">
                  {task.status}
                  {runningTaskIdSet.has(task.id) ? " / active" : ""}
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
              <span className="task-command" title={task.command}>
                {shortCommand(task.command)}
              </span>
              <span className="task-cwd" title={task.cwd}>
                {cwdLabel(task.cwd)}
              </span>
            </button>
            <button
              className="task-clear-button"
              onClick={() => onClearTask(task.id)}
              type="button"
            >
              Clear
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}

function matchesFilter(task: Task, filter: TaskFilter) {
  if (filter === "running") {
    return task.status === "running";
  }
  if (filter === "failed") {
    return task.status === "failed" || task.status === "interrupted";
  }
  if (filter === "completed") {
    return task.status === "succeeded" || task.status === "failed" || task.status === "interrupted";
  }
  if (filter === "risk") {
    return task.risk.level === "high" || task.risk.level === "medium";
  }
  return true;
}

function filterLabel(filter: TaskFilter) {
  return filter[0].toUpperCase() + filter.slice(1);
}

function taskTone(task: Task, runningTaskIds: Set<string>) {
  if (runningTaskIds.has(task.id) || task.status === "running") {
    return "active";
  }
  if (task.status === "failed" || task.status === "interrupted") {
    return "attention";
  }
  if (task.risk.level === "high" || task.risk.level === "medium") {
    return "risk";
  }
  if (task.status === "succeeded") {
    return "subdued";
  }
  return "neutral";
}

function shortCommand(command: string) {
  return command.length > 54 ? `${command.slice(0, 51)}...` : command;
}

function cwdLabel(cwd: string) {
  const trimmed = cwd.replace(/\/+$/, "");
  const basename = trimmed.split("/").filter(Boolean).pop();
  return basename ? `cwd ${basename}` : "Repository root";
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
