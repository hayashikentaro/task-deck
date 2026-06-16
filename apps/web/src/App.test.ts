import { describe, expect, it } from "vitest";
import { buildChildTaskInputs, fileProtocolChildSessionsDisabledMessage } from "./childSessionTaskInputs";
import type { ChildSessionBatchRequest } from "./childSessionRequests";
import type { TaskDeckContext } from "./types";

const appServerCommand =
  "docker start ai-agent-sandbox-agent-1 >/dev/null && docker exec -i -w /workspace ai-agent-sandbox-agent-1 sh -lc 'exec codex --sandbox danger-full-access --ask-for-approval never app-server --listen stdio://'";

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
  it("rejects file-protocol child session starts on the App Server-only route", () => {
    const result = buildChildTaskInputs("parent-task", request(), context, "request-key");

    expect(result).toEqual({
      status: "rejected",
      error: fileProtocolChildSessionsDisabledMessage,
    });
  });
});
