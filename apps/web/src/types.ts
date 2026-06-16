export type TaskStatus = "idle" | "running" | "succeeded" | "failed" | "interrupted" | "closed";
export type AgentState =
  | "starting"
  | "thinking"
  | "working"
  | "waiting_input"
  | "waiting_approval"
  | "review_ready"
  | "done"
  | "failed"
  | "stopped";

export type AgentStateSource = "taskdeck_event" | "tui_fallback" | "process" | "manual" | "child_status" | "";
export type AgentStateConfidence = "high" | "medium" | "low" | "";
export type AttentionStateSource = AgentStateSource;
export type AttentionStateConfidence = AgentStateConfidence;
export type AttentionState =
  | "none"
  | "may_need_user"
  | "needs_input"
  | "needs_approval"
  | "review_ready"
  | "failed";
export type ChildReportedState = "working" | "blocked" | "ready_for_review" | "done" | "failed";

export type TaskRisk = {
  level: "unknown" | "low" | "medium" | "high";
  reasons: string[];
};

export type TaskAttachment = {
  id: string;
  type: "image";
  filename: string;
  path: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

export type PendingTaskAttachment = TaskAttachment & {
  pending?: boolean;
};

export type CodexAppServerRequest = {
  id: string | number;
  method: string;
  kind: "approval" | "user_input" | "elicitation";
  title: string;
  detail?: string;
  canApprove: boolean;
  canDecline: boolean;
  canCancel: boolean;
};

export type Task = {
  id: string;
  title: string;
  sessionLabel?: string;
  command: string;
  cwd: string;
  agentProfileId?: string;
  agentLabel?: string;
  agentModel?: string;
  sessionMode?: string;
  resumeCommand?: string;
  agentSessionId?: string;
  agentSessionSource?: string;
  agentSessionProvider?: string;
  agentSessionDetectedAt?: string;
  agentSessionResumeCommand?: string;
  parentSessionId?: string;
  spawnedFromParentRequest?: boolean;
  workPackageId?: string;
  filesLikelyToChange?: string[];
  childStatusFile?: string;
  childReportedState?: ChildReportedState | "";
  childStatusSummary?: string;
  childStatusArtifacts?: string[];
  childStatusDetailsFile?: string;
  childStatusUpdatedAt?: string;
  childStatusError?: string;
  isManager?: boolean;
  identityColorSlot?: number;
  status: TaskStatus;
  agentState: AgentState;
  agentStateReason?: string;
  agentStateSource?: AgentStateSource;
  agentStateConfidence?: AgentStateConfidence;
  attentionState?: AttentionState;
  attentionStateReason?: string;
  attentionStateSource?: AttentionStateSource;
  attentionStateConfidence?: AttentionStateConfidence;
  attentionAcknowledgedAt?: string | null;
  reviewedAt?: string | null;
  reviewedByTaskId?: string;
  closedAt?: string | null;
  closedByTaskId?: string;
  terminalInputLockedAt?: string | null;
  risk: TaskRisk;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: number | string | null;
  initialInstruction?: string;
  attachments?: TaskAttachment[];
  codexAppServerRequest?: CodexAppServerRequest | null;
};

export type OutputEvent = {
  seq: number;
  taskId: string;
  data: string;
};

export type CreateTaskInput = {
  title: string;
  command: string;
  cwd: string;
  agentProfileId?: string;
  agentLabel?: string;
  agentModel?: string;
  sessionMode?: string;
  resumeCommand?: string;
  agentSessionProvider?: string;
  agentSessionId?: string;
  agentSessionSource?: string;
  agentSessionDetectedAt?: string;
  agentSessionResumeCommand?: string;
  parentSessionId?: string;
  spawnedFromParentRequest?: boolean;
  childSessionRequestKey?: string;
  workPackageId?: string;
  filesLikelyToChange?: string[];
  initialInstruction?: string;
  attachments?: PendingTaskAttachment[];
};

export type TaskPreset = CreateTaskInput;

export type ModelOption = {
  id: string;
  label: string;
};

export type AgentProfile = {
  id: string;
  label: string;
  command: string;
  description: string;
  diagnosticContainer?: string;
  diagnosticWorkspace?: string;
  modelOptions?: ModelOption[];
};

export type AgentProfileConfigSummary = {
  source: string;
  path: string;
  message: string;
};

export type CwdSuggestion = {
  label: string;
  path: string;
  value: string;
};

export type ProjectSuggestion = {
  label: string;
  path: string;
  isGitRepo: boolean;
};

export type TaskDeckContext = {
  repoRoot: string;
  controlRoot: string;
  dataRoot: string;
  projectRoot?: string;
  defaultCwd: string;
  serverCwd: string;
  shell: string;
  pathSeparator: string;
  isGitRepo: boolean;
  cwdSuggestions: CwdSuggestion[];
  projectRoots?: string[];
  projectSuggestions?: ProjectSuggestion[];
  agentProfiles: AgentProfile[];
  agentProfileConfig?: AgentProfileConfigSummary;
};

export type CwdValidation = {
  ok: boolean;
  inputCwd: string;
  resolvedCwd: string;
  exists: boolean;
  isDirectory: boolean;
  isGitRepo: boolean;
  message: string;
};
