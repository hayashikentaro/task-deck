import { describe, expect, it } from "vitest";
import { getComposerInputState, getComposerMode } from "./components/InputComposer";
import type { Task } from "./types";

describe("InputComposer state", () => {
  it("keeps manually locked running tasks in the locked state", () => {
    const task = taskFixture({
      id: "task-locked",
      status: "running",
      agentSessionSource: "codex_app_server_thread",
      inputLockedAt: "2026-06-24T00:00:00.000Z",
    });

    expect(getComposerMode(task, true)).toBe("Input locked");
    expect(
      getComposerInputState({
        task,
        isConnected: true,
        isUploadingAttachments: false,
        isCodexAppServerTurnActive: false,
      }),
    ).toBe("locked");
  });

  it("shows native subagent projections as read-only instead of input locked", () => {
    const task = taskFixture({
      id: "task-subagent",
      status: "running",
      agentSessionSource: "codex_app_server_native_subagent",
      inputLockedAt: "2026-06-24T00:00:00.000Z",
    });

    expect(getComposerMode(task, true)).toBe("Read-only log");
    expect(
      getComposerInputState({
        task,
        isConnected: true,
        isUploadingAttachments: false,
        isCodexAppServerTurnActive: false,
      }),
    ).toBe("readonly");
  });

  it("returns ready for an idle running App Server thread after a turn completes", () => {
    const task = taskFixture({
      id: "task-parent",
      status: "running",
      agentSessionSource: "codex_app_server_thread",
      inputLockedAt: null,
    });

    expect(getComposerMode(task, true, { isCodexAppServerTurnActive: false })).toBe("Interactive task");
    expect(
      getComposerInputState({
        task,
        isConnected: true,
        isUploadingAttachments: false,
        isCodexAppServerTurnActive: false,
      }),
    ).toBe("ready");
  });
});

function taskFixture(overrides: Partial<Task>): Task {
  return {
    id: "task",
    title: "Task",
    command: "codex app-server",
    cwd: "/workspace/task-deck",
    agentProfileId: "codex-app-server",
    status: "running",
    agentState: "ready",
    risk: { level: "unknown", reasons: [] },
    createdAt: "2026-06-24T00:00:00.000Z",
    startedAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    endedAt: null,
    exitCode: null,
    signal: null,
    ...overrides,
  };
}
