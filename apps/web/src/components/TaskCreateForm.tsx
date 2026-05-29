import { FormEvent, useEffect, useState } from "react";
import { defaultAgentProfiles } from "../agentProfiles";
import type { AgentProfile, CreateTaskInput, CwdValidation, SavedCodexSession, TaskDeckContext } from "../types";

type TaskCreateFormProps = {
  context: TaskDeckContext | null;
  disabled: boolean;
  savedCodexSessions: SavedCodexSession[];
  onCreateTask: (input: CreateTaskInput) => void;
};

const defaultAgentProfileId = "goose";
type SessionMode = "new" | "resume_last" | "saved_codex" | "custom_resume";

export function TaskCreateForm({ context, disabled, savedCodexSessions, onCreateTask }: TaskCreateFormProps) {
  const [selectedAgentId, setSelectedAgentId] = useState(defaultAgentProfileId);
  const [customCommand, setCustomCommand] = useState("");
  const [customResumeCommand, setCustomResumeCommand] = useState("");
  const [selectedSavedSessionKey, setSelectedSavedSessionKey] = useState("");
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
    agentProfiles.find((profile) => profile.id === selectedAgentId) ??
    findDefaultAgentProfile(agentProfiles) ??
    defaultAgentProfiles[0];
  const selectedSavedSession =
    savedCodexSessions.find((session) => session.key === selectedSavedSessionKey) ?? savedCodexSessions[0] ?? null;
  const cwdIsValid = cwdValidation?.ok ?? false;
  const launchCommand = buildLaunchCommand(
    selectedAgent,
    sessionMode,
    customResumeCommand,
    customCommand,
    selectedSavedSession,
  );
  const command = launchCommand.command;
  const canStart = !disabled && cwdIsValid && !isValidatingCwd && Boolean(command);

  useEffect(() => {
    if (!agentProfiles.some((profile) => profile.id === selectedAgentId)) {
      setSelectedAgentId(findDefaultAgentProfile(agentProfiles)?.id ?? defaultAgentProfileId);
    }
  }, [agentProfiles, selectedAgentId]);

  useEffect(() => {
    if (sessionMode === "saved_codex" && selectedSavedSession && cwd !== selectedSavedSession.cwd) {
      setCwd(selectedSavedSession.cwd);
    }
  }, [cwd, selectedSavedSession, sessionMode]);

  useEffect(() => {
    if (sessionMode === "saved_codex" && savedCodexSessions.length === 0) {
      setSessionMode("new");
      setSelectedSavedSessionKey("");
      return;
    }
    if (
      sessionMode === "saved_codex" &&
      selectedSavedSessionKey &&
      !savedCodexSessions.some((session) => session.key === selectedSavedSessionKey)
    ) {
      setSelectedSavedSessionKey(savedCodexSessions[0]?.key ?? "");
    }
  }, [savedCodexSessions, selectedSavedSessionKey, sessionMode]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canStart) {
      return;
    }
    onCreateTask({
      title: buildTaskTitle(
        sessionMode === "saved_codex" ? "Resume saved" : selectedAgent.label,
        initialInstruction,
        selectedSavedSession,
      ),
      command,
      cwd,
      agentProfileId: sessionMode === "saved_codex" ? selectedSavedSession?.agentProfileId || "codex" : selectedAgent.id,
      agentLabel: sessionMode === "saved_codex" ? selectedSavedSession?.agentLabel || "Codex CLI" : selectedAgent.label,
      sessionMode,
      resumeCommand: launchCommand.resumeCommand || undefined,
      agentSessionProvider: sessionMode === "saved_codex" ? selectedSavedSession?.provider : undefined,
      agentSessionId: sessionMode === "saved_codex" ? selectedSavedSession?.sessionId : undefined,
      agentSessionSource:
        sessionMode === "saved_codex" ? selectedSavedSession?.source || "saved session picker" : undefined,
      agentSessionDetectedAt: sessionMode === "saved_codex" ? selectedSavedSession?.detectedAt : undefined,
      agentSessionResumeCommand: sessionMode === "saved_codex" ? selectedSavedSession?.resumeCommand : undefined,
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
            {savedCodexSessions.length > 0 ? <option value="saved_codex">Resume saved session</option> : null}
            <option value="custom_resume">Custom resume command</option>
          </select>
        </label>
        {sessionMode === "saved_codex" ? (
          <label className="saved-session-field">
            <span>Saved session</span>
            <select
              value={selectedSavedSession?.key ?? ""}
              onChange={(event) => setSelectedSavedSessionKey(event.target.value)}
            >
              {savedCodexSessions.map((session) => (
                <option key={session.key} value={session.key}>
                  {savedSessionLabel(session)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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

function findDefaultAgentProfile(agentProfiles: AgentProfile[]) {
  return (
    agentProfiles.find((profile) => isGooseProfile(profile)) ??
    agentProfiles[0] ??
    null
  );
}

function isGooseProfile(profile: AgentProfile) {
  return (
    profile.id.includes("goose") ||
    profile.label.toLowerCase().includes("goose") ||
    /\bgoose\b/.test(profile.command)
  );
}

function isCodexProfile(profile: AgentProfile) {
  return (
    profile.id.includes("codex") ||
    profile.label.toLowerCase().includes("codex") ||
    /\bcodex\b/.test(profile.command)
  );
}

function buildLaunchCommand(
  profile: AgentProfile,
  sessionMode: SessionMode,
  customResumeCommand: string,
  customCommand: string,
  savedSession: SavedCodexSession | null,
) {
  if (sessionMode === "saved_codex") {
    const resumeCommand = savedSession?.resumeCommand.trim() || "";
    return { command: resumeCommand, resumeCommand };
  }

  if (sessionMode === "custom_resume") {
    const resumeCommand = customResumeCommand.trim();
    return { command: resumeCommand, resumeCommand };
  }

  if (sessionMode === "resume_last" && isCodexProfile(profile)) {
    const resumeCommand = buildCodexResumeLastCommand(profile);
    return { command: resumeCommand, resumeCommand };
  }

  const command = profile.id === "custom" ? customCommand.trim() : profile.command.trim();
  return { command, resumeCommand: "" };
}

function buildCodexResumeLastCommand(profile: AgentProfile) {
  if (profile.id === "ai-dev-container-codex") {
    return "docker start taskdeck-ai-dev >/dev/null && docker exec -it -w /workspace taskdeck-ai-dev sh -lc 'codex resume --last'";
  }
  return "codex resume --last";
}

function buildTaskTitle(agentLabel: string, instruction: string, savedSession?: SavedCodexSession | null) {
  const firstLine = instruction.trim().split(/\r?\n/).find(Boolean);
  if (!firstLine) {
    if (savedSession) {
      return `Resume saved: ${savedSession.title}`;
    }
    return `${agentLabel} session`;
  }
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}

function savedSessionLabel(session: SavedCodexSession) {
  const detectedAt = session.detectedAt || session.updatedAt;
  const date = Number.isFinite(Date.parse(detectedAt)) ? new Date(detectedAt).toLocaleString() : "saved";
  return `${session.title} · ${session.sessionId} · ${date}`;
}
