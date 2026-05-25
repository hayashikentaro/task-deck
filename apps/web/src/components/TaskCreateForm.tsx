import { FormEvent, useState } from "react";
import type { CreateTaskInput } from "../types";

type TaskCreateFormProps = {
  disabled: boolean;
  onCreateTask: (input: CreateTaskInput) => void;
};

export function TaskCreateForm({ disabled, onCreateTask }: TaskCreateFormProps) {
  const [title, setTitle] = useState("Inspect repository");
  const [command, setCommand] = useState("pwd && ls -la");
  const [cwd, setCwd] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onCreateTask({ title, command, cwd });
  };

  return (
    <form className="task-create-form" onSubmit={handleSubmit}>
      <label>
        <span>Title</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="command-field">
        <span>Command</span>
        <input value={command} onChange={(event) => setCommand(event.target.value)} />
      </label>
      <label>
        <span>CWD</span>
        <input placeholder="Repository root" value={cwd} onChange={(event) => setCwd(event.target.value)} />
      </label>
      <button disabled={disabled || !command.trim()} type="submit">
        Start
      </button>
    </form>
  );
}

