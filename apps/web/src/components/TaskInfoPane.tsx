import type { AgentState, Task } from "../types";

type TaskInfoPaneProps = {
  actionError: string;
  task: Task | null;
  onInterrupt: () => void;
  onRerun: () => void;
};

export function TaskInfoPane({ actionError, task, onInterrupt, onRerun }: TaskInfoPaneProps) {
  const canShowRerun = task && task.status !== "running";

  return (
    <section className="info-pane" aria-label="Task information">
      <div className="pane-heading">
        <h2>Task State</h2>
        <div className="pane-actions">
          {canShowRerun ? (
            <button onClick={onRerun} type="button">
              Rerun
            </button>
          ) : null}
          <button disabled={task?.status !== "running"} onClick={onInterrupt} type="button">
            Interrupt
          </button>
        </div>
      </div>
      {actionError ? <p className="task-action-error">{actionError}</p> : null}
      {!task ? (
        <p className="empty-state">Select or start a task.</p>
      ) : (
        <dl className="info-grid">
          <Info label="Title" value={task.title} />
          <Info label="Agent state" value={agentStateLabel(task.agentState)} />
          <Info label="State source" value={stateSourceLabel(task.agentStateSource)} />
          <Info label="State confidence" value={stateConfidenceLabel(task.agentStateConfidence)} />
          {task.agentStateReason ? <Info label="State reason" value={task.agentStateReason} /> : null}
          <Info label="Process" value={task.status} />
          <Info label="Risk" value={task.risk.level} />
          <Info label="Exit" value={task.exitCode === null ? "-" : String(task.exitCode)} />
          <Info label="CWD" value={task.cwd} />
          <Info label="Command" value={task.command} />
          <Info label="Started" value={formatDate(task.startedAt)} />
          <Info label="Updated" value={formatDate(task.updatedAt)} />
        </dl>
      )}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleTimeString();
}

function agentStateLabel(agentState: AgentState) {
  return agentState.replace(/_/g, " ");
}

function stateSourceLabel(source?: string) {
  return source ? source.replace(/_/g, " ") : "-";
}

function stateConfidenceLabel(confidence?: string) {
  return confidence || "-";
}
