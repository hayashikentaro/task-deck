export type TaskStatus = "idle" | "running" | "succeeded" | "failed" | "interrupted";
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

export type AgentStateSource = "taskdeck_event" | "tui_fallback" | "process" | "manual" | "";
export type AgentStateConfidence = "high" | "medium" | "low" | "";
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

export type Task = {
  id: string;
  title: string;
  command: string;
  cwd: string;
  agentProfileId?: string;
  agentLabel?: string;
  sessionMode?: string;
  resumeCommand?: string;
  agentSessionId?: string;
  agentSessionSource?: string;
  agentSessionProvider?: string;
  agentSessionDetectedAt?: string;
  agentSessionResumeCommand?: string;
  status: TaskStatus;
  agentState: AgentState;
  agentStateReason?: string;
  agentStateSource?: AgentStateSource;
  agentStateConfidence?: AgentStateConfidence;
  attentionState?: AttentionState;
  attentionStateReason?: string;
  risk: TaskRisk;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: number | string | null;
  initialInstruction?: string;
};

export type SavedCodexSession = {
  key: string;
  provider: string;
  sessionId: string;
  source?: string;
  resumeCommand: string;
  title: string;
  cwd: string;
  agentProfileId?: string;
  agentLabel?: string;
  commandEnvironment?: string;
  detectedAt?: string;
  updatedAt: string;
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
  sessionMode?: string;
  resumeCommand?: string;
  agentSessionProvider?: string;
  agentSessionId?: string;
  agentSessionSource?: string;
  agentSessionDetectedAt?: string;
  agentSessionResumeCommand?: string;
  initialInstruction?: string;
};

export type TaskPreset = CreateTaskInput;

export type AgentProfile = {
  id: string;
  label: string;
  command: string;
  description: string;
  diagnosticContainer?: string;
  diagnosticWorkspace?: string;
};

export type DiagnosticWorkspace = {
  path: string;
  exists: boolean;
  status: string;
  error?: string;
};

export type DiagnosticContainer = {
  name: string;
  present: boolean;
  running: boolean;
  status: string;
  image: string;
  workspaces?: DiagnosticWorkspace[];
  error?: string;
};

export type AgentProfileConfigSummary = {
  source: string;
  path: string;
  message: string;
};

export type TaskDeckDiagnostics = {
  checkedAt: string;
  config: AgentProfileConfigSummary;
  docker: {
    ok: boolean;
    message: string;
    version?: string;
  };
  containers: DiagnosticContainer[];
};

export type CwdSuggestion = {
  label: string;
  path: string;
  value: string;
};

export type TaskDeckContext = {
  repoRoot: string;
  defaultCwd: string;
  serverCwd: string;
  shell: string;
  pathSeparator: string;
  isGitRepo: boolean;
  cwdSuggestions: CwdSuggestion[];
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
