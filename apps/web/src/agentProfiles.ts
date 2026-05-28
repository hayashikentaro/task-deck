import type { AgentProfile } from "./types";

export const defaultAgentProfiles: AgentProfile[] = [
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
    id: "goose-container",
    label: "Goose Container",
    command: "docker exec -it chrome-goose-1 bash",
    description: "Enter the existing chrome-goose-1 shell; run goose inside the container when needed",
    diagnosticContainer: "chrome-goose-1",
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
