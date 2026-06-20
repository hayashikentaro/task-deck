# TaskDeck Architecture

This document is a navigation map for contributors and AI-agent sessions. It describes the current shape of the project and likely refactoring boundaries, but it is not a request to refactor code.

## Product Invariant

TaskDeck is a task-centric supervision UI for AI-agent work. It is not a chatbot UI, and it is not merely a prettier terminal.

For work sessions on this branch, TaskDeck's product route is Codex App Server-only. The Codex App Server adapter gives TaskDeck structured turns, command output, and user-input requests. PTY/TUI runtime handling is not part of this branch's committed task route.

In the current session-identity-first card design, the primary card-level visual question is which task maps to the terminal/session the operator is viewing or about to resume. `Needs you` / `Not now` remains the primary supervision signal for sorting, badges, and action prompts, but it should not dominate the whole card surface or compete with stable task/session identity as a full-card color system.

## Repository Map

- `apps/server`: Node/Express backend, Codex App Server adapter, REST API, WebSocket updates, config loading, task persistence, diagnostics, and supervision state.
- `apps/web`: React/Vite frontend for task cards, task output rendering, task creation, composer input, App Server request controls, and API/WebSocket state handling.
- `packages/core`: Shared task-state primitives and task serialization helpers used by server and web code.
- `.taskdeck/`: Ignored local runtime state. It stores persisted tasks, logs, presets, session labels, attachments, and other local data that may be sensitive.
- Config files: `taskdeck.config.json` is committed config and exposes only the Codex App Server task profile on this branch; ignored `taskdeck.local.json`, `TASKDECK_CONFIG`, `TASKDECK_PROJECT_ROOT`, and `TASKDECK_PROJECT_ROOTS` carry machine-local overrides. `taskdeck.local.example.json` is the public example for local setup.

## Runtime Data Flow

1. The web app loads `/api/context`, opens the WebSocket, and receives task snapshots and output updates over WebSocket.
2. The New Agent Session form creates a TaskDeck task that represents a Codex App Server thread session for the selected project.
3. The server starts or reuses the shared App Server runtime and sends `thread/start` with the selected project cwd. One stdio App Server subprocess can host multiple parent thread sessions, and TaskDeck task semantics depend on App Server thread/session metadata rather than process ownership.
4. App Server thread messages are reduced to human-readable task output, pending request state, and task state updates. Output is appended to bounded in-memory and persisted logs, broadcast over WebSocket, and rendered in the output pane.
5. Server-side lifecycle observations and App Server status/request events update `agentState` and `attentionState` without treating silence as thinking.
6. Task, log, preset, session-label, and attachment state is persisted under `.taskdeck/`.
7. Focused REST calls handle actions such as task renaming, input locking, log reload, attachments, task diffs, and task clearing when a UI path calls them.
8. UI state updates from REST responses and WebSocket messages keep the task list, selected task, task output, composer availability, and request controls in sync.

## Native Subagent Card Ownership

```text
Codex App Server parent task
  -> structured native subagent/thread events
  -> server materializes read-only subagent supervision card
  -> thread-scoped assistant text and command output
  -> thread completion marks the subagent card complete
  -> parent App Server task remains the only commandable session
```

TaskDeck does not parse parent task output for launch markers and does not create independently commandable sub-sessions from worker text. Native subagent cards come only from structured Codex App Server events such as native subagent thread creation, item deltas, command execution summaries, and turn completion.

Ownership map:

- Runtime owns Codex App Server subprocess lifecycle, JSON-RPC notification handling, native subagent task materialization, thread-to-task log routing, and completion transitions. Typical file: `apps/server/src/server.js`.
- UI owns the read-only subagent card presentation, `Subagent` badge, locked input affordance, and normal task-card selection behavior. Typical files: `apps/web/src/components/TaskList.tsx`, `InputComposer.tsx`, and related styles.
- Core owns durable task/session metadata that is still needed by the App Server path, including `parentSessionId` for native subagent cards and persisted compatibility rules for old task records.
- Integration owns branch/worktree convergence when explicitly assigned by a development workflow. Integration is not part of native subagent card materialization; use `docs/agents/roles/integration.md` for branch-worktree merge guidance.

Do not add stdout marker parsing, request-file writers, raw launch commands from agent output, or direct worker-to-worker command paths as a shortcut for App Server-native sub-work.

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

For running Codex App Server work, server memory keeps App Server runtime handles separate from App Server thread-session handles. The committed App Server runtime is shared for parent Codex tasks, while each TaskDeck task owns a thread-session handle. Routing goes through task/thread maps such as task id -> thread session and App Server thread id -> TaskDeck task id so one runtime can host multiple project threads without changing task semantics. App Server messages that include a thread id are routed through that map before they update task state, request state, or logs.

## Domain Concepts

- Task: The central supervision unit. For Codex App Server work, a parent task represents an App Server thread session and persists its thread identity in session metadata once the thread is ready. A task also owns low-level runtime status, command/cwd, agent profile metadata, attachments, logs, risk, `agentState`, `attentionState`, and timing.
- Agent profile: A configured launch profile. On this branch, the exposed committed profile is Codex App Server running directly in the TaskDeck server environment. Profiles merge from built-in defaults, committed config, ignored local config, and `TASKDECK_CONFIG`.
- Session mode: How an agent starts. The committed App Server route starts new sessions; legacy stored tasks may still carry older session mode values.
- Attention state: The primary operator signal for `Needs you` / `Not now`. It should remain conservative and false-positive tolerant.
- Agent state: A process/supervision state such as starting, working, waiting input, review ready, done, or failed. It is related to but not identical to attention.
- Project root / project suggestion: `projectRoot` means a parent directory whose immediate child directories become Project choices. With no configured project root, TaskDeck falls back to the TaskDeck repo itself as the selectable project.
- Diagnostics: Server-side checks for optional locally configured Docker/container profiles and related local setup. The committed App Server profile does not require Docker diagnostics.

## Task And Session Behavior

Multiple tasks can exist in the task list, and multiple App Server thread sessions can run at the same time. The committed launch surface reuses one shared stdio App Server runtime for parent Codex thread sessions. Bulk clearing removes tasks and their logs. Clearing an individual running task removes that thread-session handle and only stops the shared runtime when no active thread sessions remain.

Tasks carry a low-level process `status`, a supervisor-facing `agentState`, and a primary `attentionState` that answers whether the operator should look at the task now. `attentionState` can be `none`, `may_need_user`, `needs_input`, `needs_approval`, `review_ready`, or `failed`, with source/confidence/reason metadata. For Codex work sessions, attention should come from TaskDeck lifecycle events, App Server status/request events, child-status reports, manager actions, or explicit UI actions.

Agent state also carries lightweight `agentStateReason`, `agentStateSource`, and `agentStateConfidence` metadata so operators can distinguish TaskDeck-owned events from App Server process events. TaskDeck treats its own lifecycle events as the primary state source: session start, user input, App Server status/request events, and process exit. Silence does not imply thinking.

Task creation is centered on starting a Codex App Server thread session in a selected workspace. The New Agent Session form exposes `Codex App Server` only. Instructions are sent after launch from the composer. Task records preserve the selected agent profile and session mode, and once App Server returns a thread id the parent task stores it as `agentSessionId` with `agentSessionSource: "codex_app_server_thread"`. Legacy session metadata fields remain loadable for old stored tasks.

Completed and other non-running tasks can be rerun from the expanded selected task card. Rerun starts a new task with the same title, command, and cwd, leaving the original task record and log intact.

Expanded task cards can also rerun tasks from their stored command and cwd. Legacy `resumeCommand` metadata remains serialized for old task records, but the committed App Server route does not generate Codex CLI resume commands or expose a saved Codex session picker.

## UI Organization

The UI is organized around task cards that help operators keep the left-rail task list matched to the center task output and persisted log view. Stable task/session identity is the primary card-level visual layer, while `Needs you` / `Not now` remains visible through sorting, badges, filters, and acknowledgement controls. The right rail launches Codex App Server sessions, and the composer stays attached to the selected task.

Expanded task cards show command, cwd, process status, exit code, timing, initial instruction when available, and compact diff status. The former top summary strip and right-side task-state panel are intentionally folded into the card model.

The output pane displays human-readable Codex App Server status, assistant text, command output, and request state in a plain scrollable text view. The pane strips legacy ANSI control sequences when replaying older logs. It includes operator controls for output font size, reloading persisted logs, and counting simple search matches.

Task input is sent through the fixed bottom composer. For Codex App Server tasks it becomes structured turn input. The composer stays disabled for read-only logs, disconnected sessions, or no selected task. It supports multi-line instructions. Enter sends, Shift+Enter inserts a newline, Cmd/Ctrl+Enter sends, and IME composition is preserved for Japanese input.

Input locking blocks new input without foregrounding the task in the task list. Unlocking a running task is an operator attention action: the UI selects that task and refreshes its activity timestamp so it moves up within its current supervision bucket.

## Agent State Inference

Process and task lifecycle states are the reliable base layer: process start, user input sent through TaskDeck, App Server status/request events, and process exit. User input is a TaskDeck-owned event, and process exit is a process-owned event.

TUI text is not a stable protocol. For Codex work sessions, App Server request/status events drive request handling and supervision state. Decorative spinner or status text from terminal-backed agents should not be added as permanent detection rules.

Agent state inference on this branch is App Server-first. True `thinking` is not directly observable from TUI text, and TaskDeck should not infer it from silence.

## Local Configuration

Project suggestions come from `projectRoot` in `taskdeck.local.json` or `taskdeck.config.json`, with `TASKDECK_PROJECT_ROOT` available as an environment override. `projectRoot` means the parent directory whose immediate child directories appear as Project choices. Public defaults fall back to the TaskDeck repository itself, so a fresh clone may show only `task-deck` in the Project dropdown.

`defaultModel` can be set in `taskdeck.config.json`, ignored `taskdeck.local.json`, or `TASKDECK_CONFIG`. Later config sources override earlier ones. TaskDeck exposes the resolved value to the launch form, records it on new tasks, and passes it as the App Server `thread/start` model. When no value is configured, TaskDeck leaves the model unset so Codex uses its own default.

After App Server authentication is ready, TaskDeck requests `model/list` and broadcasts the normalized catalog to connected web clients. The selected task's composer uses that catalog for model and reasoning-effort controls. Each submitted instruction carries its selection atomically; the server records it on the task and passes `model` and `effort` to `turn/start`, so changes apply to that turn and subsequent turns without restarting the shared runtime or thread. Inputs queued before thread readiness retain the selection made when they were submitted.

For maintainer environments, user-specific paths such as `/Users/hayashikentarou/Documents` belong in `taskdeck.local.json`, not committed config. Existing `projectRoots`, `TASKDECK_PROJECT_ROOT`, and `TASKDECK_PROJECT_ROOTS` values are still accepted for compatibility.

Agent profiles can be changed without editing application code. TaskDeck merges profiles by `id`: built-in defaults are loaded first, then `taskdeck.config.json`, then ignored `taskdeck.local.json`, then `TASKDECK_CONFIG`. Later files override matching ids and append new ids, and the server exposes the merged profile list.

Each profile supports `id`, `label`, `command`, `description`, optional `diagnosticContainer`, optional `diagnosticWorkspace`, and optional `modelOptions`. The diagnostics API uses the diagnostic fields to inspect/start configured Docker containers and check whether expected container workspace directories exist. Profiles without diagnostic container fields are launchable but omitted from container diagnostics. The committed App Server profile has no diagnostic container because it runs in the TaskDeck server environment.

Codex App Server launches through `codex --sandbox danger-full-access --ask-for-approval never app-server --listen stdio://` so TaskDeck can communicate over ordinary stdin/stdout pipes. The committed route uses `danger-full-access` in the TaskDeck server environment, and TaskDeck also passes full-access/no-approval overrides when starting App Server threads and turns. TaskDeck does not otherwise synthesize Codex CLI/TUI reasoning, startup, or resume flags for this profile. If a local machine needs Docker wrapping, use ignored local config to override the profile command.

## Where To Change What

- Project dropdown / project roots: `apps/server/src/server.js` functions around `resolveProjectRoots`, `buildProjectSuggestions`, `selectDefaultProjectCwd`, and web form handling in `apps/web/src/components/TaskCreateForm.tsx`.
- Config loading: `apps/server/src/server.js` config candidate loading and profile/project-root normalization.
- Agent profiles: Built-in profile definitions and profile merge/sanitize logic in `apps/server/src/server.js`; frontend profile types in `apps/web/src/types.ts`; launch-command selection in `TaskCreateForm.tsx`.
- App Server lifecycle and input/output: Task/thread-session creation, shared App Server runtime spawn/stdin/stdout handling, log append, and WebSocket output handling in `apps/server/src/server.js`; output rendering in `OutputPane.tsx`; composer behavior in `InputComposer.tsx`.
- Attention/supervision logic: App Server status/request handling, child-status handling, manager actions, and task state marking in `apps/server/src/server.js`; task-card display in `apps/web/src/components/TaskList.tsx`.
- Output and input UI: `apps/web/src/components/OutputPane.tsx`, `InputComposer.tsx`, related output/composer CSS in `apps/web/src/styles.css`.
- Diagnostics: `/api/diagnostics` plus container inspection/start helpers in `apps/server/src/server.js`; a dedicated diagnostics UI would be future work.

## Refactoring Seams

`apps/server/src/server.js` currently mixes many responsibilities. Good future extraction candidates include:

- `config`: Config file discovery, project-root normalization, profile merging, and profile sanitization.
- `profiles`: Built-in agent profile definitions, launch helper behavior, Docker-wrapper workdir correction, and profile diagnostics metadata.
- `tasks`: Task persistence, task mutation helpers, task cleanup, presets, and attachment persistence.
- `codex-app-server`: App Server thread-session lifecycle, shared runtime spawn, JSON-RPC request/notification handling, pending request state, auth/device-login flow, and structured output rendering.
- `supervision`: App Server request/status reduction, child-status attention, manager-action state changes, and task-card supervision display.
- `diagnostics`: Optional local Docker reachability, container inspection/start, and workspace checks for locally overridden profiles.
- `api`: Express route registration separated from business logic.

Frontend seams are smaller but still visible:

- Task creation can be isolated from `TaskCreateForm.tsx` when it grows.
- Output rendering helpers can be extracted from `OutputPane.tsx` when they grow.
- Task-card supervision display can stay separate from lower-level task metadata details.

## Architecture Cautions

- `projectRoot` is a parent directory whose children are project choices. Do not set it to the TaskDeck repo just to make the current repo appear.
- Do not make `defaultAgentProfiles` empty as a shortcut to public-safety; that silently removes the built-in Agent options.
- Preserve persisted task compatibility when changing task metadata, legacy session fields, resume commands, or state names.
- Do not infer thinking from silence.
- On this branch, new product behavior should target Codex App Server first.
- For Codex work sessions, use App Server request/status events as the control data.
- Keep hidden/background status or diagnostics output out of visible task logs unless the user explicitly starts that task.
