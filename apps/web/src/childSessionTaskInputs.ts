import { buildLaunchCommand, isCodexProfile } from "./agentLaunch";
import { normalizeCodexReasoningEffort, type CodexPermissionLevel } from "./codexPermissions";
import type { ChildSessionBatchRequest } from "./childSessionRequests";
import type { CreateTaskInput, TaskDeckContext } from "./types";

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
  if (!context) {
    return { status: "deferred" };
  }

  const inputs: CreateTaskInput[] = [];

  for (const [sessionIndex, session] of request.sessions.entries()) {
    const profile = context.agentProfiles.find((agentProfile) => agentProfile.id === session.agentProfileId);
    if (!profile) {
      return { status: "rejected", error: `unknown agentProfileId "${session.agentProfileId}"` };
    }

    const isCodex = isCodexProfile(profile);
    const codexPermissionLevel = (session.agentPermissionLevel ?? "full_access") as CodexPermissionLevel;
    const codexReasoningEffort = isCodex ? normalizeCodexReasoningEffort(session.agentReasoningEffort) : "";
    const launchCommand = buildLaunchCommand(profile, "new", null, codexPermissionLevel, codexReasoningEffort);
    if (!launchCommand.command) {
      return { status: "rejected", error: `empty launch command for agentProfileId "${session.agentProfileId}"` };
    }
    if (!session.cwd) {
      return { status: "rejected", error: `empty cwd for "${session.title}"` };
    }

    inputs.push({
      title: session.title,
      command: launchCommand.command,
      cwd: session.cwd,
      agentProfileId: profile.id,
      agentLabel: profile.label,
      agentPermissionLevel: isCodex ? codexPermissionLevel : session.agentPermissionLevel,
      agentReasoningEffort: isCodex && codexReasoningEffort ? codexReasoningEffort : undefined,
      sessionMode: "new",
      initialInstruction: session.initialInstruction,
      parentSessionId: parentTaskId,
      spawnedFromParentRequest: true,
      childSessionRequestKey: `${requestKey}:${sessionIndex}`,
      workPackageId: session.workPackageId,
      filesLikelyToChange: session.filesLikelyToChange,
    });
  }

  return { status: "ready", inputs };
}
