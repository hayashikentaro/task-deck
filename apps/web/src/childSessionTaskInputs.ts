import type { ChildSessionBatchRequest } from "./childSessionRequests";
import type { CreateTaskInput, TaskDeckContext } from "./types";

export const fileProtocolChildSessionsDisabledMessage =
  "TaskDeck file-protocol child session starts are disabled on the App Server-only route; use Codex native subagents instead.";

type ChildTaskBuildResult =
  | { status: "deferred" }
  | { status: "rejected"; error: string }
  | { status: "ready"; inputs: CreateTaskInput[] };

export function buildChildTaskInputs(
  parentTaskId: string,
  request: ChildSessionBatchRequest,
  context: TaskDeckContext | null,
  requestKey: string,
): ChildTaskBuildResult {
  void parentTaskId;
  void request;
  void context;
  void requestKey;
  return { status: "rejected", error: fileProtocolChildSessionsDisabledMessage };
}
