import type { Task } from "../types";

type FleetSummaryProps = {
  tasks: Task[];
};

export function FleetSummary({ tasks }: FleetSummaryProps) {
  const summary = tasks.reduce(
    (counts, task) => {
      counts.total += 1;
      if (task.agentState === "thinking" || task.agentState === "starting") counts.thinking += 1;
      if (task.agentState === "working") counts.working += 1;
      if (task.agentState === "waiting_input" || task.agentState === "waiting_approval") counts.needsInput += 1;
      if (task.agentState === "review_ready") counts.reviewReady += 1;
      if (task.agentState === "done") counts.done += 1;
      if (task.agentState === "failed" || task.agentState === "stopped") counts.failedOrStopped += 1;
      return counts;
    },
    {
      total: 0,
      thinking: 0,
      working: 0,
      needsInput: 0,
      reviewReady: 0,
      done: 0,
      failedOrStopped: 0,
    },
  );

  return (
    <section className="fleet-summary" aria-label="Fleet summary">
      <SummaryItem label="Total" value={summary.total} tone="neutral" />
      <SummaryItem label="Thinking" value={summary.thinking} tone={summary.thinking > 0 ? "active" : "neutral"} />
      <SummaryItem label="Working" value={summary.working} tone={summary.working > 0 ? "active" : "neutral"} />
      <SummaryItem label="Needs input" value={summary.needsInput} tone={summary.needsInput > 0 ? "risk" : "neutral"} />
      <SummaryItem label="Review" value={summary.reviewReady} tone={summary.reviewReady > 0 ? "risk" : "neutral"} />
      <SummaryItem label="Done" value={summary.done} tone="subdued" />
      <SummaryItem
        label="Failed/stopped"
        value={summary.failedOrStopped}
        tone={summary.failedOrStopped > 0 ? "attention" : "neutral"}
      />
    </section>
  );
}

function SummaryItem({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "active" | "attention" | "neutral" | "risk" | "subdued";
  value: number;
}) {
  return (
    <div className="summary-item" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
