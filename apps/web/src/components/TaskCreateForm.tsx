import { FormEvent, useEffect, useMemo, useState } from "react";
import { defaultAgentProfiles } from "../agentProfiles";
import {
  applyCodexPermissionToCommand,
  buildCodexResumeCommandForCommand,
  type CodexPermissionLevel,
} from "../codexPermissions";
import type { AgentProfile, CreateTaskInput, SavedCodexSession, TaskDeckContext } from "../types";

type TaskCreateFormProps = {
  context: TaskDeckContext | null;
  disabled: boolean;
  savedCodexSessions: SavedCodexSession[];
  onCreateTask: (input: CreateTaskInput) => boolean;
  onRenameSavedSession: (sessionKey: string, label: string) => Promise<boolean>;
};

const defaultAgentProfileId = "codex";
type SessionMode = "new" | "resume_last" | "saved_codex";

export function TaskCreateForm({ context, disabled, savedCodexSessions, onCreateTask, onRenameSavedSession }: TaskCreateFormProps) {
  const [selectedAgentId, setSelectedAgentId] = useState(defaultAgentProfileId);
  const [selectedSavedSessionKey, setSelectedSavedSessionKey] = useState("");
  const [sessionMode, setSessionMode] = useState<SessionMode>("new");
  const [codexPermissionLevel, setCodexPermissionLevel] = useState<CodexPermissionLevel>("full_access");
  const [initialInstruction, setInitialInstruction] = useState("");
  const [cwd, setCwd] = useState("");
  const [isEditingSessionLabel, setIsEditingSessionLabel] = useState(false);
  const [sessionLabelInput, setSessionLabelInput] = useState("");
  const [isRenamingSession, setIsRenamingSession] = useState(false);

  useEffect(() => {
    if (!cwd && context?.defaultCwd) {
      setCwd(context.defaultCwd);
    }
  }, [context?.defaultCwd, cwd]);

  const agentProfiles = context?.agentProfiles.length ? context.agentProfiles : defaultAgentProfiles;
  const selectedAgent =
    agentProfiles.find((profile) => profile.id === selectedAgentId) ??
    findDefaultAgentProfile(agentProfiles) ??
    defaultAgentProfiles[0];
  const selectedAgentIsCodex = isCodexProfile(selectedAgent);
  const matchingSavedCodexSessions = useMemo(
    () => (selectedAgentIsCodex ? savedCodexSessions.filter((session) => savedSessionMatchesAgent(session, selectedAgent)) : []),
    [savedCodexSessions, selectedAgent, selectedAgentIsCodex],
  );
  const selectedSavedSession =
    matchingSavedCodexSessions.find((session) => session.key === selectedSavedSessionKey) ??
    matchingSavedCodexSessions[0] ??
    null;
  const sessionSelectValue =
    sessionMode === "saved_codex" && selectedSavedSession ? savedSessionOptionValue(selectedSavedSession.key) : sessionMode;
  const launchCommand = buildLaunchCommand(
    selectedAgent,
    sessionMode,
    selectedSavedSession,
    codexPermissionLevel,
  );
  const command = launchCommand.command;
  const canStart = !disabled && Boolean(cwd) && Boolean(command);

  useEffect(() => {
    if (!agentProfiles.some((profile) => profile.id === selectedAgentId)) {
      setSelectedAgentId(findDefaultAgentProfile(agentProfiles)?.id ?? defaultAgentProfileId);
    }
  }, [agentProfiles, selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentIsCodex && (sessionMode === "saved_codex" || sessionMode === "resume_last")) {
      setSessionMode("new");
      setSelectedSavedSessionKey("");
      return;
    }
    if (sessionMode === "saved_codex" && selectedSavedSession && cwd !== selectedSavedSession.cwd) {
      setCwd(selectedSavedSession.cwd);
    }
  }, [cwd, selectedAgentIsCodex, selectedSavedSession, sessionMode]);

  useEffect(() => {
    if (sessionMode === "saved_codex" && (!selectedAgentIsCodex || matchingSavedCodexSessions.length === 0)) {
      setSessionMode("new");
      setSelectedSavedSessionKey("");
      return;
    }
    if (
      sessionMode === "saved_codex" &&
      selectedSavedSessionKey &&
      !matchingSavedCodexSessions.some((session) => session.key === selectedSavedSessionKey)
    ) {
      setSelectedSavedSessionKey(matchingSavedCodexSessions[0]?.key ?? "");
    }
  }, [matchingSavedCodexSessions, selectedAgentIsCodex, selectedSavedSessionKey, sessionMode]);

  useEffect(() => {
    setIsEditingSessionLabel(false);
    setSessionLabelInput(selectedSavedSession?.title || "");
  }, [selectedSavedSession?.key, selectedSavedSession?.title]);

  const handleSessionChange = (value: string) => {
    if (value.startsWith("saved:")) {
      setSessionMode("saved_codex");
      setSelectedSavedSessionKey(value.slice("saved:".length));
      return;
    }
    setSessionMode(value as SessionMode);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canStart) {
      return;
    }

    onCreateTask({
      title: buildTaskTitle(
        selectedAgent.label,
        initialInstruction,
        selectedSavedSession,
      ),
      command,
      cwd,
      agentProfileId: sessionMode === "saved_codex" ? selectedSavedSession?.agentProfileId || "codex" : selectedAgent.id,
      agentLabel: sessionMode === "saved_codex" ? selectedSavedSession?.agentLabel || "Codex CLI" : selectedAgent.label,
      agentPermissionLevel: selectedAgentIsCodex ? codexPermissionLevel : undefined,
      sessionMode,
      resumeCommand: launchCommand.resumeCommand || undefined,
      agentSessionProvider: sessionMode === "saved_codex" ? selectedSavedSession?.provider : undefined,
      agentSessionId: sessionMode === "saved_codex" ? selectedSavedSession?.sessionId : undefined,
      agentSessionSource:
        sessionMode === "saved_codex" ? selectedSavedSession?.source || "saved session picker" : undefined,
      agentSessionDetectedAt:
        sessionMode === "saved_codex" ? selectedSavedSession?.detectedAt || selectedSavedSession?.updatedAt : undefined,
      agentSessionResumeCommand: sessionMode === "saved_codex" ? launchCommand.resumeCommand : undefined,
      initialInstruction: initialInstruction.trim(),
    });
  };

  const submitSessionLabel = async (event: FormEvent) => {
    event.preventDefault();
    const nextLabel = sessionLabelInput.trim();
    if (!selectedSavedSession || !nextLabel || isRenamingSession) {
      return;
    }
    setIsRenamingSession(true);
    const didRename = await onRenameSavedSession(selectedSavedSession.key, nextLabel);
    setIsRenamingSession(false);
    if (didRename) {
      setIsEditingSessionLabel(false);
    }
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
        {selectedAgentIsCodex ? (
          <label className="codex-permission-field">
            <span>Codex permissions</span>
            <select
              value={codexPermissionLevel}
              onChange={(event) => setCodexPermissionLevel(event.target.value as CodexPermissionLevel)}
            >
              <option value="full_access">Full access</option>
              <option value="workspace_write">Workspace write</option>
              <option value="read_only">Read only</option>
            </select>
          </label>
        ) : null}
        <label className="session-mode-field">
          <span>Session</span>
          <select value={sessionSelectValue} onChange={(event) => handleSessionChange(event.target.value)}>
            <option value="new">New session</option>
            {selectedAgentIsCodex && matchingSavedCodexSessions.length > 0 ? (
              <optgroup label="Recent saved sessions">
                {matchingSavedCodexSessions.map((session) => (
                  <option key={session.key} value={savedSessionOptionValue(session.key)}>
                    {savedSessionLabel(session)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {selectedAgentIsCodex ? (
              <optgroup label="Fallback">
                <option value="resume_last">Resume last</option>
              </optgroup>
            ) : null}
          </select>
          {selectedAgentIsCodex && matchingSavedCodexSessions.length === 0 ? (
            <small className="saved-session-empty">Saved sessions for this Codex profile appear after TaskDeck detects a session id.</small>
          ) : null}
        </label>
        {sessionMode === "saved_codex" ? (
          <div className="saved-session-field">
            {selectedSavedSession ? (
              <dl className="saved-session-preview">
                <div>
                  <dt>Session</dt>
                  <dd>{selectedSavedSession.sessionId}</dd>
                </div>
                <div>
                  <dt>TaskDeck label</dt>
                  <dd className="session-label-cell">
                    {isEditingSessionLabel ? (
                      <form className="session-label-edit-form" onSubmit={submitSessionLabel}>
                        <input
                          aria-label="TaskDeck display name"
                          autoFocus
                          value={sessionLabelInput}
                          onChange={(event) => setSessionLabelInput(event.target.value)}
                        />
                        <div>
                          <button disabled={isRenamingSession || !sessionLabelInput.trim()} type="submit">
                            Save
                          </button>
                          <button
                            data-priority="secondary"
                            disabled={isRenamingSession}
                            onClick={() => {
                              setSessionLabelInput(selectedSavedSession.title);
                              setIsEditingSessionLabel(false);
                            }}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <span className="session-label-display">
                        <span>{selectedSavedSession.title}</span>
                        <button onClick={() => setIsEditingSessionLabel(true)} type="button">
                          Edit
                        </button>
                      </span>
                    )}
                  </dd>
                </div>
                {selectedSavedSession.source ? (
                  <div>
                    <dt>Source</dt>
                    <dd>{selectedSavedSession.source}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Detected</dt>
                  <dd>{selectedSavedSession.detectedAt || selectedSavedSession.updatedAt}</dd>
                </div>
                <div>
                  <dt>Command</dt>
                  <dd>{launchCommand.resumeCommand}</dd>
                </div>
                <div>
                  <dt>Environment</dt>
                  <dd>{sessionEnvironmentLabel(selectedSavedSession)}</dd>
                </div>
                <div>
                  <dt>Workspace</dt>
                  <dd>{selectedSavedSession.cwd}</dd>
                </div>
              </dl>
            ) : null}
          </div>
        ) : null}
        <div className="instruction-field">
          <span>Initial instruction</span>
          <input
            placeholder="Describe the coding task for the agent..."
            value={initialInstruction}
            onChange={(event) => setInitialInstruction(event.target.value)}
          />
        </div>
        <button disabled={!canStart} type="submit">
          Start
        </button>
      </form>
    </section>
  );
}

function findDefaultAgentProfile(agentProfiles: AgentProfile[]) {
  return (
    agentProfiles.find((profile) => profile.id === defaultAgentProfileId) ??
    agentProfiles.find((profile) => isCodexProfile(profile)) ??
    agentProfiles[0] ??
    null
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
  savedSession: SavedCodexSession | null,
  codexPermissionLevel: CodexPermissionLevel,
) {
  if (sessionMode === "saved_codex") {
    const resumeCommand = applyCodexPermissionToCommand(savedSession?.resumeCommand.trim() || "", codexPermissionLevel);
    return { command: resumeCommand, resumeCommand };
  }

  if (sessionMode === "resume_last" && isCodexProfile(profile)) {
    const resumeCommand = buildCodexResumeLastCommand(profile, codexPermissionLevel);
    return { command: resumeCommand, resumeCommand };
  }

  const command = isCodexProfile(profile)
    ? applyCodexPermissionToCommand(profile.command.trim(), codexPermissionLevel)
    : profile.command.trim();
  return { command, resumeCommand: "" };
}

function buildCodexResumeLastCommand(profile: AgentProfile, codexPermissionLevel: CodexPermissionLevel) {
  return buildCodexResumeCommandForCommand(profile.command, codexPermissionLevel, "--last");
}

function buildTaskTitle(agentLabel: string, instruction: string, savedSession?: SavedCodexSession | null) {
  const firstLine = instruction.trim().split(/\r?\n/).find(Boolean);
  if (!firstLine) {
    if (savedSession) {
      return savedSession.title;
    }
    return `${agentLabel} session`;
  }
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}

function savedSessionLabel(session: SavedCodexSession) {
  const detectedAt = session.detectedAt || session.updatedAt;
  const date = Number.isFinite(Date.parse(detectedAt)) ? new Date(detectedAt).toLocaleString() : "saved";
  const projectName = basename(session.cwd) || "workspace";
  const taskTitle = session.title || "Codex session";
  const agentLabel = session.agentLabel || "Codex";
  return `${projectName} · ${taskTitle} · ${agentLabel} · ${sessionEnvironmentLabel(session)} · ${date} · ${compactSessionId(session.sessionId)}`;
}

function savedSessionMatchesAgent(session: SavedCodexSession, agent: AgentProfile) {
  if (session.agentProfileId) {
    return session.agentProfileId === agent.id;
  }
  return sessionEnvironment(session) === agentCommandEnvironment(agent);
}

function sessionEnvironmentLabel(session: SavedCodexSession) {
  const environment = sessionEnvironment(session);
  if (environment === "local") {
    return "Local";
  }
  return environment;
}

function sessionEnvironment(session: SavedCodexSession) {
  return session.commandEnvironment || commandEnvironmentFromCommand(session.resumeCommand);
}

function agentCommandEnvironment(agent: AgentProfile) {
  return commandEnvironmentFromCommand(agent.command);
}

function commandEnvironmentFromCommand(command: string) {
  const normalizedCommand = command.toLowerCase();
  if (/\bdocker\b[\s\S]*\bai-agent-sandbox-agent-1\b/.test(normalizedCommand)) {
    return "ai-agent-sandbox-agent-1";
  }
  if (/\bdocker\b[\s\S]*\bai-agent-sandbox-codex-1\b/.test(normalizedCommand)) {
    return "ai-agent-sandbox-codex-1";
  }
  return "local";
}

function savedSessionOptionValue(sessionKey: string) {
  return `saved:${sessionKey}`;
}

function basename(value: string) {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

function compactSessionId(sessionId: string) {
  if (sessionId.length <= 12) {
    return sessionId;
  }
  return `${sessionId.slice(0, 6)}...${sessionId.slice(-4)}`;
}
