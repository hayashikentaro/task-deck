import { useEffect, useState } from "react";
import type { CreateTaskInput, DiagnosticContainer, TaskDeckDiagnostics } from "../types";

type DiagnosticsPaneProps = {
  isConnected: boolean;
  onCreateTask: (input: CreateTaskInput) => boolean;
};

export function DiagnosticsPane({ isConnected, onCreateTask }: DiagnosticsPaneProps) {
  const [diagnostics, setDiagnostics] = useState<TaskDeckDiagnostics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const runningContainers = diagnostics?.containers.filter((container) => container.running).length ?? 0;
  const configuredContainers = diagnostics?.containers.length ?? 0;
  const workspaceCount = diagnostics?.containers.reduce((sum, container) => sum + (container.workspaces?.length ?? 0), 0) ?? 0;
  const readyWorkspaceCount =
    diagnostics?.containers.reduce(
      (sum, container) => sum + (container.workspaces?.filter((workspace) => workspace.exists).length ?? 0),
      0,
    ) ?? 0;

  const loadDiagnostics = () => {
    setIsLoading(true);
    setStatusMessage("");
    fetch("/api/diagnostics")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to load diagnostics.");
        }
        return response.json();
      })
      .then((nextDiagnostics: TaskDeckDiagnostics) => setDiagnostics(nextDiagnostics))
      .catch((nextError) => setStatusMessage(nextError.message || "Unable to load diagnostics."))
      .finally(() => setIsLoading(false));
  };

  const startContainer = (containerName: string) => {
    setStatusMessage(`Starting ${containerName}...`);
    fetch(`/api/diagnostics/containers/${encodeURIComponent(containerName)}/start`, { method: "POST" })
      .then((response) => response.json())
      .then((result: { ok: boolean; message: string; container: DiagnosticContainer | null }) => {
        setStatusMessage(result.message);
        loadDiagnostics();
      })
      .catch((error) => setStatusMessage(error.message || `Unable to start ${containerName}.`));
  };

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

  const copyText = (text: string, label: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => setStatusMessage(`Copied ${label}.`))
      .catch(() => setStatusMessage(`Could not copy ${label}.`));
  };

  useEffect(() => {
    if (isConnected) {
      loadDiagnostics();
    }
  }, [isConnected]);

  return (
    <section className="diagnostics-panel" aria-label="Agent diagnostics">
      <div className="pane-heading">
        <h2>Agent Diagnostics</h2>
        <button disabled={!isConnected || isLoading} type="button" onClick={loadDiagnostics}>
          {isLoading ? "Checking" : "Refresh"}
        </button>
      </div>
      <div className="diagnostics-body">
        <div className="diagnostic-summary-grid" aria-label="Diagnostic summary">
          <div className="diagnostic-summary-item">
            <span>Profiles</span>
            <strong>{diagnostics?.config.source || "unknown"}</strong>
          </div>
          <div className="diagnostic-summary-item">
            <span>Docker</span>
            <strong data-state={diagnostics?.docker.ok ? "ok" : "warn"}>
              {diagnostics ? (diagnostics.docker.ok ? "ready" : "unavailable") : "not checked"}
            </strong>
          </div>
          <div className="diagnostic-summary-item">
            <span>Containers</span>
            <strong data-state={configuredContainers && runningContainers === configuredContainers ? "ok" : "warn"}>
              {diagnostics ? `${runningContainers}/${configuredContainers}` : "-"}
            </strong>
          </div>
          <div className="diagnostic-summary-item">
            <span>Workspaces</span>
            <strong data-state={workspaceCount && readyWorkspaceCount === workspaceCount ? "ok" : "warn"}>
              {diagnostics ? `${readyWorkspaceCount}/${workspaceCount}` : "-"}
            </strong>
          </div>
        </div>
        <p>{statusMessage || diagnostics?.docker.message || "Check Docker and configured agent containers."}</p>
        {diagnostics?.containers.length ? (
          <div className="diagnostic-auth-actions" aria-label="Codex auth actions">
            {diagnostics.containers.map((container) => (
              <button
                disabled={!isConnected || !diagnostics.docker.ok || !container.present}
                key={container.name}
                type="button"
                onClick={() => startCodexAuthTask(container.name, "device-login")}
              >
                Codex login
              </button>
            ))}
          </div>
        ) : null}
        <details className="diagnostic-details">
          <summary>Environment, auth, and container details</summary>
          <div className="diagnostic-details-body">
            <div className="diagnostic-row">
              <span>Profile source</span>
              <strong>{diagnostics?.config.source || "unknown"}</strong>
            </div>
            <p>{diagnostics?.config.message || "Agent profile configuration has not been checked."}</p>
            <div className="diagnostic-row">
              <span>Docker</span>
              <strong data-state={diagnostics?.docker.ok ? "ok" : "warn"}>
                {diagnostics ? (diagnostics.docker.ok ? "ready" : "unavailable") : "not checked"}
              </strong>
            </div>
            <p>{diagnostics?.docker.message || "Check Docker and configured agent containers."}</p>
            {diagnostics?.containers.map((container) => (
              <div className="diagnostic-container" key={container.name}>
                <div className="diagnostic-row">
                  <span>{container.name}</span>
                  <strong data-state={container.running ? "ok" : "warn"}>
                    {container.running ? "running" : container.present ? container.status : "missing"}
                  </strong>
                </div>
                <small>{container.image || container.error || "No image information."}</small>
                {container.workspaces?.length ? (
                  <details className="diagnostic-disclosure">
                    <summary>
                      Container checks ({container.workspaces.filter((workspace) => workspace.exists).length}/
                      {container.workspaces.length})
                    </summary>
                    <div className="diagnostic-workspaces">
                      {container.workspaces.map((workspace) => (
                        <span data-state={workspace.exists ? "ok" : "warn"} key={workspace.path}>
                          {workspace.path}: {workspace.exists ? "ready" : workspace.status}
                        </span>
                      ))}
                    </div>
                  </details>
                ) : null}
                <div className="diagnostic-actions">
                  <button type="button" onClick={() => copyText(`docker inspect ${container.name}`, "inspect command")}>
                    Copy inspect
                  </button>
                  <button
                    disabled={!diagnostics.docker.ok || container.running || !container.present}
                    type="button"
                    onClick={() => startContainer(container.name)}
                  >
                    Start
                  </button>
                  <button
                    disabled={!isConnected || !diagnostics.docker.ok || !container.present}
                    type="button"
                    onClick={() => startCodexAuthTask(container.name, "logout")}
                  >
                    Codex logout
                  </button>
                  <button
                    disabled={!isConnected || !diagnostics.docker.ok || !container.present}
                    type="button"
                    onClick={() => startCodexAuthTask(container.name, "device-login")}
                  >
                    Codex device login
                  </button>
                </div>
              </div>
            ))}
            <p className="diagnostic-note">
              Agent sessions run inside <code>ai-agent-sandbox-agent-1</code> with <code>/workspace</code> as the
              container workspace. Server diagnostics are shown here and documented in README.
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}

function buildCodexAuthCommand(containerName: string, codexCommand: string) {
  const quotedContainerName = shellQuote(containerName);
  return `docker start ${quotedContainerName} >/dev/null && docker exec -it -w /workspace ${quotedContainerName} sh -lc ${shellQuote(codexCommand)}`;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
