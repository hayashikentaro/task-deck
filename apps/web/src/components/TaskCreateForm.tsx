import { FormEvent, useEffect, useState } from "react";
import { agentProfiles } from "../agentProfiles";
import type { CreateTaskInput, CwdValidation, TaskDeckContext, TaskPreset } from "../types";

type TaskCreateFormProps = {
  context: TaskDeckContext | null;
  disabled: boolean;
  onCreateTask: (input: CreateTaskInput) => void;
  onClearPresets: () => void;
  presets: TaskPreset[];
};

const defaultAgentProfileId = "codex";

export function TaskCreateForm({ context, disabled, onCreateTask, onClearPresets, presets }: TaskCreateFormProps) {
  const [selectedAgentId, setSelectedAgentId] = useState(defaultAgentProfileId);
  const [customCommand, setCustomCommand] = useState("");
  const [initialInstruction, setInitialInstruction] = useState("");
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
  const selectedAgent =
    agentProfiles.find((profile) => profile.id === selectedAgentId) ?? agentProfiles[0];
  const command = selectedAgent.id === "custom" ? customCommand.trim() : selectedAgent.command;
  const canStart = !disabled && cwdIsValid && !isValidatingCwd && Boolean(command);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canStart) {
      return;
    }
    onCreateTask({
      title: buildTaskTitle(selectedAgent.label, initialInstruction),
      command,
      cwd,
      initialInstruction: initialInstruction.trim(),
    });
  };

  const applyPreset = (preset: TaskPreset) => {
    const matchingAgent = agentProfiles.find((profile) => profile.command === preset.command && profile.command);
    if (matchingAgent) {
      setSelectedAgentId(matchingAgent.id);
      setCustomCommand("");
    } else {
      setSelectedAgentId("custom");
      setCustomCommand(preset.command);
    }
    setInitialInstruction("");
    setCwd(preset.cwd);
  };

  const applyCwdSuggestion = (value: string) => {
    setCwd(value);
  };

  return (
    <section className="task-create-panel">
      <form className="task-create-form" onSubmit={handleSubmit}>
        <label className="cwd-field">
          <span>Workspace</span>
          <input placeholder="Repository root" value={cwd} onChange={(event) => setCwd(event.target.value)} />
        </label>
        <div className="agent-picker" aria-label="Agent profiles">
          <span>Agent</span>
          <div>
            {agentProfiles.map((profile) => (
              <button
                aria-pressed={selectedAgentId === profile.id}
                data-active={selectedAgentId === profile.id}
                key={profile.id}
                onClick={() => setSelectedAgentId(profile.id)}
                title={profile.description}
                type="button"
              >
                {profile.label}
              </button>
            ))}
          </div>
        </div>
        {selectedAgent.id === "custom" ? (
          <label className="custom-command-field">
            <span>Custom PTY</span>
            <input
              placeholder="Command to run in a PTY"
              value={customCommand}
              onChange={(event) => setCustomCommand(event.target.value)}
            />
          </label>
        ) : (
          <div className="agent-command-note" aria-label="Agent command">
            <span>PTY</span>
            <strong>{selectedAgent.command}</strong>
          </div>
        )}
        <label className="instruction-field">
          <span>Initial instruction</span>
          <textarea
            placeholder="Describe the coding task for the agent..."
            rows={3}
            value={initialInstruction}
            onChange={(event) => setInitialInstruction(event.target.value)}
          />
        </label>
        <button disabled={!canStart} type="submit">
          Start agent
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

function buildTaskTitle(agentLabel: string, instruction: string) {
  const firstLine = instruction.trim().split(/\r?\n/).find(Boolean);
  if (!firstLine) {
    return `${agentLabel} session`;
  }
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}
