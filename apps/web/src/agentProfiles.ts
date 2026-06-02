import type { AgentProfile } from "./types";

export const defaultAgentProfiles: AgentProfile[] = [
  {
    id: "codex",
    label: "Codex CLI",
    command: "docker start ai-agent-sandbox-agent-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-agent-1 sh -lc 'TERM=xterm-256color codex'",
    description: "Run Codex CLI inside the AI agent sandbox container",
    diagnosticContainer: "ai-agent-sandbox-agent-1",
    diagnosticWorkspace: "/workspace",
    modelOptions: [
      { id: "default", label: "Default" },
      { id: "gpt-5.5", label: "gpt-5.5" },
      { id: "gpt-5.5-thinking", label: "gpt-5.5 Thinking" },
    ],
    runtimeModelSwitchCommand: "/model {model}",
  },
  {
    id: "goose",
    label: "Goose",
    command: "docker start ai-agent-sandbox-agent-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-agent-1 goose",
    description: "Run Goose inside the AI agent sandbox container",
    diagnosticContainer: "ai-agent-sandbox-agent-1",
    diagnosticWorkspace: "/workspace",
  },
  {
    id: "zsh",
    label: "zsh",
    command: "docker start ai-agent-sandbox-agent-1 >/dev/null && docker exec -it -w /workspace ai-agent-sandbox-agent-1 sh -lc 'exec zsh || exec bash || exec sh'",
    description: "Plain interactive zsh shell",
    diagnosticContainer: "ai-agent-sandbox-agent-1",
    diagnosticWorkspace: "/workspace",
  },
];
