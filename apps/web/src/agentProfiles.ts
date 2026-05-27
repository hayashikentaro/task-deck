export type AgentProfile = {
  id: string;
  label: string;
  command: string;
  description: string;
};

export const agentProfiles: AgentProfile[] = [
  {
    id: "codex",
    label: "Codex CLI",
    command: "codex",
    description: "High-quality cloud coding agent",
  },
  {
    id: "goose",
    label: "Goose",
    command: "goose",
    description: "Local/alternative agent option",
  },
  {
    id: "aider",
    label: "aider",
    command: "aider",
    description: "Git-aware coding assistant",
  },
  {
    id: "shell-zsh",
    label: "zsh",
    command: "zsh",
    description: "Interactive shell fallback",
  },
  {
    id: "custom",
    label: "Custom command",
    command: "",
    description: "Run a custom PTY command",
  },
];

