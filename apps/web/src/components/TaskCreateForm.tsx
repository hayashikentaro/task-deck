import { FormEvent, useEffect, useState } from "react";
import { defaultAgentProfiles } from "../agentProfiles";
import type { CreateTaskInput, CwdValidation, TaskDeckContext } from "../types";

type TaskCreateFormProps = {
  context: TaskDeckContext | null;
  disabled: boolean;
  onCreateTask: (input: CreateTaskInput) => void;
};

const defaultAgentProfileId = "codex";
type SessionMode = "new" | "resume_last" | "custom_resume";

export function TaskCreateForm({ context, disabled, onCreateTask }: TaskCreateFormProps) {
  const [selectedAgentId, setSelectedAgentId] = useState(defaultAgentProfileId);
  const [customCommand, setCustomCommand] = useState("");
  const [customResumeCommand, setCustomResumeCommand] = useState("");
  const [sessionMode, setSessionMode] = useState<SessionMode>("new");
  const [initialInstruction, setInitialInstruction] = useState("");
  const [cwd, setCwd] = useState("");
  const [cwdValidation, setCwdValidation] = useState<CwdValidation | null>(null);
  const [isValidatingCwd, setIsValidatingCwd] = useState(false);

  useEffect(() => {
    if (!cwd && context?.defaultCwd) {
      setCwd(context.defaultCwd);
    }
  }, [context?.defaultCwd, cwd]);

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

  const agentProfiles = context?.agentProfiles.length ? context.agentProfiles : defaultAgentProfiles;
  const selectedAgent =
    agentProfiles.find((profile) => profile.id === selectedAgentId) ?? agentProfiles[0] ?? defaultAgentProfiles[0];
  const cwdIsValid = cwdValidation?.ok ?? false;
  const baseCommand = selectedAgent.id === "custom" ? customCommand.trim() : selectedAgent.command;
  const command = buildAgentCommand(baseCommand, sessionMode, customResumeCommand);
  const canStart = !disabled && cwdIsValid && !isValidatingCwd && Boolean(command);

  useEffect(() => {
    if (!agentProfiles.some((profile) => profile.id === selectedAgentId)) {
      setSelectedAgentId(agentProfiles[0]?.id ?? defaultAgentProfileId);
    }
  }, [agentProfiles, selectedAgentId]);

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

  return (
    <section className="task-create-panel" aria-label="New agent session">
      <div className="pane-heading">
        <h2>New Agent Session</h2>
      </div>
      <form className="task-create-form" onSubmit={handleSubmit}>
        <div className="agent-picker" aria-label="Agent profiles">
          <span>Agent</span>
          <select value={selectedAgent.id} onChange={(event) => setSelectedAgentId(event.target.value)}>
            {agentProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
        </div>
        <label className="session-mode-field">
          <span>Session</span>
          <select value={sessionMode} onChange={(event) => setSessionMode(event.target.value as SessionMode)}>
            <option value="new">New session</option>
            <option value="resume_last">Resume last</option>
            <option value="custom_resume">Custom resume command</option>
          </select>
        </label>
        {sessionMode === "custom_resume" ? (
          <label className="custom-resume-field">
            <span>Custom resume command</span>
            <input
              placeholder="Command that resumes the external agent session"
              value={customResumeCommand}
              onChange={(event) => setCustomResumeCommand(event.target.value)}
            />
          </label>
        ) : null}
        <label className="workspace-field">
          <span>Workspace</span>
          <input
            aria-invalid={!cwdIsValid}
            onChange={(event) => setCwd(event.target.value)}
            placeholder="Workspace path"
            value={cwd}
          />
          <small data-state={cwdValidation?.ok ? "valid" : "invalid"}>
            {isValidatingCwd ? "Checking workspace..." : cwdValidation?.message || "Workspace is required."}
          </small>
        </label>
        {selectedAgent.id === "custom" ? (
          <label className="custom-command-field">
            <span>Custom command</span>
            <input
              placeholder="Command to run in a PTY"
              value={customCommand}
              onChange={(event) => setCustomCommand(event.target.value)}
            />
          </label>
        ) : null}
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
          Start
        </button>
      </form>
    </section>
  );
}

function isCodexProfile(profileId: string, command: string) {
  return profileId.includes("codex") || /\bcodex\b/.test(command);
}

function buildAgentCommand(command: string, sessionMode: SessionMode, customResumeCommand: string) {
  if (sessionMode === "custom_resume") {
    return customResumeCommand.trim();
  }

  if (sessionMode === "resume_last" && isCodexProfile("", command)) {
    if (command.includes("codex resume")) {
      return command;
    }
    return command.replace(/\bcodex\b/, "sh -lc 'codex resume --last || codex'");
  }

  return command
    .replace("sh -lc 'codex resume --last || codex'", "codex")
    .replace(/codex resume --last \|\| codex/, "codex");
}

function buildTaskTitle(agentLabel: string, instruction: string) {
  const firstLine = instruction.trim().split(/\r?\n/).find(Boolean);
  if (!firstLine) {
    return `${agentLabel} session`;
  }
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}
