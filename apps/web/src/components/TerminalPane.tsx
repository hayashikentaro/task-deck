import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import type { OutputEvent, Task } from "../types";

type TerminalPaneProps = {
  task: Task | null;
  lastOutput: OutputEvent | null;
  send: (payload: unknown) => boolean;
};

export function TerminalPane({ task, lastOutput, send }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const selectedTaskIdRef = useRef<string | null>(null);

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
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    terminal.onData((data) => {
      const taskId = selectedTaskIdRef.current;
      if (taskId) {
        send({ type: "input", taskId, data });
      }
    });

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
    selectedTaskIdRef.current = task?.id ?? null;
    const terminal = terminalRef.current;

    if (!terminal) {
      return;
    }

    terminal.reset();
    if (!task) {
      terminal.writeln("No task selected.");
      return;
    }

    fetch(`/api/tasks/${task.id}/logs`)
      .then((response) => response.json())
      .then((payload: { logs?: string }) => {
        terminal.reset();
        terminal.write(payload.logs || "");
      })
      .catch(() => {
        terminal.writeln("[TaskDeck] Unable to load task logs.");
      });
  }, [task?.id]);

  useEffect(() => {
    if (!lastOutput || lastOutput.taskId !== task?.id) {
      return;
    }
    terminalRef.current?.write(lastOutput.data);
  }, [lastOutput, task?.id]);

  return (
    <section className="terminal-pane" aria-label="Terminal">
      <div className="pane-heading">
        <h2>Terminal</h2>
        <span>{task ? task.status : "idle"}</span>
      </div>
      <div className="terminal-host" ref={hostRef} />
    </section>
  );
}

