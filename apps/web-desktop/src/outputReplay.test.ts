import { describe, expect, it } from "vitest";
import { appendOutputEventToQueue, drainOutputEventsForTask } from "./outputReplay";
import type { OutputEvent } from "./types";

describe("output replay queue", () => {
  it("keeps bursty Japanese output deltas in order", () => {
    const deltas = ["原", "因", "は", "特", "定", "で", "き", "ま", "す"];
    const events = deltas.reduce<OutputEvent[]>((queue, data, index) => {
      return appendOutputEventToQueue(queue, {
        seq: index + 1,
        taskId: "task-a",
        taskSeq: index + 1,
        data,
        role: "assistant",
        kind: "assistant_delta",
      });
    }, []);

    const drained = drainOutputEventsForTask({
      events,
      taskId: "task-a",
      lastQueueSeq: 0,
      lastTaskSeq: 0,
    });

    expect(drained.gap).toBeNull();
    expect(drained.text).toBe("原因は特定できます");
    expect(drained.nextTaskSeq).toBe(deltas.length);
  });

  it("detects task-local output sequence gaps", () => {
    const events: OutputEvent[] = [
      { seq: 1, taskId: "task-a", taskSeq: 1, data: "原因" },
      { seq: 2, taskId: "task-a", taskSeq: 3, data: "特定" },
    ];

    const drained = drainOutputEventsForTask({
      events,
      taskId: "task-a",
      lastQueueSeq: 0,
      lastTaskSeq: 0,
    });

    expect(drained.gap).toEqual({
      taskId: "task-a",
      expectedTaskSeq: 2,
      receivedTaskSeq: 3,
    });
  });

  it("skips output already covered by a persisted-log reload and applies newer deltas", () => {
    const events: OutputEvent[] = [
      { seq: 1, taskId: "task-a", taskSeq: 1, data: "古い" },
      { seq: 2, taskId: "task-a", taskSeq: 2, data: "ログ" },
      { seq: 3, taskId: "task-a", taskSeq: 3, data: "新しい" },
    ];

    const drained = drainOutputEventsForTask({
      events,
      taskId: "task-a",
      lastQueueSeq: 2,
      lastTaskSeq: 2,
    });

    expect(drained.gap).toBeNull();
    expect(drained.text).toBe("新しい");
    expect(drained.nextTaskSeq).toBe(3);
  });
});
