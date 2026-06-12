# Current Work Plan

This document records the current short-term work order for AI-assisted TaskDeck development.

GitHub Issues remain the source of truth for actionable work, open/closed state, detailed acceptance criteria, and task completion state. This document only records current sequencing rationale.

## Current priority order

1. Document and enforce the TaskDeck actor protocol boundary.
2. Validate the existing manager inbox MVP on the isolated QA branch/worktree.
3. Add a dedicated manager agent profile/session.
4. Add or generate manager-readable context files for unread manager events, active tasks, child status, and relevant task summaries.
5. Wire short manager nudges when manager inbox events are available.
6. Verify the manager read loop: worker status -> manager inbox/readable files -> manager reads -> manager reports its judgment.
7. Define the manager action schema, result shape, and `taskdeckctl`/local IPC write path after the read loop is proven.
8. Add the server-side manager action executor, Unix socket endpoint, and `taskdeckctl` manager commands.
9. Resume broader product work such as Electron packaging, Claude support, and external configuration after the manager control plane boundary is stable.

## Why this order

- The current architectural focus is the manager control plane, not provider expansion or desktop packaging.
- Worker agents should continue to communicate through append-only files and bounded status/reporting surfaces.
- Manager reads are file-based: manager inbox, generated readable views, and file change notifications.
- Proving that a real manager agent can read and understand the manager inbox is more important than building the write path first.
- Manager writes should not be raw Web API calls, raw terminal writes, or direct edits to TaskDeck state.
- The intended manager write path remains `taskdeckctl` calling a local IPC endpoint owned by TaskDeck server, but it should be implemented after the read loop is validated.
- TaskDeck server remains the only actor that validates, dedupes, logs, executes mutations, and delivers PTY input.

## Current constraints

- Do not use Codex TUI or terminal transcript output as machine control data.
- Do not use platform-native multi-agent/sub-agent tools as TaskDeck child sessions.
- Do not let non-manager agents command other agents directly.
- Do not let manager agents write directly into worker terminals.
- Do not implement manager write before validating manager read behavior with a real manager session.
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
