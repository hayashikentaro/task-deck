import { FormEvent, useEffect, useState } from "react";
import type { CreateTaskInput, CwdValidation, TaskDeckContext, TaskPreset } from "../types";

type TaskCreateFormProps = {
  context: TaskDeckContext | null;
  disabled: boolean;
  onCreateTask: (input: CreateTaskInput) => void;
  onClearPresets: () => void;
  presets: TaskPreset[];
};

export function TaskCreateForm({ context, disabled, onCreateTask, onClearPresets, presets }: TaskCreateFormProps) {
  const [title, setTitle] = useState("Inspect repository");
  const [command, setCommand] = useState("pwd && ls -la");
  const [cwd, setCwd] = useState("");
  const [cwdValidation, setCwdValidation] = useState<CwdValidation | null>(null);
  const [isValidatingCwd, setIsValidatingCwd] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();
    const validationTimer = window.setTimeout(() => {
      setIsValidatingCwd(true);
      fetch("/api/validate-cwd", {
        body: JSON.stringify({ cwd }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: abortController.signal,
      })
        .then((response) => response.json())
        .then((validation: CwdValidation) => {
          if (!abortController.signal.aborted) {
            setCwdValidation(validation);
          }
        })
        .catch(() => {
          if (!abortController.signal.aborted) {
            setCwdValidation({
              ok: false,
              inputCwd: cwd,
              resolvedCwd: cwd,
              exists: false,
              isDirectory: false,
              isGitRepo: false,
              message: "Unable to validate cwd.",
            });
          }
        })
        .finally(() => {
          if (!abortController.signal.aborted) {
            setIsValidatingCwd(false);
          }
        });
    }, 200);

    return () => {
      window.clearTimeout(validationTimer);
      abortController.abort();
    };
  }, [cwd]);

  const cwdIsValid = cwdValidation?.ok ?? false;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!cwdIsValid) {
      return;
    }
    onCreateTask({ title, command, cwd });
  };

  const applyPreset = (preset: TaskPreset) => {
    setTitle(preset.title);
    setCommand(preset.command);
    setCwd(preset.cwd);
  };

  const applyCwdSuggestion = (value: string) => {
    setCwd(value);
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
        <label className="cwd-field">
          <span>CWD</span>
          <input placeholder="Repository root" value={cwd} onChange={(event) => setCwd(event.target.value)} />
        </label>
        <button disabled={disabled || !command.trim() || isValidatingCwd || !cwdIsValid} type="submit">
          Start
        </button>
      </form>

      <div className="cwd-helper" data-state={cwdValidation?.ok ? "valid" : "invalid"}>
        <div>
          <span>CWD status</span>
          <strong>{isValidatingCwd ? "Validating..." : cwdValidation?.message ?? "Loading cwd context..."}</strong>
          {cwdValidation?.resolvedCwd ? <small>{cwdValidation.resolvedCwd}</small> : null}
        </div>
        <div className="cwd-suggestions" aria-label="Working directory suggestions">
          {context?.cwdSuggestions.map((suggestion) => (
            <button
              key={suggestion.path}
              onClick={() => applyCwdSuggestion(suggestion.value)}
              title={suggestion.path}
              type="button"
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      </div>

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
