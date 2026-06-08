export type CodexPermissionLevel = "full_access" | "workspace_write" | "read_only";
export type CodexReasoningEffort = "" | "low" | "medium" | "high" | "xhigh";

const codexCommandTokenPattern = /(^|[^-\w])codex(?![-\w])/i;
const codexCommandWithPermissionPattern =
  /(^|[^-\w])codex(?![-\w])(?:(?:\s+--dangerously-bypass-approvals-and-sandbox)|(?:\s+--sandbox\s+(?:read-only|workspace-write|danger-full-access)))*/i;
const codexReasoningEffortArgPattern = /\s+-c\s+model_reasoning_effort=(?:"[^"]*"|'[^']*'|[^\s]+)/gi;
const codexReasoningEfforts = new Set<CodexReasoningEffort>(["low", "medium", "high", "xhigh"]);

export function codexPermissionArgs(permissionLevel: string | undefined) {
  if (permissionLevel === "workspace_write") return "--sandbox workspace-write";
  if (permissionLevel === "read_only") return "--sandbox read-only";
  return "--dangerously-bypass-approvals-and-sandbox";
}

export function normalizeCodexReasoningEffort(value: string | undefined): CodexReasoningEffort {
  return codexReasoningEfforts.has(value as CodexReasoningEffort) ? (value as CodexReasoningEffort) : "";
}

export function codexReasoningEffortArgs(reasoningEffort: string | undefined) {
  const normalizedReasoningEffort = normalizeCodexReasoningEffort(reasoningEffort);
  return normalizedReasoningEffort ? `-c model_reasoning_effort="${normalizedReasoningEffort}"` : "";
}

export function applyCodexPermissionToCommand(command: string, permissionLevel: CodexPermissionLevel) {
  if (!command) {
    return command;
  }

  const args = codexPermissionArgs(permissionLevel);
  return command.replace(codexCommandWithPermissionPattern, (match, prefix: string) => {
    return `${prefix}codex ${args}`;
  });
}

export function applyCodexReasoningEffortToCommand(command: string, reasoningEffort: string | undefined) {
  if (!command) {
    return command;
  }

  const args = codexReasoningEffortArgs(reasoningEffort);
  if (!args) {
    return command;
  }

  return command
    .replace(codexReasoningEffortArgPattern, "")
    .replace(codexCommandTokenPattern, (_match, prefix: string) => `${prefix}codex ${args}`);
}

export function buildCodexResumeCommandForCommand(
  command: string,
  permissionLevel: string | undefined,
  resumeTarget: string,
  reasoningEffort: string | undefined = "",
) {
  const codexArgs = [codexPermissionArgs(permissionLevel), codexReasoningEffortArgs(reasoningEffort)]
    .filter(Boolean)
    .join(" ");
  const codexCommand = `codex ${codexArgs} resume ${resumeTarget}`;
  const normalizedCommand = String(command || "").toLowerCase();

  if (/\bdocker\b[\s\S]*\bai-agent-sandbox-agent-1\b/.test(normalizedCommand)) {
    return `docker start ai-agent-sandbox-agent-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-agent-1 sh -lc 'TERM=xterm-256color ${codexCommand}'`;
  }
  if (/\bdocker\b[\s\S]*\bai-agent-sandbox-codex-1\b/.test(normalizedCommand)) {
    return `docker start ai-agent-sandbox-codex-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-codex-1 sh -lc 'TERM=xterm-256color ${codexCommand}'`;
  }

  return codexCommand;
}
