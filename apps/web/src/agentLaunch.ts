import type { AgentProfile } from "./types";

export type AgentLaunchCommand = {
  command: string;
  resumeCommand: string;
};

export const taskDeckManagerProfileId = "taskdeck-manager";

export function isTaskDeckManagerProfile(profile: AgentProfile | null | undefined) {
  return profile?.id === taskDeckManagerProfileId;
}

export function buildLaunchCommand(profile: AgentProfile): AgentLaunchCommand {
  return {
    command: profile.command.trim(),
    resumeCommand: "",
  };
}

export function executionCwdForAgentProfile(
  profile: AgentProfile | null | undefined,
  selectedProjectPath: string,
  controlRoot?: string,
  defaultCwd?: string,
) {
  if (isTaskDeckManagerProfile(profile)) {
    return controlRoot || defaultCwd || selectedProjectPath || "";
  }
  return selectedProjectPath || defaultCwd || "";
}

export function buildTaskTitle(agentLabel: string, cwd: string) {
  return basename(cwd) || `${agentLabel} session`;
}

function basename(value: string) {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? "";
}
