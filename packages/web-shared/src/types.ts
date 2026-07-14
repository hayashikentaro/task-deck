export type TaskStatus = "idle" | "running" | "succeeded" | "failed" | "interrupted" | "closed";
export type AgentState =
  | "starting"
  | "ready"
  | "thinking"
  | "working"
  | "waiting_input"
  | "waiting_approval"
  | "review_ready"
  | "done"
  | "failed"
  | "stopped";
export type AttentionState =
  | "none"
  | "may_need_user"
  | "needs_input"
  | "needs_approval"
  | "review_ready"
  | "failed";

export type TaskRisk = {
  level: "unknown" | "low" | "medium" | "high";
  reasons: string[];
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
  taskOrderIndex?: number | null;
  title: string;
  sessionLabel?: string;
  command: string;
  cwd: string;
  agentProfileId?: string;
  agentLabel?: string;
  agentModel?: string;
  agentReasoningEffort?: string;
  sessionMode?: string;
  agentSessionSource?: string;
  identityColorSlot?: number;
  status: TaskStatus;
  agentState: AgentState;
  agentStateReason?: string;
  attentionState?: AttentionState;
  attentionStateReason?: string;
  inputLockedAt?: string | null;
  risk: TaskRisk;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: number | string | null;
  initialInstruction?: string;
  codexAppServerRequest?: CodexAppServerRequest | null;
  codexAppServerTurnActive?: boolean;
  decisionLeases?: Array<{ status: string }>;
  decisionResults?: Array<{ validationStatus?: string; actionType?: string; receivedAt?: string }>;
};

export type OutputEvent = {
  seq: number;
  taskId: string;
  data: string;
  serverSeq?: number;
  taskSeq?: number;
  role?: "user" | "assistant" | "taskdeck";
  kind?: string;
};

export type CreateTaskInput = {
  title: string;
  command: string;
  cwd: string;
  agentProfileId?: string;
  agentLabel?: string;
  agentModel?: string;
  sessionMode?: string;
  teamTemplateId?: string;
};

export type AgentProfile = {
  id: string;
  label: string;
  command: string;
  description: string;
};

export type TeamTemplate = {
  id: string;
  label: string;
  description?: string;
  agentProfileId: string;
  teamId: string;
  roleId: string;
};

export type ProjectSuggestion = {
  label: string;
  path: string;
  isGitRepo?: boolean;
};

export type TaskDeckContext = {
  defaultCwd: string;
  defaultModel?: string;
  isGitRepo?: boolean;
  projectSuggestions?: ProjectSuggestion[];
  agentProfiles: AgentProfile[];
  teamTemplates?: TeamTemplate[];
};
