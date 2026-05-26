import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DiffPane } from "./components/DiffPane";
import { FleetSummary } from "./components/FleetSummary";
import { InputComposer } from "./components/InputComposer";
import { TaskCreateForm } from "./components/TaskCreateForm";
import { TaskInfoPane } from "./components/TaskInfoPane";
import { TaskList } from "./components/TaskList";
import { TerminalPane } from "./components/TerminalPane";
import type { CreateTaskInput, OutputEvent, Task, TaskDeckContext, TaskPreset } from "./types";

type ConnectionState = "connecting" | "connected" | "disconnected";

type ServerMessage =
  | { type: "snapshot"; tasks: Task[]; presets?: TaskPreset[]; runningTaskId: string | null }
  | { type: "tasks"; tasks: Task[]; runningTaskId: string | null }
  | { type: "presets"; presets: TaskPreset[] }
  | { type: "output"; taskId: string; data: string }
  | { type: "error"; message: string };

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [lastOutput, setLastOutput] = useState<OutputEvent | null>(null);
  const [presets, setPresets] = useState<TaskPreset[]>([]);
  const [taskDeckContext, setTaskDeckContext] = useState<TaskDeckContext | null>(null);
  const [taskActionError, setTaskActionError] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const outputSeqRef = useRef(0);
  const selectedTaskIdRef = useRef<string | null>(null);
  const runningTaskIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);

  useEffect(() => {
    runningTaskIdRef.current = runningTaskId;
  }, [runningTaskId]);

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
          setTasks(message.tasks);
          setRunningTaskId(message.runningTaskId);
          if (message.type === "snapshot") {
            setPresets(message.presets ?? []);
          }
          setSelectedTaskId((current) => {
            if (message.runningTaskId) {
              return message.runningTaskId;
            }
            if (current && message.tasks.some((task) => task.id === current)) {
              return current;
            }
            return message.tasks[0]?.id ?? null;
          });
          return;
        }

        if (message.type === "presets") {
          setPresets(message.presets);
          return;
        }

        if (message.type === "output") {
          outputSeqRef.current += 1;
          setLastOutput({ seq: outputSeqRef.current, taskId: message.taskId, data: message.data });
          return;
        }

        if (message.type === "error") {
          setTaskActionError(message.message);
          outputSeqRef.current += 1;
          setLastOutput({
            seq: outputSeqRef.current,
            taskId: selectedTaskIdRef.current ?? runningTaskIdRef.current ?? "system",
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
  }, [selectedTaskId, runningTaskId]);

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

  const clearPresets = async () => {
    const response = await fetch("/api/presets", { method: "DELETE" });
    const payload = (await response.json()) as { presets: TaskPreset[] };
    setPresets(payload.presets);
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
    if (runningTaskId) {
      setTaskActionError("Wait for the running task to finish before rerunning.");
      return;
    }
    const didStart = createTask({
      title: selectedTask.title,
      command: selectedTask.command,
      cwd: selectedTask.cwd,
    });
    if (didStart) {
      setTaskActionError("");
    }
  };

  const clearTasks = async () => {
    const response = await fetch("/api/tasks", { method: "DELETE" });
    const payload = (await response.json()) as { tasks: Task[]; runningTaskId: string | null };
    applyTaskList(payload.tasks, payload.runningTaskId);
  };

  const clearTask = async (taskId: string) => {
    const response = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { tasks: Task[]; runningTaskId: string | null };
    applyTaskList(payload.tasks, payload.runningTaskId);
  };

  const applyTaskList = (nextTasks: Task[], nextRunningTaskId: string | null) => {
    setTasks(nextTasks);
    setRunningTaskId(nextRunningTaskId);
    setSelectedTaskId((current) => {
      if (nextRunningTaskId) {
        return nextRunningTaskId;
      }
      if (current && nextTasks.some((task) => task.id === current)) {
        return current;
      }
      return nextTasks[0]?.id ?? null;
    });
  };

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">TaskDeck MVP</p>
          <h1>Operational task deck</h1>
        </div>
        <div className="connection" data-state={connectionState}>
          {connectionState}
        </div>
      </header>

      <section className="create-band">
        <FleetSummary tasks={tasks} />
        <TaskCreateForm
          context={taskDeckContext}
          disabled={connectionState !== "connected" || Boolean(runningTaskId)}
          onCreateTask={createTask}
          onClearPresets={clearPresets}
          presets={presets}
        />
      </section>

      <section className="workspace-grid">
        <TaskList
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          runningTaskId={runningTaskId}
          onClearTask={clearTask}
          onClearTasks={clearTasks}
          onSelectTask={setSelectedTaskId}
        />
        <TerminalPane
          isConnected={connectionState === "connected"}
          task={selectedTask}
          lastOutput={lastOutput}
          send={send}
        />
        <aside className="right-rail">
          <TaskInfoPane
            actionError={taskActionError}
            isRerunDisabled={Boolean(runningTaskId)}
            task={selectedTask}
            onInterrupt={interruptTask}
            onRerun={rerunTask}
          />
          <DiffPane task={selectedTask} />
        </aside>
      </section>
      <InputComposer isConnected={connectionState === "connected"} task={selectedTask} send={send} />
    </main>
  );
}
