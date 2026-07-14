import type { OutputEvent } from "./types";

export const outputEventQueueLimit = 5000;

export type OutputReplayGap = {
  taskId: string;
  expectedTaskSeq: number;
  receivedTaskSeq: number;
};

export type OutputDrainResult = {
  text: string;
  nextQueueSeq: number;
  nextTaskSeq: number;
  gap: OutputReplayGap | null;
};

export function appendOutputEventToQueue(
  current: OutputEvent[],
  event: OutputEvent,
  limit = outputEventQueueLimit,
) {
  const next = [...current, event];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function maxOutputQueueSeq(events: OutputEvent[]) {
  return events.reduce((maxSeq, event) => Math.max(maxSeq, positiveInteger(event.seq)), 0);
}

export function drainOutputEventsForTask({
  events,
  taskId,
  lastQueueSeq,
  lastTaskSeq,
}: {
  events: OutputEvent[];
  taskId: string;
  lastQueueSeq: number;
  lastTaskSeq: number;
}): OutputDrainResult {
  let text = "";
  let nextQueueSeq = positiveInteger(lastQueueSeq);
  let nextTaskSeq = positiveInteger(lastTaskSeq);

  for (const event of events) {
    if (event.taskId !== taskId) {
      continue;
    }

    const queueSeq = positiveInteger(event.seq);
    if (queueSeq <= nextQueueSeq) {
      continue;
    }

    const taskSeq = positiveInteger(event.taskSeq);
    if (taskSeq > 0) {
      if (taskSeq <= nextTaskSeq) {
        nextQueueSeq = queueSeq;
        continue;
      }

      const expectedTaskSeq = nextTaskSeq + 1;
      if (taskSeq !== expectedTaskSeq) {
        return {
          text,
          nextQueueSeq,
          nextTaskSeq,
          gap: {
            taskId,
            expectedTaskSeq,
            receivedTaskSeq: taskSeq,
          },
        };
      }

      nextTaskSeq = taskSeq;
    }

    text += event.data;
    nextQueueSeq = queueSeq;
  }

  return {
    text,
    nextQueueSeq,
    nextTaskSeq,
    gap: null,
  };
}

function positiveInteger(value: unknown) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}
