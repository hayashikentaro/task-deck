import {
  applyCodexReasoningEffortToCommand,
  applyCodexPermissionToCommand,
  applyCodexTaskDeckStartupArgsToCommand,
  buildCodexResumeCommandForCommand,
  type CodexPermissionLevel,
  type CodexReasoningEffort,
} from "./codexPermissions";
import type { AgentProfile, SavedCodexSession } from "./types";

export type AgentLaunchSessionMode = "new" | "resume_last" | "saved_codex";

export type AgentLaunchCommand = {
  command: string;
  resumeCommand: string;
};

export function isCodexProfile(profile: AgentProfile) {
  return (
    profile.id.includes("codex") ||
    profile.label.toLowerCase().includes("codex") ||
    /\bcodex\b/.test(profile.command)
  );
}

export function buildLaunchCommand(
  profile: AgentProfile,
  sessionMode: AgentLaunchSessionMode,
  savedSession: SavedCodexSession | null,
  codexPermissionLevel: CodexPermissionLevel,
  codexReasoningEffort: CodexReasoningEffort = "",
): AgentLaunchCommand {
  if (sessionMode === "saved_codex") {
    const resumeCommand = savedSession?.resumeCommand.trim() || "";
    return { command: resumeCommand, resumeCommand };
  }

  if (sessionMode === "resume_last" && isCodexProfile(profile)) {
    const resumeCommand = buildCodexResumeLastCommand(profile, codexPermissionLevel, codexReasoningEffort);
    return { command: resumeCommand, resumeCommand };
  }

  const command = isCodexProfile(profile)
    ? applyCodexTaskDeckStartupArgsToCommand(
        applyCodexReasoningEffortToCommand(
          applyCodexPermissionToCommand(profile.command.trim(), codexPermissionLevel),
          codexReasoningEffort,
        ),
      )
    : profile.command.trim();
  return { command, resumeCommand: "" };
}

export function buildCodexResumeLastCommand(
  profile: AgentProfile,
  codexPermissionLevel: CodexPermissionLevel,
  codexReasoningEffort: CodexReasoningEffort = "",
) {
  return buildCodexResumeCommandForCommand(profile.command, codexPermissionLevel, "--last", codexReasoningEffort);
}

export function executionCwdForSessionMode(
  sessionMode: AgentLaunchSessionMode,
  selectedProjectPath: string,
  savedSession: SavedCodexSession | null,
  defaultCwd?: string,
) {
  if (sessionMode === "saved_codex" && savedSession) {
    return savedSession.cwd;
  }
  return selectedProjectPath || defaultCwd || "";
}

export function buildTaskTitle(
  agentLabel: string,
  sessionMode: AgentLaunchSessionMode,
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

export function savedSessionMatchesAgent(session: SavedCodexSession, agent: AgentProfile) {
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

function basename(value: string) {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? "";
}
