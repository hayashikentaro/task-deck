import type { AgentProfile } from "./types";

export const defaultAgentProfiles: AgentProfile[] = [
  {
    id: "codex",
    label: "Codex CLI",
    command: "docker start ai-agent-sandbox-codex-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-codex-1 codex",
    description: "Run Codex CLI inside the AI agent sandbox container",
    diagnosticContainer: "ai-agent-sandbox-codex-1",
    diagnosticWorkspace: "/workspace",
  },
  {
    id: "goose",
    label: "Goose",
    command: "docker start ai-agent-sandbox-codex-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-codex-1 goose",
    description: "Run Goose inside the AI agent sandbox container",
    diagnosticContainer: "ai-agent-sandbox-codex-1",
    diagnosticWorkspace: "/workspace",
  },
];
