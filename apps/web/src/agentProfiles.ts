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
