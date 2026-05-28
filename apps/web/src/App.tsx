import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TaskCreateForm } from "./components/TaskCreateForm";
import { TaskList } from "./components/TaskList";
import { TerminalPane } from "./components/TerminalPane";
import type { CreateTaskInput, OutputEvent, Task, TaskDeckContext } from "./types";

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
      title: selectedTask.title,
      command: selectedTask.command,
      cwd: selectedTask.cwd,
      agentProfileId: selectedTask.agentProfileId,
      agentLabel: selectedTask.agentLabel,
      sessionMode: selectedTask.sessionMode,
      resumeCommand: selectedTask.resumeCommand,
      initialInstruction: selectedTask.initialInstruction,
    });
    if (didStart) {
      setTaskActionError("");
    }
  };

  const resumeTask = (task: Task) => {
    const resumeCommand = task.resumeCommand?.trim();
    if (!resumeCommand) {
      return;
    }
    startResumeTask(task, resumeCommand, task.sessionMode || "custom_resume");
  };

  const resumeLastTask = (task: Task) => {
    if (!isCodexTask(task)) {
      return;
    }
    startResumeTask(task, buildCodexResumeLastCommand(task), "resume_last");
  };

  const startResumeTask = (task: Task, resumeCommand: string, sessionMode: string) => {
    const resumeKey = resumeTaskKey(task.id, resumeCommand);
    if (pendingResumeKeys.includes(resumeKey)) {
      return;
    }
    setPendingResumeKeys((current) => [...current, resumeKey]);
    const didStart = createTask({
      title: `Resume: ${task.title}`,
      command: resumeCommand,
      cwd: task.cwd,
      agentProfileId: task.agentProfileId,
      agentLabel: task.agentLabel,
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
          actionError={taskActionError}
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          runningTaskIds={runningTaskIds}
          onClearTask={clearTask}
          onClearTasks={clearTasks}
          onInterruptTask={interruptTask}
          onRerunTask={rerunTask}
          onResumeLastTask={resumeLastTask}
          onResumeTask={resumeTask}
          pendingResumeKeys={pendingResumeKeys}
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
            onCreateTask={createTask}
          />
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

function buildCodexResumeLastCommand(task: Task) {
  const command = task.command.toLowerCase();
  if (task.agentProfileId === "ai-dev-container-codex" || /docker\s+exec\b.*\bcodex\b/.test(command)) {
    return "docker start taskdeck-ai-dev >/dev/null && docker exec -it -w /workspace taskdeck-ai-dev sh -lc 'codex resume --last'";
  }
  return "codex resume --last";
}

function getRunningTaskIdsFromMessage(message: { runningTaskId?: string | null; runningTaskIds?: string[] }) {
  if (Array.isArray(message.runningTaskIds)) {
    return message.runningTaskIds;
  }
  return message.runningTaskId ? [message.runningTaskId] : [];
}
