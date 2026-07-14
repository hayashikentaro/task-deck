import type { ComposerInputState, Task } from "./types";

type NativeSubagentTaskLike = {
  agentProfileId?: string;
  agentSessionSource?: string;
  command?: string;
  sessionMode?: string;
};

export function getComposerMode(
  task: Task | null,
  isConnected: boolean,
  {
    isCodexAppServerTurnActive = false,
  }: { isCodexAppServerTurnActive?: boolean } = {},
) {
  if (!task) {
    return "No task selected";
  }
  if (!isConnected) {
    return "Disconnected";
  }
  if (task.status !== "running") {
    return "Read-only log";
  }
  if (isNativeSubagentTask(task)) {
    return "Read-only log";
  }
  if (task.inputLockedAt) {
    return "Input locked";
  }
  if (isCodexAppServerTurnActive) {
    return "Codex is running";
  }
  return "Interactive task";
}

export function getComposerInputPlaceholder({
  canSend,
  isCodexAppServerTask,
  isCodexAppServerTurnActive,
  modeText,
}: {
  canSend: boolean;
  isCodexAppServerTask: boolean;
  isCodexAppServerTurnActive: boolean;
  modeText: string;
}) {
  if (canSend) {
    return isCodexAppServerTask ? "Send input to Codex App Server task" : "Input to running task";
  }
  if (isCodexAppServerTurnActive) {
    return "";
  }
  return modeText;
}

export function getComposerInputState({
  task,
  isConnected,
  isUploadingAttachments,
  isCodexAppServerTurnActive,
}: {
  isConnected: boolean;
  isUploadingAttachments: boolean;
  isCodexAppServerTurnActive: boolean;
  task: Task | null;
}): ComposerInputState {
  if (!task) {
    return "empty";
  }
  if (!isConnected) {
    return "disconnected";
  }
  if (task.status !== "running" || isNativeSubagentTask(task)) {
    return "readonly";
  }
  if (task.inputLockedAt) {
    return "locked";
  }
  if (isUploadingAttachments || isCodexAppServerTurnActive) {
    return "busy";
  }
  return "ready";
}

export function isNativeSubagentTask(task: NativeSubagentTaskLike) {
  if (task.agentSessionSource === "codex_app_server_native_subagent") {
    return true;
  }
  return (
    task.agentProfileId === "codex-app-server" &&
    task.sessionMode === "subagent" &&
    String(task.command || "").startsWith("Codex App Server native subagent ")
  );
}

export function normalizeComposerInput(input: string) {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
