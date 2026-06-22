import { useState } from "react";
import { Button } from "./ui/Button";

type ToolsPaneProps = {
  isConnected: boolean;
  canCopyLog: boolean;
  onCopyLog: () => void;
};

export function ToolsPane({
  isConnected,
  canCopyLog,
  onCopyLog,
}: ToolsPaneProps) {
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isRestartConfirmOpen, setIsRestartConfirmOpen] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);

  const openDirectInput = () => {
    const directInputUrl = new URL(window.location.href);
    directInputUrl.searchParams.set("directInput", "1");
    window.open(directInputUrl.toString(), "_blank", "noopener,noreferrer");
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
        <div className="tool-section" aria-labelledby="tools-terminal-title">
          <h3 id="tools-terminal-title">Terminal</h3>
          <div className="tool-action-group" data-layout="single">
            <Button fullWidth variant="panel" onClick={openDirectInput}>
              Open Direct Input
            </Button>
          </div>
        </div>
        <div className="tool-section" aria-labelledby="tools-log-title">
          <h3 id="tools-log-title">Log</h3>
          <div className="tool-action-group" data-layout="single">
            <Button disabled={!canCopyLog} fullWidth variant="panel" onClick={onCopyLog}>
              Copy log
            </Button>
          </div>
        </div>
        <div className="tool-section" aria-labelledby="tools-system-title">
          <h3 id="tools-system-title">System</h3>
          <div className="tool-action-group" data-layout="single">
            <Button
              disabled={!isConnected || isRestarting}
              fullWidth
              variant="panel"
              onClick={() => setIsRestartConfirmOpen(true)}
            >
              Restart TaskDeck
            </Button>
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
              Restarting TaskDeck will restart the backend server. Active App Server or terminal-backed sessions may be
              interrupted.
            </p>
            <div className="confirmation-actions">
              <Button disabled={isRestarting} variant="secondary" onClick={() => setIsRestartConfirmOpen(false)}>
                Cancel
              </Button>
              <Button disabled={isRestarting} variant="danger" onClick={requestRestart}>
                Restart TaskDeck
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
