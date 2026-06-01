import { useEffect, useState } from "react";
import { buildCodexResumeCommandForCommand } from "../codexPermissions";
import type { Task } from "../types";

type SelectedSessionPanelProps = {
  actionError: string;
  isConnected: boolean;
  task: Task | null;
  runningTaskIds: string[];
  pendingResumeKeys: string[];
  onInterruptTask: () => void;
  onRerunTask: () => void;
  onResumeLastTask: (task: Task) => void;
  onResumeTask: (task: Task) => void;
};

export function SelectedSessionPanel({
  actionError,
  isConnected,
  task,
  runningTaskIds,
  pendingResumeKeys,
  onInterruptTask,
  onRerunTask,
  onResumeLastTask,
  onResumeTask,
}: SelectedSessionPanelProps) {
  const [isConfirmingResumeLast, setIsConfirmingResumeLast] = useState(false);

  useEffect(() => {
    setIsConfirmingResumeLast(false);
  }, [task?.id]);

  if (!task) {
    return (
      <section className="selected-session-panel" aria-label="Selected session">
        <div className="pane-heading">
          <h2>Selected Session</h2>
        </div>
        <p className="empty-state">Select or start a task.</p>
      </section>
    );
  }

  const canRerun = isConnected && task.status !== "running" && runningTaskIds.length === 0;
  const resumeCommand = task.resumeCommand?.trim() || task.agentSessionResumeCommand?.trim() || "";
  const resumeLastCommand = !resumeCommand && isCodexTask(task) ? buildCodexResumeLastCommandForTask(task) : "";
  const isResumePending = resumeCommand ? pendingResumeKeys.includes(resumeTaskKey(task.id, resumeCommand)) : false;
  const isResumeLastPending = resumeLastCommand
    ? pendingResumeKeys.includes(resumeTaskKey(task.id, resumeLastCommand))
    : false;
  const canResume = isConnected && Boolean(resumeCommand) && !isResumePending;
  const canResumeLast = isConnected && Boolean(resumeLastCommand) && !isResumeLastPending;
  const resumePreviewCommand = resumeCommand || resumeLastCommand;
  const bucket = supervisionBucket(task);

  const confirmResumeLast = () => {
    onResumeLastTask(task);
    setIsConfirmingResumeLast(false);
  };

  return (
    <section className="selected-session-panel" aria-label="Selected session">
      <div className="pane-heading">
        <h2>Selected Session</h2>
      </div>
      {actionError ? <p className="task-action-error">{actionError}</p> : null}
      <div className="selected-session-body">
        <div className="selected-session-summary">
          <strong title={taskDisplayName(task)}>{taskDisplayName(task)}</strong>
          <span>{task.agentLabel || agentOrCommandLabel(task.command)}</span>
        </div>
        <dl className="selected-session-meta">
          <Info label="State" value={supervisionBucketLabel(bucket)} tone={bucket} />
          <Info label="Status" value={task.status} />
          <Info label="Model" value={modelLabel(task)} />
          <Info label="Permission" value={permissionLevelLabel(task.agentPermissionLevel)} />
          <Info label="Session" value={sessionModeLabel(task.sessionMode)} />
          <Info label="Session ID" value={task.agentSessionId ? compactSessionId(task.agentSessionId) : "-"} />
        </dl>
        {resumePreviewCommand ? (
          <p className="resume-command-preview selected-session-resume" title={resumePreviewCommand}>
            <span>Resume:</span>
            <code>{resumePreviewCommand}</code>
          </p>
        ) : null}
        <div className="selected-session-actions">
          <button disabled={!canRerun} onClick={onRerunTask} type="button">
            Rerun
          </button>
          <button disabled={!isConnected || task.status !== "running"} onClick={onInterruptTask} type="button">
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
              onClick={() => setIsConfirmingResumeLast(true)}
              type="button"
            >
              Resume last
            </button>
          ) : null}
        </div>
        {isConfirmingResumeLast ? (
          <div className="resume-last-confirmation selected-session-confirmation">
            <p>Resume last uses the latest Codex session, not necessarily this task.</p>
            <div>
              <button disabled={isResumeLastPending} onClick={confirmResumeLast} type="button">
                Confirm
              </button>
              <button data-priority="secondary" onClick={() => setIsConfirmingResumeLast(false)} type="button">
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Info({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd data-tone={tone} title={value}>{value}</dd>
    </div>
  );
}

function resumeTaskKey(taskId: string, resumeCommand: string) {
  return `${taskId}:${resumeCommand}`;
}

function isCodexTask(task: Task) {
  const haystack = `${task.agentProfileId || ""} ${task.agentLabel || ""} ${task.command}`.toLowerCase();
  return /\bcodex\b/.test(haystack);
}

function buildCodexResumeLastCommandForTask(task: Task) {
  const command = String(task.command || task.resumeCommand || task.agentSessionResumeCommand || "");
  return buildCodexResumeCommandForCommand(command, task.agentPermissionLevel, "--last");
}

function taskDisplayName(task: Task) {
  return String(task.sessionLabel || task.title || "").trim() || "Untitled task";
}

function agentOrCommandLabel(command: string) {
  return command.split(/\s+/).filter(Boolean)[0] || "command";
}

function sessionModeLabel(sessionMode?: string) {
  if (sessionMode === "new") return "New";
  if (sessionMode === "resume_last") return "Resume last";
  if (sessionMode === "saved_codex") return "Saved";
  if (sessionMode === "diagnostic") return "Diagnostic";
  if (sessionMode === "custom_resume") return "Legacy resume";
  return sessionMode || "-";
}

function compactSessionId(sessionId: string) {
  if (sessionId.length <= 12) {
    return sessionId;
  }
  return `${sessionId.slice(0, 6)}...${sessionId.slice(-4)}`;
}

function supervisionBucket(task: Task) {
  if (task.status !== "running") return "not_now";
  return task.attentionState === "none" || !task.attentionState ? "not_now" : "needs_you";
}

function supervisionBucketLabel(bucket: ReturnType<typeof supervisionBucket>) {
  return bucket === "needs_you" ? "Needs you" : "Not now";
}

function modelLabel(task: Task) {
  const model = modelFromCommand(task.command || task.resumeCommand || task.agentSessionResumeCommand || "");
  return model || "Default";
}

function modelFromCommand(command: string) {
  const match = command.match(/(?:^|\s)(?:--model|-m)\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
  return match?.[1] || match?.[2] || match?.[3] || "";
}

function permissionLevelLabel(permissionLevel: string | undefined) {
  if (permissionLevel === "full_access") return "Full access";
  if (permissionLevel === "workspace_write") return "Workspace write";
  if (permissionLevel === "read_only") return "Read only";
  return permissionLevel || "-";
}
