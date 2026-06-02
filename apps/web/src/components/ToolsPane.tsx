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
  const [errorMessage, setErrorMessage] = useState("");
  const [isRestartConfirmOpen, setIsRestartConfirmOpen] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
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
    setErrorMessage("");
  };

  const requestRestart = async () => {
    setIsRestarting(true);
    setStatusMessage("Restarting TaskDeck...");
    setErrorMessage("");

    try {
      const response = await fetch("/api/server/restart", { method: "POST" });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to restart TaskDeck.");
      }
      setIsRestartConfirmOpen(false);
      setStatusMessage(payload.message || "Restarting TaskDeck...");
      setIsRestarting(false);
    } catch (error) {
      setStatusMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to restart TaskDeck.");
      setIsRestarting(false);
    }
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
          <div className="tool-action-group" data-layout="single">
            <button disabled={!isConnected || isRestarting} type="button" onClick={() => setIsRestartConfirmOpen(true)}>
              Restart TaskDeck
            </button>
          </div>
        </div>
        {statusMessage ? <p className="tool-status">{statusMessage}</p> : null}
        {errorMessage ? <p className="tool-status" data-tone="error">{errorMessage}</p> : null}
      </div>
      {isRestartConfirmOpen ? (
        <div aria-labelledby="restart-taskdeck-title" aria-modal="true" className="modal-backdrop" role="dialog">
          <div className="confirmation-modal">
            <h3 id="restart-taskdeck-title">Restart TaskDeck?</h3>
            <p>
              Restarting TaskDeck will restart the backend server. Active PTY sessions such as Codex, Goose, or zsh may
              be interrupted.
            </p>
            <div className="confirmation-actions">
              <button
                data-priority="secondary"
                disabled={isRestarting}
                onClick={() => setIsRestartConfirmOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button data-priority="danger" disabled={isRestarting} onClick={requestRestart} type="button">
                Restart TaskDeck
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
