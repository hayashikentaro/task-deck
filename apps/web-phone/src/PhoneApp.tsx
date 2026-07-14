import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CreateTaskInput, OutputEvent, Task, TaskDeckContext } from "@taskdeck/web-shared";
import {
  buildProjectSuggestions,
  buildTaskTitle,
  selectDefaultProjectPath,
  selectTaskIdForTaskList,
  sortTasksForDisplay,
  supervisionBucket,
  taskDisplayName,
  taskStateLabel,
  workspaceLabel,
} from "@taskdeck/web-shared";

type ConnectionState = "connecting" | "connected" | "disconnected";
type PhoneView = "terminal" | "tasks";
type ActiveSheet = "new-session" | null;
type TaskFilter = "needs_you" | "running" | "all";

type ServerMessage =
  | {
      type: "snapshot";
      tasks: Task[];
      runningTaskId?: string | null;
      runningTaskIds?: string[];
      outputSeq?: number;
    }
  | {
      type: "tasks";
      tasks: Task[];
      runningTaskId?: string | null;
      runningTaskIds?: string[];
    }
  | { type: "started"; taskId: string }
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

export function PhoneApp() {
  const [view, setView] = useState<PhoneView>("tasks");
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [runningTaskIds, setRunningTaskIds] = useState<string[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [context, setContext] = useState<TaskDeckContext | null>(null);
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
          setOutputEvents((current) => [...current.slice(-399), nextEvent]);
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

  const sendInput = (taskId: string, data: string) => {
    return send({ type: "input", taskId, data, source: "composer-agent" });
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
      <BottomNav
        activeView={view}
        onOpenNewSession={() => setActiveSheet("new-session")}
        onShowTasks={() => setView("tasks")}
        onShowTerminal={() => setView("terminal")}
        terminalDisabled={!selectedTask}
      />
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
  connectionState: ConnectionState;
  outputEvents: OutputEvent[];
  task: Task | null;
  onOpenNewSession: () => void;
  onOpenTasks: () => void;
  onResolveRequest: (taskId: string, requestId: string | number, action: "approve" | "decline" | "cancel") => boolean;
  onSendInput: (taskId: string, data: string) => boolean;
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
      {clientMessage ? <p className="phone-status-message">{clientMessage}</p> : null}
      <PhoneTerminalOutput outputEvents={outputEvents} task={task} />
      <PhoneRequestBar onResolveRequest={onResolveRequest} task={task} />
      <PhoneComposer connectionState={connectionState} onSendInput={onSendInput} onStopTurn={onStopTurn} task={task} />
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
  const [filter, setFilter] = useState<TaskFilter>("needs_you");
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
        {(["needs_you", "running", "all"] as TaskFilter[]).map((nextFilter) => (
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
            type="button"
          >
            <span className="phone-task-card-main">
              <strong>{taskDisplayName(task)}</strong>
              <span>{workspaceLabel(task.cwd)}</span>
            </span>
            <span className="phone-task-card-badges">
              <span data-kind={supervisionBucket(task)}>{supervisionBucket(task) === "needs_you" ? "Needs you" : "Not now"}</span>
              <span>{taskStateLabel(task)}</span>
            </span>
            <span className="phone-task-card-meta">
              <span>{formatTime(task.updatedAt)}</span>
              {task.codexAppServerTurnActive ? <span>Running turn</span> : null}
              {task.codexAppServerRequest ? <span>Request</span> : null}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function PhoneTerminalOutput({ outputEvents, task }: { outputEvents: OutputEvent[]; task: Task | null }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [rawLog, setRawLog] = useState("");
  const [lastAppliedSeq, setLastAppliedSeq] = useState(0);
  const taskId = task?.id ?? null;

  useEffect(() => {
    setRawLog(task ? "Loading task log...\n" : "No task selected.\n");
    setLastAppliedSeq(0);
    if (!task) return undefined;

    const abortController = new AbortController();
    fetch(`/api/tasks/${task.id}/logs?tail=120000`, { signal: abortController.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load task logs.");
        return response.json();
      })
      .then((payload: { logs?: string }) => setRawLog(payload.logs || ""))
      .catch(() => {
        if (!abortController.signal.aborted) {
          setRawLog("[TaskDeck] Unable to load task logs.\n");
        }
      });

    return () => abortController.abort();
  }, [task?.id]);

  useEffect(() => {
    if (!taskId) return;
    const nextEvents = outputEvents.filter((event) => event.taskId === taskId && event.seq > lastAppliedSeq);
    if (nextEvents.length === 0) return;
    setLastAppliedSeq(nextEvents[nextEvents.length - 1].seq);
    setRawLog((current) => `${current}${nextEvents.map((event) => event.data).join("")}`.slice(-120000));
  }, [lastAppliedSeq, outputEvents, taskId]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [rawLog]);

  return (
    <div className="phone-output" ref={viewportRef}>
      <pre>{stripAnsiControlSequences(rawLog)}</pre>
    </div>
  );
}

function PhoneRequestBar({
  task,
  onResolveRequest,
}: {
  task: Task | null;
  onResolveRequest: (taskId: string, requestId: string | number, action: "approve" | "decline" | "cancel") => boolean;
}) {
  const request = task?.codexAppServerRequest ?? null;
  if (!task || !request) {
    return null;
  }
  return (
    <section className="phone-request-bar" aria-label="Codex request">
      <div>
        <strong>{request.title}</strong>
        {request.detail ? <span>{request.detail}</span> : null}
      </div>
      <div className="phone-request-actions">
        {request.canApprove ? (
          <button onClick={() => onResolveRequest(task.id, request.id, "approve")} type="button">
            Approve
          </button>
        ) : null}
        {request.canDecline ? (
          <button onClick={() => onResolveRequest(task.id, request.id, "decline")} type="button">
            Decline
          </button>
        ) : null}
        {request.canCancel ? (
          <button onClick={() => onResolveRequest(task.id, request.id, "cancel")} type="button">
            Cancel
          </button>
        ) : null}
      </div>
    </section>
  );
}

function PhoneComposer({
  connectionState,
  task,
  onSendInput,
  onStopTurn,
}: {
  connectionState: ConnectionState;
  task: Task | null;
  onSendInput: (taskId: string, data: string) => boolean;
  onStopTurn: (taskId: string) => boolean;
}) {
  const [value, setValue] = useState("");
  const canSend = Boolean(
    task &&
      connectionState === "connected" &&
      task.status === "running" &&
      !task.inputLockedAt &&
      !task.codexAppServerTurnActive &&
      value.trim(),
  );
  const canStop = Boolean(task && connectionState === "connected" && task.codexAppServerTurnActive);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!task || !canSend) return;
    const didSend = onSendInput(task.id, normalizeInput(value));
    if (didSend) {
      setValue("");
    }
  };

  return (
    <form className="phone-composer" onSubmit={submit}>
      <textarea
        disabled={!task}
        onChange={(event) => setValue(event.target.value)}
        placeholder={task ? composerPlaceholder(task, connectionState) : "No task selected"}
        rows={2}
        value={value}
      />
      {task?.codexAppServerTurnActive ? (
        <button disabled={!canStop} onClick={() => task && onStopTurn(task.id)} type="button">
          Stop
        </button>
      ) : (
        <button disabled={!canSend} type="submit">
          Send
        </button>
      )}
    </form>
  );
}

function BottomNav({
  activeView,
  terminalDisabled,
  onOpenNewSession,
  onShowTasks,
  onShowTerminal,
}: {
  activeView: PhoneView;
  terminalDisabled: boolean;
  onOpenNewSession: () => void;
  onShowTasks: () => void;
  onShowTerminal: () => void;
}) {
  return (
    <nav className="phone-bottom-nav" aria-label="Phone navigation">
      <button aria-current={activeView === "terminal"} disabled={terminalDisabled} onClick={onShowTerminal} type="button">
        Terminal
      </button>
      <button aria-current={activeView === "tasks"} onClick={onShowTasks} type="button">
        Tasks
      </button>
      <button onClick={onOpenNewSession} type="button">
        +
      </button>
    </nav>
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

function composerPlaceholder(task: Task, connectionState: ConnectionState) {
  if (connectionState !== "connected") return "Disconnected";
  if (task.status !== "running") return "Read-only log";
  if (task.inputLockedAt) return "Input locked";
  if (task.codexAppServerTurnActive) return "";
  return "Send input";
}

function formatTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function normalizeInput(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
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
