import { describe, expect, it } from "vitest";
import { selectTaskIdForTaskList } from "./App";

describe("TaskDeck task selection", () => {
  it("preserves the current task when it still exists", () => {
    expect(
      selectTaskIdForTaskList(
        "task-current",
        [
          { id: "task-other", status: "running", agentSessionSource: "", inputLockedAt: null },
          { id: "task-current", status: "running", agentSessionSource: "", inputLockedAt: null },
        ],
        ["task-other"],
      ),
    ).toBe("task-current");
  });

  it("falls back to an active parent App Server task before newer read-only subagent cards", () => {
    expect(
      selectTaskIdForTaskList(
        "task-missing",
        [
          {
            id: "task-subagent",
            status: "running",
            agentSessionSource: "codex_app_server_native_subagent",
            inputLockedAt: "2026-06-24T00:00:00.000Z",
          },
          { id: "task-parent", status: "running", agentSessionSource: "codex_app_server_thread", inputLockedAt: null },
        ],
        ["task-parent"],
      ),
    ).toBe("task-parent");
  });

  it("prefers a normal task over a locked native subagent when there is no running id hint", () => {
    expect(
      selectTaskIdForTaskList(
        null,
        [
          {
            id: "task-subagent",
            status: "succeeded",
            agentSessionSource: "codex_app_server_native_subagent",
            inputLockedAt: "2026-06-24T00:00:00.000Z",
          },
          { id: "task-parent", status: "succeeded", agentSessionSource: "codex_app_server_thread", inputLockedAt: null },
        ],
        [],
      ),
    ).toBe("task-parent");
  });
});
