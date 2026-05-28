import { useEffect, useState } from "react";
import type { DiagnosticContainer, TaskDeckDiagnostics } from "../types";

type DiagnosticsPaneProps = {
  isConnected: boolean;
};

export function DiagnosticsPane({ isConnected }: DiagnosticsPaneProps) {
  const [diagnostics, setDiagnostics] = useState<TaskDeckDiagnostics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

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
        <div className="diagnostic-row">
          <span>Profiles</span>
          <strong>{diagnostics?.config.source || "unknown"}</strong>
        </div>
        <p>{diagnostics?.config.message || "Agent profile configuration has not been checked."}</p>
        <div className="diagnostic-row">
          <span>Docker</span>
          <strong data-state={diagnostics?.docker.ok ? "ok" : "warn"}>
            {diagnostics ? (diagnostics.docker.ok ? "ready" : "unavailable") : "not checked"}
          </strong>
        </div>
        <p>{statusMessage || diagnostics?.docker.message || "Check Docker and configured agent containers."}</p>
        {diagnostics?.containers.map((container) => (
          <div className="diagnostic-container" key={container.name}>
            <div className="diagnostic-row">
              <span>{container.name}</span>
              <strong data-state={container.running ? "ok" : "warn"}>
                {container.running ? "running" : container.present ? container.status : "missing"}
              </strong>
            </div>
            <small>{container.image || container.error || "No image information."}</small>
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
            </div>
          </div>
        ))}
        <p className="diagnostic-note">
          Goose Container opens a bash shell in <code>chrome-goose-1</code>; run <code>goose</code> inside that
          shell when needed.
        </p>
      </div>
    </section>
  );
}
