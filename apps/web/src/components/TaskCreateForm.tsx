import { FormEvent, useState } from "react";
import type { CreateTaskInput, TaskPreset } from "../types";

type TaskCreateFormProps = {
  disabled: boolean;
  onCreateTask: (input: CreateTaskInput) => void;
  onClearPresets: () => void;
  presets: TaskPreset[];
};

export function TaskCreateForm({ disabled, onCreateTask, onClearPresets, presets }: TaskCreateFormProps) {
  const [title, setTitle] = useState("Inspect repository");
  const [command, setCommand] = useState("pwd && ls -la");
  const [cwd, setCwd] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onCreateTask({ title, command, cwd });
  };

  const applyPreset = (preset: TaskPreset) => {
    setTitle(preset.title);
    setCommand(preset.command);
    setCwd(preset.cwd);
  };

  return (
    <section className="task-create-panel">
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

      <div className="preset-strip" aria-label="Recent task presets">
        <div className="preset-strip-heading">
          <span>Recent</span>
          <button disabled={presets.length === 0} onClick={onClearPresets} type="button">
            Clear presets
          </button>
        </div>
        <div className="preset-list">
          {presets.length === 0 ? <p>No recent task presets.</p> : null}
          {presets.map((preset) => (
            <button
              key={`${preset.command}:${preset.cwd}`}
              onClick={() => applyPreset(preset)}
              title={`${preset.command}\n${preset.cwd}`}
              type="button"
            >
              <span>{preset.title}</span>
              <small>{preset.cwd || "Repository root"}</small>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
