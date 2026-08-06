import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TaskCreateForm } from "./components/TaskCreateForm";
import { TaskList } from "./components/TaskList";
import { OutputPane } from "./components/OutputPane";
import { PhonePairingPanel } from "./components/PhonePairingPanel";
import { DecisionInboxPanel } from "./components/DecisionInboxPanel";
import type { CodexModel, CreateTaskInput, DecisionGatewayMailboxItem, OutputEvent, Task, TaskDeckContext } from "./types";
import type { SelectedAttachment } from "./components/InputComposer";
import { appendOutputEventToQueue } from "./outputReplay";
import { selectTaskIdForTaskList } from "@taskdeck/web-shared";

export { selectTaskIdForTaskList } from "@taskdeck/web-shared";

type ConnectionState = "connecting" | "connected" | "disconnected";

type ServerMessage =
  | {
      type: "snapshot";
      tasks: Task[];
      runningTaskId?: string | null;
      runningTaskIds?: string[];
      codexModels?: CodexModel[];
      decisionGatewayMailboxItems?: DecisionGatewayMailboxItem[];
      outputSeq?: number;
    }
  | {
      type: "tasks";
      tasks: Task[];
      runningTaskId?: string | null;
      runningTaskIds?: string[];
      decisionGatewayMailboxItems?: DecisionGatewayMailboxItem[];
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
  | {
      type: "input-rejected";
      taskId: string;
      reason: string;
      authFailureReason?: string;
      message: string;
      logged?: boolean;
    }
  | { type: "codex-models"; models: CodexModel[] }
  | { type: "error"; message: string };

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [runningTaskIds, setRunningTaskIds] = useState<string[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [outputEvents, setOutputEvents] = useState<OutputEvent[]>([]);
  const [outputReloadToken, setOutputReloadToken] = useState(0);
  const [taskDeckContext, setTaskDeckContext] = useState<TaskDeckContext | null>(null);
  const [decisionGatewayMailboxItems, setDecisionGatewayMailboxItems] = useState<DecisionGatewayMailboxItem[]>([]);
  const [composerDraftsByTaskId, setComposerDraftsByTaskId] = useState<Record<string, string>>({});
  const [composerAttachmentsByTaskId, setComposerAttachmentsByTaskId] = useState<Record<string, SelectedAttachment[]>>({});
  const [outputMessage, setOutputMessage] = useState("");
  const [codexModels, setCodexModels] = useState<CodexModel[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const outputQueueSeqRef = useRef(0);
  const latestServerOutputSeqRef = useRef(0);
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
    const taskIds = new Set(tasks.map((task) => task.id));
    setComposerDraftsByTaskId((current) => pruneRecordByKeys(current, taskIds));
    setComposerAttachmentsByTaskId((current) => pruneRecordByKeys(current, taskIds));
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
          if (message.type === "snapshot") {
            handleSnapshotOutputSeq(message.outputSeq, latestServerOutputSeqRef, setOutputReloadToken);
          }
          setTasks(message.tasks);
          if (message.decisionGatewayMailboxItems) {
            setDecisionGatewayMailboxItems(message.decisionGatewayMailboxItems);
          }
          setRunningTaskIds(nextRunningTaskIds);
          if (message.type === "snapshot" && message.codexModels) {
            setCodexModels(message.codexModels);
          }
          setSelectedTaskId((current) => selectTaskIdForTaskList(current, message.tasks, nextRunningTaskIds));
          return;
        }

        if (message.type === "started") {
          setSelectedTaskId(message.taskId);
          return;
        }

        if (message.type === "output") {
          const serverSeq = positiveInteger(message.seq);
          if (serverSeq > 0) {
            if (
              latestServerOutputSeqRef.current > 0 &&
              serverSeq > latestServerOutputSeqRef.current + 1
            ) {
              setOutputReloadToken((current) => current + 1);
            }
            latestServerOutputSeqRef.current = Math.max(latestServerOutputSeqRef.current, serverSeq);
          }
          outputQueueSeqRef.current += 1;
          const outputEvent: OutputEvent = {
            seq: outputQueueSeqRef.current,
            taskId: message.taskId,
            data: message.data,
            serverSeq: serverSeq || undefined,
            taskSeq: positiveInteger(message.taskSeq) || undefined,
            role: message.role,
            kind: message.kind,
          };
          setOutputEvents((current) => appendOutputEventToQueue(current, outputEvent));
          return;
        }

        if (message.type === "codex-models") {
          setCodexModels(message.models);
          return;
        }

        if (message.type === "input-rejected") {
          if (message.logged) {
            return;
          }
          outputQueueSeqRef.current += 1;
          const outputEvent: OutputEvent = {
            seq: outputQueueSeqRef.current,
            taskId: message.taskId || selectedTaskIdRef.current || runningTaskIdsRef.current[0] || "system",
            data: `\r\n[TaskDeck] ${message.message || "Input was not sent."}\r\n`,
            role: "taskdeck",
            kind: `input_rejected_${message.reason || "unknown"}`,
          };
          setOutputEvents((current) => appendOutputEventToQueue(current, outputEvent));
          return;
        }

        if (message.type === "error") {
          outputQueueSeqRef.current += 1;
          const outputEvent: OutputEvent = {
            seq: outputQueueSeqRef.current,
            taskId: selectedTaskIdRef.current ?? runningTaskIdsRef.current[0] ?? "system",
            data: `\r\n[TaskDeck] ${message.message}\r\n`,
            role: "taskdeck",
            kind: "client_error",
          };
          setOutputEvents((current) => appendOutputEventToQueue(current, outputEvent));
          return;
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
    fetch("/api/decision-gateway/mailbox/local")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to load Decision Gateway mailbox.");
        }
        return response.json();
      })
      .then((payload: { items?: DecisionGatewayMailboxItem[] }) => {
        if (Array.isArray(payload.items)) {
          setDecisionGatewayMailboxItems(payload.items);
        }
      })
      .catch(() => {});
  }, []);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );
  const composerValue = selectedTaskId ? composerDraftsByTaskId[selectedTaskId] ?? "" : "";
  const selectedAttachments = selectedTaskId ? composerAttachmentsByTaskId[selectedTaskId] ?? [] : [];

  const updateComposerValue = useCallback((value: string) => {
    setComposerDraftsByTaskId((current) => updateSelectedTaskRecord(current, selectedTaskId, value));
  }, [selectedTaskId]);

  const updateSelectedAttachments = useCallback((attachments: SelectedAttachment[]) => {
    setComposerAttachmentsByTaskId((current) => updateSelectedTaskRecord(current, selectedTaskId, attachments));
  }, [selectedTaskId]);

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

  const reorderTasks = async (taskIds: string[]) => {
    try {
      const response = await fetch("/api/tasks/order", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskIds }),
      });
      const payload = (await response.json()) as {
        error?: string;
        tasks?: Task[];
        runningTaskId?: string | null;
        runningTaskIds?: string[];
      };
      if (!response.ok || !payload.tasks) {
        throw new Error(payload.error || "Unable to reorder tasks.");
      }
      applyTaskList(payload.tasks, getRunningTaskIdsFromMessage(payload));
      return true;
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Unable to reorder tasks.");
      return false;
    }
  };

  const toggleInputLock = async (taskId: string, locked: boolean) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/input-lock`, {
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
        throw new Error(payload.error || "Unable to toggle input lock.");
      }
      applyTaskList(payload.tasks, getRunningTaskIdsFromMessage(payload));
      if (!locked) {
        setSelectedTaskId(taskId);
      }
      return true;
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Unable to toggle input lock.");
      return false;
    }
  };

  const sendDecisionRequest = async (taskId: string) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/decision-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        decisionUrl?: string;
        decisionId?: string;
        requestId?: string;
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.decisionUrl) {
        throw new Error(payload.error || "Unable to send decision request.");
      }
      return {
        ok: true as const,
        decisionUrl: payload.decisionUrl,
        decisionId: payload.decisionId || "",
        requestId: payload.requestId || "",
      };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "Unable to send decision request.",
      };
    }
  };

  const applyTaskList = (nextTasks: Task[], nextRunningTaskIds: string[]) => {
    setTasks(nextTasks);
    setRunningTaskIds(nextRunningTaskIds);
    setSelectedTaskId((current) => selectTaskIdForTaskList(current, nextTasks, nextRunningTaskIds));
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
          onReorderTasks={reorderTasks}
          onSendDecisionRequest={sendDecisionRequest}
          onSelectTask={setSelectedTaskId}
          onToggleInputLock={toggleInputLock}
          decisionGatewayConfigured={Boolean(taskDeckContext?.decisionGateway?.configured)}
        />
        <OutputPane
          codexModels={codexModels}
          composerValue={composerValue}
          isConnected={connectionState === "connected"}
          selectedAttachments={selectedAttachments}
          task={selectedTask}
          outputEvents={outputEvents}
          outputReloadToken={outputReloadToken}
          outputMessage={outputMessage}
          onComposerValueChange={updateComposerValue}
          onOutputMessageChange={setOutputMessage}
          onSelectedAttachmentsChange={updateSelectedAttachments}
          send={send}
        />
        <aside className="right-rail">
          <TaskCreateForm
            context={taskDeckContext}
            disabled={connectionState !== "connected"}
            onCreateTask={createTask}
          />
          <PhonePairingPanel decisionGatewayConfigured={Boolean(taskDeckContext?.decisionGateway?.configured)} />
          <DecisionInboxPanel
            autoDeliveryDisabled={Boolean(
              taskDeckContext?.decisionGateway?.configured &&
                taskDeckContext.decisionGateway.autoDeliverEnabled === false,
            )}
            items={decisionGatewayMailboxItems}
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

function handleSnapshotOutputSeq(
  outputSeq: unknown,
  latestServerOutputSeqRef: { current: number },
  requestOutputReload: (updater: (current: number) => number) => void,
) {
  const serverSeq = positiveInteger(outputSeq);
  if (serverSeq === 0) {
    if (latestServerOutputSeqRef.current > 0) {
      requestOutputReload((current) => current + 1);
      latestServerOutputSeqRef.current = 0;
    }
    return;
  }
  if (latestServerOutputSeqRef.current > 0 && serverSeq !== latestServerOutputSeqRef.current) {
    requestOutputReload((current) => current + 1);
  }
  latestServerOutputSeqRef.current = Math.max(latestServerOutputSeqRef.current, serverSeq);
}

function positiveInteger(value: unknown) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

function updateSelectedTaskRecord<T>(record: Record<string, T>, taskId: string | null, value: T) {
  if (!taskId) {
    return record;
  }

  if (isEmptyDraftValue(value)) {
    if (!(taskId in record)) {
      return record;
    }
    const { [taskId]: _removed, ...nextRecord } = record;
    return nextRecord;
  }

  if (record[taskId] === value) {
    return record;
  }
  return { ...record, [taskId]: value };
}

function pruneRecordByKeys<T>(record: Record<string, T>, keys: Set<string>) {
  let didPrune = false;
  const nextRecord: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (keys.has(key)) {
      nextRecord[key] = value;
    } else {
      didPrune = true;
    }
  }
  return didPrune ? nextRecord : record;
}

function isEmptyDraftValue(value: unknown) {
  return value === "" || (Array.isArray(value) && value.length === 0);
}
