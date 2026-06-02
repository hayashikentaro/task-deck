import type { CodexStatusSnapshot, Task } from "../types";

type CodexStatusPanelProps = {
  canRefresh: boolean;
  selectedTask: Task | null;
  snapshot: CodexStatusSnapshot | null;
  onRefresh: () => void;
};

type MetricTone = "green" | "yellow" | "red" | "empty";

const metricRows = [
  { key: "context", label: "Context" },
  { key: "fiveHour", label: "5h" },
  { key: "weekly", label: "Weekly" },
] as const;

export function CodexStatusPanel({ canRefresh, selectedTask, snapshot, onRefresh }: CodexStatusPanelProps) {
  const hasSnapshot = Boolean(snapshot);
  const unavailableText = statusUnavailableText(selectedTask, hasSnapshot);

  return (
    <section className="codex-status-panel" aria-label="Codex status">
      <div className="codex-status-heading">
        <h2>Codex status</h2>
        <button
          aria-label="Refresh Codex status"
          disabled={!canRefresh}
          onClick={onRefresh}
          title="Refresh Codex status"
          type="button"
        >
          <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
            <path d="M13 8a5 5 0 1 1-1.46-3.54M13 2.5v4h-4" />
          </svg>
        </button>
      </div>
      <div className="codex-status-body">
        {metricRows.map((row) => {
          const metric = snapshot?.[row.key];
          const resetLabel = resetLabelFor(snapshot, row.key);
          return (
            <div className="codex-status-row" key={row.key}>
              <span className="codex-status-label">{row.label}</span>
              <span
                aria-label={metric ? `${row.label} ${metric.remainingPercent}% remaining` : `${row.label} unavailable`}
                className="codex-status-meter"
                data-tone={metricTone(row.key, metric?.remainingPercent)}
              >
                <span style={{ width: metric ? `${metric.remainingPercent}%` : "0%" }} />
              </span>
              <span className="codex-status-percent">{metric ? `${metric.remainingPercent}%` : "--"}</span>
              <span className="codex-status-reset">{resetLabel}</span>
            </div>
          );
        })}
        {unavailableText ? <p className="codex-status-hint">{unavailableText}</p> : null}
      </div>
    </section>
  );
}

function resetLabelFor(snapshot: CodexStatusSnapshot | null, key: (typeof metricRows)[number]["key"]) {
  if (key === "fiveHour") {
    return snapshot?.fiveHour?.resetLabel || "";
  }
  if (key === "weekly") {
    return snapshot?.weekly?.resetLabel || "";
  }
  return "";
}

function statusUnavailableText(selectedTask: Task | null, hasSnapshot: boolean) {
  if (!selectedTask) {
    return "Select a running Codex task";
  }
  if (selectedTask.status !== "running" || !isCodexTask(selectedTask)) {
    return "Codex task required";
  }
  if (!hasSnapshot) {
    return "No Codex status yet";
  }
  return "";
}

function metricTone(key: (typeof metricRows)[number]["key"], percent: number | undefined): MetricTone {
  if (typeof percent !== "number") {
    return "empty";
  }
  if (key === "context") {
    return percent >= 50 ? "green" : percent >= 20 ? "yellow" : "red";
  }
  if (key === "fiveHour") {
    return percent >= 40 ? "green" : percent >= 15 ? "yellow" : "red";
  }
  return percent >= 30 ? "green" : percent >= 10 ? "yellow" : "red";
}

function isCodexTask(task: Task) {
  if (task.sessionMode === "diagnostic") {
    return false;
  }
  const text = `${task.agentProfileId || ""} ${task.agentLabel || ""} ${task.command || ""}`.toLowerCase();
  return /\bcodex\b/.test(text);
}
