import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "./ui/Button";
import type { CodexModel, PendingTaskAttachment, Task } from "../types";

type InputComposerProps = {
  codexModels: CodexModel[];
  isConnected: boolean;
  task: Task | null;
  value: string;
  onValueChange: (value: string) => void;
  send: (payload: unknown) => boolean;
};

const maxComposerHeight = 140;
const fallbackReasoningEfforts = ["minimal", "low", "medium", "high", "xhigh"];
type SelectedImageAttachment = {
  id: string;
  file: File;
};
type ComposerInputState = "ready" | "locked" | "busy" | "readonly" | "disconnected" | "empty";

export function InputComposer({ codexModels, isConnected, task, value, onValueChange, send }: InputComposerProps) {
  const [isComposing, setIsComposing] = useState(false);
  const [selectedImages, setSelectedImages] = useState<SelectedImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState("");
  const [isStopRequested, setIsStopRequested] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const isInputLocked = Boolean(task?.inputLockedAt);
  const isCodexAppServerTask = task?.agentProfileId === "codex-app-server";
  const codexAppServerRequest = task?.codexAppServerRequest ?? null;
  const needsUserAttention = taskNeedsUserAttention(task);
  const isCodexAppServerNeedsAttention = Boolean(isCodexAppServerTask && needsUserAttention);
  const isCodexAppServerTurnActive = Boolean(isCodexAppServerTask && task?.codexAppServerTurnActive);
  const canInteractWithRunningTask = Boolean(task && task.status === "running" && isConnected);
  const canStopCodexAppServerTurn = Boolean(canInteractWithRunningTask && isCodexAppServerTurnActive && !isStopRequested);
  const canSend = canInteractWithRunningTask && !isInputLocked && !isCodexAppServerTurnActive && !isCodexAppServerNeedsAttention;
  const hasComposerContent = Boolean(value || selectedImages.length);
  const canSubmit = canSend && hasComposerContent && !isUploadingAttachments;
  const canResolveCodexAppServerRequest = Boolean(canInteractWithRunningTask && codexAppServerRequest);
  const actionLabel = isCodexAppServerTurnActive
    ? "Stop active Codex turn"
    : "Send input to running task";
  const modeText = getComposerMode(task, isConnected, { isCodexAppServerNeedsAttention, isCodexAppServerTurnActive });
  const inputPlaceholder = canSend
    ? isCodexAppServerTask
      ? "Send input to Codex App Server task"
      : "Input to running task"
    : modeText;
  const inputState = getComposerInputState({ task, isConnected, isUploadingAttachments, isCodexAppServerTurnActive });
  const modelOptions = useMemo(
    () => ensureSelectedModelOption(codexModels, selectedModel || task?.agentModel || ""),
    [codexModels, selectedModel, task?.agentModel],
  );
  const selectedModelOption = modelOptions.find((model) => model.model === selectedModel) ?? null;
  const reasoningEffortOptions = useMemo(
    () => getReasoningEffortOptions(selectedModelOption, selectedReasoningEffort),
    [selectedModelOption, selectedReasoningEffort],
  );
  const canConfigureTurn = Boolean(isCodexAppServerTask && canInteractWithRunningTask && !isInputLocked && !isCodexAppServerTurnActive);

  useEffect(() => {
    setSelectedModel(String(task?.agentModel || "").trim());
    setSelectedReasoningEffort(String(task?.agentReasoningEffort || "").trim());
    setIsStopRequested(false);
  }, [task?.agentModel, task?.agentReasoningEffort, task?.id]);

  useEffect(() => {
    if (!isCodexAppServerTurnActive) {
      setIsStopRequested(false);
    }
  }, [isCodexAppServerTurnActive]);

  useEffect(() => {
    if (!isStopRequested || !isCodexAppServerTurnActive) {
      return;
    }
    const retryTimer = window.setTimeout(() => setIsStopRequested(false), 2000);
    return () => window.clearTimeout(retryTimer);
  }, [isCodexAppServerTurnActive, isStopRequested]);

  useEffect(() => {
    if (!selectedModel && modelOptions.length > 0) {
      const defaultModel = modelOptions.find((model) => model.isDefault) ?? modelOptions[0];
      setSelectedModel(defaultModel.model);
      return;
    }
    if (!selectedReasoningEffort && selectedModelOption?.defaultReasoningEffort) {
      setSelectedReasoningEffort(selectedModelOption.defaultReasoningEffort);
    }
  }, [modelOptions, selectedModel, selectedModelOption, selectedReasoningEffort]);

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
    if (isCodexAppServerTurnActive) {
      stopCodexAppServerTurn();
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

  const resolveCodexAppServerRequest = (action: "approve" | "decline" | "cancel") => {
    if (!task || !codexAppServerRequest || !canResolveCodexAppServerRequest) {
      return;
    }
    send({
      type: "codex-app-server-request",
      taskId: task.id,
      requestId: codexAppServerRequest.id,
      action,
    });
  };

  const stopCodexAppServerTurn = () => {
    if (!task || !canStopCodexAppServerTurn) {
      return;
    }
    const didSend = send({
      type: "codex-app-server-interrupt-turn",
      taskId: task.id,
    });
    if (didSend) {
      setIsStopRequested(true);
    }
  };

  const sendValue = async () => {
    if (!canSend || !hasComposerContent || isUploadingAttachments) {
      return;
    }

    try {
      setIsUploadingAttachments(true);
      setAttachmentError("");
      const uploadedAttachments = await uploadSelectedImages(selectedImages);
      const input = appendAttachmentContext(value, uploadedAttachments);
      const didSend = sendAgentInput(input);
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

  const sendAgentInput = (input: string) => {
    if (!task || !canSend || !input) {
      return false;
    }
    const data = normalizeComposerInput(input);
    return send({
      type: "input",
      taskId: task.id,
      data,
      source: "composer-agent",
      agentModel: selectedModel,
      agentReasoningEffort: selectedReasoningEffort,
    });
  };

  const changeSelectedModel = (model: string) => {
    setSelectedModel(model);
    const nextModel = modelOptions.find((option) => option.model === model);
    setSelectedReasoningEffort(nextModel?.defaultReasoningEffort || "");
  };

  return (
    <form className="input-composer" data-input-state={inputState} onSubmit={handleSubmit}>
      {codexAppServerRequest ? (
        <div className="codex-app-server-request-bar">
          <div className="codex-app-server-request-copy">
            <strong>{codexAppServerRequest.title}</strong>
            {codexAppServerRequest.detail ? <span title={codexAppServerRequest.detail}>{codexAppServerRequest.detail}</span> : null}
          </div>
          <div className="codex-app-server-request-actions">
            {codexAppServerRequest.canApprove ? (
              <Button
                disabled={!canResolveCodexAppServerRequest}
                onClick={() => resolveCodexAppServerRequest("approve")}
                size="sm"
                type="button"
                variant="panel"
              >
                Approve
              </Button>
            ) : null}
            {codexAppServerRequest.canDecline ? (
              <Button
                disabled={!canResolveCodexAppServerRequest}
                onClick={() => resolveCodexAppServerRequest("decline")}
                size="sm"
                type="button"
                variant="secondary"
              >
                Decline
              </Button>
            ) : null}
            {codexAppServerRequest.canCancel ? (
              <Button
                disabled={!canResolveCodexAppServerRequest}
                onClick={() => resolveCodexAppServerRequest("cancel")}
                size="sm"
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
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
          placeholder={inputPlaceholder}
          rows={1}
          spellCheck={false}
          value={value}
        />
        <div className="input-composer-footer">
          <div className="input-composer-footer-start">
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
          </div>
          <div className="input-composer-footer-end">
            {isCodexAppServerTask ? (
              <>
                <label className="composer-option-control" title={selectedModelOption?.description || "Model"}>
                  <span className="visually-hidden">Model</span>
                  <select
                    aria-label="Model for next instruction"
                    disabled={!canConfigureTurn || modelOptions.length === 0}
                    onChange={(event) => changeSelectedModel(event.target.value)}
                    value={selectedModel}
                  >
                    {modelOptions.map((model) => (
                      <option key={model.model} value={model.model}>{model.displayName}</option>
                    ))}
                  </select>
                </label>
                <label className="composer-option-control">
                  <span className="visually-hidden">Reasoning effort</span>
                  <select
                    aria-label="Reasoning effort for next instruction"
                    disabled={!canConfigureTurn || reasoningEffortOptions.length === 0}
                    onChange={(event) => setSelectedReasoningEffort(event.target.value)}
                    value={selectedReasoningEffort}
                  >
                    {reasoningEffortOptions.map((effort) => (
                      <option key={effort} value={effort}>{formatReasoningEffort(effort)}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <button
              aria-label={actionLabel}
              className="input-primary-action-button"
              data-action={isCodexAppServerTurnActive ? "stop" : "send"}
              disabled={isCodexAppServerTurnActive ? !canStopCodexAppServerTurn : !canSubmit}
              onClick={handlePrimaryAction}
              title={actionLabel}
              type="button"
            >
              {isCodexAppServerTurnActive ? (
                <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
                  <rect height="7" rx="1" width="7" x="4.5" y="4.5" />
                </svg>
              ) : (
                <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
                  <path d="M8 13V3M4 7l4-4 4 4" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

function ensureSelectedModelOption(models: CodexModel[], selectedModel: string) {
  if (!selectedModel || models.some((model) => model.model === selectedModel)) {
    return models;
  }
  return [
    {
      id: selectedModel,
      model: selectedModel,
      displayName: selectedModel,
      description: "",
      isDefault: false,
      defaultReasoningEffort: "",
      supportedReasoningEfforts: [],
    },
    ...models,
  ];
}

function getReasoningEffortOptions(model: CodexModel | null, selectedEffort: string) {
  const advertised = model?.supportedReasoningEfforts.map((option) => option.reasoningEffort) ?? [];
  const options = advertised.length > 0 ? advertised : ["", ...fallbackReasoningEfforts];
  return selectedEffort && !options.includes(selectedEffort) ? [selectedEffort, ...options] : options;
}

function formatReasoningEffort(effort: string) {
  if (!effort) return "Default";
  if (effort === "none") return "None";
  if (effort === "minimal") return "Minimal";
  if (effort === "low") return "Low";
  if (effort === "medium") return "Medium";
  if (effort === "high") return "High";
  if (effort === "xhigh") return "Extra high";
  return effort;
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

function normalizeComposerInput(input: string) {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function getComposerMode(
  task: Task | null,
  isConnected: boolean,
  {
    isCodexAppServerNeedsAttention = false,
    isCodexAppServerTurnActive = false,
  }: { isCodexAppServerNeedsAttention?: boolean; isCodexAppServerTurnActive?: boolean } = {},
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
  if (task.inputLockedAt) {
    return "Input locked";
  }
  if (isCodexAppServerNeedsAttention) {
    return "Task needs your attention";
  }
  if (isCodexAppServerTurnActive) {
    return "Codex is running";
  }
  return "Interactive task";
}

function getComposerInputState({
  task,
  isConnected,
  isUploadingAttachments,
  isCodexAppServerTurnActive,
}: {
  isConnected: boolean;
  isUploadingAttachments: boolean;
  isCodexAppServerTurnActive: boolean;
  task: Task | null;
}): ComposerInputState {
  if (!task) {
    return "empty";
  }
  if (!isConnected) {
    return "disconnected";
  }
  if (task.inputLockedAt) {
    return "locked";
  }
  if (isUploadingAttachments || isCodexAppServerTurnActive) {
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
