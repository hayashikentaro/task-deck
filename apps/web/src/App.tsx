import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodexStatusPanel } from "./components/CodexStatusPanel";
import { TaskCreateForm } from "./components/TaskCreateForm";
import { TaskList } from "./components/TaskList";
import { TerminalPane } from "./components/TerminalPane";
import { ToolsPane } from "./components/ToolsPane";
import { buildLaunchCommand, isCodexProfile } from "./agentLaunch";
import {
  CHILD_SESSION_BATCH_REQUEST_START_MARKER,
  CHILD_SESSION_MESSAGE_REQUEST_START_MARKER,
  parseChildSessionMessageRequestsFromText,
  parseChildSessionRequestsFromText,
  type ChildSessionBatchRequest,
  type ChildSessionMessageRequest,
  type ChildSessionRequestParseError,
} from "./childSessionRequests";
import type { CodexPermissionLevel } from "./codexPermissions";
import type { CodexStatusSnapshot, CreateTaskInput, OutputEvent, SavedCodexSession, Task, TaskDeckContext } from "./types";

type ConnectionState = "connecting" | "connected" | "disconnected";

const childRequestScanWindowLength = 80_000;
const terminalEnter = "\r";
const bracketedPasteStart = "\x1b[200~";
const bracketedPasteEnd = "\x1b[201~";

type ServerMessage =
  | {
      type: "snapshot";
      tasks: Task[];
      runningTaskId?: string | null;
      runningTaskIds?: string[];
    }
  | { type: "tasks"; tasks: Task[]; runningTaskId?: string | null; runningTaskIds?: string[] }
  | { type: "started"; taskId: string }
  | { type: "output"; taskId: string; data: string }
  | { type: "error"; message: string };

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [savedCodexSessions, setSavedCodexSessions] = useState<SavedCodexSession[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [runningTaskIds, setRunningTaskIds] = useState<string[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [lastOutput, setLastOutput] = useState<OutputEvent | null>(null);
  const [taskDeckContext, setTaskDeckContext] = useState<TaskDeckContext | null>(null);
  const [composerValue, setComposerValue] = useState("");
  const [codexStatusSnapshot, setCodexStatusSnapshot] = useState<CodexStatusSnapshot | null>(null);
  const [isCodexStatusRefreshing, setIsCodexStatusRefreshing] = useState(false);
  const [selectedLogBuffer, setSelectedLogBuffer] = useState("");
  const [terminalMessage, setTerminalMessage] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const outputSeqRef = useRef(0);
  const selectedTaskIdRef = useRef<string | null>(null);
  const runningTaskIdsRef = useRef<string[]>([]);
  const tasksRef = useRef<Task[]>([]);
  const taskDeckContextRef = useRef<TaskDeckContext | null>(null);
  const childRequestOutputBuffersRef = useRef(new Map<string, string>());
  const launchedChildRequestKeysRef = useRef(new Set<string>());
  const rejectedChildRequestKeysRef = useRef(new Set<string>());
  const sentChildMessageRequestKeysRef = useRef(new Set<string>());
  const rejectedChildMessageRequestKeysRef = useRef(new Set<string>());
  const hasAutoRefreshedCodexUsageRef = useRef(false);
  const isCodexStatusRefreshingRef = useRef(false);

  const send = useCallback((payload: unknown) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  const createTask = useCallback((input: CreateTaskInput) => {
    const didSend = send({ type: "start", ...input });
    return didSend;
  }, [send]);

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);

  useEffect(() => {
    runningTaskIdsRef.current = runningTaskIds;
  }, [runningTaskIds]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    taskDeckContextRef.current = taskDeckContext;
  }, [taskDeckContext]);

  const loadSavedCodexSessions = useCallback(() => {
    fetch("/api/agent-sessions")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to load saved Codex sessions.");
        }
        return response.json();
      })
      .then((payload: { sessions?: SavedCodexSession[] }) => setSavedCodexSessions(payload.sessions ?? []))
      .catch(() => setSavedCodexSessions([]));
  }, []);

  const processChildSessionRequestBuffer = useCallback((parentTaskId: string, buffer: string) => {
    if (!buffer.includes(CHILD_SESSION_BATCH_REQUEST_START_MARKER)) {
      return;
    }

    const parentTask = tasksRef.current.find((task) => task.id === parentTaskId) ?? null;
    if (!parentTask || parentTask.spawnedFromParentRequest) {
      return;
    }
    const parentLabel = parentTask?.title || "parent task";
    const result = parseChildSessionRequestsFromText(buffer);

    for (const error of result.errors) {
      if (error.code === "unterminated_block") {
        continue;
      }
      const errorKey = childRequestParserErrorKey(parentTaskId, error);
      if (rejectedChildRequestKeysRef.current.has(errorKey)) {
        continue;
      }
      rejectedChildRequestKeysRef.current.add(errorKey);
      setTerminalMessage(`Rejected child session request from ${parentLabel}: ${childRequestParserErrorLabel(error)}.`);
    }

    for (const request of result.requests) {
      const requestKey = childRequestBatchKey(parentTaskId, request);
      if (
        launchedChildRequestKeysRef.current.has(requestKey) ||
        rejectedChildRequestKeysRef.current.has(requestKey)
      ) {
        continue;
      }

      const buildResult = buildChildTaskInputs(parentTaskId, request, taskDeckContextRef.current, requestKey);
      if (buildResult.status === "deferred") {
        continue;
      }
      if (buildResult.status === "rejected") {
        rejectedChildRequestKeysRef.current.add(requestKey);
        setTerminalMessage(`Rejected child session request from ${parentLabel}: ${buildResult.error}.`);
        continue;
      }

      let createdCount = 0;
      for (const input of buildResult.inputs) {
        if (createTask(input)) {
          createdCount += 1;
        }
      }

      if (createdCount === buildResult.inputs.length) {
        launchedChildRequestKeysRef.current.add(requestKey);
        setTerminalMessage(`Created ${createdCount} child ${createdCount === 1 ? "session" : "sessions"} from ${parentLabel}.`);
      } else {
        rejectedChildRequestKeysRef.current.add(requestKey);
        setTerminalMessage(`Failed to create all child sessions from ${parentLabel}: TaskDeck is not connected.`);
      }
    }
  }, [createTask]);

  const processChildSessionMessageRequestBuffer = useCallback((parentTaskId: string, buffer: string) => {
    if (!buffer.includes(CHILD_SESSION_MESSAGE_REQUEST_START_MARKER)) {
      return;
    }

    const parentTask = tasksRef.current.find((task) => task.id === parentTaskId) ?? null;
    if (!parentTask || parentTask.spawnedFromParentRequest) {
      return;
    }
    const parentLabel = parentTask.title || parentTask.id;
    const result = parseChildSessionMessageRequestsFromText(buffer);

    for (const error of result.errors) {
      if (error.code === "unterminated_block") {
        continue;
      }
      const errorKey = childMessageRequestParserErrorKey(parentTaskId, error);
      if (rejectedChildMessageRequestKeysRef.current.has(errorKey)) {
        continue;
      }
      rejectedChildMessageRequestKeysRef.current.add(errorKey);
      setTerminalMessage(`Rejected parent instruction request from ${parentLabel}: ${childRequestParserErrorLabel(error)}.`);
    }

    for (const request of result.requests) {
      const requestKey = childMessageRequestKey(parentTaskId, request);
      if (
        sentChildMessageRequestKeysRef.current.has(requestKey) ||
        rejectedChildMessageRequestKeysRef.current.has(requestKey)
      ) {
        continue;
      }

      const routeResult = buildChildMessageInput(parentTask, request, tasksRef.current);
      if (routeResult.status === "rejected") {
        rejectedChildMessageRequestKeysRef.current.add(requestKey);
        setTerminalMessage(`Rejected parent instruction request from ${parentLabel}: ${routeResult.error}.`);
        continue;
      }

      const didSend = send({
        type: "input",
        taskId: routeResult.childTask.id,
        data: routeResult.data,
        source: "parent-instruction",
      });
      if (didSend) {
        sentChildMessageRequestKeysRef.current.add(requestKey);
        setTerminalMessage(`Sent parent instruction to ${routeResult.childTask.title || routeResult.childTask.id}.`);
      } else {
        rejectedChildMessageRequestKeysRef.current.add(requestKey);
        setTerminalMessage(`Failed to send parent instruction from ${parentLabel}: TaskDeck is not connected.`);
      }
    }
  }, [send]);

  const processChildSessionRequestsFromOutput = useCallback((parentTaskId: string, data: string) => {
    const currentBuffer = childRequestOutputBuffersRef.current.get(parentTaskId) ?? "";
    const nextBuffer = `${currentBuffer}${data}`.slice(-childRequestScanWindowLength);
    childRequestOutputBuffersRef.current.set(parentTaskId, nextBuffer);
    processChildSessionRequestBuffer(parentTaskId, nextBuffer);
    processChildSessionMessageRequestBuffer(parentTaskId, nextBuffer);
  }, [processChildSessionMessageRequestBuffer, processChildSessionRequestBuffer]);

  useEffect(() => {
    if (!taskDeckContext) {
      return;
    }
    for (const [parentTaskId, buffer] of childRequestOutputBuffersRef.current) {
      processChildSessionRequestBuffer(parentTaskId, buffer);
    }
  }, [processChildSessionRequestBuffer, taskDeckContext]);

  useEffect(() => {
    for (const [parentTaskId, buffer] of childRequestOutputBuffersRef.current) {
      processChildSessionRequestBuffer(parentTaskId, buffer);
      processChildSessionMessageRequestBuffer(parentTaskId, buffer);
    }
  }, [processChildSessionMessageRequestBuffer, processChildSessionRequestBuffer, tasks]);

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
          const nextRunningTaskIds = getRunningTaskIdsFromMessage(message);
          setTasks(message.tasks);
          setRunningTaskIds(nextRunningTaskIds);
          loadSavedCodexSessions();
          setSelectedTaskId((current) => {
            if (current && message.tasks.some((task) => task.id === current)) {
              return current;
            }
            if (nextRunningTaskIds[0]) {
              return nextRunningTaskIds[0];
            }
            return message.tasks[0]?.id ?? null;
          });
          return;
        }

        if (message.type === "started") {
          setSelectedTaskId(message.taskId);
          return;
        }

        if (message.type === "output") {
          outputSeqRef.current += 1;
          setLastOutput({ seq: outputSeqRef.current, taskId: message.taskId, data: message.data });
          processChildSessionRequestsFromOutput(message.taskId, message.data);
          return;
        }

        if (message.type === "error") {
          outputSeqRef.current += 1;
          setLastOutput({
            seq: outputSeqRef.current,
            taskId: selectedTaskIdRef.current ?? runningTaskIdsRef.current[0] ?? "system",
            data: `\r\n[TaskDeck] ${message.message}\r\n`,
          });
        }
      });

      socket.addEventListener("close", () => {
        if (closedByEffect) {
          return;
        }
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
  }, [loadSavedCodexSessions, processChildSessionRequestsFromOutput]);

  useEffect(() => {
    fetch("/api/context")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to load TaskDeck context.");
        }
        return response.json();
      })
      .then((context: TaskDeckContext) => setTaskDeckContext(context))
      .catch(() => setTaskDeckContext(null));
  }, []);

  useEffect(() => {
    loadSavedCodexSessions();
  }, [loadSavedCodexSessions]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );
  const canRefreshCodexStatus = connectionState === "connected";

  const refreshCodexStatus = useCallback(async () => {
    if (!canRefreshCodexStatus || isCodexStatusRefreshingRef.current) {
      return;
    }

    isCodexStatusRefreshingRef.current = true;
    setIsCodexStatusRefreshing(true);
    try {
      const response = await fetch("/api/codex-status/refresh", { method: "POST" });
      const payload = (await response.json()) as { status?: CodexStatusSnapshot; error?: string };
      if (!response.ok || !payload.status) {
        throw new Error(payload.error || "Unable to refresh Codex status.");
      }
      setCodexStatusSnapshot(codexStatusSnapshotForDisplay(payload.status));
    } catch {
      // Keep existing meters and leave refresh failures quiet in the compact rail UI.
    } finally {
      isCodexStatusRefreshingRef.current = false;
      setIsCodexStatusRefreshing(false);
    }
  }, [canRefreshCodexStatus]);

  useEffect(() => {
    if (connectionState !== "connected" || hasAutoRefreshedCodexUsageRef.current) {
      return undefined;
    }

    const refreshTimer = window.setTimeout(() => {
      if (hasAutoRefreshedCodexUsageRef.current) {
        return;
      }
      hasAutoRefreshedCodexUsageRef.current = true;
      refreshCodexStatus();
    }, 0);

    return () => window.clearTimeout(refreshTimer);
  }, [connectionState, refreshCodexStatus]);

  const renameTask = async (taskId: string, title: string) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/title`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const payload = (await response.json()) as { error?: string; tasks?: Task[]; sessions?: SavedCodexSession[] };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to update TaskDeck display name.");
      }
      if (payload.tasks) {
        setTasks(payload.tasks);
      }
      if (payload.sessions) {
        setSavedCodexSessions(payload.sessions);
      } else {
        loadSavedCodexSessions();
      }
      return true;
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Unable to update TaskDeck display name.");
      return false;
    }
  };

  const clearTasks = async () => {
    const response = await fetch("/api/tasks", { method: "DELETE" });
    const payload = (await response.json()) as {
      tasks: Task[];
      runningTaskId?: string | null;
      runningTaskIds?: string[];
    };
    applyTaskList(payload.tasks, getRunningTaskIdsFromMessage(payload));
  };

  const clearTask = async (taskId: string) => {
    const response = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as {
      tasks: Task[];
      runningTaskId?: string | null;
      runningTaskIds?: string[];
    };
    applyTaskList(payload.tasks, getRunningTaskIdsFromMessage(payload));
  };

  const toggleTerminalInputLock = async (taskId: string, locked: boolean) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/terminal-input-lock`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked }),
      });
      const payload = (await response.json()) as {
        error?: string;
        tasks?: Task[];
        runningTaskId?: string | null;
        runningTaskIds?: string[];
      };
      if (!response.ok || !payload.tasks) {
        throw new Error(payload.error || "Unable to toggle terminal input lock.");
      }
      applyTaskList(payload.tasks, getRunningTaskIdsFromMessage(payload));
      if (!locked) {
        setSelectedTaskId(taskId);
      }
      return true;
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Unable to toggle terminal input lock.");
      return false;
    }
  };

  const copySelectedLog = async () => {
    if (!selectedLogBuffer) {
      setTerminalMessage("No terminal content to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(selectedLogBuffer);
      setTerminalMessage("Copied terminal content.");
    } catch {
      setTerminalMessage("Copy failed in this browser context.");
    }
  };

  const applyTaskList = (nextTasks: Task[], nextRunningTaskIds: string[]) => {
    setTasks(nextTasks);
    setRunningTaskIds(nextRunningTaskIds);
    loadSavedCodexSessions();
    setSelectedTaskId((current) => {
      if (current && nextTasks.some((task) => task.id === current)) {
        return current;
      }
      if (nextRunningTaskIds[0]) {
        return nextRunningTaskIds[0];
      }
      return nextTasks[0]?.id ?? null;
    });
  };

  return (
    <main className="app-shell">
      <section className="workspace-grid">
        <TaskList
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          runningTaskIds={runningTaskIds}
          onClearTask={clearTask}
          onClearTasks={clearTasks}
          onRenameTask={renameTask}
          onSelectTask={setSelectedTaskId}
          onToggleTerminalInputLock={toggleTerminalInputLock}
        />
        <TerminalPane
          composerValue={composerValue}
          isConnected={connectionState === "connected"}
          task={selectedTask}
          lastOutput={lastOutput}
          terminalMessage={terminalMessage}
          onComposerValueChange={setComposerValue}
          onLogBufferChange={setSelectedLogBuffer}
          onTerminalMessageChange={setTerminalMessage}
          send={send}
        />
        <aside className="right-rail">
          <TaskCreateForm
            context={taskDeckContext}
            disabled={connectionState !== "connected"}
            savedCodexSessions={savedCodexSessions}
            onCreateTask={createTask}
          />
          <CodexStatusPanel
            canRefresh={canRefreshCodexStatus}
            isRefreshing={isCodexStatusRefreshing}
            snapshot={codexStatusSnapshot}
            onRefresh={refreshCodexStatus}
          />
          <ToolsPane
            context={taskDeckContext}
            isConnected={connectionState === "connected"}
            canCopyLog={Boolean(selectedTask && selectedLogBuffer.length)}
            onCreateTask={createTask}
            onCopyLog={copySelectedLog}
          />
        </aside>
      </section>
    </main>
  );
}

function getRunningTaskIdsFromMessage(message: { runningTaskId?: string | null; runningTaskIds?: string[] }) {
  if (Array.isArray(message.runningTaskIds)) {
    return message.runningTaskIds;
  }
  return message.runningTaskId ? [message.runningTaskId] : [];
}

function codexStatusSnapshotForDisplay(status: CodexStatusSnapshot): CodexStatusSnapshot {
  return {
    updatedAt: status.updatedAt,
    ...(status.fiveHour
      ? {
          fiveHour: {
            remainingPercent: status.fiveHour.remainingPercent,
            resetLabel: localFiveHourResetLabel(status.fiveHour.resetLabel),
          },
        }
      : {}),
    ...(status.weekly
      ? {
          weekly: {
            remainingPercent: status.weekly.remainingPercent,
            resetLabel: localWeeklyResetLabel(status.weekly.resetLabel),
          },
        }
      : {}),
  };
}

function localFiveHourResetLabel(resetLabel: string | undefined) {
  const label = String(resetLabel || "").trim();
  if (!label) {
    return "";
  }

  const resetDate = utcDateForTimeOnlyReset(label);
  return resetDate ? localTimeLabel(resetDate) : label;
}

function localWeeklyResetLabel(resetLabel: string | undefined) {
  const label = String(resetLabel || "").trim();
  if (!label) {
    return "";
  }

  const resetDate = utcDateForWeeklyReset(label);
  return resetDate ? localMonthDayLabel(resetDate) : label;
}

function utcDateForTimeOnlyReset(resetLabel: string) {
  const match = resetLabel.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const now = new Date();
  const resetDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(match[1]), Number(match[2])));
  return Number.isNaN(resetDate.getTime()) ? null : resetDate;
}

function utcDateForWeeklyReset(resetLabel: string) {
  const match = resetLabel.match(/^(\d{1,2}):(\d{2})\s+on\s+(\d{1,2})\s+([A-Za-z]{3,})$/i);
  if (!match) {
    return null;
  }

  const monthIndex = monthIndexFromLabel(match[4]);
  if (monthIndex === -1) {
    return null;
  }

  const now = new Date();
  const resetDate = new Date(Date.UTC(now.getUTCFullYear(), monthIndex, Number(match[3]), Number(match[1]), Number(match[2])));
  return Number.isNaN(resetDate.getTime()) ? null : resetDate;
}

function monthIndexFromLabel(value: string) {
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(
    value.slice(0, 3).toLowerCase(),
  );
}

function localTimeLabel(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

function localMonthDayLabel(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
  }).format(value);
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

type ChildTaskBuildResult =
  | { status: "deferred" }
  | { status: "rejected"; error: string }
  | { status: "ready"; inputs: CreateTaskInput[] };

function buildChildTaskInputs(
  parentTaskId: string,
  request: ChildSessionBatchRequest,
  context: TaskDeckContext | null,
  requestKey: string,
): ChildTaskBuildResult {
  if (!context) {
    return { status: "deferred" };
  }

  const inputs: CreateTaskInput[] = [];

  for (const [sessionIndex, session] of request.sessions.entries()) {
    const profile = context.agentProfiles.find((agentProfile) => agentProfile.id === session.agentProfileId);
    if (!profile) {
      return { status: "rejected", error: `unknown agentProfileId "${session.agentProfileId}"` };
    }

    const isCodex = isCodexProfile(profile);
    const codexPermissionLevel = (session.agentPermissionLevel ?? "full_access") as CodexPermissionLevel;
    const launchCommand = buildLaunchCommand(profile, "new", null, codexPermissionLevel);
    if (!launchCommand.command) {
      return { status: "rejected", error: `empty launch command for agentProfileId "${session.agentProfileId}"` };
    }
    if (!session.cwd) {
      return { status: "rejected", error: `empty cwd for "${session.title}"` };
    }

    inputs.push({
      title: session.title,
      command: launchCommand.command,
      cwd: session.cwd,
      agentProfileId: profile.id,
      agentLabel: profile.label,
      agentPermissionLevel: isCodex ? codexPermissionLevel : session.agentPermissionLevel,
      sessionMode: "new",
      initialInstruction: session.initialInstruction,
      parentSessionId: parentTaskId,
      spawnedFromParentRequest: true,
      childSessionRequestKey: `${requestKey}:${sessionIndex}`,
      workPackageId: session.workPackageId,
      filesLikelyToChange: session.filesLikelyToChange,
    });
  }

  return { status: "ready", inputs };
}

function childRequestBatchKey(parentTaskId: string, request: ChildSessionBatchRequest) {
  return `${parentTaskId}:${stableHash(stableStringify(request))}`;
}

function childRequestParserErrorKey(parentTaskId: string, error: ChildSessionRequestParseError) {
  return [
    parentTaskId,
    error.code,
    error.path ?? "",
    error.blockIndex ?? "",
    error.sessionIndex ?? "",
    error.startIndex ?? "",
    error.endIndex ?? "",
    error.message,
  ].join(":");
}

function childRequestParserErrorLabel(error: ChildSessionRequestParseError) {
  return error.path ? `${error.message} (${error.path})` : error.message;
}

type ChildMessageInputBuildResult =
  | { status: "rejected"; error: string }
  | { status: "ready"; childTask: Task; data: string };

function buildChildMessageInput(
  parentTask: Task,
  request: ChildSessionMessageRequest,
  tasks: Task[],
): ChildMessageInputBuildResult {
  const targetResult = resolveChildMessageTarget(parentTask.id, request, tasks);
  if (targetResult.status === "rejected") {
    return targetResult;
  }

  const childTask = targetResult.childTask;
  if (childTask.status !== "running") {
    return { status: "rejected", error: `target child session "${childTask.title || childTask.id}" is not running` };
  }
  if (childTask.terminalInputLockedAt) {
    return {
      status: "rejected",
      error: `target child session "${childTask.title || childTask.id}" has terminal input locked`,
    };
  }

  return {
    status: "ready",
    childTask,
    data: formatParentInstructionInputForPty(parentTask, request.message),
  };
}

function resolveChildMessageTarget(
  parentTaskId: string,
  request: ChildSessionMessageRequest,
  tasks: Task[],
): { status: "rejected"; error: string } | { status: "ready"; childTask: Task } {
  const targetChildSessionId = request.target.childSessionId?.trim();
  const targetWorkPackageId = request.target.workPackageId?.trim();

  if (targetChildSessionId) {
    const childTask = tasks.find((task) => task.id === targetChildSessionId) ?? null;
    if (!childTask || !isChildTaskFromParent(childTask, parentTaskId)) {
      return { status: "rejected", error: `no child session matches childSessionId "${targetChildSessionId}"` };
    }
    if (targetWorkPackageId && childTask.workPackageId !== targetWorkPackageId) {
      return {
        status: "rejected",
        error: `childSessionId "${targetChildSessionId}" does not match workPackageId "${targetWorkPackageId}"`,
      };
    }
    return { status: "ready", childTask };
  }

  if (!targetWorkPackageId) {
    return { status: "rejected", error: "target must include childSessionId or workPackageId" };
  }

  const matchingChildren = tasks.filter(
    (task) => isChildTaskFromParent(task, parentTaskId) && task.workPackageId === targetWorkPackageId,
  );
  if (matchingChildren.length === 0) {
    return { status: "rejected", error: `no child session matches workPackageId "${targetWorkPackageId}"` };
  }
  if (matchingChildren.length > 1) {
    return { status: "rejected", error: `multiple child sessions match workPackageId "${targetWorkPackageId}"` };
  }

  return { status: "ready", childTask: matchingChildren[0] };
}

function isChildTaskFromParent(task: Task, parentTaskId: string) {
  return Boolean(task.spawnedFromParentRequest && task.parentSessionId === parentTaskId);
}

function formatParentInstructionInputForPty(parentTask: Task, message: string) {
  const parentLabel = parentTask.title || parentTask.id;
  const text = normalizeTerminalInput(`Parent instruction from ${parentLabel}:\n${message}`);
  return `${bracketedPasteStart}${text}${bracketedPasteEnd}${terminalEnter}`;
}

function normalizeTerminalInput(input: string) {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function childMessageRequestKey(parentTaskId: string, request: ChildSessionMessageRequest) {
  return `message:${parentTaskId}:${stableHash(stableStringify(request))}`;
}

function childMessageRequestParserErrorKey(parentTaskId: string, error: ChildSessionRequestParseError) {
  return `message:${childRequestParserErrorKey(parentTaskId, error)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}
