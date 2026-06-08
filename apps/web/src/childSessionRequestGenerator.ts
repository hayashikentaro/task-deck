import {
  CHILD_SESSION_BATCH_REQUEST_END_MARKER,
  CHILD_SESSION_BATCH_REQUEST_START_MARKER,
  type ChildSessionAgentReasoningEffort,
  type ChildSessionPermissionLevel,
} from "./childSessionRequests";

export type ChildSessionRequestDraft = {
  title: string;
  agentProfileId: string;
  agentPermissionLevel?: ChildSessionPermissionLevel;
  agentReasoningEffort?: ChildSessionAgentReasoningEffort;
  cwd: string;
  workPackageId: string;
  filesLikelyToChange?: string[];
  initialInstruction: string;
};

export type ChildSessionBatchRequestDraft = {
  version?: 1;
  reason: string;
  sessions: ChildSessionRequestDraft[];
};

export function createChildSessionBatchRequestBlock(draft: ChildSessionBatchRequestDraft): string {
  const request = {
    version: draft.version ?? 1,
    reason: draft.reason,
    sessions: draft.sessions.map((session) => ({
      title: session.title,
      agentProfileId: session.agentProfileId,
      ...(session.agentPermissionLevel ? { agentPermissionLevel: session.agentPermissionLevel } : {}),
      ...(session.agentReasoningEffort ? { agentReasoningEffort: session.agentReasoningEffort } : {}),
      cwd: session.cwd,
      workPackageId: session.workPackageId,
      ...(session.filesLikelyToChange ? { filesLikelyToChange: session.filesLikelyToChange } : {}),
      initialInstruction: session.initialInstruction,
    })),
  };

  return [
    CHILD_SESSION_BATCH_REQUEST_START_MARKER,
    JSON.stringify(request, null, 2),
    CHILD_SESSION_BATCH_REQUEST_END_MARKER,
  ].join("\n");
}
