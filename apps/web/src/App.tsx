import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TaskCreateForm } from "./components/TaskCreateForm";
import { TaskList } from "./components/TaskList";
import { TerminalPane } from "./components/TerminalPane";
import { ToolsPane } from "./components/ToolsPane";
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
  const [composerValue, setComposerValue] = useState("");
  const [selectedLogBuffer, setSelectedLogBuffer] = useState("");
  const [terminalMessage, setTerminalMessage] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const outputSeqRef = useRef(0);
  const selectedTaskIdRef = useRef<string | null>(null);
  const runningTaskIdsRef = useRef<string[]>([]);
  const tasksRef = useRef<Task[]>([]);

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

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );

  const renameTask = async (taskId: string, title: string) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/title`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const payload = (await response.json()) as { error?: string; tasks?: Task[] };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to update TaskDeck display name.");
      }
      if (payload.tasks) {
        setTasks(payload.tasks);
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
            onCreateTask={createTask}
          />
          <ToolsPane
            isConnected={connectionState === "connected"}
            canCopyLog={Boolean(selectedTask && selectedLogBuffer.length)}
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
