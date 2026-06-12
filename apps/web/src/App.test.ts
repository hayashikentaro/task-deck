import { describe, expect, it } from "vitest";
import { buildChildTaskInputs } from "./childSessionTaskInputs";
import type { ChildSessionBatchRequest } from "./childSessionRequests";
import type { TaskDeckContext } from "./types";

const context: TaskDeckContext = {
  repoRoot: "/workspace/task-deck",
  controlRoot: "/workspace",
  dataRoot: "/workspace/task-deck/.taskdeck",
  defaultCwd: "/workspace/task-deck",
  serverCwd: "/workspace/task-deck",
  shell: "bash",
  pathSeparator: "/",
  isGitRepo: true,
  cwdSuggestions: [],
  agentProfiles: [
    {
      id: "codex",
      label: "Codex CLI",
      command:
        "docker start ai-agent-sandbox-agent-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-agent-1 sh -lc 'TERM=xterm-256color codex --dangerously-bypass-approvals-and-sandbox'",
      description: "Run Codex CLI inside the AI agent sandbox container",
    },
    {
      id: "zsh",
      label: "zsh",
      command:
        "docker start ai-agent-sandbox-agent-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-agent-1 zsh",
      description: "Plain shell",
    },
  ],
};

function request(overrides: Partial<ChildSessionBatchRequest["sessions"][number]> = {}): ChildSessionBatchRequest {
  return {
    version: 1,
    reason: "Test child task input building.",
    sessions: [
      {
        title: "Child task",
        agentProfileId: "codex",
        agentPermissionLevel: "full_access",
        cwd: "/workspace/task-deck",
        workPackageId: "child-work",
        filesLikelyToChange: ["README.md"],
        initialInstruction: "Read AGENTS.md, then report status.",
        ...overrides,
      },
    ],
  };
}

describe("buildChildTaskInputs", () => {
  it("passes Codex reasoning effort into child create task input and command generation", () => {
    const result = buildChildTaskInputs("parent-task", request({ agentReasoningEffort: "high" }), context, "request-key");

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0]).toMatchObject({
      parentSessionId: "parent-task",
      spawnedFromParentRequest: true,
      childSessionRequestKey: "request-key:0",
      workPackageId: "child-work",
      filesLikelyToChange: ["README.md"],
      initialInstruction: "Read AGENTS.md, then report status.",
      agentReasoningEffort: "high",
    });
    expect(result.inputs[0].command).toContain('model_reasoning_effort="high"');
  });

  it("builds exactly one low-effort Codex child create task input", () => {
    const result = buildChildTaskInputs("parent-task", request({ agentReasoningEffort: "low" }), context, "request-key");

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0].agentReasoningEffort).toBe("low");
    expect(result.inputs[0].command).toContain('model_reasoning_effort="low"');
  });

  it("leaves missing Codex reasoning effort unset", () => {
    const result = buildChildTaskInputs("parent-task", request(), context, "request-key");

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.inputs[0].agentReasoningEffort).toBeUndefined();
    expect(result.inputs[0].command).not.toContain("model_reasoning_effort");
  });

  it("normalizes invalid Codex reasoning effort to unset", () => {
    const result = buildChildTaskInputs(
      "parent-task",
      request({ agentReasoningEffort: "largest" as ChildSessionBatchRequest["sessions"][number]["agentReasoningEffort"] }),
      context,
      "request-key",
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.inputs[0].agentReasoningEffort).toBeUndefined();
    expect(result.inputs[0].command).not.toContain("model_reasoning_effort");
  });

  it("ignores Codex reasoning effort for non-Codex children", () => {
    const result = buildChildTaskInputs(
      "parent-task",
      request({
        agentProfileId: "zsh",
        agentPermissionLevel: undefined,
        agentReasoningEffort: "high",
      }),
      context,
      "request-key",
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.inputs[0].agentReasoningEffort).toBeUndefined();
    expect(result.inputs[0].command).toBe(context.agentProfiles[1].command);
  });
});
