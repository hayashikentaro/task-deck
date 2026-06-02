import { useMemo, useState } from "react";
import { defaultAgentProfiles } from "../agentProfiles";
import type { AgentProfile, CreateTaskInput, TaskDeckContext } from "../types";

type ToolsPaneProps = {
  context: TaskDeckContext | null;
  isConnected: boolean;
  onCreateTask: (input: CreateTaskInput) => boolean;
};

export function ToolsPane({ context, isConnected, onCreateTask }: ToolsPaneProps) {
  const [statusMessage, setStatusMessage] = useState("");
  const codexContainers = useMemo(() => getCodexToolContainers(context), [context]);

  const startCodexAuthTask = (containerName: string, action: "logout" | "device-login") => {
    const isDeviceLogin = action === "device-login";
    const command = buildCodexAuthCommand(containerName, isDeviceLogin ? "codex login --device-auth" : "codex logout");
    const didStart = onCreateTask({
      title: isDeviceLogin ? "Codex device login" : "Codex logout",
      command,
      cwd: "",
      agentProfileId: "codex-auth",
      agentLabel: "Codex auth",
      sessionMode: "diagnostic",
      initialInstruction: "",
    });
    setStatusMessage(
      didStart
        ? `Started ${isDeviceLogin ? "Codex device login" : "Codex logout"} in ${containerName}.`
        : "TaskDeck is not connected.",
    );
  };

  return (
    <section className="tools-panel" aria-label="Tools">
      <div className="pane-heading">
        <h2>Tools</h2>
      </div>
      <div className="tools-body">
        <div className="tool-actions" aria-label="Codex auth actions">
          {codexContainers.map((containerName) => (
            <div className="tool-action-group" key={containerName}>
              <button
                disabled={!isConnected}
                type="button"
                onClick={() => startCodexAuthTask(containerName, "device-login")}
              >
                Codex login
              </button>
              <button
                disabled={!isConnected}
                type="button"
                onClick={() => startCodexAuthTask(containerName, "logout")}
              >
                Codex logout
              </button>
            </div>
          ))}
        </div>
        {statusMessage ? <p className="tool-status">{statusMessage}</p> : null}
      </div>
    </section>
  );
}

function getCodexToolContainers(context: TaskDeckContext | null) {
  const agentProfiles = context?.agentProfiles.length ? context.agentProfiles : defaultAgentProfiles;
  return Array.from(
    new Set(
      agentProfiles
        .filter((profile) => isCodexProfile(profile))
        .map((profile) => profile.diagnosticContainer?.trim())
        .filter((containerName): containerName is string => Boolean(containerName)),
    ),
  );
}

function isCodexProfile(profile: AgentProfile) {
  return (
    profile.id.includes("codex") ||
    profile.label.toLowerCase().includes("codex") ||
    /\bcodex\b/.test(profile.command)
  );
}

function buildCodexAuthCommand(containerName: string, codexCommand: string) {
  const quotedContainerName = shellQuote(containerName);
  return `docker start ${quotedContainerName} >/dev/null && docker exec -it -w /workspace ${quotedContainerName} sh -lc ${shellQuote(codexCommand)}`;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
