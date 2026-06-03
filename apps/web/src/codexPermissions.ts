export type CodexPermissionLevel = "full_access" | "workspace_write" | "read_only";

export function codexPermissionArgs(permissionLevel: string | undefined) {
  if (permissionLevel === "workspace_write") return "--sandbox workspace-write";
  if (permissionLevel === "read_only") return "--sandbox read-only";
  return "--dangerously-bypass-approvals-and-sandbox";
}

export function applyCodexPermissionToCommand(command: string, permissionLevel: CodexPermissionLevel) {
  if (!command) {
    return command;
  }

  const args = codexPermissionArgs(permissionLevel);
  return command.replace(
    /\bcodex\b(?:(?:\s+--dangerously-bypass-approvals-and-sandbox)|(?:\s+--sandbox\s+(?:read-only|workspace-write|danger-full-access)))*/i,
    `codex ${args}`,
  );
}

export function buildCodexResumeCommandForCommand(
  command: string,
  permissionLevel: string | undefined,
  resumeTarget: string,
) {
  const codexCommand = `codex ${codexPermissionArgs(permissionLevel)} resume ${resumeTarget}`;
  const normalizedCommand = String(command || "").toLowerCase();

  if (/\bdocker\b[\s\S]*\bai-agent-sandbox-agent-1\b/.test(normalizedCommand)) {
    return `docker start ai-agent-sandbox-agent-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-agent-1 sh -lc 'TERM=xterm-256color ${codexCommand}'`;
  }
  if (/\bdocker\b[\s\S]*\bai-agent-sandbox-codex-1\b/.test(normalizedCommand)) {
    return `docker start ai-agent-sandbox-codex-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-codex-1 sh -lc 'TERM=xterm-256color ${codexCommand}'`;
  }

  return codexCommand;
}
