import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InputComposer } from "./InputComposer";
import type { OutputEvent, Task } from "../types";

type TerminalPaneProps = {
  isConnected: boolean;
  task: Task | null;
  lastOutput: OutputEvent | null;
  send: (payload: unknown) => boolean;
};

const logTailLength = 200_000;
const terminalFontSizeStorageKey = "taskdeck.terminalFontSize";
const terminalFontSizes = [11, 12, 13, 14, 15, 16, 18];

export function TerminalPane({ isConnected, task, lastOutput, send }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const selectedTaskIdRef = useRef<string | null>(null);
  const directInputDebugRef = useRef(isDirectInputDebugEnabled());
  const [logBuffer, setLogBuffer] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [terminalMessage, setTerminalMessage] = useState("");
  const [terminalFontSize, setTerminalFontSize] = useState(readStoredTerminalFontSize);

  const directInputDebug = directInputDebugRef.current;
  const taskId = task?.id ?? null;
  const searchMatchCount = useMemo(() => countMatches(logBuffer, searchTerm), [logBuffer, searchTerm]);

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
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: terminalFontSize,
      theme: {
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
      },
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

  const loadPersistedLog = useCallback((nextTask: Task | null) => {
    const terminal = terminalRef.current;

    if (!terminal) {
      return undefined;
    }

    terminal.reset();
    setTerminalMessage("");
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
        setTerminalMessage(payload.truncated ? `Showing last ${logTailLength.toLocaleString()} characters.` : "");
      })
      .catch((error) => {
        if (abortController.signal.aborted) {
          return;
        }
        terminal.writeln("[TaskDeck] Unable to load task logs.");
        setTerminalMessage(error instanceof Error ? error.message : "Unable to load task logs.");
      });

    return () => abortController.abort();
  }, []);

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

  const copyLog = async () => {
    if (!logBuffer) {
      setTerminalMessage("No terminal content to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(logBuffer);
      setTerminalMessage("Copied terminal content.");
    } catch {
      setTerminalMessage("Copy failed in this browser context.");
    }
  };

  return (
    <section className="terminal-pane" aria-label="Terminal">
      <div className="terminal-toolbar">
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
          <button disabled={!task} onClick={reloadLog} type="button">
            Reload log
          </button>
          <button disabled={!task || logBuffer.length === 0} onClick={copyLog} type="button">
            Copy log
          </button>
        </div>
      </div>
      {terminalMessage ? <p className="terminal-message">{terminalMessage}</p> : null}
      <div className="terminal-host" ref={hostRef} />
      <InputComposer isConnected={isConnected} task={task} send={send} />
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

function isDirectInputDebugEnabled() {
  return new URLSearchParams(window.location.search).get("directInput") === "1";
}

function readStoredTerminalFontSize() {
  const storedValue = Number(window.localStorage.getItem(terminalFontSizeStorageKey));
  return terminalFontSizes.includes(storedValue) ? storedValue : 13;
}
