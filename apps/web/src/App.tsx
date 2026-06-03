import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodexStatusPanel } from "./components/CodexStatusPanel";
import { TaskCreateForm } from "./components/TaskCreateForm";
import { TaskList } from "./components/TaskList";
import { TerminalPane } from "./components/TerminalPane";
import { ToolsPane } from "./components/ToolsPane";
import type { CodexStatusSnapshot, CreateTaskInput, OutputEvent, SavedCodexSession, Task, TaskDeckContext } from "./types";

type ConnectionState = "connecting" | "connected" | "disconnected";

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
  const [codexStatusError, setCodexStatusError] = useState("");
  const [isCodexStatusRefreshing, setIsCodexStatusRefreshing] = useState(false);
  const [selectedLogBuffer, setSelectedLogBuffer] = useState("");
  const [terminalMessage, setTerminalMessage] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const outputSeqRef = useRef(0);
  const selectedTaskIdRef = useRef<string | null>(null);
  const runningTaskIdsRef = useRef<string[]>([]);
  const hasAutoRefreshedCodexUsageRef = useRef(false);
  const isCodexStatusRefreshingRef = useRef(false);

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);

  useEffect(() => {
    runningTaskIdsRef.current = runningTaskIds;
  }, [runningTaskIds]);

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
  }, []);

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

  const send = useCallback((payload: unknown) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  const createTask = (input: CreateTaskInput) => {
    const didSend = send({ type: "start", ...input });
    return didSend;
  };

  const refreshCodexStatus = useCallback(async () => {
    if (!canRefreshCodexStatus || isCodexStatusRefreshingRef.current) {
      return;
    }

    isCodexStatusRefreshingRef.current = true;
    setIsCodexStatusRefreshing(true);
    setCodexStatusError("");
    try {
      const response = await fetch("/api/codex-status/refresh", { method: "POST" });
      const payload = (await response.json()) as { status?: CodexStatusSnapshot; error?: string };
      if (!response.ok || !payload.status) {
        throw new Error(payload.error || "Unable to refresh Codex status.");
      }
      setCodexStatusSnapshot(codexStatusSnapshotForDisplay(payload.status));
    } catch {
      setCodexStatusError("Unable to refresh");
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
            errorMessage={codexStatusError}
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
