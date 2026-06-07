import type { AgentState, AttentionState, Task } from "../types";

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
          <InfoSection label="User attention" />
          <Info label="Attention state" value={attentionStateLabel(attentionState(task))} />
          <Info label="Attention source" value={stateSourceLabel(task.attentionStateSource)} />
          <Info label="Attention confidence" value={stateConfidenceLabel(task.attentionStateConfidence)} />
          {task.attentionStateReason ? <Info label="Attention reason" value={task.attentionStateReason} /> : null}
          <InfoSection label="Observed process" />
          <Info label="Process status" value={task.status} />
          <Info label="Exit" value={task.exitCode === null ? "-" : String(task.exitCode)} />
          <InfoSection label="Agent signal" />
          <Info label="Agent state" value={agentStateLabel(task.agentState)} />
          <Info label="Signal source" value={stateSourceLabel(task.agentStateSource)} />
          <Info label="Signal confidence" value={stateConfidenceLabel(task.agentStateConfidence)} />
          {task.agentStateReason ? <Info label="Signal reason" value={task.agentStateReason} /> : null}
          <Info label="Risk" value={task.risk.level} />
          <Info label="CWD" value={task.cwd} />
          <Info label="Command" value={task.command} />
          {hasChildSessionMetadata(task) ? (
            <>
              <InfoSection label="Child session" />
              {task.parentSessionId ? <Info label="Parent session id" value={task.parentSessionId} /> : null}
              {task.workPackageId ? <Info label="Work package id" value={task.workPackageId} /> : null}
              <Info label="Spawned from parent request" value={task.spawnedFromParentRequest ? "Yes" : "No"} />
              {task.filesLikelyToChange?.length ? (
                <Info label="Files likely to change" value={task.filesLikelyToChange.join(", ")} />
              ) : null}
            </>
          ) : null}
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

function hasChildSessionMetadata(task: Task) {
  return Boolean(
    task.parentSessionId ||
      task.spawnedFromParentRequest ||
      task.workPackageId ||
      task.filesLikelyToChange?.length
  );
}

function InfoSection({ label }: { label: string }) {
  return (
    <div className="info-section-label">
      <span>{label}</span>
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

function attentionState(task: Task): AttentionState {
  return task.attentionState || "none";
}

function attentionStateLabel(nextAttentionState: AttentionState) {
  return nextAttentionState.replace(/_/g, " ");
}

function stateSourceLabel(source?: string) {
  return source ? source.replace(/_/g, " ") : "-";
}

function stateConfidenceLabel(confidence?: string) {
  return confidence || "-";
}
