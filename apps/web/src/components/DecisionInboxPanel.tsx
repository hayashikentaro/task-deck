import type { DecisionGatewayMailboxItem } from "../types";

type DecisionInboxPanelProps = {
  items: DecisionGatewayMailboxItem[];
};

export function DecisionInboxPanel({ items }: DecisionInboxPanelProps) {
  const visibleItems = items.filter((item) => item.validationStatus !== "valid").slice(0, 5);

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <section className="decision-inbox-panel" aria-label="Decision inbox">
      <div className="decision-inbox-heading">
        <h2>Decision inbox</h2>
        <span>{visibleItems.length}</span>
      </div>
      <div className="decision-inbox-items">
        {visibleItems.map((item) => (
          <article className="decision-inbox-item" key={item.mailboxItemId} title={decisionInboxTitle(item)}>
            <span className="decision-inbox-status" data-status={item.validationStatus}>
              {item.validationStatus}
            </span>
            <span className="decision-inbox-action">
              {decisionActionLabel(item.actionType)}
              <span>{formatDecisionTime(item.decidedAt || item.receivedAt)}</span>
            </span>
            <span className="decision-inbox-meta">
              {item.taskId ? `task ${shortId(item.taskId)}` : `mail ${shortId(item.mailboxItemId)}`}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

function decisionActionLabel(value: string | undefined) {
  return String(value || "decision").replace(/_/g, " ");
}

function decisionInboxTitle(item: DecisionGatewayMailboxItem) {
  return [item.validationReason, item.condition, item.reason].filter(Boolean).join(" ");
}

function formatDecisionTime(value: string | undefined) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) {
    return "unknown time";
  }
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(value: string | undefined) {
  const normalizedValue = String(value || "").trim();
  if (normalizedValue.length <= 12) {
    return normalizedValue || "unknown";
  }
  return `${normalizedValue.slice(0, 10)}...`;
}
