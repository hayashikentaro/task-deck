import type { CodexStatusSnapshot } from "../types";
import { IconButton } from "./ui/IconButton";

type CodexStatusPanelProps = {
  canRefresh: boolean;
  isRefreshing: boolean;
  snapshot: CodexStatusSnapshot | null;
  onRefresh: () => void;
};

type MetricTone = "green" | "yellow" | "red" | "empty";

const metricRows = [
  { key: "fiveHour", label: "5h" },
  { key: "weekly", label: "Weekly" },
] as const;

export function CodexStatusPanel({
  canRefresh,
  isRefreshing,
  snapshot,
  onRefresh,
}: CodexStatusPanelProps) {
  return (
    <section className="codex-status-panel" aria-label="Codex usage">
      <div className="codex-status-heading">
        <h2>Codex Usage</h2>
        <IconButton
          data-loading={isRefreshing ? "true" : undefined}
          disabled={!canRefresh || isRefreshing}
          label="Refresh Codex usage"
          onClick={onRefresh}
          title="Refresh Codex usage"
          variant="panel"
        >
          <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
            <path d="M13 8a5 5 0 1 1-1.46-3.54M13 2.5v4h-4" />
          </svg>
        </IconButton>
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
              <span className="codex-status-percent">{metric ? `${metric.remainingPercent}%` : "—"}</span>
              <span className="codex-status-reset">{resetLabel}</span>
            </div>
          );
        })}
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

function metricTone(key: (typeof metricRows)[number]["key"], percent: number | undefined): MetricTone {
  if (typeof percent !== "number") {
    return "empty";
  }
  if (key === "fiveHour") {
    return percent >= 40 ? "green" : percent >= 15 ? "yellow" : "red";
  }
  return percent >= 30 ? "green" : percent >= 10 ? "yellow" : "red";
}
