import { useEffect, useState } from "react";
import type { Task } from "../types";

type DiffPaneProps = {
  task: Task | null;
};

export function DiffPane({ task }: DiffPaneProps) {
  const [diff, setDiff] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!task) {
      setDiff("");
      setStatus("idle");
      setMessage("");
      return;
    }

    let cancelled = false;
    setStatus("loading");
    fetch(`/api/tasks/${task.id}/diff`)
      .then((response) => response.json())
      .then((payload: { diff?: string; error?: string; isGitRepo?: boolean; message?: string; ok?: boolean }) => {
        if (cancelled) {
          return;
        }
        setDiff(payload.diff || "");
        setMessage(payload.message || payload.error || "");
        setStatus(payload.isGitRepo === false ? "not git" : payload.error ? "unavailable" : "ready");
      })
      .catch(() => {
        if (!cancelled) {
          setDiff("");
          setStatus("unavailable");
          setMessage("");
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
      <pre>{diff || message || "No working tree diff for this task."}</pre>
    </section>
  );
}
