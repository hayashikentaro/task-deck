import { describe, expect, it } from "vitest";
import { mergeVisibleTaskOrder, moveTaskIdInOrder, sortTasksForDisplay } from "./TaskList";
import type { Task } from "../types";

describe("task list ordering", () => {
  it("moves a task id to the drop target position", () => {
    expect(moveTaskIdInOrder(["one", "two", "three"], "one", "three")).toEqual(["two", "three", "one"]);
    expect(moveTaskIdInOrder(["one", "two", "three"], "three", "one")).toEqual(["three", "one", "two"]);
  });

  it("keeps non-visible task positions while merging a filtered reorder", () => {
    expect(
      mergeVisibleTaskOrder(["one", "two", "three", "four"], ["one", "three"], ["three", "one"]),
    ).toEqual(["three", "two", "one", "four"]);
  });

  it("uses persisted task order indexes before the default supervision sort", () => {
    const first = task({
      id: "first",
      taskOrderIndex: 1,
      attentionState: "needs_input",
      updatedAt: "2026-06-24T01:00:00.000Z",
    });
    const second = task({ id: "second", taskOrderIndex: 0, updatedAt: "2026-06-24T00:00:00.000Z" });
    const unordered = task({
      id: "unordered",
      attentionState: "needs_input",
      updatedAt: "2026-06-24T02:00:00.000Z",
    });

    expect(sortTasksForDisplay([first, unordered, second]).map((item) => item.id)).toEqual([
      "second",
      "first",
      "unordered",
    ]);
  });
});

function task(overrides: Partial<Task>): Task {
  return {
    id: "task",
    title: "Task",
    command: "codex",
    cwd: "/tmp",
    status: "running",
    agentState: "ready",
    attentionState: "none",
    risk: { level: "low", reasons: [] },
    createdAt: "2026-06-24T00:00:00.000Z",
    startedAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    endedAt: null,
    exitCode: null,
    signal: null,
    attachments: [],
    decisionResults: [],
    decisionLeases: [],
    ...overrides,
  } as Task;
}
