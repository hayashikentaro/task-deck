import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InputComposer } from "./InputComposer";
import { taskIdentityCssProperties } from "../taskIdentity";
import type { CodexModel, OutputEvent, Task } from "../types";
import { IconButton } from "./ui/IconButton";
import type { SelectedAttachment } from "./InputComposer";
import { drainOutputEventsForTask, maxOutputQueueSeq } from "../outputReplay";
import { parseOutputLinks } from "../outputLinks";
import { LocalPathLink } from "./LocalPathLink";

type OutputPaneProps = {
  codexModels: CodexModel[];
  composerValue: string;
  isConnected: boolean;
  selectedAttachments: SelectedAttachment[];
  task: Task | null;
  outputEvents: OutputEvent[];
  outputReloadToken: number;
  outputMessage: string;
  onSelectedAttachmentsChange: (attachments: SelectedAttachment[]) => void;
  onComposerValueChange: (value: string) => void;
  onOutputMessageChange: (value: string) => void;
  send: (payload: unknown) => boolean;
};

const logTailLength = 200_000;
const outputFontSizeStorageKey = "taskdeck.outputFontSize";
const outputDefaultFontSize = 16;
const outputFontSizes = [11, 12, 13, 14, 15, 16, 18];
const outputBottomScrollTolerancePx = 16;
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

export function OutputPane({
  codexModels,
  composerValue,
  isConnected,
  selectedAttachments,
  task,
  outputEvents,
  outputReloadToken,
  outputMessage,
  onSelectedAttachmentsChange,
  onComposerValueChange,
  onOutputMessageChange,
  send,
}: OutputPaneProps) {
  const outputViewportRef = useRef<HTMLDivElement | null>(null);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const shouldStickToOutputBottomRef = useRef(true);
  const outputEventsRef = useRef<OutputEvent[]>([]);
  const loadingTaskIdRef = useRef<string | null>(null);
  const appliedTaskSeqByTaskIdRef = useRef<Record<string, number>>({});
  const lastAppliedQueueSeqRef = useRef(0);
  const [rawLog, setRawLog] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [outputFontSize, setOutputFontSize] = useState(readStoredOutputFontSize);
  const [isOutputAtBottom, setIsOutputAtBottom] = useState(true);

  const taskId = task?.id ?? null;
  const outputText = useMemo(() => stripAnsiControlSequences(rawLog), [rawLog]);
  const outputSegments = useMemo(() => segmentOutputText(outputText), [outputText]);
  const searchMatchCount = useMemo(() => countMatches(outputText, searchTerm), [outputText, searchTerm]);
  const taskIdentityStyle = useMemo(
    () => (task ? taskIdentityCssProperties({ taskId: task.id, identityColorSlot: task.identityColorSlot }) : undefined),
    [task?.id, task?.identityColorSlot],
  );

  const updateOutputMessage = useCallback(
    (value: string) => {
      onOutputMessageChange(value);
    },
    [onOutputMessageChange],
  );

  useEffect(() => {
    outputEventsRef.current = outputEvents;
  }, [outputEvents]);

  useEffect(() => {
    shouldStickToOutputBottomRef.current = true;
    setIsOutputAtBottom(true);
  }, [taskId]);

  useEffect(() => {
    window.localStorage.setItem(outputFontSizeStorageKey, String(outputFontSize));
  }, [outputFontSize]);

  const isOutputViewportNearBottom = useCallback(() => {
    const viewport = outputViewportRef.current;
    if (!viewport) {
      return true;
    }

    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    return distanceFromBottom <= outputBottomScrollTolerancePx;
  }, []);

  const scrollOutputToBottom = useCallback(() => {
    const viewport = outputViewportRef.current;
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
    shouldStickToOutputBottomRef.current = true;
    setIsOutputAtBottom(true);
  }, []);

  const scrollOutputToBottomAfterLayout = useCallback(() => {
    if (scrollAnimationFrameRef.current !== null) {
      cancelAnimationFrame(scrollAnimationFrameRef.current);
    }

    scrollOutputToBottom();
    scrollAnimationFrameRef.current = requestAnimationFrame(() => {
      scrollAnimationFrameRef.current = null;
      scrollOutputToBottom();
    });
  }, [scrollOutputToBottom]);

  useEffect(() => {
    return () => {
      if (scrollAnimationFrameRef.current !== null) {
        cancelAnimationFrame(scrollAnimationFrameRef.current);
        scrollAnimationFrameRef.current = null;
      }
    };
  }, []);

  const loadPersistedLog = useCallback((nextTask: Task | null) => {
    shouldStickToOutputBottomRef.current = true;
    updateOutputMessage("");
    setRawLog("");

    if (!nextTask) {
      loadingTaskIdRef.current = null;
      setRawLog("No task selected.\n");
      return undefined;
    }

    const loadingTaskId = nextTask.id;
    const reloadStartQueueSeq = maxOutputQueueSeq(outputEventsRef.current);
    loadingTaskIdRef.current = loadingTaskId;
    const abortController = new AbortController();
    const logUrl = `/api/tasks/${loadingTaskId}/logs?tail=${logTailLength}`;

    fetch(logUrl, { signal: abortController.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to load task logs.");
        }
        return response.json();
      })
      .then((payload: { logs?: string; truncated?: boolean; taskSeq?: number }) => {
        if (abortController.signal.aborted) {
          return;
        }
        const logs = payload.logs || "";
        const loadedTaskSeq = positiveInteger(payload.taskSeq);
        const replayHeader = payload.truncated
          ? `[TaskDeck] Showing last ${logTailLength.toLocaleString()} characters of persisted log.\n`
          : "";
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

        setRawLog(`${replayHeader}${logs}${queuedDrain.gap ? "" : queuedDrain.text}`);
        updateOutputMessage(payload.truncated ? `Showing last ${logTailLength.toLocaleString()} characters.` : "");
        loadingTaskIdRef.current = null;
        scrollOutputToBottomAfterLayout();
      })
      .catch((error) => {
        if (abortController.signal.aborted) {
          return;
        }
        loadingTaskIdRef.current = null;
        setRawLog("[TaskDeck] Unable to load task logs.\n");
        updateOutputMessage(error instanceof Error ? error.message : "Unable to load task logs.");
      });

    return () => abortController.abort();
  }, [scrollOutputToBottomAfterLayout, updateOutputMessage]);

  useEffect(() => {
    setSearchTerm("");
    return loadPersistedLog(task);
  }, [loadPersistedLog, outputReloadToken, taskId]);

  useEffect(() => {
    if (!taskId || loadingTaskIdRef.current === taskId) {
      return;
    }
    const lastTaskSeq = appliedTaskSeqByTaskIdRef.current[taskId] || 0;
    const drainedOutput = drainOutputEventsForTask({
      events: outputEvents,
      taskId,
      lastQueueSeq: lastAppliedQueueSeqRef.current,
      lastTaskSeq,
    });

    if (drainedOutput.gap) {
      updateOutputMessage("Output stream gap detected; reloading persisted log.");
      loadPersistedLog(task);
      return;
    }

    appliedTaskSeqByTaskIdRef.current[taskId] = drainedOutput.nextTaskSeq;
    lastAppliedQueueSeqRef.current = drainedOutput.nextQueueSeq;
    if (!drainedOutput.text) {
      return;
    }

    const shouldStickToBottom = shouldStickToOutputBottomRef.current || isOutputViewportNearBottom();
    shouldStickToOutputBottomRef.current = shouldStickToBottom;
    setRawLog((current) => `${current}${drainedOutput.text}`.slice(-logTailLength));
    if (shouldStickToBottom) {
      scrollOutputToBottomAfterLayout();
    }
  }, [isOutputViewportNearBottom, loadPersistedLog, outputEvents, scrollOutputToBottomAfterLayout, task, taskId, updateOutputMessage]);

  const reloadLog = () => {
    loadPersistedLog(task);
  };

  const updateOutputBottomStickiness = () => {
    const isNearBottom = isOutputViewportNearBottom();
    shouldStickToOutputBottomRef.current = isNearBottom;
    setIsOutputAtBottom(isNearBottom);
  };

  return (
    <section className="output-pane" aria-label="Task output" data-has-task={task ? "true" : undefined} style={taskIdentityStyle}>
      <div className="output-toolbar">
        <div className="output-controls">
          <label className="output-font-size">
            <span>Font</span>
            <select
              aria-label="Output font size"
              value={outputFontSize}
              onChange={(event) => setOutputFontSize(Number(event.target.value))}
            >
              {outputFontSizes.map((fontSize) => (
                <option key={fontSize} value={fontSize}>
                  {fontSize}
                </option>
              ))}
            </select>
          </label>
          <label className="output-search">
            <input
              disabled={!task}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search output"
              type="search"
              value={searchTerm}
            />
          </label>
          {searchTerm ? (
            <span className="output-search-count">
              {searchMatchCount} match{searchMatchCount === 1 ? "" : "es"}
            </span>
          ) : null}
          <IconButton label="Reload output" disabled={!task} size="sm" variant="ghost" onClick={reloadLog} title="Reload output">
            <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
              <path d="M13 8a5 5 0 1 1-1.46-3.54M13 2.5v4h-4" />
            </svg>
          </IconButton>
        </div>
      </div>
      {outputMessage ? <p className="output-message">{outputMessage}</p> : null}
      <div className="output-host">
        <div className="output-scroll" ref={outputViewportRef} onScroll={updateOutputBottomStickiness}>
          <pre className="output-surface" style={{ fontSize: outputFontSize }}>
            {outputSegments.map((segment, index) => (
              <span key={index} data-output-tone={segment.tone}>
                {renderOutputTextWithLinks(segment.text, updateOutputMessage)}
              </span>
            ))}
          </pre>
        </div>
        {task && !isOutputAtBottom ? (
          <IconButton
            className="output-scroll-latest-button"
            label="Scroll to latest output"
            size="md"
            variant="panel"
            onClick={scrollOutputToBottom}
            title="Scroll to latest output"
          >
            <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
              <path d="M8 2.5v8M4.75 7.5 8 10.75l3.25-3.25M3 13.5h10" />
            </svg>
          </IconButton>
        ) : null}
      </div>
      <InputComposer
        key={task?.id ?? "no-task"}
        codexModels={codexModels}
        isConnected={isConnected}
        selectedAttachments={selectedAttachments}
        task={task}
        value={composerValue}
        onSelectedAttachmentsChange={onSelectedAttachmentsChange}
        onValueChange={onComposerValueChange}
        send={send}
      />
    </section>
  );
}

function renderOutputTextWithLinks(text: string, onLocalPathError: (message: string) => void) {
  return parseOutputLinks(text).map((part, index) => {
    if (part.kind === "web") {
      return (
        <a href={part.url} key={`${index}-${part.url}`} rel="noreferrer" target="_blank">
          {part.text}
        </a>
      );
    }
    if (part.kind === "local-path") {
      return (
        <LocalPathLink
          key={`${index}-${part.path}`}
          path={part.path}
          text={part.text}
          onError={onLocalPathError}
        />
      );
    }
    return part.text;
  });
}

function countMatches(value: string, searchTerm: string) {
  if (!searchTerm) {
    return 0;
  }

  let count = 0;
  let position = 0;
  const normalizedValue = value.toLocaleLowerCase();
  const normalizedSearchTerm = searchTerm.toLocaleLowerCase();

  while (position < normalizedValue.length) {
    const matchPosition = normalizedValue.indexOf(normalizedSearchTerm, position);
    if (matchPosition === -1) {
      break;
    }
    count += 1;
    position = matchPosition + normalizedSearchTerm.length;
  }

  return count;
}

function stripAnsiControlSequences(value: string) {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[PX^_].*?\x1b\\/g, "")
    .replace(/\r/g, "\n");
}

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

function positiveInteger(value: unknown) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

function readStoredOutputFontSize() {
  const storedValue = Number(window.localStorage.getItem(outputFontSizeStorageKey));
  return outputFontSizes.includes(storedValue) ? storedValue : outputDefaultFontSize;
}
