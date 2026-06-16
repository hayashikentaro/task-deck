import { describe, expect, it } from "vitest";
import { buildChildTaskInputs } from "./childSessionTaskInputs";
import type { ChildSessionBatchRequest } from "./childSessionRequests";
import type { TaskDeckContext } from "./types";

const appServerCommand =
  "docker start ai-agent-sandbox-agent-1 >/dev/null && docker exec -i -w /workspace ai-agent-sandbox-agent-1 sh -lc 'exec codex --sandbox danger-full-access app-server --listen stdio://'";

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
      id: "codex-app-server",
      label: "Codex App Server",
      command: appServerCommand,
      description: "Run Codex App Server inside the AI agent sandbox container",
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
        agentProfileId: "codex-app-server",
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
  it("builds an App Server child create task input without rewriting the profile command", () => {
    const result = buildChildTaskInputs("parent-task", request(), context, "request-key");

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
      agentProfileId: "codex-app-server",
      agentLabel: "Codex App Server",
      command: appServerCommand,
    });
    expect(result.inputs[0].command).toContain("codex --sandbox danger-full-access app-server --listen stdio://");
    expect(result.inputs[0].command).not.toContain("docker exec -it");
  });

  it("keeps non-App-Server child profiles unchanged", () => {
    const result = buildChildTaskInputs(
      "parent-task",
      request({
        agentProfileId: "zsh",
      }),
      context,
      "request-key",
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.inputs[0].command).toBe(context.agentProfiles[1].command);
  });
});
