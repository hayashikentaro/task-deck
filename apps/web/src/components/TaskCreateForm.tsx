import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  applyCodexPermissionToCommand,
  buildCodexResumeCommandForCommand,
  type CodexPermissionLevel,
} from "../codexPermissions";
import type { AgentProfile, CreateTaskInput, ProjectSuggestion, SavedCodexSession, TaskDeckContext } from "../types";
import { Button } from "./ui/Button";

type TaskCreateFormProps = {
  context: TaskDeckContext | null;
  disabled: boolean;
  savedCodexSessions: SavedCodexSession[];
  onCreateTask: (input: CreateTaskInput) => boolean;
};

const defaultAgentProfileId = "codex";
type SessionMode = "new" | "resume_last" | "saved_codex";

export function TaskCreateForm({ context, disabled, savedCodexSessions, onCreateTask }: TaskCreateFormProps) {
  const [selectedAgentId, setSelectedAgentId] = useState(defaultAgentProfileId);
  const [selectedSavedSessionKey, setSelectedSavedSessionKey] = useState("");
  const [sessionMode, setSessionMode] = useState<SessionMode>("new");
  const [codexPermissionLevel, setCodexPermissionLevel] = useState<CodexPermissionLevel>("full_access");
  const [selectedProjectPath, setSelectedProjectPath] = useState("");

  const projectSuggestions = useMemo(() => buildProjectSuggestions(context), [context]);

  useEffect(() => {
    if (!projectSuggestions.length) {
      return;
    }
    if (!selectedProjectPath || !projectSuggestions.some((project) => project.path === selectedProjectPath)) {
      setSelectedProjectPath(selectDefaultProjectPath(projectSuggestions, context?.defaultCwd));
    }
  }, [context?.defaultCwd, projectSuggestions, selectedProjectPath]);

  const agentProfiles = context?.agentProfiles ?? [];
  const selectedAgent =
    agentProfiles.find((profile) => profile.id === selectedAgentId) ??
    findDefaultAgentProfile(agentProfiles);
  const selectedAgentIsCodex = Boolean(selectedAgent && isCodexProfile(selectedAgent));
  const matchingSavedCodexSessions = useMemo(
    () => (selectedAgentIsCodex && selectedAgent ? savedCodexSessions.filter((session) => savedSessionMatchesAgent(session, selectedAgent)) : []),
    [savedCodexSessions, selectedAgent, selectedAgentIsCodex],
  );
  const selectedSavedSession =
    matchingSavedCodexSessions.find((session) => session.key === selectedSavedSessionKey) ??
    matchingSavedCodexSessions[0] ??
    null;
  const sessionSelectValue =
    sessionMode === "saved_codex" && selectedSavedSession ? savedSessionOptionValue(selectedSavedSession.key) : sessionMode;
  const launchCommand = selectedAgent
    ? buildLaunchCommand(selectedAgent, sessionMode, selectedSavedSession, codexPermissionLevel)
    : { command: "", resumeCommand: "" };
  const command = launchCommand.command;
  const effectiveCwd = executionCwdForSessionMode(sessionMode, selectedProjectPath, selectedSavedSession, context?.defaultCwd);
  const canStart = !disabled && Boolean(selectedAgent) && Boolean(effectiveCwd) && Boolean(command);

  useEffect(() => {
    if (!agentProfiles.some((profile) => profile.id === selectedAgentId)) {
      setSelectedAgentId(findDefaultAgentProfile(agentProfiles)?.id ?? "");
    }
  }, [agentProfiles, selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentIsCodex && (sessionMode === "saved_codex" || sessionMode === "resume_last")) {
      setSessionMode("new");
      setSelectedSavedSessionKey("");
    }
  }, [selectedAgentIsCodex, sessionMode]);

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
      title: buildTaskTitle(selectedAgent?.label || "Agent", sessionMode, effectiveCwd, selectedSavedSession),
      command,
      cwd: effectiveCwd,
      agentProfileId: sessionMode === "saved_codex" ? selectedSavedSession?.agentProfileId || "codex" : selectedAgent?.id || "",
      agentLabel: sessionMode === "saved_codex" ? selectedSavedSession?.agentLabel || "Codex CLI" : selectedAgent?.label || "Agent",
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
    });
  };

  return (
    <section className="task-create-panel" aria-label="New agent session">
      <form className="task-create-form" onSubmit={handleSubmit}>
        <div className="agent-picker" aria-label="Agent profiles">
          <span>Agent</span>
          <select disabled={!agentProfiles.length} value={selectedAgent?.id ?? ""} onChange={(event) => setSelectedAgentId(event.target.value)}>
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
        <label className="project-field">
          <span>Project</span>
          <select value={selectedProjectPath} onChange={(event) => setSelectedProjectPath(event.target.value)}>
            {projectSuggestions.map((project) => (
              <option key={project.path} value={project.path}>
                {project.label}
              </option>
            ))}
          </select>
        </label>
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
        <Button disabled={!canStart} fullWidth type="submit" variant="panel">
          Start Session
        </Button>
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
    const resumeCommand = savedSession?.resumeCommand.trim() || "";
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

function executionCwdForSessionMode(
  sessionMode: SessionMode,
  selectedProjectPath: string,
  savedSession: SavedCodexSession | null,
  defaultCwd?: string,
) {
  if (sessionMode === "saved_codex" && savedSession) {
    return savedSession.cwd;
  }
  return selectedProjectPath || defaultCwd || "";
}

function buildCodexResumeLastCommand(profile: AgentProfile, codexPermissionLevel: CodexPermissionLevel) {
  return buildCodexResumeCommandForCommand(profile.command, codexPermissionLevel, "--last");
}

function buildProjectSuggestions(context: TaskDeckContext | null): ProjectSuggestion[] {
  const suggestions = context?.projectSuggestions?.length
    ? context.projectSuggestions
    : context?.defaultCwd
      ? [{ label: basename(context.defaultCwd) || "Repository root", path: context.defaultCwd, isGitRepo: context.isGitRepo }]
      : [];
  const seenPaths = new Set<string>();
  return suggestions.filter((suggestion) => {
    if (!suggestion.path || seenPaths.has(suggestion.path)) {
      return false;
    }
    seenPaths.add(suggestion.path);
    return true;
  });
}

function selectDefaultProjectPath(projectSuggestions: ProjectSuggestion[], defaultCwd?: string) {
  return (
    projectSuggestions.find((project) => project.path === defaultCwd)?.path ??
    projectSuggestions.find((project) => project.label === "task-deck")?.path ??
    projectSuggestions[0]?.path ??
    ""
  );
}

function buildTaskTitle(
  agentLabel: string,
  sessionMode: SessionMode,
  cwd: string,
  savedSession?: SavedCodexSession | null,
) {
  if (sessionMode === "saved_codex" && savedSession) {
    return savedSession.title;
  }
  if (sessionMode === "resume_last") {
    return `Resume last: ${agentLabel}`;
  }
  return basename(cwd) || `${agentLabel} session`;
}

function savedSessionLabel(session: SavedCodexSession) {
  const projectName = basename(session.cwd) || "workspace";
  const taskTitle = session.title || "Codex session";
  return `${projectName} · ${taskTitle}`;
}

function savedSessionMatchesAgent(session: SavedCodexSession, agent: AgentProfile) {
  if (session.agentProfileId) {
    return session.agentProfileId === agent.id;
  }
  return sessionEnvironment(session) === agentCommandEnvironment(agent);
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
