# Current Work Plan

This document records the current short-term work order for AI-assisted TaskDeck development.

GitHub Issues remain the source of truth for actionable work, open/closed state, detailed acceptance criteria, and task completion state. This document only records current sequencing rationale.

## Current priority order

1. Document and enforce the TaskDeck actor protocol boundary.
2. Read-only global manager MVP: complete.
3. Minimum manager action/write path through `taskdeckctl`: implemented for ack, review, and close.
4. Current phase: stabilize manager action QA and make supported manager actions discoverable to real manager agents.
5. Resume broader product work such as Electron packaging, Claude support, external configuration, and future manager-to-worker messaging only after the manager control plane boundary and action discoverability are stable.

## Completed read-only manager MVP

Read-only global manager MVP: complete.

The completed scope includes:

- global manager launch from the control/document root;
- manager cwd `/workspace` in the QA environment;
- project-bound worker sessions;
- manager inbox unread events;
- generated manager-readable context and unread event files;
- manager nudge;
- terminal-only manager judgment;
- no `TASKDECK_STATUS_FILE` writes by the manager;
- no `STATUS ERROR` from manager status parsing.

The read-only MVP intentionally did not include `taskdeckctl` or manager write actions. That baseline has since been extended by the minimum manager action/write path below.

## Completed minimum manager action/write path

The minimum manager action/write path is implemented through `taskdeckctl` over server-owned local transports.

The completed scope includes:

- `taskdeckctl` as the manager-facing command surface;
- local IPC / Unix socket transport;
- token-protected loopback TCP fallback for Docker manager sessions;
- manager action schema;
- server-side manager action executor;
- validation, dedupe, action logging, and compact history;
- `ack`, `review`, and `close` actions first.

Current supported manager commands:

```sh
taskdeckctl ack --event <eventId>
taskdeckctl ack --task <taskId>
taskdeckctl review --task <taskId>
taskdeckctl close --task <taskId>
```

## Current phase: manager action discoverability and QA

The next work is not to broaden manager writes immediately. The next work is to make sure a real manager agent can reliably discover and use only the actions that TaskDeck currently supports.

This phase should add or verify:

- a generated manager-readable action guide, such as `.taskdeck/manager-readable/actions.md`;
- a machine-readable capabilities file, such as `.taskdeck/manager-readable/capabilities.json`;
- manager environment pointers such as `TASKDECK_MANAGER_ACTIONS_FILE` and `TASKDECK_MANAGER_CAPABILITIES_FILE`;
- manager nudges that explicitly tell the manager to read the action guide before acting;
- per-event suggested actions with concrete `eventId` / `taskId` values where appropriate;
- `taskdeckctl --help`, server allowlists, and generated manager-readable action guidance kept in sync;
- QA that verifies `ack`, `review`, and `close` work from a real manager session and produce the expected UI/state/log/history effects.

Important rule: do not show a command to the manager unless the server and `taskdeckctl` both support it. Future manager-to-worker messaging must stay out of generated manager action guidance until it is implemented and validated end-to-end.

## Future manager-to-worker messaging

Future manager-to-worker messaging should extend the same `taskdeckctl` and server-owned action boundary rather than adding a manager-facing raw API or direct cross-agent path.

Before future messaging becomes manager-visible, the implementation must include:

- `taskdeckctl` parser/help support;
- server-side action validation and allowlisting;
- actor manager-task validation;
- target task validation;
- action id dedupe;
- action logging/history;
- clear success/failure results;
- generated manager-readable action guidance that lists the command only after support is real.

## Why this order

- The current architectural focus is the manager control plane, not provider expansion or desktop packaging.
- Worker agents should continue to communicate through append-only files and bounded status/reporting surfaces.
- Worker sessions are project-bound; the manager session is a global TaskDeck supervisor launched from the TaskDeck control/document root.
- Manager reads are file-based and global across projects: manager inbox, generated readable views, and file change notifications.
- Manager writes should not be raw Web API calls, direct cross-agent commands, or direct edits to TaskDeck state.
- The current manager write path is `taskdeckctl` calling a local IPC endpoint owned by TaskDeck server.
- TaskDeck server remains the only actor that validates, dedupes, logs, executes mutations, and coordinates session effects.
- Real manager sessions need an execution-time action guide because static repository docs can drift from the running server's actual capabilities.

## Current constraints

- Do not use Codex TUI or terminal transcript output as machine control data.
- Do not use platform-native multi-agent/sub-agent tools as TaskDeck child sessions.
- Do not use `git worktree` for TaskDeck AI-assisted development; isolated work must use a full clone.
- Worktree directories are not self-contained because their `.git` file points back to the parent repository's `.git/worktrees` metadata, which is unsafe across macOS, Docker, `/workspace` paths, copied directories, and AI agents.
- Do not let non-manager agents command other agents directly.
- Do not launch the manager inside an individual project workspace; launch it from the TaskDeck control/document root.
- Keep the current implemented manager write scope limited to ack, review, and close until action discoverability and QA are stable.
- Do not expose a manager Web API endpoint as the manager-facing write path.
- Do not show unsupported future commands in generated manager-readable action guidance.
- Do not start a SQLite migration as part of the immediate manager control plane work.
- Do not start tmux/session reattach work as part of the immediate manager control plane work; see #60 for future recovery tracking.

## Primary design docs

- `docs/taskdeck-actor-protocol.md`
- `docs/taskdeck-child-session-protocol.md`

## Clone isolation

Use full clones for isolated TaskDeck development, not `git worktree`.

Recommended local layout:

```text
~/Documents/task-deck                 stable/main clone
~/Documents/task-deck-manager-actions stable/current manager-action QA clone when needed
```

Keep development isolation through separate clone path, branch, and `PORT` when parallel or risky work requires it.

## Update policy

Update this file only when the short-term execution order or sequencing rationale changes.

Do not copy full issue bodies here.
Do not track completion state here beyond the current priority order.
