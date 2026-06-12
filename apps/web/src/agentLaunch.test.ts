import { describe, expect, it } from "vitest";
import { buildLaunchCommand, executionCwdForAgentProfile, isTaskDeckManagerProfile } from "./agentLaunch";
import {
  applyCodexPermissionToCommand,
  applyCodexReasoningEffortToCommand,
  type CodexPermissionLevel,
} from "./codexPermissions";
import type { AgentProfile, SavedCodexSession } from "./types";

const codexProfile: AgentProfile = {
  id: "codex",
  label: "Codex CLI",
  command: "docker start ai-agent-sandbox-agent-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-agent-1 sh -lc 'TERM=xterm-256color codex --dangerously-bypass-approvals-and-sandbox'",
  description: "Run Codex CLI inside the AI agent sandbox container",
};

const codexContainerNameProfile: AgentProfile = {
  id: "ai-dev-container-codex",
  label: "Codex Container",
  command: "docker start ai-agent-sandbox-codex-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-codex-1 sh -lc 'TERM=xterm-256color codex --dangerously-bypass-approvals-and-sandbox'",
  description: "Run Codex CLI inside the Codex sandbox container",
};

const shellProfile: AgentProfile = {
  id: "zsh",
  label: "zsh",
  command: "zsh",
  description: "Plain shell",
};

const managerProfile: AgentProfile = {
  id: "taskdeck-manager",
  label: "TaskDeck Manager",
  command: codexProfile.command,
  description: "Run TaskDeck manager",
};

describe("Codex launch command generation", () => {
  it("leaves the command unchanged when reasoning effort is default or invalid", () => {
    const command = "codex --dangerously-bypass-approvals-and-sandbox";

    expect(applyCodexReasoningEffortToCommand(command, "")).toBe(command);
    expect(applyCodexReasoningEffortToCommand(command, "largest")).toBe(command);
  });

  it.each(["low", "medium", "high", "xhigh"] as const)("supports reasoning effort %s", (reasoningEffort) => {
    expect(applyCodexReasoningEffortToCommand("codex", reasoningEffort)).toBe(
      `codex -c model_reasoning_effort="${reasoningEffort}"`,
    );
  });

  it("adds the TaskDeck Codex startup config override", () => {
    const command = buildLaunchCommand(codexProfile, "new", null, "read_only", "").command;

    expect(command).toContain("codex -c check_for_update_on_startup=false --sandbox read-only");
    expect(command).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("adds high reasoning effort without changing permission behavior", () => {
    const command = buildLaunchCommand(codexProfile, "new", null, "read_only", "high").command;

    expect(command).toContain('codex -c check_for_update_on_startup=false -c model_reasoning_effort="high" --sandbox read-only');
    expect(command).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("adds reasoning effort to the inner Codex command in Docker-backed profiles", () => {
    const command = buildLaunchCommand(codexProfile, "new", null, "full_access", "high").command;

    expect(command).toContain("docker exec -it -w /workspace ai-agent-sandbox-agent-1 sh -lc");
    expect(command).toContain(
      'codex -c check_for_update_on_startup=false -c model_reasoning_effort="high" --dangerously-bypass-approvals-and-sandbox',
    );
    expect(command).not.toContain('docker exec -c model_reasoning_effort="high"');
  });

  it("does not mistake codex in a Docker container name for the Codex command", () => {
    const command = buildLaunchCommand(codexContainerNameProfile, "new", null, "workspace_write", "medium").command;

    expect(command).toContain("ai-agent-sandbox-codex-1");
    expect(command).toContain(
      'codex -c check_for_update_on_startup=false -c model_reasoning_effort="medium" --sandbox workspace-write',
    );
    expect(command).not.toContain('ai-agent-sandbox-codex -c model_reasoning_effort="medium"-1');
  });

  it("keeps non-Codex commands unchanged", () => {
    expect(buildLaunchCommand(shellProfile, "new", null, "full_access", "high").command).toBe("zsh");
  });

  it("applies reasoning effort to resume-last commands generated from the selected Codex profile", () => {
    const command = buildLaunchCommand(codexProfile, "resume_last", null, "workspace_write", "xhigh").command;

    expect(command).toContain(
      'codex --sandbox workspace-write -c check_for_update_on_startup=false -c model_reasoning_effort="xhigh" resume --last',
    );
  });

  it("does not mutate saved Codex resume commands", () => {
    const savedSession: SavedCodexSession = {
      key: "codex:saved",
      provider: "codex",
      sessionId: "saved",
      resumeCommand: "codex resume saved",
      title: "Saved session",
      cwd: "/workspace/task-deck",
      updatedAt: "2026-06-08T00:00:00.000Z",
    };

    expect(buildLaunchCommand(codexProfile, "saved_codex", savedSession, "read_only", "high").command).toBe(
      "codex resume saved",
    );
  });
});

describe("applyCodexPermissionToCommand", () => {
  it.each(["full_access", "workspace_write", "read_only"] as CodexPermissionLevel[])(
    "continues to apply permission level %s",
    (permissionLevel) => {
      expect(applyCodexPermissionToCommand("codex --dangerously-bypass-approvals-and-sandbox", permissionLevel)).toContain(
        permissionLevel === "workspace_write"
          ? "--sandbox workspace-write"
          : permissionLevel === "read_only"
            ? "--sandbox read-only"
            : "--dangerously-bypass-approvals-and-sandbox",
      );
    },
  );
});

describe("manager launch cwd", () => {
  it("uses the TaskDeck control root for manager sessions and preserves selected projects for workers", () => {
    const selectedProjectPath = "/workspace/project-a";
    const controlRoot = "/workspace";

    expect(isTaskDeckManagerProfile(managerProfile)).toBe(true);
    expect(executionCwdForAgentProfile(managerProfile, "new", selectedProjectPath, null, controlRoot, selectedProjectPath)).toBe(
      controlRoot,
    );
    expect(executionCwdForAgentProfile(codexProfile, "new", selectedProjectPath, null, controlRoot, selectedProjectPath)).toBe(
      selectedProjectPath,
    );
  });
});
