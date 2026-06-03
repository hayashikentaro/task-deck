# TaskDeck Architecture

This document is a navigation map for contributors and AI-agent sessions. It describes the current shape of the project and likely refactoring boundaries, but it is not a request to refactor code.

## Product Invariant

TaskDeck is a task-centric supervision UI for AI-agent work. It is not a chatbot UI, and it is not merely a prettier terminal.

The primary operator question is whether each task needs attention now. The UI should preserve `Needs you` / `Not now` as the main supervision lens, with terminal interaction, logs, diffs, diagnostics, and saved sessions supporting that task-level view.

## Repository Map

- `apps/server`: Node/Express backend, PTY orchestration, REST API, WebSocket updates, config loading, task persistence, diagnostics, Codex status refresh, saved-session discovery, and supervision heuristics.
- `apps/web`: React/Vite frontend for task cards, terminal rendering, task creation, Codex usage, tools, diagnostics, composer input, and API/WebSocket state handling.
- `packages/core`: Shared task-state primitives and task serialization helpers used by server and web code.
- `.taskdeck/`: Ignored local runtime state. It stores persisted tasks, logs, presets, session labels, attachments, and other local data that may be sensitive.
- Config files: `taskdeck.config.json` is committed default config; ignored `taskdeck.local.json`, `TASKDECK_CONFIG`, `TASKDECK_PROJECT_ROOT`, and `TASKDECK_PROJECT_ROOTS` carry machine-local overrides. `taskdeck.local.example.json` is the public example for local setup.

## Runtime Data Flow

1. The web app loads `/api/context`, `/api/tasks`, saved sessions, presets, diagnostics, and opens the WebSocket.
2. The New Agent Session form creates a task from an agent profile, session mode, selected project, permission level, and optional saved-session resume command.
3. The server launches the selected command in a PTY, stores task metadata, and begins streaming PTY output.
4. PTY output is appended to bounded in-memory and persisted logs, broadcast over WebSocket, and rendered by xterm.js in the terminal pane.
5. Server-side activity observations and adapter-specific TUI fallbacks update `agentState` and `attentionState` without treating silence as thinking.
6. Task, log, preset, session-label, and attachment state is persisted under `.taskdeck/`.
7. UI state updates from REST responses and WebSocket messages keep the task list, selected task, terminal output, composer availability, Codex usage panel, tools, and diagnostics in sync.

## Domain Concepts

- Task: The central supervision unit. It owns process status, command/cwd, agent profile metadata, session metadata, attachments, logs, risk, `agentState`, `attentionState`, and timing.
- Agent profile: A configured launch profile such as Codex, Goose, zsh, or another Docker-backed command. Profiles merge from built-in defaults, committed config, ignored local config, and `TASKDECK_CONFIG`.
- Session mode: How an agent starts, such as new session, resume last, or resume saved.
- Attention state: The primary operator signal for `Needs you` / `Not now`. It should remain conservative and false-positive tolerant.
- Agent state: A process/supervision state such as starting, working, waiting input, review ready, done, or failed. It is related to but not identical to attention.
- Saved session: Best-effort Codex session metadata derived from TaskDeck task records and available container-side Codex session storage. It is not a guaranteed Codex internal registry.
- Project root / project suggestion: `projectRoot` means a parent directory whose immediate child directories become Project choices. With no configured project root, TaskDeck falls back to the TaskDeck repo itself as the selectable project.
- Diagnostics: Server/UI checks for Docker reachability, configured containers, configured container workspaces, and related local setup.

## Where To Change What

- Project dropdown / project roots: `apps/server/src/server.js` functions around `resolveProjectRoots`, `buildProjectSuggestions`, `selectDefaultProjectCwd`, and web form handling in `apps/web/src/components/TaskCreateForm.tsx`.
- Config loading: `apps/server/src/server.js` config candidate loading and profile/project-root normalization.
- Agent profiles: Built-in profile definitions and profile merge/sanitize logic in `apps/server/src/server.js`; frontend profile types in `apps/web/src/types.ts`; launch-command shaping in `TaskCreateForm.tsx` and `apps/web/src/codexPermissions.ts`.
- PTY lifecycle and input/output: Task creation, PTY spawn, resize, queued input, log append, and WebSocket output handling in `apps/server/src/server.js`; terminal rendering in `TerminalPane.tsx`; composer behavior in `InputComposer.tsx`.
- Attention/supervision logic: Adapter selection, process/activity observation, explicit TUI prompt fallback, quiet timers, and task state marking in `apps/server/src/server.js`; task-card display in `apps/web/src/components/TaskList.tsx`.
- Terminal UI: `apps/web/src/components/TerminalPane.tsx`, `InputComposer.tsx`, related terminal/composer CSS in `apps/web/src/styles.css`.
- Saved sessions: Codex session detection, resume command construction, session label storage, `/api/agent-sessions`, and saved-session picker behavior in `apps/server/src/server.js` and `TaskCreateForm.tsx`.
- Diagnostics: `/api/diagnostics`, container inspection/start helpers, and diagnostics UI components in `apps/server/src/server.js` and the web diagnostics/tool panes.

## Refactoring Seams

`apps/server/src/server.js` currently mixes many responsibilities. Good future extraction candidates include:

- `config`: Config file discovery, project-root normalization, profile merging, and profile sanitization.
- `profiles`: Built-in agent profile definitions, Codex permission command shaping, Docker workdir correction, and profile diagnostics metadata.
- `tasks`: Task persistence, task mutation helpers, task cleanup, presets, and attachment persistence.
- `pty`: PTY spawn/resize/input queue/output stream/log append lifecycle.
- `supervision`: Activity tracking, adapter selection, attention/agent-state inference, quiet timers, and explicit TUI prompt fallback.
- `codex-sessions`: Codex session id detection, container session storage reading, saved-session API, resume-command construction, and session labels.
- `diagnostics`: Docker reachability, container inspection/start, and workspace checks.
- `codex-usage`: Hidden Codex usage refresh, status parsing, bounded debug output, and refresh errors.
- `api`: Express route registration separated from business logic.

Frontend seams are smaller but still visible:

- Task creation and launch command construction can be isolated from `TaskCreateForm.tsx`.
- Terminal observation helpers can be extracted from `TerminalPane.tsx` when they grow.
- Task-card supervision display can stay separate from lower-level task metadata details.

## Architecture Cautions

- `projectRoot` is a parent directory whose children are project choices. Do not set it to the TaskDeck repo just to make the current repo appear.
- Do not make `defaultAgentProfiles` empty as a shortcut to public-safety; that silently removes the built-in Agent options.
- Preserve persisted task compatibility when changing task metadata, saved-session fields, resume commands, or state names.
- Do not infer thinking from silence. Quiet running PTYs should keep their last supervisor state until a stronger signal appears.
- Keep adapter-specific behavior isolated for Codex, Goose, and generic agents; do not tune one agent by adding one-off phrases to a shared path.
- Treat PTY output parsing as a fallback for explicit user-action prompts, not a stable protocol.
- Keep hidden/background status or diagnostics output out of visible task logs unless the user explicitly starts that task.
