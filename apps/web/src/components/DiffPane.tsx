import { useEffect, useState } from "react";
import type { Task } from "../types";

type DiffPaneProps = {
  task: Task | null;
};

export function DiffPane({ task }: DiffPaneProps) {
  const [diff, setDiff] = useState("");
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    if (!task) {
      setDiff("");
      setStatus("idle");
      return;
    }

    let cancelled = false;
    setStatus("loading");
    fetch(`/api/tasks/${task.id}/diff`)
      .then((response) => response.json())
      .then((payload: { diff?: string; error?: string }) => {
        if (cancelled) {
          return;
        }
        setDiff(payload.diff || "");
        setStatus(payload.error ? "unavailable" : "ready");
      })
      .catch(() => {
        if (!cancelled) {
          setDiff("");
          setStatus("unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [task?.id, task?.updatedAt]);

  return (
    <section className="diff-pane" aria-label="Task diff">
      <div className="pane-heading">
        <h2>Diff</h2>
        <span>{status}</span>
      </div>
      <pre>{diff || "No working tree diff for this task."}</pre>
    </section>
  );
}

