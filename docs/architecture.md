# TaskDeck Architecture

This document is a navigation map for contributors and AI-agent sessions. It describes the current shape of the project and likely refactoring boundaries, but it is not a request to refactor code.

## Product Invariant

TaskDeck is a task-centric supervision UI for AI-agent work. It is not a chatbot UI, and it is not merely a prettier terminal.

For work sessions on this branch, TaskDeck's product route is Codex App Server-only. The Codex App Server adapter gives TaskDeck structured turns, command output, and user-input requests. PTY/TUI handling remains in the codebase as a legacy/fallback runtime path, but the committed task launch surface exposes only Codex App Server while the App Server thread model is being rebuilt.

In the current session-identity-first card design, the primary card-level visual question is which task maps to the terminal/session the operator is viewing or about to resume. `Needs you` / `Not now` remains the primary supervision signal for sorting, badges, and action prompts, but it should not dominate the whole card surface or compete with stable task/session identity as a full-card color system.

## Repository Map

- `apps/server`: Node/Express backend, Codex App Server adapter, PTY orchestration, REST API, WebSocket updates, config loading, task persistence, diagnostics, and supervision heuristics.
- `apps/web`: React/Vite frontend for task cards, task output rendering, terminal fallback rendering, task creation, tools, diagnostics, composer input, App Server request controls, and API/WebSocket state handling.
- `packages/core`: Shared task-state primitives and task serialization helpers used by server and web code.
- `.taskdeck/`: Ignored local runtime state. It stores persisted tasks, logs, presets, session labels, attachments, and other local data that may be sensitive.
- Config files: `taskdeck.config.json` is committed config and exposes only the Codex App Server task profile on this branch; ignored `taskdeck.local.json`, `TASKDECK_CONFIG`, `TASKDECK_PROJECT_ROOT`, and `TASKDECK_PROJECT_ROOTS` carry machine-local overrides. `taskdeck.local.example.json` is the public example for local setup.

## Runtime Data Flow

1. The web app loads `/api/context`, opens the WebSocket, and receives task snapshots and output updates over WebSocket.
2. The New Agent Session form creates a Codex App Server task for the selected project.
3. The server launches the Codex App Server command as a stdio App Server subprocess. Legacy terminal-backed profile launch code remains present but is not exposed on the App Server-only route.
4. App Server messages are reduced to human-readable task output, pending request state, and task state updates. PTY output is appended to bounded in-memory and persisted logs, broadcast over WebSocket, and rendered by xterm.js in the terminal pane.
5. Server-side lifecycle observations, App Server status events, and adapter-specific fallback signals update `agentState` and `attentionState` without treating silence as thinking.
6. Task, log, preset, session-label, and attachment state is persisted under `.taskdeck/`.
7. Focused REST calls handle actions such as task renaming, log reload, attachments, and diagnostics queries when a UI path calls them.
8. UI state updates from REST responses and WebSocket messages keep the task list, selected task, terminal output, composer availability, and tools in sync.

## Legacy #29 Child Session Auto-Launch Ownership

Issue #29 previously added a narrow parent-output-to-child-task flow:

```text
parent output
  -> detect TASKDECK_CHILD_SESSION_BATCH_REQUEST
  -> parse and validate
  -> resolve trusted local agent profile
  -> build trusted launch command
  -> create child task
  -> auto-send initialInstruction
  -> display child metadata
  -> dedupe created/rejected requests
  -> report created/rejected status
  -> later parent/integration workflow handles merging
```

This flow is disabled on the App Server-only route. TaskDeck no longer scans the Web UI output path for stdout child-session marker blocks, no longer exposes file-protocol child-session request directories to launched App Server sessions, and rejects file-protocol child session starts while the App Server-native thread/session model is being rebuilt.

The legacy ownership map remains useful if this protocol is reintroduced:

- Protocol owns the request block shape, required and optional fields, forbidden fields, validation semantics, parser/validator behavior, and protocol docs. Typical files are `docs/taskdeck-child-session-protocol.md` and `apps/web/src/childSessionRequests.ts`. Protocol work must not introduce raw launch commands or UI workflow decisions.
- App Flow owns scanning parent task output/logs, calling the parser, deduping processed request blocks, resolving trusted local agent profiles, mapping valid requests to `CreateTaskInput`, invoking the existing task creation flow, and surfacing concise created/rejected status. Typical files are `apps/web/src/App.tsx` and `apps/web/src/agentLaunch.ts`.
- Runtime owns App Server and PTY-backed task launch, task metadata preservation, queued input behavior, `initialInstruction` delivery, and process/output lifecycle. Typical files are `apps/server/src/server.js` and, for stable metadata semantics, `packages/core/src/index.js`.
- UI owns child metadata display, Child and work-package badges, expanded task-card details, concise status presentation, and the #29 decision to avoid a confirmation modal for valid parent-generated requests. Typical files are `apps/web/src/components/TaskList.tsx` and related local styles when needed.
- Core owns parent/child task metadata semantics and persisted compatibility for fields such as `parentSessionId`, `spawnedFromParentRequest`, `workPackageId`, and `filesLikelyToChange` when those semantics change.
- Integration owns collecting pushed child branches after child sessions finish, choosing merge order, merging into the parent or integration branch, and running checks. Integration is not part of the auto-launch runtime itself; use `docs/agents/roles/integration.md` for that workflow.

#29 must not execute raw commands from parent output if reintroduced. Parent requests may name an agent profile, cwd, permission, title, work package, file hints, and an initial instruction, but TaskDeck must build the actual launch command from trusted local profile configuration.

#29 is also not worktree management, branch management, dependency graph execution, automatic merge, parent-to-child follow-up instruction routing, or child completion result tracking. Follow-up instruction routing belongs to #30. Child completion/result tracking and integration handoff should be handled by later workflows/issues such as #40 and the integration role guide.

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
- Agent profile: A configured launch profile. On this branch, the exposed committed profile is Codex App Server running directly in the TaskDeck server environment. Profiles merge from built-in defaults, committed config, ignored local config, and `TASKDECK_CONFIG`.
- Session mode: How an agent starts. The committed App Server route starts new sessions; legacy stored tasks may still carry older session mode values.
- Attention state: The primary operator signal for `Needs you` / `Not now`. It should remain conservative and false-positive tolerant.
- Agent state: A process/supervision state such as starting, working, waiting input, review ready, done, or failed. It is related to but not identical to attention.
- Project root / project suggestion: `projectRoot` means a parent directory whose immediate child directories become Project choices. With no configured project root, TaskDeck falls back to the TaskDeck repo itself as the selectable project.
- Diagnostics: Server-side checks for Docker reachability, configured containers, configured container workspaces, and related local setup. There is not currently a dedicated web diagnostics pane.

## Task And Session Behavior

Multiple tasks can exist in the task list, and multiple agent processes can run at the same time. Codex App Server tasks are stdio-backed subprocesses; terminal fallback and shell/provider tasks are PTY-backed. Bulk clearing removes non-running tasks and their logs while preserving active tasks. Clearing an individual running task stops its active process and removes that task.

Tasks carry a low-level process `status`, a supervisor-facing `agentState`, and a primary `attentionState` that answers whether the operator should look at the task now. `attentionState` can be `none`, `may_need_user`, `needs_input`, `needs_approval`, `review_ready`, or `failed`, with source/confidence/reason metadata. TaskDeck intentionally prefers false positives over false negatives for attention: input-like prompts that are not yet stable, quiet running PTYs, and working tasks whose PTY activity has stopped become `may_need_user` rather than staying invisible.

Agent state also carries lightweight `agentStateReason`, `agentStateSource`, and `agentStateConfidence` metadata so operators can distinguish TaskDeck-owned events from App Server process events and heuristic TUI fallback. TaskDeck treats its own lifecycle events as the primary state source: session start, user input, App Server status/request events, PTY output activity, and process exit. Plain PTY output is a reliable process observation but only a medium-confidence inference of `working`. Silence does not imply thinking, but it may need user attention.

Task creation is centered on starting an AI agent session in a selected workspace. The New Agent Session form defaults to `Codex App Server`. Instructions are sent after launch from the composer. Task records preserve the selected agent profile and session mode, while legacy session metadata fields remain loadable for old stored tasks.

Completed and other non-running tasks can be rerun from the expanded selected task card. Rerun starts a new task with the same title, command, and cwd, leaving the original task record and log intact.

Expanded task cards can also rerun tasks from their stored command and cwd. Legacy `resumeCommand` metadata remains serialized for old task records, but the committed App Server route does not generate Codex CLI resume commands or expose a saved Codex session picker.

## UI Organization

The UI is organized around task cards that help operators keep the left-rail task list matched to the center task output and persisted log view. Stable task/session identity is the primary card-level visual layer, while `Needs you` / `Not now` remains visible through sorting, badges, filters, and acknowledgement controls. The right rail launches new agent sessions, and the composer stays attached to the selected task.

Expanded task cards show command, cwd, process status, exit code, timing, initial instruction when available, and compact diff status. The former top summary strip and right-side task-state panel are intentionally folded into the card model.

The output pane keeps xterm.js for terminal-backed profiles while also displaying human-readable Codex App Server status, assistant text, command output, and request state. It includes operator controls for follow mode, clearing the current view, reloading persisted logs, copying the bounded visible log buffer, and counting simple search matches. The xterm surface fits the visible terminal viewport when a PTY profile is selected; composer height changes should resize the terminal viewport and preserve bottom-follow state instead of relying on an oversized hidden terminal surface.

Task input is sent through the fixed bottom composer. For Codex App Server tasks it becomes structured turn input. For PTY-backed tasks it targets the selected running PTY and uses terminal input semantics. The composer stays disabled for read-only logs, disconnected sessions, or no selected task. It supports multi-line instructions. Enter sends, Shift+Enter inserts a newline, Cmd/Ctrl+Enter sends, and IME composition is preserved for Japanese input. Single-line slash commands are passed through only for terminal-backed profiles so the underlying TUI can parse commands it actually supports. TaskDeck does not add support for slash commands the CLI does not expose. Normal PTY composer instructions submit with bracketed paste followed by terminal Enter (`\r`).

Terminal input locking blocks new input without foregrounding the task in the task list. Unlocking a running task is an operator attention action: the UI selects that task and refreshes its activity timestamp so it moves up within its current supervision bucket.

## Agent State Inference

Process and task lifecycle states are the reliable base layer: process start, user input sent through TaskDeck, App Server status/request events, PTY output observed from the child process, and process exit. User input is a TaskDeck-owned event, and process exit is a process-owned event.

TUI text is not a stable protocol. For Codex work sessions, App Server request/status events drive request handling and supervision state. PTY fallback should only detect explicit user-action prompts such as approval requested, input requested, or review-ready hints for non-Codex terminal-backed profiles. Approval prompts win immediately, but input prompts are only stabilized when the PTY is not actively repainting. Decorative spinner or status text from terminal-backed agents should not be added as permanent detection rules.

Agent state inference is split behind App Server, Goose, and generic adapters. App Server status events should be preferred when present. The PTY adapters share conservative process/activity signals and explicit prompt fallback, but this keeps provider tuning separate. Generic PTY output is classified as process-sourced, medium-confidence `working`: the output is real, but the interpretation is still an inference. While a PTY is active, TaskDeck also tracks in-memory activity signals such as recent output frames, visible text, ANSI/cursor-control frames, and carriage returns so animated terminal repainting can be distinguished from plain text output. True `thinking` is not directly observable from TUI text.

## Local Configuration

Project suggestions come from `projectRoot` in `taskdeck.local.json` or `taskdeck.config.json`, with `TASKDECK_PROJECT_ROOT` available as an environment override. `projectRoot` means the parent directory whose immediate child directories appear as Project choices. Public defaults fall back to the TaskDeck repository itself, so a fresh clone may show only `task-deck` in the Project dropdown.

For maintainer environments, user-specific paths such as `/Users/hayashikentarou/Documents` belong in `taskdeck.local.json`, not committed config. Existing `projectRoots`, `TASKDECK_PROJECT_ROOT`, and `TASKDECK_PROJECT_ROOTS` values are still accepted for compatibility.

Agent profiles can be changed without editing application code. TaskDeck merges profiles by `id`: built-in defaults are loaded first, then `taskdeck.config.json`, then ignored `taskdeck.local.json`, then `TASKDECK_CONFIG`. Later files override matching ids and append new ids, and the server exposes the merged profile list.

Each profile supports `id`, `label`, `command`, `description`, optional `diagnosticContainer`, optional `diagnosticWorkspace`, and optional `modelOptions`. The diagnostics panel uses the diagnostic fields to inspect/start configured Docker containers and check whether expected container workspace directories exist. Profiles without diagnostic container fields are launchable but omitted from container diagnostics. The committed App Server profile has no diagnostic container because it runs in the TaskDeck server environment.

Codex App Server launches through `codex --sandbox danger-full-access --ask-for-approval never app-server --listen stdio://` so TaskDeck can communicate over ordinary stdin/stdout pipes. The committed route uses `danger-full-access` in the TaskDeck server environment, and TaskDeck also passes full-access/no-approval overrides when starting App Server threads and turns. TaskDeck does not otherwise synthesize Codex CLI/TUI reasoning, startup, or resume flags for this profile. If a local machine needs Docker wrapping, use ignored local config to override the profile command.

## Where To Change What

- Project dropdown / project roots: `apps/server/src/server.js` functions around `resolveProjectRoots`, `buildProjectSuggestions`, `selectDefaultProjectCwd`, and web form handling in `apps/web/src/components/TaskCreateForm.tsx`.
- Config loading: `apps/server/src/server.js` config candidate loading and profile/project-root normalization.
- Agent profiles: Built-in profile definitions and profile merge/sanitize logic in `apps/server/src/server.js`; frontend profile types in `apps/web/src/types.ts`; launch-command shaping in `TaskCreateForm.tsx` and `apps/web/src/agentLaunch.ts`.
- App Server and PTY lifecycle and input/output: Task creation, App Server spawn/stdin/stdout handling, PTY spawn, resize, queued input, log append, and WebSocket output handling in `apps/server/src/server.js`; terminal rendering in `TerminalPane.tsx`; composer behavior in `InputComposer.tsx`.
- Attention/supervision logic: Adapter selection, process/activity observation, explicit TUI prompt fallback, quiet timers, and task state marking in `apps/server/src/server.js`; task-card display in `apps/web/src/components/TaskList.tsx`.
- Output and terminal UI: `apps/web/src/components/TerminalPane.tsx`, `InputComposer.tsx`, related output/composer CSS in `apps/web/src/styles.css`.
- Diagnostics: `/api/diagnostics` plus container inspection/start helpers in `apps/server/src/server.js`; existing tool panes use related profile/container metadata, and a dedicated diagnostics UI would be future work.

## Refactoring Seams

`apps/server/src/server.js` currently mixes many responsibilities. Good future extraction candidates include:

- `config`: Config file discovery, project-root normalization, profile merging, and profile sanitization.
- `profiles`: Built-in agent profile definitions, launch helper behavior, Docker workdir correction, and profile diagnostics metadata.
- `tasks`: Task persistence, task mutation helpers, task cleanup, presets, and attachment persistence.
- `pty`: PTY spawn/resize/input queue/output stream/log append lifecycle.
- `codex-app-server`: App Server spawn, JSON-RPC request/notification handling, pending request state, auth/device-login flow, and structured output rendering.
- `supervision`: Activity tracking, adapter selection, attention/agent-state inference, quiet timers, and explicit TUI prompt fallback.
- `diagnostics`: Docker reachability, container inspection/start, and workspace checks.
- `api`: Express route registration separated from business logic.

Frontend seams are smaller but still visible:

- Task creation and launch command construction can be isolated from `TaskCreateForm.tsx`.
- Terminal observation helpers can be extracted from `TerminalPane.tsx` when they grow.
- Task-card supervision display can stay separate from lower-level task metadata details.

## Architecture Cautions

- `projectRoot` is a parent directory whose children are project choices. Do not set it to the TaskDeck repo just to make the current repo appear.
- Do not make `defaultAgentProfiles` empty as a shortcut to public-safety; that silently removes the built-in Agent options.
- Preserve persisted task compatibility when changing task metadata, legacy session fields, resume commands, or state names.
- Do not infer thinking from silence. Quiet running PTYs should keep their last supervisor state until a stronger signal appears.
- Keep adapter-specific behavior isolated for Codex App Server, Goose, and generic agents; do not tune one agent by adding one-off phrases to a shared path.
- Treat PTY output parsing as a fallback for explicit user-action prompts, not a stable protocol.
- For Codex work sessions, use App Server request/status events as the control data.
- Keep hidden/background status or diagnostics output out of visible task logs unless the user explicitly starts that task.
