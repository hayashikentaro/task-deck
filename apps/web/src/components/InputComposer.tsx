import { FormEvent, useState } from "react";
import type { Task } from "../types";

type InputComposerProps = {
  isConnected: boolean;
  task: Task | null;
  send: (payload: unknown) => boolean;
};

export function InputComposer({ isConnected, task, send }: InputComposerProps) {
  const [value, setValue] = useState("");
  const canSend = Boolean(task && task.status === "running" && isConnected);
  const modeText = getComposerMode(task, isConnected);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!task || !canSend || !value) {
      return;
    }
    const didSend = send({ type: "input", taskId: task.id, data: `${value}\r` });
    if (didSend) {
      setValue("");
    }
  };

  return (
    <form className="input-composer" onSubmit={handleSubmit}>
      <button className="composer-plus" disabled type="button" aria-label="Attach context">
        +
      </button>
      <input
        disabled={!canSend}
        onChange={(event) => setValue(event.target.value)}
        placeholder={canSend ? "Send input to running PTY" : modeText}
        value={value}
      />
      <span>{modeText}</span>
      <button disabled={!canSend || !value} type="submit">
        Send
      </button>
    </form>
  );
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
