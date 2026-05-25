export type TaskStatus = "idle" | "running" | "succeeded" | "failed" | "interrupted";

export type TaskRisk = {
  level: "unknown" | "low" | "medium" | "high";
  reasons: string[];
};

export type Task = {
  id: string;
  title: string;
  command: string;
  cwd: string;
  status: TaskStatus;
  risk: TaskRisk;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: number | string | null;
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
};

export type TaskPreset = CreateTaskInput;
