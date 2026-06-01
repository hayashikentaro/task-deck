import { FormEvent, useEffect, useMemo, useState } from "react";
import { buildCodexResumeCommandForCommand } from "../codexPermissions";
import type { AgentProfile, AgentState, AttentionState, ModelOption, Task } from "../types";

type TaskFilter = "all" | "needs_you" | "not_now";

type TaskListProps = {
  actionError: string;
  agentProfiles: AgentProfile[];
  isConnected: boolean;
  tasks: Task[];
  selectedTaskId: string | null;
  runningTaskIds: string[];
  onClearTask: (taskId: string) => void;
  onClearTasks: () => void | Promise<void>;
  onInterruptTask: (task: Task) => void;
  onRerunTask: (task: Task) => void;
  onResumeLastTask: (task: Task) => void;
  onResumeTask: (task: Task) => void;
  onApplyModel: (task: Task, model: string) => boolean;
  onRenameTask: (taskId: string, title: string) => Promise<boolean>;
  pendingResumeKeys: string[];
  onSelectTask: (taskId: string) => void;
};

export function TaskList({
  actionError,
  agentProfiles,
  isConnected,
  tasks,
  selectedTaskId,
  runningTaskIds,
  onClearTask,
  onClearTasks,
  onInterruptTask,
  onRerunTask,
  onResumeLastTask,
  onResumeTask,
  onApplyModel,
  onRenameTask,
  pendingResumeKeys,
  onSelectTask,
}: TaskListProps) {
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [isClearAllConfirmOpen, setIsClearAllConfirmOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const runningTaskIdSet = useMemo(() => new Set(runningTaskIds), [runningTaskIds]);
  const visibleTasks = useMemo(() => sortTasksBySupervision(tasks.filter((task) => matchesFilter(task, filter))), [filter, tasks]);

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

  return (
    <aside className="task-list" aria-label="Tasks">
      <div className="pane-heading">
        <h2>Tasks</h2>
        <div className="pane-actions">
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
            <p>This will stop running PTYs and remove all task records and logs from TaskDeck.</p>
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
          const resumeCommand = task.resumeCommand?.trim() || task.agentSessionResumeCommand?.trim() || "";
          const resumeLastCommand = !resumeCommand && isCodexTask(task) ? buildCodexResumeLastCommandForTask(task) : "";
          const isResumePending = resumeCommand
            ? pendingResumeKeys.includes(resumeTaskKey(task.id, resumeCommand))
            : false;
          const isResumeLastPending = resumeLastCommand
            ? pendingResumeKeys.includes(resumeTaskKey(task.id, resumeLastCommand))
            : false;
          const canRerun = isConnected && task.status !== "running" && runningTaskIds.length === 0;
          const canResume = isConnected && Boolean(resumeCommand) && !isResumePending;
          const canResumeLast = isConnected && Boolean(resumeLastCommand) && !isResumeLastPending;
          const resumePreviewCommand = resumeCommand || resumeLastCommand;
          const bucket = supervisionBucket(task);
          const isEditingTitle = editingTaskId === task.id;
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
                data-expanded={isExpanded}
                onClick={() => toggleExpanded(task.id)}
                title={isExpanded ? "Collapse task details" : "Expand task details"}
                type="button"
              >
                <svg aria-hidden="true" className="task-expand-icon" focusable="false" viewBox="0 0 16 16">
                  <path d="M4 6l4 4 4-4" />
                </svg>
              </button>
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
                <button className="task-select-button" onClick={() => selectTask(task.id)} type="button">
                  <span className="task-row-heading">
                    <span className="task-title">{taskDisplayName(task)}</span>
                  </span>
                  <span className="task-badge-row">
                    <span className="task-badge" data-kind={`supervision-${bucket}`} title={supervisionTitle(task)}>
                      {supervisionBucketLabel(bucket)}
                    </span>
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
                </button>
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
                <button aria-label="Clear task" className="task-clear-button" onClick={() => onClearTask(task.id)} title="Clear task" type="button">
                  <svg aria-hidden="true" className="task-clear-icon" focusable="false" viewBox="0 0 16 16">
                    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                  </svg>
                </button>
              </div>
              {isExpanded ? (
                <div className="task-card-detail">
                  {isSelected && actionError ? <p className="task-action-error">{actionError}</p> : null}
                  <dl className="task-detail-grid">
                    <Info label="Agent" value={task.agentLabel || agentOrCommandLabel(task.command)} />
                    {task.agentPermissionLevel ? (
                      <Info label="Permission level" value={permissionLevelLabel(task.agentPermissionLevel)} />
                    ) : null}
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
                    {task.attachments?.length ? (
                      <>
                        <SectionLabel label="Attachments" />
                        {task.attachments.map((attachment) => (
                          <Info
                            key={attachment.id}
                            label={attachment.filename}
                            value={attachment.path}
                            wide
                          />
                        ))}
                      </>
                    ) : null}
                    <div className="task-detail-item">
                      <dt>Diff</dt>
                      <dd>
                        <TaskDiffStatus task={task} />
                      </dd>
                    </div>
                  </dl>
                  <RuntimeModelControl
                    agentProfiles={agentProfiles}
                    isConnected={isConnected}
                    task={task}
                    onApplyModel={onApplyModel}
                  />
                  {resumePreviewCommand ? (
                    <p className="resume-command-preview" title={resumePreviewCommand}>
                      <span>Resume command:</span>
                      <code>{resumePreviewCommand}</code>
                    </p>
                  ) : null}
                  <div className="task-detail-actions">
                    <button disabled={!canRerun} onClick={() => onRerunTask(task)} type="button">
                      Rerun command
                    </button>
                    <button disabled={!isConnected || task.status !== "running"} onClick={() => onInterruptTask(task)} type="button">
                      Interrupt
                    </button>
                    {resumeCommand ? (
                      <button disabled={!canResume} onClick={() => onResumeTask(task)} type="button">
                        Resume saved
                      </button>
                    ) : null}
                    {resumeLastCommand ? (
                      <button
                        data-priority="secondary"
                        disabled={!canResumeLast}
                        onClick={() => confirmResumeLast(task)}
                        type="button"
                      >
                        Resume last
                      </button>
                    ) : null}
                  </div>
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

function RuntimeModelControl({
  agentProfiles,
  isConnected,
  task,
  onApplyModel,
}: {
  agentProfiles: AgentProfile[];
  isConnected: boolean;
  task: Task;
  onApplyModel: (task: Task, model: string) => boolean;
}) {
  const modelOptions = useMemo(() => modelOptionsForTask(task, agentProfiles), [agentProfiles, task]);
  const runtimeCommand = runtimeModelSwitchCommandForTask(task, agentProfiles);
  const currentModel = currentTaskModel(task);
  const [selectedModel, setSelectedModel] = useState(currentModel);

  useEffect(() => {
    setSelectedModel(currentModel);
  }, [currentModel, task.id]);

  if (task.status !== "running" || !runtimeCommand || modelOptions.length === 0) {
    return null;
  }

  const canApply = isConnected && Boolean(selectedModel) && selectedModel !== "default" && selectedModel !== currentModel;

  return (
    <form
      className="task-runtime-model-control"
      onSubmit={(event) => {
        event.preventDefault();
        if (canApply) {
          onApplyModel(task, selectedModel);
        }
      }}
    >
      <label>
        <span>Model</span>
        <select
          aria-label="Runtime model"
          value={selectedModel}
          onChange={(event) => setSelectedModel(event.target.value)}
        >
          {modelOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button disabled={!canApply} type="submit">
        Apply
      </button>
    </form>
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

function permissionLevelLabel(permissionLevel: string | undefined) {
  if (permissionLevel === "full_access") return "Full access";
  if (permissionLevel === "workspace_write") return "Workspace write";
  if (permissionLevel === "read_only") return "Read only";
  return permissionLevel || "-";
}

function taskDisplayName(task: Task) {
  return displayTaskTitle(task.sessionLabel || task.title);
}

function displayTaskTitle(title: string | undefined) {
  return String(title || "").trim().replace(/^(?:Resume saved:\s*)+/i, "") || "Untitled task";
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

function timestampForSort(value: string | null | undefined) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

const codexFallbackModelOptions: ModelOption[] = [
  { id: "default", label: "Default" },
  { id: "gpt-5.5", label: "gpt-5.5" },
  { id: "gpt-5.5-thinking", label: "gpt-5.5 Thinking" },
];

function modelOptionsForTask(task: Task, agentProfiles: AgentProfile[]) {
  const profile = findAgentProfileForTask(task, agentProfiles);
  const configuredOptions = normalizeModelOptions(profile?.modelOptions);
  if (configuredOptions.length > 0) {
    return configuredOptions;
  }
  return isCodexLikeTask(task, profile) ? codexFallbackModelOptions : [];
}

function normalizeModelOptions(modelOptions: unknown) {
  if (!Array.isArray(modelOptions)) {
    return [];
  }

  const seen = new Set<string>();
  return modelOptions.reduce<ModelOption[]>((options, option) => {
    const id = typeof option === "string" ? option.trim() : String(option?.id || "").trim();
    const label = typeof option === "string" ? id : String(option?.label || id).trim();
    if (!id || seen.has(id)) {
      return options;
    }
    seen.add(id);
    options.push({ id, label: label || id });
    return options;
  }, []);
}

function runtimeModelSwitchCommandForTask(task: Task, agentProfiles: AgentProfile[]) {
  const profile = findAgentProfileForTask(task, agentProfiles);
  const configuredCommand = String(profile?.runtimeModelSwitchCommand || "").trim();
  if (configuredCommand) {
    return configuredCommand;
  }
  return isCodexLikeTask(task, profile) ? "/model {model}" : "";
}

function findAgentProfileForTask(task: Task, agentProfiles: AgentProfile[]) {
  return (
    agentProfiles.find((profile) => profile.id === task.agentProfileId) ??
    agentProfiles.find((profile) => profile.label === task.agentLabel) ??
    null
  );
}

function isCodexLikeTask(task: Task, profile: AgentProfile | null) {
  const haystack = `${profile?.id || ""} ${profile?.label || ""} ${task.agentProfileId || ""} ${task.agentLabel || ""} ${task.command}`.toLowerCase();
  return /\bcodex\b/.test(haystack);
}

function currentTaskModel(task: Task) {
  return String(task.agentModel || modelFromCommand(task.command) || "default").trim() || "default";
}

function modelFromCommand(command: string) {
  const match = String(command || "").match(/(?:^|\s)(?:--model|-m)\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
  return match?.[1] || match?.[2] || match?.[3] || "";
}

function resumeTaskKey(taskId: string, resumeCommand: string) {
  return `${taskId}:${resumeCommand}`;
}

function isCodexTask(task: Task) {
  return isCodexLikeTask(task, null);
}

function buildCodexResumeLastCommandForTask(task: Task) {
  const command = String(task.command || task.resumeCommand || task.agentSessionResumeCommand || "");
  return buildCodexResumeCommandForCommand(command, task.agentPermissionLevel, "--last");
}
