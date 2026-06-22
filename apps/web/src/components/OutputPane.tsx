import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InputComposer } from "./InputComposer";
import { taskIdentityCssProperties } from "../taskIdentity";
import type { CodexModel, OutputEvent, Task } from "../types";
import { IconButton } from "./ui/IconButton";
import type { SelectedImageAttachment } from "./InputComposer";

type OutputPaneProps = {
  codexModels: CodexModel[];
  composerValue: string;
  isConnected: boolean;
  selectedImages: SelectedImageAttachment[];
  task: Task | null;
  lastOutput: OutputEvent | null;
  outputMessage: string;
  onSelectedImagesChange: (images: SelectedImageAttachment[]) => void;
  onComposerValueChange: (value: string) => void;
  onOutputMessageChange: (value: string) => void;
  send: (payload: unknown) => boolean;
};

const logTailLength = 200_000;
const outputFontSizeStorageKey = "taskdeck.outputFontSize";
const outputDefaultFontSize = 16;
const outputFontSizes = [11, 12, 13, 14, 15, 16, 18];
const outputBottomScrollTolerancePx = 16;

export function OutputPane({
  codexModels,
  composerValue,
  isConnected,
  selectedImages,
  task,
  lastOutput,
  outputMessage,
  onSelectedImagesChange,
  onComposerValueChange,
  onOutputMessageChange,
  send,
}: OutputPaneProps) {
  const outputViewportRef = useRef<HTMLDivElement | null>(null);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const shouldStickToOutputBottomRef = useRef(true);
  const [rawLog, setRawLog] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [outputFontSize, setOutputFontSize] = useState(readStoredOutputFontSize);

  const taskId = task?.id ?? null;
  const outputText = useMemo(() => stripAnsiControlSequences(rawLog), [rawLog]);
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
    shouldStickToOutputBottomRef.current = true;
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
      setRawLog("No task selected.\n");
      return undefined;
    }

    const abortController = new AbortController();
    const logUrl = `/api/tasks/${nextTask.id}/logs?tail=${logTailLength}`;

    fetch(logUrl, { signal: abortController.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to load task logs.");
        }
        return response.json();
      })
      .then((payload: { logs?: string; truncated?: boolean }) => {
        if (abortController.signal.aborted) {
          return;
        }
        const logs = payload.logs || "";
        const replayHeader = payload.truncated
          ? `[TaskDeck] Showing last ${logTailLength.toLocaleString()} characters of persisted log.\n`
          : "";
        setRawLog(`${replayHeader}${logs}`);
        updateOutputMessage(payload.truncated ? `Showing last ${logTailLength.toLocaleString()} characters.` : "");
        scrollOutputToBottomAfterLayout();
      })
      .catch((error) => {
        if (abortController.signal.aborted) {
          return;
        }
        setRawLog("[TaskDeck] Unable to load task logs.\n");
        updateOutputMessage(error instanceof Error ? error.message : "Unable to load task logs.");
      });

    return () => abortController.abort();
  }, [scrollOutputToBottomAfterLayout, updateOutputMessage]);

  useEffect(() => {
    setSearchTerm("");
    return loadPersistedLog(task);
  }, [loadPersistedLog, taskId]);

  useEffect(() => {
    if (!lastOutput || lastOutput.taskId !== task?.id) {
      return;
    }
    const shouldStickToBottom = shouldStickToOutputBottomRef.current || isOutputViewportNearBottom();
    shouldStickToOutputBottomRef.current = shouldStickToBottom;
    setRawLog((current) => `${current}${lastOutput.data}`.slice(-logTailLength));
    if (shouldStickToBottom) {
      scrollOutputToBottomAfterLayout();
    }
  }, [isOutputViewportNearBottom, lastOutput, scrollOutputToBottomAfterLayout, task?.id]);

  const reloadLog = () => {
    loadPersistedLog(task);
  };

  const updateOutputBottomStickiness = () => {
    shouldStickToOutputBottomRef.current = isOutputViewportNearBottom();
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
          <pre className="output-surface" style={{ fontSize: outputFontSize }}>{outputText}</pre>
        </div>
      </div>
      <InputComposer
        key={task?.id ?? "no-task"}
        codexModels={codexModels}
        isConnected={isConnected}
        selectedImages={selectedImages}
        task={task}
        value={composerValue}
        onSelectedImagesChange={onSelectedImagesChange}
        onValueChange={onComposerValueChange}
        send={send}
      />
    </section>
  );
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

function readStoredOutputFontSize() {
  const storedValue = Number(window.localStorage.getItem(outputFontSizeStorageKey));
  return outputFontSizes.includes(storedValue) ? storedValue : outputDefaultFontSize;
}
