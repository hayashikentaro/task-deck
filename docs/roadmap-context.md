# Roadmap Context

This document records medium-term TaskDeck product direction and cross-issue design rationale.

GitHub Issues remain the source of truth for actionable work and completion state. This document is not a backlog.

## Product direction

TaskDeck is a supervision UI for multiple AI/CLI sessions.

It is not a chatbot UI, a provider-specific Codex UI, or merely a prettier terminal. The medium-term direction is to make TaskDeck easier for other people to use while preserving the core supervision model. The product route on this branch is App Server-only: use structured App Server events for turns, command output, and user-input requests. PTY/TUI handling for shell and non-Codex providers is not part of the active branch runtime.

## Medium-term themes

### Control plane

The previous AI-agent actor model has been removed pending redesign. Keep the existing local control-plane implementation documented as runtime behavior, not as a durable actor taxonomy.

The current design direction is:

- Read-only supervision transport MVP: complete. The completed scope includes control-root launch, cwd `/workspace` in QA, generated unread events, generated readable context/unread files, short nudge, terminal-only judgment, no `TASKDECK_STATUS_FILE` writes, no `STATUS ERROR` from status parsing, and no direct mutation path;
- Minimum local action/write path: implemented for ack, review, and close actions;
- App Server dynamic human-decision requests: enabled by default and routed through Decision Gateway;
- Next phase: redesign the actor model before adding broader session-to-session workflow behavior;
- `taskdeckctl` should talk to a local IPC endpoint, preferably a Unix domain socket, rather than an exposed Web API;
- TaskDeck server validates, dedupes, logs, executes, and broadcasts every mutation.

The local action/write path includes `taskdeckctl`, local IPC / Unix socket, action schema, the server-side action executor, and ack/review/close actions. Later bounded message or sub-work actions must be App Server-native or a new server-owned protocol; they must not introduce stdout-marker or request-file shortcuts.

Related design doc:

- `docs/taskdeck-actor-protocol.md`

### Codex App Server-first route

Codex supervision should move away from transcript-driven TUI control and toward the structured `codex --sandbox danger-full-access --ask-for-approval never app-server --listen stdio://` adapter.

The current route is:

- use `Codex App Server` as the default Codex work-session profile;
- run the App Server directly in the TaskDeck server environment with stdio JSON;
- keep raw App Server JSON out of normal logs;
- render assistant text, command output, and App Server status as TaskDeck task output;
- surface user-input requests through TaskDeck controls;
- expose `taskdeck.request_decision` as the default App Server-native human-decision request path;
- keep committed Codex work sessions on the App Server route only;
- avoid adding Codex TUI parsing or committed Codex CLI/TUI launch profiles.

This is still compatible with provider-neutral TaskDeck. The principle is not "Codex-only"; it is "prefer structured provider adapters over TUI transcript control whenever a provider exposes one."

### Branch worktree lifecycle

TaskDeck branch work uses `git worktree`.

Use the main repository as the base development checkout. Create one worktree per branch and purpose for parallel development.

Do not create disposable full clones for TaskDeck branch work. Do not choose between clone and worktree.

Remote GitHub branches are the durable source of truth. A branch task is complete only after intended changes are committed and pushed.

### Desktop app packaging

Package TaskDeck as an Electron desktop app so users can open TaskDeck, choose a workspace, and supervise agent sessions without manually starting server/web processes.

Related issue:

- #55 — Package TaskDeck as an Electron desktop app.

### Multi-agent/provider support

Add Claude support so TaskDeck is not Codex-only.

This is future work, not a current-branch launch route. The design should avoid provider TUI parsing. Provider adapters should reuse generic supervision where possible and add only bounded, robust provider-specific behavior. When a provider exposes a stable structured app-server or machine protocol, prefer that path over PTY transcript control.

Related issue:

- #56 — Add Claude agent adapter support.

### External configuration instead of settings editor UI

Do not build a large settings editor UI while TaskDeck's configuration model is still evolving.

Use external config files, schema validation, examples, and AI-editable guide docs. The app may show diagnostics, loaded config status, and validation errors, but should not become the primary config mutation UI yet.

Related issues:

- #57 — Introduce external TaskDeck config file with schema validation.
- #58 — Add AI-editable TaskDeck config guide docs.
- #59 — Show loaded config and validation diagnostics without adding a settings editor.

## Design stance

- Keep machine control data out of human display planes.
- Prefer bounded file, environment, local IPC, and command protocols for machine-readable coordination.
- Prefer structured App Server or provider adapter protocols over TUI transcript parsing for agent control.
- Redesign AI-agent actor responsibilities before adding new role-specific behavior.
- Avoid free-form subtask-to-parent or worker-to-worker chat until the actor redesign defines supported behavior.
- Keep write behavior constrained to generated `taskdeckctl` capabilities.
- Keep future write operations behind `taskdeckctl` and server-side validation.
- Avoid exposing writes as a broad Web API surface.
- Avoid building UI around unstable configuration concepts.
- Prefer diagnostics over settings mutation UI.
- Keep TaskDeck provider-neutral.

## Non-goals for this phase

- Public HTTP API.
- Broad Web API write surface.
- Write operations that are not exposed through generated `taskdeckctl` capabilities.
- SQLite migration.
- tmux/session reattach.
- General workflow queue.
- Full settings editor.
- Provider-specific transcript parsers.
- Chatbot-style UX.
- Free-form subtask-to-parent messaging.
