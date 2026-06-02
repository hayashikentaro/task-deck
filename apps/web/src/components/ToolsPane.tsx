import { useMemo, useState } from "react";
import { defaultAgentProfiles } from "../agentProfiles";
import type { AgentProfile, CreateTaskInput, ModelOption, Task, TaskDeckContext } from "../types";

type ToolsPaneProps = {
  context: TaskDeckContext | null;
  isConnected: boolean;
  selectedTask: Task | null;
  canCopyLog: boolean;
  onCreateTask: (input: CreateTaskInput) => boolean;
  onCopyLog: () => void;
  onApplyModel: (taskId: string, model: string) => boolean;
};

const codexFallbackModelOptions: ModelOption[] = [
  { id: "default", label: "Default" },
  { id: "gpt-5.5", label: "gpt-5.5" },
  { id: "gpt-5.5-thinking", label: "gpt-5.5 Thinking" },
  { id: "gpt-5.4-codex", label: "gpt-5.4 Codex" },
];

export function ToolsPane({
  context,
  isConnected,
  selectedTask,
  canCopyLog,
  onCreateTask,
  onCopyLog,
  onApplyModel,
}: ToolsPaneProps) {
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isRestartConfirmOpen, setIsRestartConfirmOpen] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const codexContainers = useMemo(() => getCodexToolContainers(context), [context]);
  const selectedTaskProfile = useMemo(() => findAgentProfileForTask(context, selectedTask), [context, selectedTask]);
  const modelOptions = useMemo(
    () => modelOptionsForTask(selectedTask, selectedTaskProfile).filter((option) => option.id !== "default"),
    [selectedTask, selectedTaskProfile],
  );
  const canSwitchModel = Boolean(
    isConnected &&
      selectedTask?.status === "running" &&
      runtimeModelSwitchCommandForTask(selectedTask, selectedTaskProfile) &&
      modelOptions.length > 0,
  );

  const openDirectInput = () => {
    const directInputUrl = new URL(window.location.href);
    directInputUrl.searchParams.set("directInput", "1");
    window.open(directInputUrl.toString(), "_blank", "noopener,noreferrer");
  };

  const startCodexAuthTask = (containerName: string, action: "logout" | "device-login") => {
    const isDeviceLogin = action === "device-login";
    const command = buildCodexAuthCommand(containerName, isDeviceLogin ? "codex login --device-auth" : "codex logout");
    const didStart = onCreateTask({
      title: isDeviceLogin ? "Codex device login" : "Codex logout",
      command,
      cwd: "",
      agentProfileId: "codex-auth",
      agentLabel: "Codex auth",
      sessionMode: "diagnostic",
      initialInstruction: "",
    });
    setStatusMessage(
      didStart
        ? `Started ${isDeviceLogin ? "Codex device login" : "Codex logout"} in ${containerName}.`
        : "TaskDeck is not connected.",
    );
    setErrorMessage("");
  };

  const applyModel = (model: string) => {
    if (!selectedTask || !canSwitchModel) {
      return;
    }
    const didSend = onApplyModel(selectedTask.id, model);
    setStatusMessage(didSend ? `Switching model to ${model}.` : "TaskDeck is not connected.");
    setErrorMessage("");
  };

  const requestRestart = async () => {
    setIsRestarting(true);
    setStatusMessage("Restarting TaskDeck...");
    setErrorMessage("");

    try {
      const response = await fetch("/api/server/restart", { method: "POST" });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to restart TaskDeck.");
      }
      setIsRestartConfirmOpen(false);
      setStatusMessage(payload.message || "Restarting TaskDeck...");
      setIsRestarting(false);
    } catch (error) {
      setStatusMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to restart TaskDeck.");
      setIsRestarting(false);
    }
  };

  return (
    <section className="tools-panel" aria-label="Tools">
      <div className="pane-heading">
        <h2>Tools</h2>
      </div>
      <div className="tools-body">
        <div className="tool-section" aria-labelledby="tools-terminal-title">
          <h3 id="tools-terminal-title">Terminal</h3>
          <div className="tool-action-group" data-layout="single">
            <button type="button" onClick={openDirectInput}>
              Open Direct Input
            </button>
          </div>
        </div>
        <div className="tool-section" aria-labelledby="tools-account-title">
          <h3 id="tools-account-title">Account</h3>
          <div className="tool-actions" aria-label="Codex auth actions">
            {codexContainers.map((containerName) => (
              <div className="tool-action-group" data-layout="single" key={containerName}>
                <button
                  disabled={!isConnected}
                  type="button"
                  onClick={() => startCodexAuthTask(containerName, "device-login")}
                >
                  Codex login
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="tool-section" aria-labelledby="tools-model-title">
          <h3 id="tools-model-title">Switch model</h3>
          <div className="tool-action-group" data-layout="single">
            {modelOptions.map((modelOption) => (
              <button
                aria-label={`Switch model to ${modelOption.label}`}
                disabled={!canSwitchModel}
                key={modelOption.id}
                title={`Switch model to ${modelOption.label}`}
                type="button"
                onClick={() => applyModel(modelOption.id)}
              >
                {modelOption.label}
              </button>
            ))}
          </div>
          <p className="tool-hint">
            {canSwitchModel ? "Sends TaskDeck's model-switch action to the selected task." : "Select a running Codex task to switch models."}
          </p>
        </div>
        <div className="tool-section" aria-labelledby="tools-log-title">
          <h3 id="tools-log-title">Log</h3>
          <div className="tool-action-group" data-layout="single">
            <button disabled={!canCopyLog} type="button" onClick={onCopyLog}>
              Copy log
            </button>
          </div>
        </div>
        <div className="tool-section" aria-labelledby="tools-system-title">
          <h3 id="tools-system-title">System</h3>
          <div className="tool-action-group" data-layout="single">
            <button disabled={!isConnected || isRestarting} type="button" onClick={() => setIsRestartConfirmOpen(true)}>
              Restart TaskDeck
            </button>
          </div>
        </div>
        {statusMessage ? <p className="tool-status">{statusMessage}</p> : null}
        {errorMessage ? <p className="tool-status" data-tone="error">{errorMessage}</p> : null}
      </div>
      {isRestartConfirmOpen ? (
        <div aria-labelledby="restart-taskdeck-title" aria-modal="true" className="modal-backdrop" role="dialog">
          <div className="confirmation-modal">
            <h3 id="restart-taskdeck-title">Restart TaskDeck?</h3>
            <p>
              Restarting TaskDeck will restart the backend server. Active PTY sessions such as Codex, Goose, or zsh may
              be interrupted.
            </p>
            <div className="confirmation-actions">
              <button
                data-priority="secondary"
                disabled={isRestarting}
                onClick={() => setIsRestartConfirmOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button data-priority="danger" disabled={isRestarting} onClick={requestRestart} type="button">
                Restart TaskDeck
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function getCodexToolContainers(context: TaskDeckContext | null) {
  const agentProfiles = context?.agentProfiles.length ? context.agentProfiles : defaultAgentProfiles;
  return Array.from(
    new Set(
      agentProfiles
        .filter((profile) => isCodexProfile(profile))
        .map((profile) => profile.diagnosticContainer?.trim())
        .filter((containerName): containerName is string => Boolean(containerName)),
    ),
  );
}

function findAgentProfileForTask(context: TaskDeckContext | null, task: Task | null) {
  if (!task) {
    return null;
  }
  const agentProfiles = context?.agentProfiles.length ? context.agentProfiles : defaultAgentProfiles;
  return (
    agentProfiles.find((profile) => profile.id === task.agentProfileId) ??
    agentProfiles.find((profile) => profile.label === task.agentLabel) ??
    null
  );
}

function modelOptionsForTask(task: Task | null, profile: AgentProfile | null) {
  const configuredOptions = profile?.modelOptions?.filter((option) => option.id && option.label) ?? [];
  if (configuredOptions.length > 0) {
    return configuredOptions;
  }
  return task && isCodexRuntimeSwitchTask(task, profile) ? codexFallbackModelOptions : [];
}

function runtimeModelSwitchCommandForTask(task: Task | null, profile: AgentProfile | null) {
  const configuredCommand = profile?.runtimeModelSwitchCommand?.trim() ?? "";
  if (configuredCommand) {
    return configuredCommand;
  }
  return task && isCodexRuntimeSwitchTask(task, profile) ? "/model {model}" : "";
}

function isCodexRuntimeSwitchTask(task: Task, profile: AgentProfile | null) {
  const haystack = `${profile?.id || ""} ${profile?.label || ""} ${task.agentProfileId || ""} ${task.agentLabel || ""} ${task.command}`.toLowerCase();
  return /\bcodex\b/.test(haystack);
}

function isCodexProfile(profile: AgentProfile) {
  return (
    profile.id.includes("codex") ||
    profile.label.toLowerCase().includes("codex") ||
    /\bcodex\b/.test(profile.command)
  );
}

function buildCodexAuthCommand(containerName: string, codexCommand: string) {
  const quotedContainerName = shellQuote(containerName);
  return `docker start ${quotedContainerName} >/dev/null && docker exec -it -w /workspace ${quotedContainerName} sh -lc ${shellQuote(codexCommand)}`;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
