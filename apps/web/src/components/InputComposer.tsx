import { FormEvent, KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import type { Task } from "../types";

type InputComposerProps = {
  isConnected: boolean;
  task: Task | null;
  send: (payload: unknown) => boolean;
};

type ComposerAction = {
  label: string;
  text: string;
};

type DiagnosticCommand = {
  label: string;
  command: string;
};

const maxComposerHeight = 140;
const terminalEnter = "\r";
const bracketedPasteStart = "\x1b[200~";
const bracketedPasteEnd = "\x1b[201~";
const insertActions: ComposerAction[] = [
  { label: "Continue", text: "Continue from the current state." },
  { label: "Summarize", text: "Summarize the current state, blockers, and next step." },
  { label: "Review diff", text: "Review the current diff and call out risks before changing more files." },
];
const diagnosticCommands: DiagnosticCommand[] = [
  { label: "pwd", command: "pwd" },
  { label: "ls", command: "ls" },
  { label: "git status", command: "git status" },
  { label: "which codex", command: "which codex" },
  { label: "which goose", command: "which goose" },
  { label: "codex --version", command: "codex --version" },
  { label: "goose --version", command: "goose --version" },
];
const codexAuthCommands: DiagnosticCommand[] = [
  { label: "codex help", command: "codex --help" },
  { label: "logout", command: "codex logout" },
  { label: "login", command: "codex login" },
];
const inPtyContainerCheckCommands: DiagnosticCommand[] = [
  {
    label: "pwd",
    command: "pwd",
  },
  {
    label: "/workspace",
    command: "test -d /workspace && echo 'current PTY:/workspace ready' || echo 'current PTY:/workspace missing'",
  },
  {
    label: "workspace files",
    command: "test -d /workspace && ls -la /workspace || echo 'current PTY:/workspace unavailable'",
  },
  {
    label: "find review/lens",
    command: "find /workspace -maxdepth 3 -iname '*review*' -o -iname '*lens*'",
  },
];
const hostDockerContainerCheckCommands: DiagnosticCommand[] = [
  {
    label: "docker ps",
    command: "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'",
  },
  {
    label: "codex workspace",
    command:
      "docker exec ai-agent-sandbox-agent-1 test -d /workspace && echo 'ai-agent-sandbox-agent-1:/workspace ready' || echo 'ai-agent-sandbox-agent-1:/workspace missing'",
  },
];

export function InputComposer({ isConnected, task, send }: InputComposerProps) {
  const [value, setValue] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canSend = Boolean(task && task.status === "running" && isConnected);
  const modeText = getComposerMode(task, isConnected);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxComposerHeight)}px`;
  }, [value]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    sendValue();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!shouldSendFromEnterKey(event, isComposing)) {
      return;
    }
    event.preventDefault();
    sendValue();
  };

  const insertQuickAction = (actionText: string) => {
    setValue((currentValue) => (currentValue ? `${currentValue}\n${actionText}` : actionText));
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const sendDiagnosticCommand = (command: string) => {
    sendShellCommands(command);
  };

  const sendAllDiagnostics = () => {
    sendShellCommands(diagnosticCommands.map((diagnostic) => diagnostic.command).join("\n"));
  };

  const sendCodexAuthCommand = (command: string) => {
    sendShellCommands(command);
  };

  const sendContainerCheck = (command: string) => {
    sendShellCommands(command);
  };

  const sendAllContainerChecks = () => {
    sendShellCommands([...inPtyContainerCheckCommands, ...hostDockerContainerCheckCommands].map((check) => check.command).join("\n"));
  };

  const sendAllInPtyContainerChecks = () => {
    sendShellCommands(inPtyContainerCheckCommands.map((check) => check.command).join("\n"));
  };

  const sendAllHostDockerContainerChecks = () => {
    sendShellCommands(hostDockerContainerCheckCommands.map((check) => check.command).join("\n"));
  };

  const sendValue = () => {
    if (!value) {
      return;
    }
    const didSend = sendAgentInput(value);
    if (didSend) {
      setValue("");
    }
  };

  const sendAgentInput = (input: string) => {
    if (!task || !canSend || !input) {
      return false;
    }
    const data = formatAgentInputForPty(input);
    return send({ type: "input", taskId: task.id, data, source: "composer-agent" });
  };

  const sendShellCommands = (input: string) => {
    if (!task || !canSend || !input) {
      return false;
    }
    const data = formatShellCommandsForPty(input);
    return send({ type: "input", taskId: task.id, data, source: "composer-shell" });
  };

  return (
    <form className="input-composer" onSubmit={handleSubmit}>
      <div className="input-composer-inner">
        <details className="composer-quick-actions">
          <summary>Quick actions</summary>
          <div className="composer-action-groups" aria-label="Composer quick actions">
            <div className="composer-action-group">
              <span>Prompt snippets</span>
              <div className="composer-actions">
                {insertActions.map((action) => (
                  <button disabled={!canSend} key={action.label} type="button" onClick={() => insertQuickAction(action.text)}>
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="composer-action-group">
              <span>PTY diagnostics</span>
              <div className="composer-actions">
                {diagnosticCommands.map((diagnostic) => (
                  <button
                    disabled={!canSend}
                    key={diagnostic.command}
                    type="button"
                    onClick={() => sendDiagnosticCommand(diagnostic.command)}
                  >
                    {diagnostic.label}
                  </button>
                ))}
                <button disabled={!canSend} type="button" onClick={sendAllDiagnostics}>
                  all
                </button>
              </div>
            </div>
            <div className="composer-action-group">
              <span>Codex auth</span>
              <div className="composer-actions">
                {codexAuthCommands.map((command) => (
                  <button
                    disabled={!canSend}
                    key={command.command}
                    type="button"
                    onClick={() => sendCodexAuthCommand(command.command)}
                  >
                    {command.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="composer-action-group">
              <span>Current PTY</span>
              <div className="composer-actions">
                {inPtyContainerCheckCommands.map((check) => (
                  <button disabled={!canSend} key={check.command} type="button" onClick={() => sendContainerCheck(check.command)}>
                    {check.label}
                  </button>
                ))}
                <button disabled={!canSend} type="button" onClick={sendAllInPtyContainerChecks}>
                  all
                </button>
              </div>
            </div>
            <div className="composer-action-group">
              <span>Host Docker</span>
              <div className="composer-actions">
                {hostDockerContainerCheckCommands.map((check) => (
                  <button disabled={!canSend} key={check.command} type="button" onClick={() => sendContainerCheck(check.command)}>
                    {check.label}
                  </button>
                ))}
                <button disabled={!canSend} type="button" onClick={sendAllHostDockerContainerChecks}>
                  all
                </button>
                <button disabled={!canSend} type="button" onClick={sendAllContainerChecks}>
                  all checks
                </button>
              </div>
            </div>
          </div>
        </details>
        <textarea
          ref={textareaRef}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          disabled={!canSend}
          onChange={(event) => setValue(event.target.value)}
          onCompositionEnd={() => setIsComposing(false)}
          onCompositionStart={() => setIsComposing(true)}
          onKeyDown={handleKeyDown}
          placeholder={canSend ? "Send input to running PTY" : modeText}
          rows={1}
          spellCheck={false}
          value={value}
        />
        <div className="composer-meta">
          <span className="composer-status">{modeText}</span>
          <span className="composer-hint">Enter to send · Shift+Enter newline · Cmd/Ctrl+Enter send</span>
        </div>
        <button disabled={!canSend || !value} type="submit">
          Send
        </button>
      </div>
    </form>
  );
}

function shouldSendFromEnterKey(event: KeyboardEvent<HTMLTextAreaElement>, isComposing: boolean) {
  if (!isEnterKey(event)) {
    return false;
  }
  if (isImeCompositionActive(event, isComposing)) {
    return false;
  }
  if (shouldInsertNewline(event)) {
    return false;
  }
  return isPlainEnter(event) || isCommandEnter(event);
}

function isEnterKey(event: KeyboardEvent<HTMLTextAreaElement>) {
  return event.key === "Enter";
}

function isImeCompositionActive(event: KeyboardEvent<HTMLTextAreaElement>, isComposing: boolean) {
  return isComposing || event.nativeEvent.isComposing;
}

function shouldInsertNewline(event: KeyboardEvent<HTMLTextAreaElement>) {
  return event.shiftKey;
}

function isPlainEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  return !event.altKey && !event.ctrlKey && !event.metaKey;
}

function isCommandEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  return event.metaKey || event.ctrlKey;
}

function formatAgentInputForPty(input: string) {
  const text = normalizeTerminalInput(input);
  return `${bracketedPasteStart}${text}${bracketedPasteEnd}${terminalEnter}`;
}

function formatShellCommandsForPty(input: string) {
  const text = normalizeTerminalInput(input);
  return `${text.replace(/\n/g, terminalEnter)}${terminalEnter}`;
}

function normalizeTerminalInput(input: string) {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function getComposerMode(task: Task | null, isConnected: boolean) {
  if (!task) {
    return "No task selected";
  }
  if (!isConnected) {
    return "Disconnected";
  }
  if (task.status !== "running") {
    return "Read-only log";
  }
  return "Interactive PTY";
}
