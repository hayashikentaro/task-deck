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

export function TerminalPane({ isConnected, task, lastOutput, send }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const selectedTaskIdRef = useRef<string | null>(null);
  const followOutputRef = useRef(true);
  const [followOutput, setFollowOutput] = useState(true);
  const [logBuffer, setLogBuffer] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [terminalMessage, setTerminalMessage] = useState("");

  const terminalMode = getTerminalMode(task, isConnected);
  const searchMatchCount = useMemo(() => countMatches(logBuffer, searchTerm), [logBuffer, searchTerm]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.disableStdin = true;
    }
  }, []);

  useEffect(() => {
    followOutputRef.current = followOutput;
  }, [followOutput]);

  useEffect(() => {
    if (!hostRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      theme: {
        background: "#07090b",
        foreground: "#d8f3dc",
        cursor: "#7dd3fc",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);
    terminal.options.disableStdin = true;
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
          if (followOutputRef.current) {
            terminal.scrollToBottom();
          }
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
    selectedTaskIdRef.current = task?.id ?? null;
    setSearchTerm("");
    return loadPersistedLog(task);
  }, [loadPersistedLog, task]);

  useEffect(() => {
    if (!lastOutput || lastOutput.taskId !== task?.id) {
      return;
    }
    setLogBuffer((current) => `${current}${lastOutput.data}`.slice(-logTailLength));
    terminalRef.current?.write(lastOutput.data, () => {
      if (followOutputRef.current) {
        terminalRef.current?.scrollToBottom();
      }
    });
  }, [lastOutput, task?.id]);

  const clearTerminalView = () => {
    terminalRef.current?.reset();
    setLogBuffer("");
    setTerminalMessage("Terminal view cleared. Reload to restore persisted log.");
  };

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
        <div className="terminal-title-group">
          <h2>Terminal</h2>
          <strong data-mode={modeTone(terminalMode)}>{terminalMode}</strong>
          <span>{task ? task.agentState.replace(/_/g, " ") : "idle"}</span>
        </div>
        <div className="terminal-controls">
          <button
            aria-pressed={followOutput}
            data-active={followOutput}
            onClick={() => setFollowOutput((current) => !current)}
            type="button"
          >
            Follow {followOutput ? "on" : "off"}
          </button>
          <label className="terminal-search">
            <input
              disabled={!task}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search log"
              type="search"
              value={searchTerm}
            />
          </label>
          <span className="terminal-search-count">
            {searchTerm ? `${searchMatchCount} match${searchMatchCount === 1 ? "" : "es"}` : "No search"}
          </span>
          <button disabled={!task} onClick={clearTerminalView} type="button">
            Clear
          </button>
          <button disabled={!task} onClick={reloadLog} type="button">
            Reload
          </button>
          <button disabled={!task || logBuffer.length === 0} onClick={copyLog} type="button">
            Copy
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

function getTerminalMode(task: Task | null, isConnected: boolean) {
  if (!task) {
    return "No task selected";
  }
  if (!isConnected) {
    return "Disconnected";
  }
  if (task.status === "running") {
    return "Interactive PTY";
  }
  return "Read-only log";
}

function modeTone(mode: string) {
  if (mode === "Interactive PTY") {
    return "interactive";
  }
  if (mode === "Disconnected") {
    return "disconnected";
  }
  if (mode === "Read-only log") {
    return "readonly";
  }
  return "none";
}
