import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InputComposer } from "./InputComposer";
import { taskIdentityCssProperties } from "../taskIdentity";
import type { OutputEvent, Task } from "../types";
import { IconButton } from "./ui/IconButton";

type TerminalPaneProps = {
  composerValue: string;
  isConnected: boolean;
  task: Task | null;
  lastOutput: OutputEvent | null;
  terminalMessage: string;
  onComposerValueChange: (value: string) => void;
  onLogBufferChange: (value: string) => void;
  onTerminalMessageChange: (value: string) => void;
  send: (payload: unknown) => boolean;
};

const logTailLength = 200_000;
const terminalFontSizeStorageKey = "taskdeck.terminalFontSize";
const terminalFontSizes = [11, 12, 13, 14, 15, 16, 18];
const transparentTerminalBackground = "rgba(0, 0, 0, 0)";
const terminalTheme = {
  background: "#080907",
  foreground: "#e2dac8",
  cursor: "#c6a45b",
  selectionBackground: "#2c2519",
  black: "#080907",
  blue: "#637e86",
  brightBlue: "#78949d",
  brightCyan: "#7fab9f",
  brightGreen: "#9fa86a",
  brightMagenta: "#9d86aa",
  brightRed: "#c3774f",
  brightWhite: "#eee7d6",
  brightYellow: "#d0bd72",
  cyan: "#5e948f",
  green: "#7e8e58",
  magenta: "#8c749b",
  red: "#ae583f",
  white: "#cfc6b2",
  yellow: "#c6a45b",
};

export function TerminalPane({
  composerValue,
  isConnected,
  task,
  lastOutput,
  terminalMessage,
  onComposerValueChange,
  onLogBufferChange,
  onTerminalMessageChange,
  send,
}: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const selectedTaskIdRef = useRef<string | null>(null);
  const directInputDebugRef = useRef(isDirectInputDebugEnabled());
  const [logBuffer, setLogBuffer] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [terminalFontSize, setTerminalFontSize] = useState(readStoredTerminalFontSize);

  const directInputDebug = directInputDebugRef.current;
  const taskId = task?.id ?? null;
  const searchMatchCount = useMemo(() => countMatches(logBuffer, searchTerm), [logBuffer, searchTerm]);
  const hasTuiChoice = useMemo(() => detectTuiChoice(logBuffer), [logBuffer]);
  const taskIdentityStyle = useMemo(
    () => (task ? taskIdentityCssProperties({ taskId: task.id, identityColorSlot: task.identityColorSlot }) : undefined),
    [task?.id, task?.identityColorSlot],
  );
  const terminalSelectionBackground =
    taskIdentityStyle?.["--task-terminal-selection"] ?? terminalTheme.selectionBackground;

  const updateTerminalMessage = useCallback(
    (value: string) => {
      onTerminalMessageChange(value);
    },
    [onTerminalMessageChange],
  );

  useEffect(() => {
    onLogBufferChange(logBuffer);
  }, [logBuffer, onLogBufferChange]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.disableStdin = !(directInputDebug && task?.status === "running" && isConnected);
    }
  }, [directInputDebug, isConnected, task?.status]);

  useEffect(() => {
    if (!hostRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      allowTransparency: true,
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: terminalFontSize,
      theme: terminalTheme,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);
    terminal.options.disableStdin = !directInputDebugRef.current;
    terminal.onData((data) => {
      if (!directInputDebugRef.current) {
        return;
      }
      const taskId = selectedTaskIdRef.current;
      if (taskId) {
        send({ type: "input", taskId, data, source: "xterm" });
      }
    });
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const resize = () => {
      fitAddon.fit();
      const taskId = selectedTaskIdRef.current;
      if (taskId) {
        send({ type: "resize", taskId, cols: terminal.cols, rows: terminal.rows });
      }
    };
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [send]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }

    terminal.options.fontSize = terminalFontSize;
    window.localStorage.setItem(terminalFontSizeStorageKey, String(terminalFontSize));
    fitAddon.fit();

    const taskId = selectedTaskIdRef.current;
    if (taskId) {
      send({ type: "resize", taskId, cols: terminal.cols, rows: terminal.rows });
    }
  }, [send, terminalFontSize]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.theme = {
      ...terminalTheme,
      background: taskId ? transparentTerminalBackground : terminalTheme.background,
      selectionBackground: taskId ? terminalSelectionBackground : terminalTheme.selectionBackground,
    };
  }, [taskId, terminalSelectionBackground]);

  const loadPersistedLog = useCallback((nextTask: Task | null) => {
    const terminal = terminalRef.current;

    if (!terminal) {
      return undefined;
    }

    terminal.reset();
    updateTerminalMessage("");
    setLogBuffer("");

    if (!nextTask) {
      terminal.writeln("No task selected.");
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
        terminal.reset();
        if (payload.truncated) {
          terminal.writeln(`[TaskDeck] Showing last ${logTailLength.toLocaleString()} characters of persisted log.`);
        }
        terminal.write(logs, () => {
          terminal.scrollToBottom();
        });
        setLogBuffer(logs);
        updateTerminalMessage(payload.truncated ? `Showing last ${logTailLength.toLocaleString()} characters.` : "");
      })
      .catch((error) => {
        if (abortController.signal.aborted) {
          return;
        }
        terminal.writeln("[TaskDeck] Unable to load task logs.");
        updateTerminalMessage(error instanceof Error ? error.message : "Unable to load task logs.");
      });

    return () => abortController.abort();
  }, [updateTerminalMessage]);

  useEffect(() => {
    selectedTaskIdRef.current = taskId;
    setSearchTerm("");
    return loadPersistedLog(task);
  }, [loadPersistedLog, taskId]);

  useEffect(() => {
    if (!lastOutput || lastOutput.taskId !== task?.id) {
      return;
    }
    setLogBuffer((current) => `${current}${lastOutput.data}`.slice(-logTailLength));
    terminalRef.current?.write(lastOutput.data, () => {
      terminalRef.current?.scrollToBottom();
    });
  }, [lastOutput, task?.id]);

  const reloadLog = () => {
    loadPersistedLog(task);
  };

  return (
    <section className="terminal-pane" aria-label="Terminal" data-has-task={task ? "true" : undefined} style={taskIdentityStyle}>
      <div className="terminal-toolbar">
        <div className="terminal-observations">
          {hasTuiChoice ? (
            <span
              aria-label="Possible TUI choice detected"
              className="terminal-tui-choice-indicator"
              role="status"
              title="Possible TUI choice detected"
            >
              Possible TUI choice
            </span>
          ) : null}
        </div>
        <div className="terminal-controls">
          <label className="terminal-font-size">
            <span>Font</span>
            <select
              aria-label="Terminal font size"
              value={terminalFontSize}
              onChange={(event) => setTerminalFontSize(Number(event.target.value))}
            >
              {terminalFontSizes.map((fontSize) => (
                <option key={fontSize} value={fontSize}>
                  {fontSize}
                </option>
              ))}
            </select>
          </label>
          <label className="terminal-search">
            <input
              disabled={!task}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search log"
              type="search"
              value={searchTerm}
            />
          </label>
          {searchTerm ? (
            <span className="terminal-search-count">
              {searchMatchCount} match{searchMatchCount === 1 ? "" : "es"}
            </span>
          ) : null}
          <IconButton label="Reload log" disabled={!task} size="sm" variant="ghost" onClick={reloadLog} title="Reload log">
            <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
              <path d="M13 8a5 5 0 1 1-1.46-3.54M13 2.5v4h-4" />
            </svg>
          </IconButton>
        </div>
      </div>
      {terminalMessage ? <p className="terminal-message">{terminalMessage}</p> : null}
      <div className="terminal-host" ref={hostRef} />
      <InputComposer
        isConnected={isConnected}
        task={task}
        value={composerValue}
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

function detectTuiChoice(value: string) {
  const text = normalizeTerminalObservation(value.slice(-8000));
  if (!text) {
    return false;
  }

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-80);
  const optionLineIndexes = indexesMatching(lines, (line) => isLikelyChoiceOptionLine(line) || isLikelySelectedChoiceLine(line));
  const selectedLineIndexes = indexesMatching(lines, isLikelySelectedChoiceLine);
  const menuPromptLineIndexes = indexesMatching(lines, isLikelyMenuPromptLine);
  const enterPromptLineIndexes = indexesMatching(lines, isLikelyEnterPromptLine);
  const numberedOptionIndexes = indexesMatching(lines, isLikelyNumberedChoiceOptionLine);
  const selectedNumberedOptionIndexes = indexesMatching(lines, isLikelySelectedNumberedChoiceOptionLine);

  return hasNumberedChoiceMenu(lines, numberedOptionIndexes, selectedNumberedOptionIndexes)
    || (menuPromptLineIndexes.length > 0 && hasNearbyLine(menuPromptLineIndexes, optionLineIndexes))
    || (
      enterPromptLineIndexes.length > 0
      && selectedLineIndexes.length > 0
      && optionLineIndexes.length >= 2
      && hasNearbyLine(enterPromptLineIndexes, selectedLineIndexes)
    );
}

function normalizeTerminalObservation(value: string) {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[PX^_].*?\x1b\\/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/[│┃┆┊┌┐└┘├┤┬┴┼─━]/g, " ");
}

function isLikelyChoiceOptionLine(line: string) {
  return /^(?:[>▸▹▶❯]\s*)?(?:\(?[0-9]{1,2}\)?[.)]|[a-zA-Z][.)])\s+\S/.test(line);
}

function isLikelySelectedChoiceLine(line: string) {
  return /^(?:[>▸▹▶❯])\s+\S/.test(line);
}

function isLikelyNumberedChoiceOptionLine(line: string) {
  return /^(?:[>›»▸▹▶❯]\s*)?(?:\(?[0-9]{1,2}\)?[.)])\s+\S/.test(line);
}

function isLikelySelectedNumberedChoiceOptionLine(line: string) {
  return /^(?:[>›»▸▹▶❯])\s+(?:\(?[0-9]{1,2}\)?[.)])\s+\S/.test(line);
}

function isLikelyMenuPromptLine(line: string) {
  return /\b(use\s+(?:the\s+)?arrow\s+keys|select(?:\s+an?\s+option)?|choose(?:\s+an?\s+option)?|pick\s+one)\b/i.test(line);
}

function isLikelyEnterPromptLine(line: string) {
  return /\bpress\s+enter\b/i.test(line);
}

function hasNumberedChoiceMenu(lines: string[], numberedOptionIndexes: number[], selectedNumberedOptionIndexes: number[]) {
  const consecutiveNumberedOptionIndexes = consecutiveNumberedMenuIndexes(lines, numberedOptionIndexes);
  if (consecutiveNumberedOptionIndexes.length < 2) {
    return false;
  }

  if (selectedNumberedOptionIndexes.some((index) => consecutiveNumberedOptionIndexes.includes(index))) {
    return true;
  }

  return hasNearbyInteractionSignal(lines, consecutiveNumberedOptionIndexes);
}

function consecutiveNumberedMenuIndexes(lines: string[], numberedOptionIndexes: number[]) {
  for (let index = 0; index < numberedOptionIndexes.length - 1; index += 1) {
    const firstIndex = numberedOptionIndexes[index];
    const secondIndex = numberedOptionIndexes[index + 1];
    const firstNumber = numberedOptionNumber(lines[firstIndex]);
    const secondNumber = numberedOptionNumber(lines[secondIndex]);
    if (secondIndex - firstIndex <= 2 && firstNumber > 0 && secondNumber === firstNumber + 1) {
      return [firstIndex, secondIndex];
    }
  }
  return [];
}

function numberedOptionNumber(line: string) {
  const match = line.match(/^(?:[>›»▸▹▶❯]\s*)?\(?([0-9]{1,2})\)?[.)]\s+\S/);
  return match ? Number(match[1]) : 0;
}

function hasNearbyInteractionSignal(lines: string[], optionIndexes: number[]) {
  const optionText = optionIndexes.map((index) => lines[index]).join("\n");
  if (/\b(?:yes|no|cancel|proceed|continue|quit)\b/i.test(optionText)) {
    return true;
  }

  const firstIndex = optionIndexes[0];
  const lastIndex = optionIndexes[optionIndexes.length - 1];
  const nearbyText = lines.slice(Math.max(0, firstIndex - 6), Math.min(lines.length, lastIndex + 7)).join("\n");
  return /\b(?:press\s+enter|use\s+(?:the\s+)?arrow|select|choose|pick\s+one)\b/i.test(nearbyText)
    || /(?:\?|^(?:do|are|would|should|can|will|is|does)\b.*\?)/im.test(nearbyText);
}

function indexesMatching(lines: string[], predicate: (line: string) => boolean) {
  return lines.reduce<number[]>((indexes, line, index) => {
    if (predicate(line)) {
      indexes.push(index);
    }
    return indexes;
  }, []);
}

function hasNearbyLine(leftIndexes: number[], rightIndexes: number[]) {
  return leftIndexes.some((leftIndex) => rightIndexes.some((rightIndex) => Math.abs(leftIndex - rightIndex) <= 6));
}

function isDirectInputDebugEnabled() {
  return new URLSearchParams(window.location.search).get("directInput") === "1";
}

function readStoredTerminalFontSize() {
  const storedValue = Number(window.localStorage.getItem(terminalFontSizeStorageKey));
  return terminalFontSizes.includes(storedValue) ? storedValue : 13;
}
