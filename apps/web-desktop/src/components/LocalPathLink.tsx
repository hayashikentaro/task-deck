import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type LocalPathPreview = {
  kind: "directory" | "image" | "text" | "unknown";
  title: string;
  subtitle: string;
  mimeType?: string;
  data?: string;
  lines?: string[];
  entries?: string[];
};

type LocalPathLinkProps = {
  path: string;
  text: string;
  onError: (message: string) => void;
};

const previewDelayMs = 250;
const previewCache = new Map<string, LocalPathPreview>();

export function LocalPathLink({ path, text, onError }: LocalPathLinkProps) {
  const previewTimerRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const [preview, setPreview] = useState<LocalPathPreview | null>(null);
  const [previewPosition, setPreviewPosition] = useState({ x: 0, y: 0 });

  const hidePreview = () => {
    requestIdRef.current += 1;
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    setPreview(null);
  };

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current);
      }
    };
  }, []);

  const showPreview = (event: React.MouseEvent<HTMLButtonElement>) => {
    hidePreview();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setPreviewPosition(positionPreview(event.clientX, event.clientY));
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      void loadPreview(path)
        .then((result) => {
          if (requestIdRef.current === requestId) {
            setPreview(result);
          }
        })
        .catch(() => undefined);
    }, previewDelayMs);
  };

  const openPath = () => {
    hidePreview();
    void fetch("/api/local-paths/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(String(payload?.error || "Unable to open local path."));
        }
      })
      .catch((error: unknown) => {
        onError(error instanceof Error ? error.message : "Unable to open local path.");
      });
  };

  return (
    <>
      <button
        className="output-local-path-link"
        onClick={openPath}
        onMouseEnter={showPreview}
        onMouseLeave={hidePreview}
        title={`Open ${text}`}
        type="button"
      >
        {text}
      </button>
      {preview
        ? createPortal(
            <div
              className="output-local-path-preview"
              role="tooltip"
              style={{ left: previewPosition.x, top: previewPosition.y }}
            >
              <strong>{preview.title || text}</strong>
              <span>{preview.subtitle || text}</span>
              {preview.kind === "image" && preview.data && preview.mimeType ? (
                <img alt="" src={`data:${preview.mimeType};base64,${preview.data}`} />
              ) : null}
              {preview.kind === "text" && preview.lines ? (
                <pre>{preview.lines.join("\n") || "(empty file)"}</pre>
              ) : null}
              {preview.kind === "directory" && preview.entries ? (
                <ul>
                  {(preview.entries.length ? preview.entries : ["(empty directory)"]).map((entry, index) => (
                    <li key={`${index}-${entry}`}>{entry}</li>
                  ))}
                </ul>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

async function loadPreview(path: string) {
  const cached = previewCache.get(path);
  if (cached) {
    return cached;
  }

  const response = await fetch(`/api/local-paths/preview?path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    throw new Error("Unable to preview local path.");
  }
  const preview = await response.json() as LocalPathPreview;
  previewCache.set(path, preview);
  return preview;
}

function positionPreview(x: number, y: number) {
  const margin = 12;
  const width = Math.min(320, window.innerWidth - margin * 2);
  return {
    x: Math.max(margin, Math.min(x + 14, window.innerWidth - width - margin)),
    y: Math.max(margin, Math.min(y + 18, window.innerHeight - 240 - margin)),
  };
}
