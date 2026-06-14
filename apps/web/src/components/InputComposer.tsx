import { ChangeEvent, FormEvent, KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import type { PendingTaskAttachment, Task } from "../types";

type InputComposerProps = {
  isConnected: boolean;
  task: Task | null;
  value: string;
  onValueChange: (value: string) => void;
  send: (payload: unknown) => boolean;
};

const maxComposerHeight = 140;
const terminalEnter = "\r";
const bracketedPasteStart = "\x1b[200~";
const bracketedPasteEnd = "\x1b[201~";
type SelectedImageAttachment = {
  id: string;
  file: File;
};
type ComposerInputState = "ready" | "locked" | "busy" | "readonly" | "disconnected" | "empty";

export function InputComposer({ isConnected, task, value, onValueChange, send }: InputComposerProps) {
  const [isComposing, setIsComposing] = useState(false);
  const [selectedImages, setSelectedImages] = useState<SelectedImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const isTerminalInputLocked = Boolean(task?.terminalInputLockedAt);
  const isCodexAppServerTask = task?.agentProfileId === "codex-app-server";
  const needsUserAttention = taskNeedsUserAttention(task);
  const isCodexAppServerNeedsAttention = Boolean(isCodexAppServerTask && needsUserAttention);
  const isActiveInstruction = Boolean(task?.agentState === "working" && !needsUserAttention);
  const isUnsupportedCancelActiveTask = Boolean(isCodexAppServerTask && isActiveInstruction);
  const canInteractWithRunningTask = Boolean(task && task.status === "running" && isConnected);
  const canSend = canInteractWithRunningTask && !isTerminalInputLocked && !isUnsupportedCancelActiveTask && !isCodexAppServerNeedsAttention;
  const hasComposerContent = Boolean(value || selectedImages.length);
  const canSubmit = canSend && hasComposerContent && !isUploadingAttachments;
  const canCancelCurrentInstruction = Boolean(canInteractWithRunningTask && !isCodexAppServerTask && isActiveInstruction);
  const actionLabel = isUnsupportedCancelActiveTask
    ? "Task is running"
    : canCancelCurrentInstruction
      ? "Cancel current instruction"
      : "Send input to running task";
  const modeText = getComposerMode(task, isConnected, { isCodexAppServerNeedsAttention, isUnsupportedCancelActiveTask });
  const inputState = getComposerInputState({ task, isConnected, isUploadingAttachments });

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxComposerHeight)}px`;
  }, [value]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    sendValue();
  };

  const handlePrimaryAction = () => {
    if (canCancelCurrentInstruction) {
      cancelCurrentInstruction();
      return;
    }
    sendValue();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!shouldSendFromEnterKey(event, isComposing)) {
      return;
    }
    event.preventDefault();
    sendValue();
  };

  const handleImageSelection = (event: ChangeEvent<HTMLInputElement>) => {
    if (!canSend) {
      event.target.value = "";
      return;
    }

    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    const supportedImages = files.filter((file) => isSupportedImage(file));
    if (supportedImages.length !== files.length) {
      setAttachmentError("PNG, JPEG, or WebP images only.");
    } else {
      setAttachmentError("");
    }

    setSelectedImages((current) => [
      ...current,
      ...supportedImages.map((file) => ({
        id: crypto.randomUUID(),
        file,
      })),
    ]);
  };

  const removeSelectedImage = (imageId: string) => {
    setSelectedImages((current) => current.filter((image) => image.id !== imageId));
  };

  const cancelCurrentInstruction = () => {
    if (!task || !canInteractWithRunningTask) {
      return;
    }
    send({ type: "interrupt", taskId: task.id });
  };

  const sendValue = async () => {
    if (!canSend || !hasComposerContent || isUploadingAttachments) {
      return;
    }

    try {
      setIsUploadingAttachments(true);
      setAttachmentError("");
      const hasImageAttachments = selectedImages.length > 0;
      const uploadedAttachments = await uploadSelectedImages(selectedImages);
      const input = appendAttachmentContext(value, uploadedAttachments);
      const didSend = sendAgentInput(input, hasImageAttachments);
      if (didSend) {
        onValueChange("");
        setSelectedImages([]);
      }
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Unable to attach images.");
    } finally {
      setIsUploadingAttachments(false);
    }
  };

  const sendAgentInput = (input: string, hasImageAttachments: boolean) => {
    if (!task || !canSend || !input) {
      return false;
    }
    const data = formatComposerInputForPty(input, hasImageAttachments);
    return send({ type: "input", taskId: task.id, data, source: "composer-agent" });
  };

  return (
    <form className="input-composer" data-input-state={inputState} onSubmit={handleSubmit}>
      {selectedImages.length > 0 ? (
        <div className="attachment-chip-list input-attachment-chip-list" aria-label="Selected image attachments">
          {selectedImages.map((image) => (
            <span className="attachment-chip" key={image.id}>
              <span>{image.file.name}</span>
              <button
                aria-label={`Remove ${image.file.name}`}
                onClick={() => removeSelectedImage(image.id)}
                title="Remove attachment"
                type="button"
              >
                <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
                  <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {attachmentError ? <small className="attachment-error input-attachment-error">{attachmentError}</small> : null}
      <div className="input-composer-inner">
        <button
          aria-label="Attach image"
          className="add-context-button input-attach-button"
          disabled={!canSend || isUploadingAttachments}
          onClick={() => imageInputRef.current?.click()}
          title="Attach image"
          type="button"
        >
          <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
        <input
          ref={imageInputRef}
          accept="image/png,image/jpeg,image/webp"
          className="visually-hidden"
          multiple
          onChange={handleImageSelection}
          type="file"
        />
        <textarea
          ref={textareaRef}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          disabled={!canSend}
          onChange={(event) => onValueChange(event.target.value)}
          onCompositionEnd={() => setIsComposing(false)}
          onCompositionStart={() => setIsComposing(true)}
          onKeyDown={handleKeyDown}
          placeholder={canSend ? "Input to running task" : modeText}
          rows={1}
          spellCheck={false}
          value={value}
        />
        <button
          aria-label={actionLabel}
          className="input-primary-action-button"
          disabled={canCancelCurrentInstruction ? !canInteractWithRunningTask : !canSubmit}
          onClick={handlePrimaryAction}
          title={actionLabel}
          type="button"
        >
          {canCancelCurrentInstruction ? (
            <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
              <rect height="8" rx="1.2" width="8" x="4" y="4" />
            </svg>
          ) : (
            <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
              <path d="M8 13V3M4 7l4-4 4 4" />
            </svg>
          )}
        </button>
      </div>
    </form>
  );
}

async function uploadSelectedImages(images: SelectedImageAttachment[]) {
  const uploadedAttachments: PendingTaskAttachment[] = [];

  for (const image of images) {
    const response = await fetch("/api/attachments", {
      method: "POST",
      headers: {
        "Content-Type": image.file.type,
        "X-TaskDeck-Filename": encodeURIComponent(image.file.name),
      },
      body: image.file,
    });
    const payload = await readJsonResponse<{ attachment?: PendingTaskAttachment; error?: string }>(response);
    if (!response.ok) {
      throw new Error(payload?.error || formatUploadFailure(response));
    }
    if (!payload) {
      throw new Error("TaskDeck server returned an empty response.");
    }
    if (!payload.attachment) {
      throw new Error(payload.error || "Unable to upload image.");
    }
    uploadedAttachments.push(payload.attachment);
  }

  return uploadedAttachments;
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`TaskDeck server returned a non-JSON response (${response.status} ${response.statusText}).`);
  }
}

function formatUploadFailure(response: Response) {
  const statusText = response.statusText || "Upload failed";
  return `Attachment upload failed: ${response.status} ${statusText}.`;
}

function isSupportedImage(file: File) {
  return ["image/png", "image/jpeg", "image/webp"].includes(file.type);
}

function appendAttachmentContext(input: string, attachments: PendingTaskAttachment[]) {
  if (!attachments.length) {
    return input;
  }

  const attachmentBlock = [
    "Attached images:",
    ...attachments.map((attachment) => `- ${attachment.path}`),
  ].join("\n");
  const instruction = input.trim();
  return instruction ? `${instruction}\n\n${attachmentBlock}` : attachmentBlock;
}

function shouldSendFromEnterKey(event: KeyboardEvent<HTMLTextAreaElement>, isComposing: boolean) {
  if (!isEnterKey(event)) {
    return false;
  }
  if (isImeCompositionActive(event, isComposing)) {
    return false;
  }
  if (shouldInsertNewline(event)) {
    return false;
  }
  return isPlainEnter(event) || isCommandEnter(event);
}

function isEnterKey(event: KeyboardEvent<HTMLTextAreaElement>) {
  return event.key === "Enter";
}

function isImeCompositionActive(event: KeyboardEvent<HTMLTextAreaElement>, isComposing: boolean) {
  return isComposing || event.nativeEvent.isComposing;
}

function shouldInsertNewline(event: KeyboardEvent<HTMLTextAreaElement>) {
  return event.shiftKey;
}

function isPlainEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  return !event.altKey && !event.ctrlKey && !event.metaKey;
}

function isCommandEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  return event.metaKey || event.ctrlKey;
}

function formatComposerInputForPty(input: string, hasImageAttachments: boolean) {
  const text = normalizeTerminalInput(input);
  if (isSlashCommandInput(text, hasImageAttachments)) {
    return `${text.trim()}${terminalEnter}`;
  }
  return `${bracketedPasteStart}${text}${bracketedPasteEnd}${terminalEnter}`;
}

function normalizeTerminalInput(input: string) {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isSlashCommandInput(input: string, hasImageAttachments: boolean) {
  if (hasImageAttachments) {
    return false;
  }

  const text = input.trim();
  return text.startsWith("/") && !text.includes("\n");
}

function getComposerMode(
  task: Task | null,
  isConnected: boolean,
  {
    isCodexAppServerNeedsAttention = false,
    isUnsupportedCancelActiveTask = false,
  }: { isCodexAppServerNeedsAttention?: boolean; isUnsupportedCancelActiveTask?: boolean } = {},
) {
  if (!task) {
    return "No task selected";
  }
  if (!isConnected) {
    return "Disconnected";
  }
  if (task.status !== "running") {
    return "Read-only log";
  }
  if (task.terminalInputLockedAt) {
    return "Terminal input locked";
  }
  if (isCodexAppServerNeedsAttention) {
    return "Task needs your attention";
  }
  if (isUnsupportedCancelActiveTask) {
    return "Task is running";
  }
  return "Interactive task";
}

function getComposerInputState({
  task,
  isConnected,
  isUploadingAttachments,
}: {
  isConnected: boolean;
  isUploadingAttachments: boolean;
  task: Task | null;
}): ComposerInputState {
  if (!task) {
    return "empty";
  }
  if (!isConnected) {
    return "disconnected";
  }
  if (task.terminalInputLockedAt) {
    return "locked";
  }
  if (isUploadingAttachments) {
    return "busy";
  }
  if (task.status !== "running") {
    return "readonly";
  }
  return "ready";
}

function taskNeedsUserAttention(task: Task | null) {
  return Boolean(task?.attentionState && task.attentionState !== "none");
}
