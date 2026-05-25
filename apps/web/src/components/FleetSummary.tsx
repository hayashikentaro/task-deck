import type { Task } from "../types";

type FleetSummaryProps = {
  tasks: Task[];
};

export function FleetSummary({ tasks }: FleetSummaryProps) {
  const summary = tasks.reduce(
    (counts, task) => {
      counts.total += 1;
      if (task.status === "running") counts.running += 1;
      if (task.status === "succeeded") counts.succeeded += 1;
      if (task.status === "failed") counts.failed += 1;
      if (task.status === "interrupted") counts.interrupted += 1;
      if (task.risk.level === "high") counts.highRisk += 1;
      if (task.risk.level === "medium") counts.mediumRisk += 1;
      return counts;
    },
    {
      total: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      interrupted: 0,
      highRisk: 0,
      mediumRisk: 0,
    },
  );

  return (
    <section className="fleet-summary" aria-label="Fleet summary">
      <SummaryItem label="Total" value={summary.total} tone="neutral" />
      <SummaryItem label="Running" value={summary.running} tone={summary.running > 0 ? "active" : "neutral"} />
      <SummaryItem label="Succeeded" value={summary.succeeded} tone="subdued" />
      <SummaryItem label="Failed" value={summary.failed} tone={summary.failed > 0 ? "attention" : "neutral"} />
      <SummaryItem
        label="Interrupted"
        value={summary.interrupted}
        tone={summary.interrupted > 0 ? "attention" : "neutral"}
      />
      <SummaryItem label="High risk" value={summary.highRisk} tone={summary.highRisk > 0 ? "risk" : "neutral"} />
      <SummaryItem
        label="Medium risk"
        value={summary.mediumRisk}
        tone={summary.mediumRisk > 0 ? "risk" : "neutral"}
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
