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
    sendInput(command);
  };

  const sendAllDiagnostics = () => {
    sendInput(diagnosticCommands.map((diagnostic) => diagnostic.command).join("\n"));
  };

  const sendValue = () => {
    if (!value) {
      return;
    }
    const didSend = sendInput(value);
    if (didSend) {
      setValue("");
    }
  };

  const sendInput = (input: string) => {
    if (!task || !canSend || !input) {
      return false;
    }
    const data = input.endsWith("\n") || input.endsWith("\r") ? input : `${input}\r`;
    return send({ type: "input", taskId: task.id, data });
  };

  return (
    <form className="input-composer" onSubmit={handleSubmit}>
      <div className="input-composer-inner">
        <div className="composer-action-groups" aria-label="Composer quick actions">
          <div className="composer-action-group">
            <span>Insert</span>
            <div className="composer-actions">
              {insertActions.map((action) => (
                <button disabled={!canSend} key={action.label} type="button" onClick={() => insertQuickAction(action.text)}>
                  {action.label}
                </button>
              ))}
            </div>
          </div>
          <div className="composer-action-group">
            <span>Send diagnostics</span>
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
        </div>
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
  if (event.key !== "Enter") {
    return false;
  }
  if (isComposing || event.nativeEvent.isComposing) {
    return false;
  }
  if (event.shiftKey) {
    return false;
  }
  return event.metaKey || event.ctrlKey || !event.altKey;
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
