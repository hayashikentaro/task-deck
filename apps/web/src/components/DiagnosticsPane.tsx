import { useEffect, useState } from "react";
import type { TaskDeckDiagnostics } from "../types";

type DiagnosticsPaneProps = {
  isConnected: boolean;
};

export function DiagnosticsPane({ isConnected }: DiagnosticsPaneProps) {
  const [diagnostics, setDiagnostics] = useState<TaskDeckDiagnostics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const loadDiagnostics = () => {
    setIsLoading(true);
    setError("");
    fetch("/api/diagnostics")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to load diagnostics.");
        }
        return response.json();
      })
      .then((nextDiagnostics: TaskDeckDiagnostics) => setDiagnostics(nextDiagnostics))
      .catch((nextError) => setError(nextError.message || "Unable to load diagnostics."))
      .finally(() => setIsLoading(false));
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
          <span>Docker</span>
          <strong data-state={diagnostics?.docker.ok ? "ok" : "warn"}>
            {diagnostics ? (diagnostics.docker.ok ? "ready" : "unavailable") : "not checked"}
          </strong>
        </div>
        <p>{error || diagnostics?.docker.message || "Check Docker and configured agent containers."}</p>
        {diagnostics?.containers.map((container) => (
          <div className="diagnostic-container" key={container.name}>
            <div className="diagnostic-row">
              <span>{container.name}</span>
              <strong data-state={container.running ? "ok" : "warn"}>
                {container.running ? "running" : container.present ? container.status : "missing"}
              </strong>
            </div>
            <small>{container.image || container.error || "No image information."}</small>
          </div>
        ))}
        <p className="diagnostic-note">
          Goose Container opens a bash shell in <code>chrome-goose-1</code>; start Goose inside that shell when needed.
        </p>
      </div>
    </section>
  );
}
