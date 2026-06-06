# TaskDeck Architecture

This document is a navigation map for contributors and AI-agent sessions. It describes the current shape of the project and likely refactoring boundaries, but it is not a request to refactor code.

## Product Invariant

TaskDeck is a task-centric supervision UI for AI-agent work. It is not a chatbot UI, and it is not merely a prettier terminal.

In the current session-identity-first card design, the primary card-level visual question is which task maps to the terminal/session the operator is viewing or about to resume. `Needs you` / `Not now` remains the primary supervision signal for sorting, badges, and action prompts, but it should not dominate the whole card surface or compete with stable task/session identity as a full-card color system.

## Repository Map

- `apps/server`: Node/Express backend, PTY orchestration, REST API, WebSocket updates, config loading, task persistence, diagnostics, Codex status refresh, saved-session discovery, and supervision heuristics.
- `apps/web`: React/Vite frontend for task cards, terminal rendering, task creation, Codex usage, tools, diagnostics, composer input, and API/WebSocket state handling.
- `packages/core`: Shared task-state primitives and task serialization helpers used by server and web code.
- `.taskdeck/`: Ignored local runtime state. It stores persisted tasks, logs, presets, session labels, attachments, and other local data that may be sensitive.
- Config files: `taskdeck.config.json` is committed config and currently still contains default agent profile assumptions; ignored `taskdeck.local.json`, `TASKDECK_CONFIG`, `TASKDECK_PROJECT_ROOT`, and `TASKDECK_PROJECT_ROOTS` carry machine-local overrides. `taskdeck.local.example.json` is the public example for local setup.

## Runtime Data Flow

1. The web app loads `/api/context` and saved sessions, opens the WebSocket, and receives task snapshots and output updates over WebSocket.
2. The New Agent Session form creates a task from an agent profile, session mode, selected project, permission level, and optional saved-session resume command.
3. The server launches the selected command in a PTY, stores task metadata, and begins streaming PTY output.
4. PTY output is appended to bounded in-memory and persisted logs, broadcast over WebSocket, and rendered by xterm.js in the terminal pane.
5. Server-side activity observations and adapter-specific TUI fallbacks update `agentState` and `attentionState` without treating silence as thinking.
6. Task, log, preset, session-label, and attachment state is persisted under `.taskdeck/`.
7. Focused REST calls handle actions such as Codex usage refresh, task/session renaming, log reload, attachments, and diagnostics queries when a UI path calls them.
8. UI state updates from REST responses and WebSocket messages keep the task list, selected task, terminal output, composer availability, Codex usage panel, and tools in sync.

## Runtime State

The server persists local runtime state under `.taskdeck/`, which is intentionally ignored by Git:

```text
.taskdeck/
  tasks.json
  session-labels.json
  presets.json
  attachments/
    <taskId>/
      <attachmentId>.png
  logs/
    <taskId>.log
```

`.taskdeck/` may contain sensitive task metadata, logs, session labels, attachments, and agent output. Do not commit or share it.

## Domain Concepts

- Task: The central supervision unit. It owns process status, command/cwd, agent profile metadata, session metadata, attachments, logs, risk, `agentState`, `attentionState`, and timing.
- Agent profile: A configured launch profile such as Codex, Goose, zsh, or another Docker-backed command. Profiles merge from built-in defaults, committed config, ignored local config, and `TASKDECK_CONFIG`.
- Session mode: How an agent starts, such as new session, resume last, or resume saved.
- Attention state: The primary operator signal for `Needs you` / `Not now`. It should remain conservative and false-positive tolerant.
- Agent state: A process/supervision state such as starting, working, waiting input, review ready, done, or failed. It is related to but not identical to attention.
- Saved session: Best-effort Codex session metadata derived from TaskDeck task records and available container-side Codex session storage. It is not a guaranteed Codex internal registry.
- Project root / project suggestion: `projectRoot` means a parent directory whose immediate child directories become Project choices. With no configured project root, TaskDeck falls back to the TaskDeck repo itself as the selectable project.
- Diagnostics: Server-side checks for Docker reachability, configured containers, configured container workspaces, and related local setup. There is not currently a dedicated web diagnostics pane.

## Task And Session Behavior

Multiple tasks can exist in the task list, and multiple PTY-backed agent sessions can run at the same time. Bulk clearing removes non-running tasks and their logs while preserving active tasks. Clearing an individual running task stops its PTY and removes that task.

Tasks carry a low-level process `status`, a supervisor-facing `agentState`, and a primary `attentionState` that answers whether the operator should look at the task now. `attentionState` can be `none`, `may_need_user`, `needs_input`, `needs_approval`, `review_ready`, or `failed`, with source/confidence/reason metadata. TaskDeck intentionally prefers false positives over false negatives for attention: input-like prompts that are not yet stable, quiet running PTYs, and working tasks whose PTY activity has stopped become `may_need_user` rather than staying invisible.

Agent state also carries lightweight `agentStateReason`, `agentStateSource`, and `agentStateConfidence` metadata so operators can distinguish TaskDeck-owned events from heuristic TUI fallback. TaskDeck treats its own lifecycle events as the primary state source: session start, user input, PTY output activity, and process exit. Plain PTY output is a reliable process observation but only a medium-confidence inference of `working`. Silence does not imply thinking, but it may need user attention.

Task creation is centered on starting an AI agent session in a selected workspace. The New Agent Session form selects Agent, Codex permissions, Project, and Session; instructions are sent after launch from the terminal composer. Task records preserve the selected agent profile, session mode, detected session id/provider/source/timestamp when available, generated session resume command, and resume command when provided.

For Codex profiles, the Session selector offers a new session, recent saved Codex sessions detected from prior tasks, then the fallback `codex resume --last`. Full automatic saved-session discovery is not implemented yet, but TaskDeck does a first-pass Codex session id detection from explicit `codex resume <id>` commands and from recognizable session/conversation id text in task output. Detected Codex sessions become available through the existing Resume saved action by filling `resumeCommand` when it is empty or still points at imprecise resume-last behavior, and through the New Agent Session saved-session picker.

Completed and other non-running tasks can be rerun from the expanded selected task card. Rerun starts a new task with the same title, command, and cwd, leaving the original task record and log intact.

Expanded task cards can also resume agent sessions. Tasks with a saved `resumeCommand` show a Resume saved action that starts a new task in the same cwd without replaying the original initial instruction. Older Codex tasks without saved resume metadata show a lower-priority Resume last action with an inline confirmation because it targets the latest Codex session, not necessarily the selected task. Resume-last tasks are titled `Resume last: ...`. When a resume action is available, the expanded card previews the exact command that will be launched.

## UI Organization

The UI is organized around task cards that help operators keep the left-rail task list matched to the center terminal and persisted log view. Stable task/session identity is the primary card-level visual layer, while `Needs you` / `Not now` remains visible through sorting, badges, filters, and acknowledgement controls. The right rail launches new agent sessions, and the composer stays attached to the terminal.

Expanded task cards show command, cwd, process status, exit code, timing, initial instruction when available, and compact diff status. The former top summary strip and right-side task-state panel are intentionally folded into the card model.

The terminal pane keeps xterm.js as the renderer while adding operator controls for follow mode, clearing the current view, reloading persisted logs, copying the bounded visible log buffer, and counting simple search matches. The xterm surface fits the visible terminal viewport; composer height changes should resize the terminal viewport and preserve bottom-follow state instead of relying on an oversized hidden terminal surface.

Terminal input is sent through the fixed bottom composer. It targets the selected running PTY and stays disabled for read-only logs, disconnected sessions, or no selected task. The composer supports multi-line instructions. Enter sends, Shift+Enter inserts a newline, Cmd/Ctrl+Enter sends, and IME composition is preserved for Japanese input. Single-line slash commands are sent as raw terminal input plus Enter so the underlying TUI can parse commands it actually supports, such as `/help` when available. TaskDeck only passes these commands through; it does not add support for slash commands the CLI does not expose. Normal composer instructions submit with bracketed paste followed by terminal Enter (`\r`) so Codex-style TUIs receive even one-line text as a committed instruction. Codex task input is briefly queued during startup so early instructions are not swallowed while the CLI is booting.

Terminal input locking blocks new input without foregrounding the task in the task list. Unlocking a running task is an operator attention action: the UI selects that task and refreshes its activity timestamp so it moves up within its current supervision bucket.

## Agent State Inference

Process and task lifecycle states are the reliable base layer: process start, user input sent through TaskDeck, PTY output observed from the child process, and process exit. User input is a TaskDeck-owned event, and process exit is a process-owned event.

TUI text is not a stable protocol. TUI fallback should only detect explicit user-action prompts such as approval requested, input requested, or review-ready hints. Approval prompts win immediately, but input prompts are only stabilized when the PTY is not actively repainting. Decorative spinner or status text from Goose, Codex, or other agents should not be added as permanent detection rules.

Agent state inference is split behind Goose, Codex, and generic adapters. The adapters currently share conservative process/activity signals and explicit prompt fallback, but this keeps Goose tuning separate from Codex behavior so lower-cost Goose testing can stabilize supervision logic first. Generic PTY output is classified as process-sourced, medium-confidence `working`: the output is real, but the interpretation is still an inference. While a PTY is active, TaskDeck also tracks in-memory activity signals such as recent output frames, visible text, ANSI/cursor-control frames, and carriage returns so animated terminal repainting can be distinguished from plain text output. True `thinking` is not directly observable from TUI text.

## Local Configuration

Project suggestions come from `projectRoot` in `taskdeck.local.json` or `taskdeck.config.json`, with `TASKDECK_PROJECT_ROOT` available as an environment override. `projectRoot` means the parent directory whose immediate child directories appear as Project choices. Public defaults fall back to the TaskDeck repository itself, so a fresh clone may show only `task-deck` in the Project dropdown.

For maintainer environments, user-specific paths such as `/Users/hayashikentarou/Documents` belong in `taskdeck.local.json`, not committed config. Existing `projectRoots`, `TASKDECK_PROJECT_ROOT`, and `TASKDECK_PROJECT_ROOTS` values are still accepted for compatibility.

Agent profiles can be changed without editing application code. TaskDeck merges profiles by `id`: built-in defaults are loaded first, then `taskdeck.config.json`, then ignored `taskdeck.local.json`, then `TASKDECK_CONFIG`. Later files override matching ids and append new ids, but the server only exposes profiles with Docker-backed commands and diagnostic containers.

Each profile supports `id`, `label`, `command`, `description`, optional `diagnosticContainer`, optional `diagnosticWorkspace`, and optional `modelOptions`. The diagnostics panel uses the diagnostic fields to inspect/start configured Docker containers and check whether expected container workspace directories exist. The committed profiles are `codex` and `goose`, both running inside `ai-agent-sandbox-agent-1`.

Agent profiles are limited to container-backed profiles in the current UI. Codex launches through `sh -lc 'TERM=xterm-256color codex'` so the CLI sees a conventional terminal environment. Prefer machine-readable or non-TUI agent modes when an agent exposes one, but keep the PTY path as the current compatibility layer.

## Where To Change What

- Project dropdown / project roots: `apps/server/src/server.js` functions around `resolveProjectRoots`, `buildProjectSuggestions`, `selectDefaultProjectCwd`, and web form handling in `apps/web/src/components/TaskCreateForm.tsx`.
- Config loading: `apps/server/src/server.js` config candidate loading and profile/project-root normalization.
- Agent profiles: Built-in profile definitions and profile merge/sanitize logic in `apps/server/src/server.js`; frontend profile types in `apps/web/src/types.ts`; launch-command shaping in `TaskCreateForm.tsx` and `apps/web/src/codexPermissions.ts`.
- PTY lifecycle and input/output: Task creation, PTY spawn, resize, queued input, log append, and WebSocket output handling in `apps/server/src/server.js`; terminal rendering in `TerminalPane.tsx`; composer behavior in `InputComposer.tsx`.
- Attention/supervision logic: Adapter selection, process/activity observation, explicit TUI prompt fallback, quiet timers, and task state marking in `apps/server/src/server.js`; task-card display in `apps/web/src/components/TaskList.tsx`.
- Terminal UI: `apps/web/src/components/TerminalPane.tsx`, `InputComposer.tsx`, related terminal/composer CSS in `apps/web/src/styles.css`.
- Saved sessions: Codex session detection, resume command construction, session label storage, `/api/agent-sessions`, and saved-session picker behavior in `apps/server/src/server.js` and `TaskCreateForm.tsx`.
- Diagnostics: `/api/diagnostics` plus container inspection/start helpers in `apps/server/src/server.js`; existing tool panes use related profile/container metadata, and a dedicated diagnostics UI would be future work.

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
