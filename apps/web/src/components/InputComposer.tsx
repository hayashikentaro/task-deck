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

const maxComposerHeight = 140;
const composerActions: ComposerAction[] = [
  { label: "Continue", text: "Continue from the current state." },
  { label: "Summarize", text: "Summarize the current state, blockers, and next step." },
  { label: "Review diff", text: "Review the current diff and call out risks before changing more files." },
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

  const sendValue = () => {
    if (!task || !canSend || !value) {
      return;
    }
    const data = value.endsWith("\n") || value.endsWith("\r") ? value : `${value}\r`;
    const didSend = send({ type: "input", taskId: task.id, data });
    if (didSend) {
      setValue("");
    }
  };

  return (
    <form className="input-composer" onSubmit={handleSubmit}>
      <div className="input-composer-inner">
        <div className="composer-actions" aria-label="Composer quick actions">
          {composerActions.map((action) => (
            <button disabled={!canSend} key={action.label} type="button" onClick={() => insertQuickAction(action.text)}>
              {action.label}
            </button>
          ))}
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
