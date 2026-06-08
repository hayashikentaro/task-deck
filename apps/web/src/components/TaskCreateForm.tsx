import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  buildLaunchCommand,
  buildTaskTitle,
  executionCwdForSessionMode,
  isCodexProfile,
  savedSessionMatchesAgent,
  type AgentLaunchSessionMode,
} from "../agentLaunch";
import type { CodexPermissionLevel, CodexReasoningEffort } from "../codexPermissions";
import type { AgentProfile, CreateTaskInput, ProjectSuggestion, SavedCodexSession, TaskDeckContext } from "../types";
import { Button } from "./ui/Button";
import { SelectField } from "./ui/SelectField";

type TaskCreateFormProps = {
  context: TaskDeckContext | null;
  disabled: boolean;
  savedCodexSessions: SavedCodexSession[];
  onCreateTask: (input: CreateTaskInput) => boolean;
};

const defaultAgentProfileId = "codex";

export function TaskCreateForm({ context, disabled, savedCodexSessions, onCreateTask }: TaskCreateFormProps) {
  const [selectedAgentId, setSelectedAgentId] = useState(defaultAgentProfileId);
  const [selectedSavedSessionKey, setSelectedSavedSessionKey] = useState("");
  const [sessionMode, setSessionMode] = useState<AgentLaunchSessionMode>("new");
  const [codexPermissionLevel, setCodexPermissionLevel] = useState<CodexPermissionLevel>("full_access");
  const [codexReasoningEffort, setCodexReasoningEffort] = useState<CodexReasoningEffort>("");
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
    ? buildLaunchCommand(selectedAgent, sessionMode, selectedSavedSession, codexPermissionLevel, codexReasoningEffort)
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
    if (!selectedAgentIsCodex && codexReasoningEffort) {
      setCodexReasoningEffort("");
    }
  }, [codexReasoningEffort, selectedAgentIsCodex, sessionMode]);

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
      const nextSavedSessionKey = value.slice("saved:".length);
      const nextSavedSession = matchingSavedCodexSessions.find((session) => session.key === nextSavedSessionKey);

      setSessionMode("saved_codex");
      setSelectedSavedSessionKey(nextSavedSessionKey);

      if (nextSavedSession?.cwd && projectSuggestions.some((project) => project.path === nextSavedSession.cwd)) {
        setSelectedProjectPath(nextSavedSession.cwd);
      }
      return;
    }
    setSessionMode(value as AgentLaunchSessionMode);
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
      agentReasoningEffort:
        selectedAgentIsCodex && sessionMode !== "saved_codex" && codexReasoningEffort
          ? codexReasoningEffort
          : undefined,
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
        <SelectField
          className="agent-picker"
          disabled={!agentProfiles.length}
          label="Agent"
          value={selectedAgent?.id ?? ""}
          onChange={setSelectedAgentId}
        >
          {agentProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label}
            </option>
          ))}
        </SelectField>
        {selectedAgentIsCodex ? (
          <SelectField
            className="codex-permission-field"
            label="Codex permissions"
            value={codexPermissionLevel}
            onChange={(value) => setCodexPermissionLevel(value as CodexPermissionLevel)}
          >
            <option value="full_access">Full access</option>
            <option value="workspace_write">Workspace write</option>
            <option value="read_only">Read only</option>
          </SelectField>
        ) : null}
        {selectedAgentIsCodex ? (
          <SelectField
            className="codex-reasoning-field"
            label="Codex reasoning"
            value={codexReasoningEffort}
            onChange={(value) => setCodexReasoningEffort(value as CodexReasoningEffort)}
          >
            <option value="">Default</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">XHigh</option>
          </SelectField>
        ) : null}
        <SelectField
          className="session-mode-field"
          hint={
            selectedAgentIsCodex && matchingSavedCodexSessions.length === 0
              ? "Saved sessions for this Codex profile appear after TaskDeck detects a session id."
              : undefined
          }
          label="Session"
          value={sessionSelectValue}
          onChange={handleSessionChange}
        >
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
        </SelectField>
        <SelectField
          className="project-field"
          label="Project"
          value={selectedProjectPath}
          onChange={setSelectedProjectPath}
        >
          {projectSuggestions.map((project) => (
            <option key={project.path} value={project.path}>
              {project.label}
            </option>
          ))}
        </SelectField>
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

function savedSessionLabel(session: SavedCodexSession) {
  const projectName = basename(session.cwd) || "workspace";
  const taskTitle = session.title || "Codex session";
  return `${projectName} · ${taskTitle}`;
}

function savedSessionOptionValue(sessionKey: string) {
  return `saved:${sessionKey}`;
}

function basename(value: string) {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? "";
}
