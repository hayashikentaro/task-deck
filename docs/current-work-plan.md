# Current Work Plan

This document records the current short-term work order for AI-assisted TaskDeck development.

GitHub Issues remain the source of truth for actionable work, open/closed state, detailed acceptance criteria, and task completion state. This document only records current sequencing rationale.

## Current priority order

1. Document and enforce the TaskDeck actor protocol boundary.
2. Read-only global manager MVP: complete.
3. Next phase: manager action/write path.
4. Resume broader product work such as Electron packaging, Claude support, and external configuration after the manager control plane boundary is stable.

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
- no `STATUS ERROR` from manager status parsing;
- no `taskdeckctl` or manager write path yet in the completed read-only MVP baseline.

## Next phase

Next phase: manager action/write path. The minimum practical merge line is `taskdeckctl` over local IPC with ack, review, and close actions only.

This phase includes:

- `taskdeckctl`;
- local IPC / Unix socket;
- manager action schema;
- server-side manager action executor;
- ack, review, and close actions first;
- spawn-child actions later;
- any future worker command delivery.

## Why this order

- The current architectural focus is the manager control plane, not provider expansion or desktop packaging.
- Worker agents should continue to communicate through append-only files and bounded status/reporting surfaces.
- Worker sessions are project-bound; the manager session is a global TaskDeck supervisor launched from the TaskDeck control/document root.
- Manager reads are file-based and global across projects: manager inbox, generated readable views, and file change notifications.
- Proving that a real manager agent can read and understand the manager inbox was the required prerequisite before manager writes.
- Manager writes should not be raw Web API calls, raw terminal writes, or direct edits to TaskDeck state.
- The current manager write path is `taskdeckctl` calling a local IPC endpoint owned by TaskDeck server, limited to ack, review, and close before merge.
- TaskDeck server remains the only actor that validates, dedupes, logs, executes mutations, and delivers PTY input.

## Current constraints

- Do not use Codex TUI or terminal transcript output as machine control data.
- Do not use platform-native multi-agent/sub-agent tools as TaskDeck child sessions.
- Do not let non-manager agents command other agents directly.
- Do not let manager agents write directly into worker terminals.
- Do not launch the manager inside an individual project workspace; launch it from the TaskDeck control/document root.
- The read-only manager behavior is already validated; keep the current manager write scope limited to ack, review, and close before merging.
- Do not expose a manager Web API endpoint as the first manager write path.
- Do not start a SQLite migration as part of the immediate manager control plane work.
- Do not start tmux/session reattach work as part of the immediate manager control plane work; see #60 for future recovery tracking.

## Primary design docs

- `docs/taskdeck-actor-protocol.md`
- `docs/taskdeck-child-session-protocol.md`

## Update policy

Update this file only when the short-term execution order or sequencing rationale changes.

Do not copy full issue bodies here.
Do not track completion state here beyond the current priority order.
