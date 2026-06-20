import { describe, expect, it } from "vitest";
import {
  AgentStateSource,
  AttentionState,
  ChildReportedState,
  TaskStatus,
  createTask,
  isTaskVisibleInNormalList,
  markTaskChildStatusError,
  markTaskChildStatusReported,
  markTaskClosed,
  markTaskInputLocked,
  markTaskInputUnlocked,
  markTaskRunning,
  serializeTask,
} from "@taskdeck/core";

describe("task lifecycle visibility", () => {
  it("keeps closed task records out of the normal task list projection", () => {
    const runningTask = markTaskRunning(createTask({ title: "Running task", command: "echo run", cwd: "." }));
    const closedTask = markTaskClosed(runningTask, { closedAt: "2026-06-13T00:00:00.000Z" });

    expect(isTaskVisibleInNormalList(runningTask)).toBe(true);
    expect(isTaskVisibleInNormalList(closedTask)).toBe(false);
  });

  it("does not let stale task status reports revive attention on closed tasks", () => {
    const task = markTaskClosed(
      {
        ...markTaskRunning(createTask({ title: "Reported task", command: "echo task", cwd: "." })),
        childReportedState: ChildReportedState.READY_FOR_REVIEW,
        attentionState: AttentionState.REVIEW_READY,
        attentionStateSource: AgentStateSource.CHILD_STATUS,
      },
      { closedAt: "2026-06-13T00:00:00.000Z" },
    );

    const reported = markTaskChildStatusReported(
      task,
      {
        state: ChildReportedState.READY_FOR_REVIEW,
        summary: "Ready again from a stale status file.",
        artifacts: [],
        detailsFile: "",
        updatedAt: "2026-06-13T00:01:00.000Z",
      },
      "2026-06-13T00:01:00.000Z",
    );
    const errored = markTaskChildStatusError(task, "stale read error", "2026-06-13T00:02:00.000Z");

    expect(reported).toBe(task);
    expect(errored).toBe(task);
    expect(reported).toMatchObject({
      status: TaskStatus.CLOSED,
      attentionState: AttentionState.NONE,
      attentionStateSource: AgentStateSource.MANUAL,
    });
  });
});

describe("task input locking", () => {
  it("uses task input lock metadata for newly updated tasks", () => {
    const task = createTask({ title: "Input lock task", command: "echo lock", cwd: "." });
    const locked = markTaskInputLocked(task, "2026-06-17T00:00:00.000Z");
    const unlocked = markTaskInputUnlocked(locked, "2026-06-17T00:01:00.000Z");

    expect(serializeTask(locked)).toMatchObject({
      inputLockedAt: "2026-06-17T00:00:00.000Z",
      updatedAt: task.updatedAt,
    });
    expect(serializeTask(unlocked)).toMatchObject({
      inputLockedAt: null,
      updatedAt: "2026-06-17T00:01:00.000Z",
    });
    expect(locked).not.toHaveProperty("terminalInputLockedAt");
    expect(unlocked).not.toHaveProperty("terminalInputLockedAt");
  });

  it("loads old persisted task input locks into the current metadata field", () => {
    const legacyTask = {
      ...createTask({ title: "Legacy lock task", command: "echo legacy", cwd: "." }),
      inputLockedAt: null,
      terminalInputLockedAt: "2026-06-16T00:00:00.000Z",
    };

    expect(serializeTask(legacyTask)).toMatchObject({
      inputLockedAt: "2026-06-16T00:00:00.000Z",
    });
  });
});

describe("legacy task metadata", () => {
  it("does not expose old TUI fallback state sources", () => {
    const legacyTask = {
      ...createTask({ title: "Legacy state source task", command: "echo source", cwd: "." }),
      attentionState: AttentionState.NEEDS_INPUT,
      agentStateSource: "tui_fallback",
      attentionStateSource: "tui_fallback",
    };

    expect(serializeTask(legacyTask)).toMatchObject({
      agentStateSource: "",
      attentionStateSource: "",
    });
  });

  it("persists minimal Codex reasoning effort", () => {
    const task = createTask({
      title: "Model selection",
      command: "codex app-server",
      cwd: "/workspace/task-deck",
      agentReasoningEffort: "minimal",
    });

    expect(serializeTask(task).agentReasoningEffort).toBe("minimal");
  });
});
