import type { Task } from "../types";

type TaskListProps = {
  tasks: Task[];
  selectedTaskId: string | null;
  runningTaskId: string | null;
  onClearTasks: () => void;
  onSelectTask: (taskId: string) => void;
};

export function TaskList({ tasks, selectedTaskId, runningTaskId, onClearTasks, onSelectTask }: TaskListProps) {
  const clearableCount = tasks.filter((task) => task.id !== runningTaskId).length;

  return (
    <aside className="task-list" aria-label="Tasks">
      <div className="pane-heading">
        <h2>Tasks</h2>
        <div className="pane-actions">
          <span>{tasks.length}</span>
          <button disabled={clearableCount === 0} onClick={onClearTasks} type="button">
            Clear
          </button>
        </div>
      </div>
      <div className="task-list-items">
        {tasks.length === 0 ? <p className="empty-state">No tasks yet.</p> : null}
        {tasks.map((task) => (
          <button
            className="task-list-item"
            data-selected={task.id === selectedTaskId}
            key={task.id}
            onClick={() => onSelectTask(task.id)}
            type="button"
          >
            <span className="task-title">{task.title}</span>
            <span className="task-meta">
              {task.status}
              {task.id === runningTaskId ? " / active" : ""}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
