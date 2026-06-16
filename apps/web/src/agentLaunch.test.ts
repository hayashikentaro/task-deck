import { describe, expect, it } from "vitest";
import { buildLaunchCommand, executionCwdForAgentProfile, isTaskDeckManagerProfile } from "./agentLaunch";
import type { AgentProfile } from "./types";

const shellProfile: AgentProfile = {
  id: "zsh",
  label: "zsh",
  command: "zsh",
  description: "Plain shell",
};

const managerProfile: AgentProfile = {
  id: "taskdeck-manager",
  label: "TaskDeck Manager",
  command: "taskdeck-manager-app-server-placeholder",
  description: "Run TaskDeck manager",
};

const codexAppServerProfile: AgentProfile = {
  id: "codex-app-server",
  label: "Codex App Server",
  command:
    "docker start ai-agent-sandbox-agent-1 >/dev/null && docker exec -i -w /workspace ai-agent-sandbox-agent-1 sh -lc 'exec codex --sandbox danger-full-access app-server --listen stdio://'",
  description: "Run Codex App Server inside the AI agent sandbox container",
};

describe("agent launch command generation", () => {
  it("keeps the Codex App Server profile as a stdio app-server command", () => {
    const command = buildLaunchCommand(codexAppServerProfile).command;

    expect(command).toBe(codexAppServerProfile.command);
    expect(command).toContain("docker exec -i -w /workspace ai-agent-sandbox-agent-1");
    expect(command).toContain("codex --sandbox danger-full-access app-server --listen stdio://");
    expect(command).not.toContain("docker exec -it");
  });

  it("keeps non-Codex commands unchanged", () => {
    expect(buildLaunchCommand(shellProfile).command).toBe("zsh");
  });
});

describe("manager launch cwd", () => {
  it("uses the TaskDeck control root for manager sessions and preserves selected projects for workers", () => {
    const selectedProjectPath = "/workspace/project-a";
    const controlRoot = "/workspace";

    expect(isTaskDeckManagerProfile(managerProfile)).toBe(true);
    expect(executionCwdForAgentProfile(managerProfile, selectedProjectPath, controlRoot, selectedProjectPath)).toBe(
      controlRoot,
    );
    expect(executionCwdForAgentProfile(codexAppServerProfile, selectedProjectPath, controlRoot, selectedProjectPath)).toBe(
      selectedProjectPath,
    );
  });
});
