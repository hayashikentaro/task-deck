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
  const socketRef = useRef<WebSocket | null>(null);
  const outputSeqRef = useRef(0);
  const selectedTaskIdRef = useRef<string | null>(null);
  const runningTaskIdsRef = useRef<string[]>([]);
  const codexStatusOutputBuffersRef = useRef(new Map<string, string>());

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
  const selectedCodexStatusSnapshot = codexStatusSnapshot?.taskId === selectedTask?.id ? codexStatusSnapshot : null;
  const canRefreshCodexStatus = Boolean(
    connectionState === "connected" && selectedTask?.status === "running" && isCodexTask(selectedTask),
  );

  useEffect(() => {
    if (!lastOutput) {
      return;
    }
    const task = tasks.find((candidate) => candidate.id === lastOutput.taskId);
    if (!task || !isCodexTask(task)) {
      return;
    }

    const buffers = codexStatusOutputBuffersRef.current;
    const nextBuffer = `${buffers.get(task.id) || ""}${stripTerminalControlSequences(lastOutput.data)}`.slice(-8000);
    buffers.set(task.id, nextBuffer);

    const parsedStatus = parseCodexStatusOutput(nextBuffer);
    if (!parsedStatus) {
      return;
    }
    setCodexStatusSnapshot({
      ...parsedStatus,
      taskId: task.id,
      updatedAt: new Date().toISOString(),
    });
  }, [lastOutput, tasks]);

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

  const refreshCodexStatus = () => {
    if (!selectedTask || !canRefreshCodexStatus) {
      return;
    }
    send({
      type: "input",
      taskId: selectedTask.id,
      data: formatAgentInputForPty("/status"),
      source: "codex-status",
    });
  };

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

  const renameSavedSession = async (sessionKey: string, label: string) => {
    try {
      const response = await fetch(`/api/agent-sessions/${encodeURIComponent(sessionKey)}/label`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
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
          onComposerValueChange={setComposerValue}
          send={send}
        />
        <aside className="right-rail">
          <TaskCreateForm
            context={taskDeckContext}
            disabled={connectionState !== "connected"}
            savedCodexSessions={savedCodexSessions}
            onCreateTask={createTask}
            onRenameSavedSession={renameSavedSession}
          />
          <CodexStatusPanel
            canRefresh={canRefreshCodexStatus}
            selectedTask={selectedTask}
            snapshot={selectedCodexStatusSnapshot}
            onRefresh={refreshCodexStatus}
          />
          <ToolsPane
            context={taskDeckContext}
            isConnected={connectionState === "connected"}
            selectedTask={selectedTask}
            onCreateTask={createTask}
            onInsertComposerText={setComposerValue}
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

const terminalEnter = "\r";
const bracketedPasteStart = "\x1b[200~";
const bracketedPasteEnd = "\x1b[201~";

function formatAgentInputForPty(input: string) {
  const text = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return `${bracketedPasteStart}${text}${bracketedPasteEnd}${terminalEnter}`;
}

function isCodexTask(task: Task) {
  if (task.sessionMode === "diagnostic") {
    return false;
  }
  const text = `${task.agentProfileId || ""} ${task.agentLabel || ""} ${task.command || ""}`.toLowerCase();
  return /\bcodex\b/.test(text);
}

function stripTerminalControlSequences(value: string) {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "\n");
}

function parseCodexStatusOutput(output: string): Omit<CodexStatusSnapshot, "taskId" | "updatedAt"> | null {
  const statusBlock = latestCompleteCodexStatusBlock(output);
  if (!statusBlock) {
    return null;
  }

  const context = parseCodexStatusLine(statusBlock.contextLine, "Context window");
  const fiveHour = parseCodexStatusLine(statusBlock.fiveHourLine, "5h limit");
  const weekly = parseCodexStatusLine(statusBlock.weeklyLine, "Weekly limit");

  return {
    ...(context ? { context: { remainingPercent: context.percent } } : {}),
    ...(fiveHour ? { fiveHour: { remainingPercent: fiveHour.percent, resetLabel: localFiveHourResetLabel(fiveHour.resetLabel) } } : {}),
    ...(weekly ? { weekly: { remainingPercent: weekly.percent, resetLabel: localWeeklyResetLabel(weekly.resetLabel) } } : {}),
  };
}

function latestCompleteCodexStatusBlock(output: string) {
  const lines = output
    .split("\n")
    .map((line) => removeTerminalBoxDrawing(line).replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (let weeklyIndex = lines.length - 1; weeklyIndex >= 0; weeklyIndex -= 1) {
    if (!statusLineHasLabel(lines[weeklyIndex], "Weekly limit")) {
      continue;
    }

    const fiveHourIndex = findPreviousStatusLineIndex(lines, weeklyIndex - 1, "5h limit");
    if (fiveHourIndex === -1) {
      continue;
    }

    const contextIndex = findPreviousStatusLineIndex(lines, fiveHourIndex - 1, "Context window");
    if (contextIndex === -1) {
      continue;
    }

    return {
      contextLine: lines[contextIndex],
      fiveHourLine: lines[fiveHourIndex],
      weeklyLine: lines[weeklyIndex],
    };
  }

  return null;
}

function findPreviousStatusLineIndex(lines: string[], startIndex: number, label: string) {
  for (let index = startIndex; index >= 0; index -= 1) {
    if (statusLineHasLabel(lines[index], label)) {
      return index;
    }
  }
  return -1;
}

function statusLineHasLabel(line: string, label: string) {
  return new RegExp(`${labelPatternForRegex(label)}\\s*:`, "i").test(line);
}

function parseCodexStatusLine(line: string, label: string) {
  const labelPattern = labelPatternForRegex(label);
  const match = line.match(new RegExp(`${labelPattern}\\s*:\\s*.*?(\\d{1,3})%\\s+left(?:\\s+\\(resets\\s+([^)]+)\\))?`, "i"));
  if (!match) {
    return null;
  }
  return {
    percent: clampPercent(Number(match[1])),
    resetLabel: String(match[2] || "").trim(),
  };
}

function labelPatternForRegex(label: string) {
  return label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function removeTerminalBoxDrawing(value: string) {
  return value.replace(/[\u2500-\u257f]/g, " ");
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
  return resetDate ? localMonthDayTimeLabel(resetDate) : label;
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

function localMonthDayTimeLabel(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}
