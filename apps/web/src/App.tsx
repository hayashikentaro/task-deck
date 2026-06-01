import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DiagnosticsPane } from "./components/DiagnosticsPane";
import { SelectedSessionPanel } from "./components/SelectedSessionPanel";
import { TaskCreateForm } from "./components/TaskCreateForm";
import { TaskList } from "./components/TaskList";
import { TerminalPane } from "./components/TerminalPane";
import { buildCodexResumeCommandForCommand } from "./codexPermissions";
import type { CreateTaskInput, OutputEvent, SavedCodexSession, Task, TaskDeckContext } from "./types";

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
  const [taskActionError, setTaskActionError] = useState("");
  const [pendingResumeKeys, setPendingResumeKeys] = useState<string[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const outputSeqRef = useRef(0);
  const selectedTaskIdRef = useRef<string | null>(null);
  const runningTaskIdsRef = useRef<string[]>([]);

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
          setPendingResumeKeys([]);
          return;
        }

        if (message.type === "output") {
          outputSeqRef.current += 1;
          setLastOutput({ seq: outputSeqRef.current, taskId: message.taskId, data: message.data });
          return;
        }

        if (message.type === "error") {
          setTaskActionError(message.message);
          setPendingResumeKeys([]);
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

  useEffect(() => {
    setTaskActionError("");
  }, [selectedTaskId, runningTaskIds]);

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
    if (!didSend) {
      setTaskActionError("TaskDeck is not connected.");
    }
    return didSend;
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
      setTaskActionError("");
      return true;
    } catch (error) {
      setTaskActionError(error instanceof Error ? error.message : "Unable to update TaskDeck display name.");
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
      setTaskActionError("");
      return true;
    } catch (error) {
      setTaskActionError(error instanceof Error ? error.message : "Unable to update TaskDeck display name.");
      return false;
    }
  };

  const interruptTask = () => {
    if (selectedTask) {
      send({ type: "interrupt", taskId: selectedTask.id });
    }
  };

  const rerunTask = () => {
    if (!selectedTask) {
      return;
    }
    const didStart = createTask({
      title: taskDisplayName(selectedTask),
      command: selectedTask.command,
      cwd: selectedTask.cwd,
      agentProfileId: selectedTask.agentProfileId,
      agentLabel: selectedTask.agentLabel,
      agentPermissionLevel: selectedTask.agentPermissionLevel,
      sessionMode: selectedTask.sessionMode,
      resumeCommand: selectedTask.resumeCommand,
      initialInstruction: selectedTask.initialInstruction,
    });
    if (didStart) {
      setTaskActionError("");
    }
  };

  const resumeTask = (task: Task) => {
    const resumeCommand = task.resumeCommand?.trim() || task.agentSessionResumeCommand?.trim();
    if (!resumeCommand) {
      return;
    }
    startResumeTask(task, resumeCommand, task.sessionMode || "custom_resume");
  };

  const resumeLastTask = (task: Task) => {
    if (!isCodexTask(task)) {
      return;
    }
    startResumeTask(task, buildCodexResumeLastCommandForTask(task), "resume_last");
  };

  const startResumeTask = (task: Task, resumeCommand: string, sessionMode: string) => {
    const resumeKey = resumeTaskKey(task.id, resumeCommand);
    if (pendingResumeKeys.includes(resumeKey)) {
      return;
    }
    setPendingResumeKeys((current) => [...current, resumeKey]);
    const didStart = createTask({
      title: sessionMode === "resume_last" ? `Resume last: ${taskDisplayName(task)}` : taskDisplayName(task),
      command: resumeCommand,
      cwd: task.cwd,
      agentProfileId: task.agentProfileId,
      agentLabel: task.agentLabel,
      agentPermissionLevel: task.agentPermissionLevel,
      sessionMode,
      resumeCommand,
    });
    if (!didStart) {
      setPendingResumeKeys((current) => current.filter((key) => key !== resumeKey));
      return;
    }
    window.setTimeout(() => {
      setPendingResumeKeys((current) => current.filter((key) => key !== resumeKey));
    }, 4000);
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
          isConnected={connectionState === "connected"}
          task={selectedTask}
          lastOutput={lastOutput}
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
          <SelectedSessionPanel
            actionError={taskActionError}
            isConnected={connectionState === "connected"}
            task={selectedTask}
            runningTaskIds={runningTaskIds}
            pendingResumeKeys={pendingResumeKeys}
            onInterruptTask={interruptTask}
            onRerunTask={rerunTask}
            onResumeLastTask={resumeLastTask}
            onResumeTask={resumeTask}
          />
          <DiagnosticsPane isConnected={connectionState === "connected"} onCreateTask={createTask} />
        </aside>
      </section>
    </main>
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

function getRunningTaskIdsFromMessage(message: { runningTaskId?: string | null; runningTaskIds?: string[] }) {
  if (Array.isArray(message.runningTaskIds)) {
    return message.runningTaskIds;
  }
  return message.runningTaskId ? [message.runningTaskId] : [];
}
