import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CreateTaskInput, OutputEvent, Task, TaskDeckContext } from "@taskdeck/web-shared";
import {
  appendOutputEventToQueue,
  buildProjectSuggestions,
  buildTaskTitle,
  drainOutputEventsForTask,
  getComposerInputPlaceholder,
  getComposerInputState,
  getComposerMode,
  isNativeSubagentTask,
  maxOutputQueueSeq,
  normalizeComposerInput,
  selectDefaultProjectPath,
  selectTaskIdForTaskList,
  sortTasksForDisplay,
  supervisionBucket,
  taskDisplayName,
  taskStateLabel,
  workspaceLabel,
} from "@taskdeck/web-shared";
import { taskIdentityCssProperties } from "./taskIdentity";

type ConnectionState = "connecting" | "connected" | "disconnected";
type PhoneView = "terminal" | "tasks";
type ActiveSheet = "new-session" | null;
type TaskFilter = "needs_you" | "running" | "all";
type PhoneTurnOptions = {
  agentModel?: string;
  agentReasoningEffort?: string;
};
type SelectedImageAttachment = {
  id: string;
  file: File;
};
type PendingTaskAttachment = {
  id: string;
  type: "image";
  filename: string;
  path: string;
  mimeType: string;
  size: number;
  createdAt: string;
  pending?: boolean;
};
type CodexReasoningEffortOption = {
  reasoningEffort: string;
  description: string;
};
type CodexModel = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: CodexReasoningEffortOption[];
};

type ServerMessage =
  | {
      type: "snapshot";
      tasks: Task[];
      runningTaskId?: string | null;
      runningTaskIds?: string[];
      codexModels?: CodexModel[];
      outputSeq?: number;
    }
  | {
      type: "tasks";
      tasks: Task[];
      runningTaskId?: string | null;
      runningTaskIds?: string[];
    }
  | { type: "started"; taskId: string }
  | { type: "codex-models"; models: CodexModel[] }
  | {
      type: "output";
      taskId: string;
      data: string;
      seq?: number;
      taskSeq?: number;
      role?: "user" | "assistant" | "taskdeck";
      kind?: string;
    }
  | { type: "error"; message: string }
  | { type: "input-rejected"; taskId: string; message: string; logged?: boolean };

const codexAppServerProfileId = "codex-app-server";
const fallbackReasoningEfforts = ["minimal", "low", "medium", "high", "xhigh"];
const logTailLength = 120_000;

export function PhoneApp() {
  const [view, setView] = useState<PhoneView>("tasks");
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [runningTaskIds, setRunningTaskIds] = useState<string[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [context, setContext] = useState<TaskDeckContext | null>(null);
  const [codexModels, setCodexModels] = useState<CodexModel[]>([]);
  const [outputEvents, setOutputEvents] = useState<OutputEvent[]>([]);
  const [clientMessage, setClientMessage] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const outputQueueSeqRef = useRef(0);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );

  const send = useCallback((payload: unknown) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  const applyTaskList = useCallback((nextTasks: Task[], nextRunningTaskIds: string[]) => {
    setTasks(nextTasks);
    setRunningTaskIds(nextRunningTaskIds);
    setSelectedTaskId((current) => selectTaskIdForTaskList(current, nextTasks, nextRunningTaskIds));
  }, []);

  useEffect(() => {
    let reconnectTimer: number | undefined;
    let closedByEffect = false;

    const connect = () => {
      setConnectionState("connecting");
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socketRef.current = socket;

      socket.addEventListener("open", () => setConnectionState("connected"));
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === "snapshot" || message.type === "tasks") {
          if (message.type === "snapshot" && message.codexModels) {
            setCodexModels(message.codexModels);
          }
          applyTaskList(message.tasks, getRunningTaskIdsFromMessage(message));
          return;
        }
        if (message.type === "started") {
          setSelectedTaskId(message.taskId);
          setView("terminal");
          setActiveSheet(null);
          return;
        }
        if (message.type === "output") {
          outputQueueSeqRef.current += 1;
          const nextEvent: OutputEvent = {
            seq: outputQueueSeqRef.current,
            taskId: message.taskId,
            data: message.data,
            serverSeq: positiveInteger(message.seq) || undefined,
            taskSeq: positiveInteger(message.taskSeq) || undefined,
            role: message.role,
            kind: message.kind,
          };
          setOutputEvents((current) => appendOutputEventToQueue(current, nextEvent));
          return;
        }
        if (message.type === "codex-models") {
          setCodexModels(message.models);
          return;
        }
        if (message.type === "input-rejected" && !message.logged) {
          setClientMessage(message.message || "Input was not sent.");
          return;
        }
        if (message.type === "error") {
          setClientMessage(message.message);
        }
      });

      socket.addEventListener("close", () => {
        if (closedByEffect) return;
        setConnectionState("disconnected");
        reconnectTimer = window.setTimeout(connect, 1000);
      });
    };

    connect();

    return () => {
      closedByEffect = true;
      window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [applyTaskList]);

  useEffect(() => {
    fetch("/api/context")
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load TaskDeck context.");
        return response.json();
      })
      .then((payload: TaskDeckContext) => setContext(payload))
      .catch((error) => setClientMessage(error instanceof Error ? error.message : "Unable to load TaskDeck context."));
  }, []);

  useEffect(() => {
    if (selectedTaskId) {
      setView("terminal");
    }
  }, [selectedTaskId]);

  const createTask = (input: CreateTaskInput) => {
    return send({ type: "start", ...input });
  };

  const selectTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    setView("terminal");
  };

  const sendInput = (taskId: string, data: string, turnOptions: PhoneTurnOptions = {}) => {
    return send({ type: "input", taskId, data, source: "composer-agent", ...turnOptions });
  };

  const stopTurn = (taskId: string) => {
    return send({ type: "codex-app-server-interrupt-turn", taskId });
  };

  const resolveRequest = (taskId: string, requestId: string | number, action: "approve" | "decline" | "cancel") => {
    return send({ type: "codex-app-server-request", taskId, requestId, action });
  };

  return (
    <main className="phone-shell">
      <div className="phone-view">
        {view === "terminal" ? (
          <TerminalView
            clientMessage={clientMessage}
            codexModels={codexModels}
            connectionState={connectionState}
            outputEvents={outputEvents}
            onOpenNewSession={() => setActiveSheet("new-session")}
            onOpenTasks={() => setView("tasks")}
            onResolveRequest={resolveRequest}
            onSendInput={sendInput}
            onStopTurn={stopTurn}
            task={selectedTask}
          />
        ) : (
          <TasksView
            connectionState={connectionState}
            onOpenNewSession={() => setActiveSheet("new-session")}
            onSelectTask={selectTask}
            runningTaskIds={runningTaskIds}
            selectedTaskId={selectedTaskId}
            tasks={tasks}
          />
        )}
      </div>
      {activeSheet === "new-session" ? (
        <NewSessionSheet
          context={context}
          disabled={connectionState !== "connected"}
          onClose={() => setActiveSheet(null)}
          onCreateTask={createTask}
        />
      ) : null}
    </main>
  );
}

function TerminalView({
  clientMessage,
  codexModels,
  connectionState,
  outputEvents,
  task,
  onOpenNewSession,
  onOpenTasks,
  onResolveRequest,
  onSendInput,
  onStopTurn,
}: {
  clientMessage: string;
  codexModels: CodexModel[];
  connectionState: ConnectionState;
  outputEvents: OutputEvent[];
  task: Task | null;
  onOpenNewSession: () => void;
  onOpenTasks: () => void;
  onResolveRequest: (taskId: string, requestId: string | number, action: "approve" | "decline" | "cancel") => boolean;
  onSendInput: (taskId: string, data: string, turnOptions?: PhoneTurnOptions) => boolean;
  onStopTurn: (taskId: string) => boolean;
}) {
  return (
    <section className="terminal-view" aria-label="Terminal">
      <header className="phone-topbar">
        <button aria-label="Show tasks" className="icon-button" onClick={onOpenTasks} type="button">
          <svg aria-hidden="true" viewBox="0 0 16 16">
            <path d="M3 4.5h10M3 8h10M3 11.5h10" />
          </svg>
        </button>
        <div className="phone-topbar-title">
          <strong>{task ? taskDisplayName(task) : "Terminal"}</strong>
          <span>{task ? `${workspaceLabel(task.cwd)} / ${taskStateLabel(task)}` : connectionState}</span>
        </div>
        <button aria-label="New session" className="icon-button" onClick={onOpenNewSession} type="button">
          <svg aria-hidden="true" viewBox="0 0 16 16">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      </header>
      <div className="phone-status-slot">
        {clientMessage ? <p className="phone-status-message">{clientMessage}</p> : null}
      </div>
      <PhoneTerminalOutput outputEvents={outputEvents} task={task} />
      <div className="phone-request-slot">
        <PhoneRequestBar connectionState={connectionState} onResolveRequest={onResolveRequest} task={task} />
      </div>
      <PhoneComposer
        codexModels={codexModels}
        connectionState={connectionState}
        onSendInput={onSendInput}
        onStopTurn={onStopTurn}
        task={task}
      />
    </section>
  );
}

function TasksView({
  connectionState,
  onOpenNewSession,
  onSelectTask,
  runningTaskIds,
  selectedTaskId,
  tasks,
}: {
  connectionState: ConnectionState;
  onOpenNewSession: () => void;
  onSelectTask: (taskId: string) => void;
  runningTaskIds: string[];
  selectedTaskId: string | null;
  tasks: Task[];
}) {
  const [filter, setFilter] = useState<TaskFilter>("all");
  const runningTaskIdSet = useMemo(() => new Set(runningTaskIds), [runningTaskIds]);
  const orderedTasks = useMemo(() => sortTasksForDisplay(tasks), [tasks]);
  const visibleTasks = orderedTasks.filter((task) => matchesTaskFilter(task, filter, runningTaskIdSet));

  return (
    <section className="tasks-view" aria-label="Tasks">
      <header className="phone-topbar">
        <div className="phone-topbar-title">
          <strong>Tasks</strong>
          <span>{connectionState}</span>
        </div>
        <button aria-label="New session" className="icon-button" onClick={onOpenNewSession} type="button">
          <svg aria-hidden="true" viewBox="0 0 16 16">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      </header>
      <div className="phone-filter-row" aria-label="Task filters">
        {(["all", "needs_you", "running"] as TaskFilter[]).map((nextFilter) => (
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
      <div className="phone-task-list">
        {tasks.length === 0 ? <p className="empty-state">No tasks yet.</p> : null}
        {tasks.length > 0 && visibleTasks.length === 0 ? <p className="empty-state">No tasks match this filter.</p> : null}
        {visibleTasks.map((task) => (
          <button
            className="phone-task-card"
            data-selected={task.id === selectedTaskId ? "true" : undefined}
            key={task.id}
            onClick={() => onSelectTask(task.id)}
            style={taskIdentityCssProperties({ taskId: task.id, identityColorSlot: task.identityColorSlot })}
            type="button"
          >
            <span className="phone-task-card-main">
              <strong>{taskDisplayName(task)}</strong>
              <span>{workspaceLabel(task.cwd)}</span>
            </span>
            <span className="phone-task-card-badges">
              <span data-kind={`supervision-${supervisionBucket(task)}`}>
                {supervisionBucket(task) === "needs_you" ? "Needs you" : "Not now"}
              </span>
              <span data-kind={taskStateBadgeKind(task)}>{taskStateLabel(task)}</span>
            </span>
            <span className="phone-task-card-meta">
              <span>{formatTime(task.updatedAt)}</span>
              {task.codexAppServerTurnActive ? <span data-kind="turn-active">Running turn</span> : null}
              {task.codexAppServerRequest ? <span data-kind="request">Request</span> : null}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function PhoneTerminalOutput({ outputEvents, task }: { outputEvents: OutputEvent[]; task: Task | null }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const outputEventsRef = useRef<OutputEvent[]>([]);
  const loadingTaskIdRef = useRef<string | null>(null);
  const appliedTaskSeqByTaskIdRef = useRef<Record<string, number>>({});
  const lastAppliedQueueSeqRef = useRef(0);
  const [rawLog, setRawLog] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const taskId = task?.id ?? null;
  const outputText = useMemo(() => stripAnsiControlSequences(rawLog), [rawLog]);
  const outputSegments = useMemo(() => segmentOutputText(outputText), [outputText]);

  useEffect(() => {
    outputEventsRef.current = outputEvents;
  }, [outputEvents]);

  useEffect(() => {
    setRawLog(task ? "Loading task log...\n" : "No task selected.\n");
    if (!task) {
      loadingTaskIdRef.current = null;
      return undefined;
    }

    const loadingTaskId = task.id;
    const reloadStartQueueSeq = maxOutputQueueSeq(outputEventsRef.current);
    loadingTaskIdRef.current = loadingTaskId;
    const abortController = new AbortController();
    fetch(`/api/tasks/${loadingTaskId}/logs?tail=${logTailLength}`, { signal: abortController.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load task logs.");
        return response.json();
      })
      .then((payload: { logs?: string; taskSeq?: number; truncated?: boolean }) => {
        if (abortController.signal.aborted) {
          return;
        }
        const loadedTaskSeq = positiveInteger(payload.taskSeq);
        appliedTaskSeqByTaskIdRef.current[loadingTaskId] = loadedTaskSeq;
        lastAppliedQueueSeqRef.current = Math.max(lastAppliedQueueSeqRef.current, reloadStartQueueSeq);
        const queuedDrain = drainOutputEventsForTask({
          events: outputEventsRef.current,
          taskId: loadingTaskId,
          lastQueueSeq: lastAppliedQueueSeqRef.current,
          lastTaskSeq: loadedTaskSeq,
        });
        appliedTaskSeqByTaskIdRef.current[loadingTaskId] = queuedDrain.nextTaskSeq;
        lastAppliedQueueSeqRef.current = queuedDrain.nextQueueSeq;
        const replayHeader = payload.truncated
          ? `[TaskDeck] Showing last ${logTailLength.toLocaleString()} characters of persisted log.\n`
          : "";
        setRawLog(`${replayHeader}${payload.logs || ""}${queuedDrain.gap ? "" : queuedDrain.text}`);
        loadingTaskIdRef.current = null;
      })
      .catch(() => {
        if (!abortController.signal.aborted) {
          setRawLog("[TaskDeck] Unable to load task logs.\n");
          loadingTaskIdRef.current = null;
        }
      });

    return () => abortController.abort();
  }, [reloadToken, task?.id]);

  useEffect(() => {
    if (!taskId || loadingTaskIdRef.current === taskId) return;
    const lastTaskSeq = appliedTaskSeqByTaskIdRef.current[taskId] || 0;
    const drainedOutput = drainOutputEventsForTask({
      events: outputEvents,
      taskId,
      lastQueueSeq: lastAppliedQueueSeqRef.current,
      lastTaskSeq,
    });
    if (drainedOutput.gap) {
      setReloadToken((current) => current + 1);
      return;
    }
    appliedTaskSeqByTaskIdRef.current[taskId] = drainedOutput.nextTaskSeq;
    lastAppliedQueueSeqRef.current = drainedOutput.nextQueueSeq;
    if (!drainedOutput.text) return;
    setRawLog((current) => `${current}${drainedOutput.text}`.slice(-logTailLength));
  }, [outputEvents, taskId]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [rawLog]);

  return (
    <div
      className="phone-output"
      data-has-task={task ? "true" : undefined}
      ref={viewportRef}
      style={task ? taskIdentityCssProperties({ taskId: task.id, identityColorSlot: task.identityColorSlot }) : undefined}
    >
      <pre>
        {outputSegments.map((segment, index) => (
          <span data-output-tone={segment.tone} key={index}>
            {segment.text}
          </span>
        ))}
      </pre>
    </div>
  );
}

function PhoneRequestBar({
  task,
  connectionState,
  onResolveRequest,
}: {
  task: Task | null;
  connectionState: ConnectionState;
  onResolveRequest: (taskId: string, requestId: string | number, action: "approve" | "decline" | "cancel") => boolean;
}) {
  const request = task?.codexAppServerRequest ?? null;
  if (!task || !request) {
    return null;
  }
  const canResolve = connectionState === "connected" && task.status === "running" && !isNativeSubagentTask(task);
  return (
    <section className="phone-request-bar" aria-label="Codex request">
      <div>
        <strong>{request.title}</strong>
        {request.detail ? <span>{request.detail}</span> : null}
      </div>
      <div className="phone-request-actions">
        {request.canApprove ? (
          <button disabled={!canResolve} onClick={() => onResolveRequest(task.id, request.id, "approve")} type="button">
            Approve
          </button>
        ) : null}
        {request.canDecline ? (
          <button disabled={!canResolve} onClick={() => onResolveRequest(task.id, request.id, "decline")} type="button">
            Decline
          </button>
        ) : null}
        {request.canCancel ? (
          <button disabled={!canResolve} onClick={() => onResolveRequest(task.id, request.id, "cancel")} type="button">
            Cancel
          </button>
        ) : null}
      </div>
    </section>
  );
}

function PhoneComposer({
  codexModels,
  connectionState,
  task,
  onSendInput,
  onStopTurn,
}: {
  codexModels: CodexModel[];
  connectionState: ConnectionState;
  task: Task | null;
  onSendInput: (taskId: string, data: string, turnOptions?: PhoneTurnOptions) => boolean;
  onStopTurn: (taskId: string) => boolean;
}) {
  const [value, setValue] = useState("");
  const [selectedImages, setSelectedImages] = useState<SelectedImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState("");
  const [isStopRequested, setIsStopRequested] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const isCodexAppServerTask = task?.agentProfileId === codexAppServerProfileId;
  const isCodexAppServerTurnActive = Boolean(isCodexAppServerTask && task?.codexAppServerTurnActive);
  const isReadOnlyProjection = Boolean(task && isNativeSubagentTask(task));
  const canSend = Boolean(
    task &&
      connectionState === "connected" &&
      task.status === "running" &&
      !isReadOnlyProjection &&
      !task.inputLockedAt &&
      !isCodexAppServerTurnActive,
  );
  const hasComposerContent = Boolean(value || selectedImages.length);
  const canSubmit = canSend && hasComposerContent && !isUploadingAttachments;
  const canStop = Boolean(
    task &&
      connectionState === "connected" &&
      task.status === "running" &&
      !isReadOnlyProjection &&
      isCodexAppServerTurnActive &&
      !isStopRequested,
  );
  const modeText = getComposerMode(task, connectionState === "connected", { isCodexAppServerTurnActive });
  const inputState = getComposerInputState({
    task,
    isConnected: connectionState === "connected",
    isUploadingAttachments,
    isCodexAppServerTurnActive,
  });
  const placeholder = getComposerInputPlaceholder({
    canSend,
    isCodexAppServerTask: Boolean(isCodexAppServerTask),
    isCodexAppServerTurnActive,
    modeText,
  });
  const modelOptions = useMemo(
    () => ensureSelectedModelOption(codexModels, selectedModel || task?.agentModel || ""),
    [codexModels, selectedModel, task?.agentModel],
  );
  const selectedModelOption = modelOptions.find((model) => model.model === selectedModel) ?? null;
  const reasoningEffortOptions = useMemo(
    () => getReasoningEffortOptions(selectedModelOption, selectedReasoningEffort),
    [selectedModelOption, selectedReasoningEffort],
  );
  const canConfigureTurn = Boolean(
    isCodexAppServerTask &&
      task &&
      connectionState === "connected" &&
      task.status === "running" &&
      !isReadOnlyProjection &&
      !task.inputLockedAt &&
      !isCodexAppServerTurnActive,
  );
  const actionLabel = isCodexAppServerTurnActive ? "Stop active Codex turn" : "Send input to running task";

  useEffect(() => {
    setSelectedModel(String(task?.agentModel || "").trim());
    setSelectedReasoningEffort(String(task?.agentReasoningEffort || "").trim());
    setIsStopRequested(false);
  }, [task?.agentModel, task?.agentReasoningEffort, task?.id]);

  useEffect(() => {
    if (!isCodexAppServerTurnActive) {
      setIsStopRequested(false);
    }
  }, [isCodexAppServerTurnActive]);

  useEffect(() => {
    if (!isStopRequested || !isCodexAppServerTurnActive) {
      return;
    }
    const retryTimer = window.setTimeout(() => setIsStopRequested(false), 2000);
    return () => window.clearTimeout(retryTimer);
  }, [isCodexAppServerTurnActive, isStopRequested]);

  useEffect(() => {
    if (!selectedModel && modelOptions.length > 0) {
      const defaultModel = modelOptions.find((model) => model.isDefault) ?? modelOptions[0];
      setSelectedModel(defaultModel.model);
      return;
    }
    if (!selectedReasoningEffort && selectedModelOption?.defaultReasoningEffort) {
      setSelectedReasoningEffort(selectedModelOption.defaultReasoningEffort);
    }
  }, [modelOptions, selectedModel, selectedModelOption, selectedReasoningEffort]);

  const changeSelectedModel = (model: string) => {
    setSelectedModel(model);
    const nextModel = modelOptions.find((option) => option.model === model);
    setSelectedReasoningEffort(nextModel?.defaultReasoningEffort || "");
  };

  const handleImageSelection = (event: ChangeEvent<HTMLInputElement>) => {
    if (!canSend) {
      event.target.value = "";
      return;
    }

    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    const supportedImages = files.filter((file) => isSupportedImage(file));
    if (supportedImages.length !== files.length) {
      setAttachmentError("PNG, JPEG, or WebP images only.");
    } else {
      setAttachmentError("");
    }

    setSelectedImages((current) => [
      ...current,
      ...supportedImages.map((file) => ({
        id: crypto.randomUUID(),
        file,
      })),
    ]);
  };

  const removeSelectedImage = (imageId: string) => {
    setSelectedImages((current) => current.filter((image) => image.id !== imageId));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!task || !canSubmit) return;
    try {
      setIsUploadingAttachments(true);
      setAttachmentError("");
      const uploadedAttachments = await uploadSelectedImages(selectedImages);
      const didSend = onSendInput(task.id, normalizeInput(appendAttachmentContext(value, uploadedAttachments)), {
        agentModel: selectedModel,
        agentReasoningEffort: selectedReasoningEffort,
      });
      if (didSend) {
        setValue("");
        setSelectedImages([]);
      }
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Unable to attach images.");
    } finally {
      setIsUploadingAttachments(false);
    }
  };

  return (
    <form className="phone-composer" data-input-state={inputState} onSubmit={submit}>
      {selectedImages.length > 0 ? (
        <div className="phone-attachment-chip-list" aria-label="Selected image attachments">
          {selectedImages.map((image) => (
            <span className="phone-attachment-chip" key={image.id}>
              <span>{image.file.name}</span>
              <button
                aria-label={`Remove ${image.file.name}`}
                onClick={() => removeSelectedImage(image.id)}
                title="Remove attachment"
                type="button"
              >
                <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
                  <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {attachmentError ? <small className="phone-attachment-error">{attachmentError}</small> : null}
      <div className="phone-composer-inner">
        <textarea
          disabled={!task}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          rows={1}
          value={value}
        />
        <div className="phone-composer-footer">
          <div className="phone-composer-footer-start">
            <button
              aria-label="Attach image"
              className="phone-composer-attach"
              disabled={!canSend || isUploadingAttachments}
              onClick={() => imageInputRef.current?.click()}
              title="Attach image"
              type="button"
            >
              <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
                <path d="M8 3v10M3 8h10" />
              </svg>
            </button>
            <input
              ref={imageInputRef}
              accept="image/png,image/jpeg,image/webp"
              className="visually-hidden"
              multiple
              onChange={handleImageSelection}
              type="file"
            />
          </div>
          <div className="phone-composer-footer-end">
            {isCodexAppServerTask ? (
              <>
                <label className="phone-composer-option-control" title={selectedModelOption?.description || "Model"}>
                  <span className="visually-hidden">Model</span>
                  <select
                    aria-label="Model for next instruction"
                    disabled={!canConfigureTurn || modelOptions.length === 0}
                    onChange={(event) => changeSelectedModel(event.target.value)}
                    value={selectedModel}
                  >
                    {modelOptions.map((model) => (
                      <option key={model.model} value={model.model}>
                        {model.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="phone-composer-option-control">
                  <span className="visually-hidden">Reasoning effort</span>
                  <select
                    aria-label="Reasoning effort for next instruction"
                    disabled={!canConfigureTurn || reasoningEffortOptions.length === 0}
                    onChange={(event) => setSelectedReasoningEffort(event.target.value)}
                    value={selectedReasoningEffort}
                  >
                    {reasoningEffortOptions.map((effort) => (
                      <option key={effort} value={effort}>
                        {formatReasoningEffort(effort)}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            {isCodexAppServerTurnActive ? (
              <button
                aria-label={actionLabel}
                className="phone-composer-primary"
                data-action="stop"
                disabled={!canStop}
                onClick={() => {
                  if (task && onStopTurn(task.id)) {
                    setIsStopRequested(true);
                  }
                }}
                title={actionLabel}
                type="button"
              >
                <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
                  <rect height="7" rx="1" width="7" x="4.5" y="4.5" />
                </svg>
              </button>
            ) : (
              <button
                aria-label={actionLabel}
                className="phone-composer-primary"
                data-action="send"
                disabled={!canSubmit}
                title={actionLabel}
                type="submit"
              >
                <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
                  <path d="M8 13V3M4 7l4-4 4 4" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

function NewSessionSheet({
  context,
  disabled,
  onClose,
  onCreateTask,
}: {
  context: TaskDeckContext | null;
  disabled: boolean;
  onClose: () => void;
  onCreateTask: (input: CreateTaskInput) => boolean;
}) {
  const projectSuggestions = useMemo(() => buildProjectSuggestions(context), [context]);
  const [projectPath, setProjectPath] = useState("");
  const [teamTemplateId, setTeamTemplateId] = useState("");

  useEffect(() => {
    if (!projectSuggestions.length) return;
    if (!projectPath || !projectSuggestions.some((project) => project.path === projectPath)) {
      setProjectPath(selectDefaultProjectPath(projectSuggestions, context?.defaultCwd));
    }
  }, [context?.defaultCwd, projectPath, projectSuggestions]);

  const profile = context?.agentProfiles.find((agentProfile) => agentProfile.id === codexAppServerProfileId) ?? null;
  const teamTemplates = (context?.teamTemplates ?? []).filter((template) => template.agentProfileId === codexAppServerProfileId);
  const selectedTemplate = teamTemplates.find((template) => template.id === teamTemplateId) ?? null;
  const command = profile?.command.trim() ?? "";
  const canStart = !disabled && Boolean(profile) && Boolean(projectPath) && Boolean(command);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canStart || !profile) return;
    const didCreate = onCreateTask({
      title: buildTaskTitle(profile.label, projectPath),
      command,
      cwd: projectPath,
      agentProfileId: profile.id,
      agentLabel: profile.label,
      agentModel: context?.defaultModel?.trim() || undefined,
      sessionMode: "new",
      teamTemplateId: selectedTemplate?.id || undefined,
    });
    if (didCreate) {
      onClose();
    }
  };

  return (
    <div className="phone-sheet-backdrop" role="presentation">
      <section aria-label="New session" aria-modal="true" className="phone-sheet" role="dialog">
        <header className="phone-sheet-header">
          <strong>New Session</strong>
          <button aria-label="Close new session" className="icon-button" onClick={onClose} type="button">
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
            </svg>
          </button>
        </header>
        <form className="phone-new-session-form" onSubmit={submit}>
          <label>
            <span>Project</span>
            <select onChange={(event) => setProjectPath(event.target.value)} value={projectPath}>
              {projectSuggestions.map((project) => (
                <option key={project.path} value={project.path}>
                  {project.label}
                </option>
              ))}
            </select>
          </label>
          {teamTemplates.length > 0 ? (
            <label>
              <span>Team template</span>
              <select onChange={(event) => setTeamTemplateId(event.target.value)} value={teamTemplateId}>
                <option value="">None</option>
                {teamTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button disabled={!canStart} type="submit">
            Start Codex Session
          </button>
        </form>
      </section>
    </div>
  );
}

function getRunningTaskIdsFromMessage(message: { runningTaskId?: string | null; runningTaskIds?: string[] }) {
  if (Array.isArray(message.runningTaskIds)) {
    return message.runningTaskIds;
  }
  return message.runningTaskId ? [message.runningTaskId] : [];
}

function matchesTaskFilter(task: Task, filter: TaskFilter, runningTaskIds: Set<string>) {
  if (filter === "needs_you") {
    return supervisionBucket(task) === "needs_you";
  }
  if (filter === "running") {
    return task.status === "running" || runningTaskIds.has(task.id);
  }
  return true;
}

function filterLabel(filter: TaskFilter) {
  if (filter === "needs_you") return "Needs you";
  if (filter === "running") return "Running";
  return "All";
}

function taskStateBadgeKind(task: Task) {
  const attentionState = task.attentionState || "none";
  if (task.status === "running" && attentionState !== "none") {
    return `attention-${attentionState}`;
  }
  if (task.status !== "running") {
    return `process-${task.status}`;
  }
  return `agent-${task.agentState}`;
}

function formatTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function normalizeInput(value: string) {
  return normalizeComposerInput(value).trim();
}

function ensureSelectedModelOption(models: CodexModel[], selectedModel: string) {
  if (!selectedModel || models.some((model) => model.model === selectedModel)) {
    return models;
  }
  return [
    {
      id: selectedModel,
      model: selectedModel,
      displayName: selectedModel,
      description: "",
      isDefault: false,
      defaultReasoningEffort: "",
      supportedReasoningEfforts: [],
    },
    ...models,
  ];
}

function getReasoningEffortOptions(model: CodexModel | null, selectedEffort: string) {
  const advertised = model?.supportedReasoningEfforts.map((option) => option.reasoningEffort) ?? [];
  const options = advertised.length > 0 ? advertised : ["", ...fallbackReasoningEfforts];
  return selectedEffort && !options.includes(selectedEffort) ? [selectedEffort, ...options] : options;
}

function formatReasoningEffort(effort: string) {
  if (!effort) return "Default";
  if (effort === "none") return "None";
  if (effort === "minimal") return "Minimal";
  if (effort === "low") return "Low";
  if (effort === "medium") return "Medium";
  if (effort === "high") return "High";
  if (effort === "xhigh") return "Extra high";
  return effort;
}

async function uploadSelectedImages(images: SelectedImageAttachment[]) {
  const uploadedAttachments: PendingTaskAttachment[] = [];

  for (const image of images) {
    const response = await fetch("/api/attachments", {
      method: "POST",
      headers: {
        "Content-Type": image.file.type,
        "X-TaskDeck-Filename": encodeURIComponent(image.file.name),
      },
      body: image.file,
    });
    const payload = await readJsonResponse<{ attachment?: PendingTaskAttachment; error?: string }>(response);
    if (!response.ok) {
      throw new Error(payload?.error || formatUploadFailure(response));
    }
    if (!payload) {
      throw new Error("TaskDeck server returned an empty response.");
    }
    if (!payload.attachment) {
      throw new Error(payload.error || "Unable to upload image.");
    }
    uploadedAttachments.push(payload.attachment);
  }

  return uploadedAttachments;
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`TaskDeck server returned a non-JSON response (${response.status} ${response.statusText}).`);
  }
}

function formatUploadFailure(response: Response) {
  const statusText = response.statusText || "Upload failed";
  return `Attachment upload failed: ${response.status} ${statusText}.`;
}

function isSupportedImage(file: File) {
  return ["image/png", "image/jpeg", "image/webp"].includes(file.type);
}

function appendAttachmentContext(input: string, attachments: PendingTaskAttachment[]) {
  if (!attachments.length) {
    return input;
  }

  const attachmentBlock = [
    "Attached images:",
    ...attachments.map((attachment) => `- ${attachment.path}`),
  ].join("\n");
  const instruction = input.trim();
  return instruction ? `${instruction}\n\n${attachmentBlock}` : attachmentBlock;
}

function positiveInteger(value: unknown) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

function stripAnsiControlSequences(value: string) {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[PX^_].*?\x1b\\/g, "")
    .replace(/\r/g, "\n");
}

type OutputSegmentTone =
  | "assistant"
  | "user"
  | "taskdeck"
  | "command"
  | "warning"
  | "error"
  | "debug"
  | "metadata";

type OutputSegment = {
  text: string;
  tone: OutputSegmentTone;
};

function segmentOutputText(value: string): OutputSegment[] {
  if (!value) {
    return [];
  }

  const segments: OutputSegment[] = [];
  let currentTone: OutputSegmentTone = "taskdeck";
  let inCommandOutput = false;
  const lines = value.match(/[^\n]*\n|[^\n]+/g) || [];

  for (const line of lines) {
    const lineTone = classifyOutputLine(line, { inCommandOutput, currentTone });
    inCommandOutput = lineTone.inCommandOutput;
    currentTone = lineTone.tone;
    const previousSegment = segments[segments.length - 1];
    if (previousSegment?.tone === lineTone.tone) {
      previousSegment.text += line;
    } else {
      segments.push({ text: line, tone: lineTone.tone });
    }
  }

  return segments;
}

function classifyOutputLine(
  line: string,
  state: { inCommandOutput: boolean; currentTone: OutputSegmentTone },
): { tone: OutputSegmentTone; inCommandOutput: boolean } {
  const trimmed = line.trimStart();

  if (trimmed.startsWith("[Assistant]")) {
    return { tone: "assistant", inCommandOutput: false };
  }
  if (trimmed.startsWith("[You]")) {
    return { tone: "user", inCommandOutput: false };
  }
  if (trimmed.startsWith("[TaskDeck -> Codex App Server]")) {
    return { tone: "debug", inCommandOutput: false };
  }
  if (trimmed.startsWith("[TaskDeck] Codex App Server command output:")) {
    return { tone: "command", inCommandOutput: true };
  }
  if (trimmed.startsWith("[TaskDeck]")) {
    return {
      tone: taskDeckLineTone(trimmed),
      inCommandOutput: false,
    };
  }
  if (state.inCommandOutput) {
    return { tone: "command", inCommandOutput: true };
  }
  return { tone: state.currentTone, inCommandOutput: false };
}

function taskDeckLineTone(line: string): OutputSegmentTone {
  const lowered = line.toLocaleLowerCase();
  if (
    lowered.includes("failed") ||
    lowered.includes("error") ||
    lowered.includes("unauthorized") ||
    lowered.includes("invalid") ||
    lowered.includes("revoked")
  ) {
    return "error";
  }
  if (
    lowered.includes("login required") ||
    lowered.includes("needs chatgpt") ||
    lowered.includes("approval request") ||
    lowered.includes("user-input request") ||
    lowered.includes("waiting for user")
  ) {
    return "warning";
  }
  if (lowered.includes("native subagent") || lowered.includes("thread ready")) {
    return "metadata";
  }
  return "taskdeck";
}
