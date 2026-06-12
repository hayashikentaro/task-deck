# Roadmap Context

This document records medium-term TaskDeck product direction and cross-issue design rationale.

GitHub Issues remain the source of truth for actionable work and completion state. This document is not a backlog.

## Product direction

TaskDeck is a supervision UI for multiple AI/CLI sessions.

It is not a chatbot UI, a provider-specific Codex UI, or merely a prettier terminal. The medium-term direction is to make TaskDeck easier for other people to use while preserving the core supervision model.

## Medium-term themes

### Manager control plane

Introduce a dedicated manager control plane so non-manager agents can report bounded outputs while TaskDeck server remains the only actor that mutates state or delivers commands.

The current design direction is:

- worker sessions are project-bound and read generated context for the selected project workspace;
- worker agents write append-only status/result/artifact files from their project scope;
- the manager session is a global TaskDeck supervisor launched from the TaskDeck control/document root, not from an individual project workspace;
- manager-readable context is global across projects and includes file-based manager inbox events and generated readable views;
- Read-only global manager MVP: complete. The completed scope includes global manager launch from the control/document root, manager cwd `/workspace` in QA, project-bound worker sessions, manager inbox unread events, generated manager-readable context/unread files, manager nudge, terminal-only manager judgment, no manager writes to `TASKDECK_STATUS_FILE`, no `STATUS ERROR` from manager status parsing, and no `taskdeckctl` or manager write path yet;
- Next phase: manager action/write path;
- once read behavior is proven, manager writes should go through `taskdeckctl`;
- `taskdeckctl` should talk to a local IPC endpoint, preferably a Unix domain socket, rather than an exposed Web API;
- TaskDeck server validates, dedupes, logs, executes, and broadcasts every mutation.

The manager action/write path phase includes `taskdeckctl`, local IPC / Unix socket, manager action schema, the server-side manager action executor, ack/review/close/spawn-child actions, and any future worker command delivery.

Related design doc:

- `docs/taskdeck-actor-protocol.md`

### Desktop app packaging

Package TaskDeck as an Electron desktop app so users can open TaskDeck, choose a workspace, and supervise agent sessions without manually starting server/web processes.

Related issue:

- #55 — Package TaskDeck as an Electron desktop app.

### Multi-agent/provider support

Add Claude support so TaskDeck is not Codex-only.

The design should avoid provider TUI parsing. Provider adapters should reuse generic supervision where possible and add only bounded, robust provider-specific behavior.

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
- Keep worker-to-TaskDeck reporting constrained and append-only where possible.
- Keep worker sessions project-bound and keep the manager session TaskDeck-control-root-bound.
- Treat manager-readable context as global cross-project supervision context.
- Avoid free-form child-to-parent or worker-to-worker chat.
- Prove manager read behavior before implementing manager write behavior.
- Keep future manager write operations behind `taskdeckctl` and server-side validation.
- Avoid exposing manager write as a broad Web API surface.
- Avoid building UI around unstable configuration concepts.
- Prefer diagnostics over settings mutation UI.
- Keep TaskDeck provider-neutral.

## Non-goals for this phase

- Public HTTP API.
- Broad manager Web API surface.
- Manager write implementation before manager read-loop validation.
- SQLite migration.
- tmux/session reattach.
- General workflow queue.
- Full settings editor.
- Provider-specific transcript parsers.
- Chatbot-style UX.
- Free-form child-to-parent messaging.
