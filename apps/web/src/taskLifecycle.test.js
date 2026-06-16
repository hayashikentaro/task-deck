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

  it("does not let stale child status reports revive attention on closed tasks", () => {
    const task = markTaskClosed(
      {
        ...markTaskRunning(createTask({ title: "Child task", command: "echo child", cwd: "." })),
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

  it("preserves Codex App Server thread metadata through serialization", () => {
    const task = createTask({
      id: "task_app_thread_test",
      title: "App Server subagent",
      command: "codex app-server subagent thread",
      cwd: ".",
      agentProfileId: "codex-app-server",
      parentSessionId: "task_parent",
      codexAppServerSessionId: "session_1",
      codexAppServerThreadId: "thread_child",
      codexAppServerParentThreadId: "thread_parent",
      codexAppServerRootTaskId: "task_parent",
      codexAppServerAgentNickname: "finder",
      codexAppServerAgentRole: "investigator",
      codexAppServerThreadPath: "/tmp/thread.jsonl",
      codexAppServerThreadStatus: "active",
    });

    expect(serializeTask(task)).toMatchObject({
      id: "task_app_thread_test",
      parentSessionId: "task_parent",
      spawnedFromParentRequest: false,
      codexAppServerSessionId: "session_1",
      codexAppServerThreadId: "thread_child",
      codexAppServerParentThreadId: "thread_parent",
      codexAppServerRootTaskId: "task_parent",
      codexAppServerAgentNickname: "finder",
      codexAppServerAgentRole: "investigator",
      codexAppServerThreadPath: "/tmp/thread.jsonl",
      codexAppServerThreadStatus: "active",
    });
  });
});
