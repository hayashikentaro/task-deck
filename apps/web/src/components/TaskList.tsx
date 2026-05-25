import type { Task } from "../types";

type TaskListProps = {
  tasks: Task[];
  selectedTaskId: string | null;
  runningTaskId: string | null;
  onSelectTask: (taskId: string) => void;
};

export function TaskList({ tasks, selectedTaskId, runningTaskId, onSelectTask }: TaskListProps) {
  return (
    <aside className="task-list" aria-label="Tasks">
      <div className="pane-heading">
        <h2>Tasks</h2>
        <span>{tasks.length}</span>
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

