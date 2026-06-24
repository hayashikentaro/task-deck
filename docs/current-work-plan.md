# Current Work Plan

This document records the current short-term work order for AI-assisted TaskDeck development.

GitHub Issues remain the source of truth for actionable work, open/closed state, detailed acceptance criteria, and task completion state. This document only records current sequencing rationale.

## Current priority order

1. Document and enforce the TaskDeck actor protocol boundary.
2. Read-only global manager MVP: complete.
3. Minimum manager action/write path through `taskdeckctl`: implemented for ack, review, and close.
4. Manager action discoverability and runtime action guide: implemented enough to support real manager sessions.
5. Codex work sessions use the App Server-first route as the only committed task launch surface on this branch.
6. App Server dynamic human-decision requests through `taskdeck.request_decision`: implemented behind `TASKDECK_CODEX_DYNAMIC_DECISION_TOOL=1`.
7. Mobile decision auto-delivery to originating App Server threads: implemented behind `TASKDECK_DECISION_AUTO_DELIVER=1`.
8. Next phase: rebuild the manager-mediated main/sub-session loop only on App Server-native semantics; do not add stdout-marker or request-file shortcuts.
9. Resume broader product work such as Electron packaging, non-Codex provider support, external configuration, and broader decision workflow policy only after the local implementation loop is stable.

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

## Completed manager action discoverability baseline

TaskDeck now has the baseline needed for real manager sessions to discover supported actions at runtime.

The completed or established scope includes:

- generated manager-readable action guidance;
- generated capabilities file shape;
- manager environment pointers such as `TASKDECK_MANAGER_ACTIONS_FILE` and `TASKDECK_MANAGER_CAPABILITIES_FILE`;
- manager bootstrap instructions that tell the manager to read role guidance and runtime action files;
- per-event suggested actions for currently supported actions;
- a strict rule that generated action guidance must not list unsupported future commands.

This does not mean manager-to-session messaging is implemented. It means the runtime capability surface is ready to expose that command only after the server and `taskdeckctl` support it end-to-end.

## Current phase: Codex App Server-first route

TaskDeck's Codex work-session route is the structured `codex --sandbox danger-full-access --ask-for-approval never app-server --listen stdio://` adapter, not the Codex TUI transcript.

The intended direction is:

```text
TaskDeck UI
  -> TaskDeck server
  -> Codex App Server runtime over stdio JSON
  -> App Server threads / structured turns / command output / user-input requests
  -> TaskDeck task state, logs, and supervision UI
```

The committed `Codex App Server` profile is the only exposed task launch profile on this branch and runs `codex --sandbox danger-full-access --ask-for-approval never app-server --listen stdio://` directly in the TaskDeck server environment. This branch assumes TaskDeck server itself is already running in the intended agent environment. Use ignored local config only if a machine needs to wrap that command, for example by launching a separate container. A TaskDeck Codex task should be treated as an App Server thread session hosted by the shared App Server runtime. The route uses `danger-full-access` and `approvalPolicy: "never"` for the App Server runtime, App Server threads, and App Server turns to avoid nested Codex sandbox setup and command approval prompts. Interactive Codex CLI/TUI profiles, non-Codex providers, shell profiles, and file/request-based sub-session launches are not committed product routes while the App Server thread model is rebuilt.

During this App Server-only migration slice, TaskDeck may render Codex native subagent events as read-only native subagent cards. Those cards are App Server thread projections, not independently launched TaskDeck sessions, and must not expose direct subagent input routing or any other independently commandable control surface.

When `TASKDECK_CODEX_DYNAMIC_DECISION_TOOL=1`, TaskDeck registers the `taskdeck.request_decision` dynamic tool for App Server threads. A running session can request a human decision by sending bounded decision content; TaskDeck resolves the session identity server-side and sends the request through Decision Gateway. The returned decision URL is for awareness while TaskDeck waits for a received decision result.

When `TASKDECK_DECISION_AUTO_DELIVER=1`, a valid matched mobile decision is automatically delivered back to the originating App Server thread as a scoped new turn. The normal product flow is mobile approval, TaskDeck lease validation, then App Server turn delivery. PC action is reserved for unmatched, stale, duplicate, or blocked delivery states.

Implementation priorities for this phase:

1. Keep App Server as the only committed Codex work-session profile.
2. Keep App Server as the only exposed task launch profile until the App Server thread/session model is stable.
3. Keep App Server JSON hidden from normal task logs while rendering human-readable assistant text, command output, and request state.
4. Route App Server user-input requests through TaskDeck UI controls rather than raw transcript prompts.
5. Keep dynamic decision requests and decision delivery on App Server-native paths, not request files, PTY/stdin, stdout markers, or manager action commands.
6. Make native subagent rendering and manager-loop flows App Server-compatible before broadening feature work.
7. Do not add Codex TUI parsing or committed Codex CLI/TUI launch profiles on this branch.

## Next phase: manager-mediated implementation loop (#64)

The manager-mediated implementation loop remains the next product workflow goal. It must build on the App Server-first Codex route and preserve the same TaskDeck actor boundaries.

Do not implement this loop by adding stdout marker parsing, request-file writers, or request-directory environment variables. The next viable path is App Server-native: either supervise Codex native subagent events as read-only cards or add a new server-owned action protocol that is explicitly documented and exposed by the running server.

The goal is to make TaskDeck support a real implementation loop with these roles:

```text
User
  -> gives work direction and final authority

Main session
  -> owns the specification and implementation plan
  -> acts as reviewer
  -> decides follow-up instructions or closure

Sub-sessions
  -> future App Server-native bounded work sessions, not stdout-marker or request-file sessions
  -> report blocked / ready_for_review / done / failed only after a supported reporting path exists

TaskDeck Manager
  -> acts as messenger and control-plane executor
  -> reads manager inbox and generated action guide
  -> delivers supported messages/actions through taskdeckctl
  -> acknowledges handled events
  -> marks reviewed work reviewed
  -> closes no-longer-needed sessions
```

The manager is not the specification owner and not the implementer. The main session owns specification and review. Sub-sessions own bounded implementation. The manager moves messages and executes supported TaskDeck actions through the server-owned command boundary.

The next missing capability is bounded manager-to-session messaging.

The expected direction is:

```text
Manager
  -> taskdeckctl supported message action
  -> TaskDeck server validates / dedupes / logs
  -> server delivers message to the target session
```

The likely command shape is:

```sh
taskdeckctl send-task-input --target-task <taskId> --message <message>
```

That command must not appear in generated manager action guidance until it is implemented end-to-end in both `taskdeckctl` and the server action validator/executor.

## Implementation order for #64

Prefer small, testable slices:

1. Document the App Server-native role model and avoid implying that stdout-marker or request-file sub-session routes exist.
2. Implement one bounded manager-to-session message action through `taskdeckctl` and the server-owned manager action endpoint.
3. Decide whether sub-session work is represented by Codex native subagent events or by a new TaskDeck server-owned action; document that protocol before exposing it.
4. Add generated suggested actions only for actions that the running server and `taskdeckctl` support.
5. QA one full local loop before broadening the action set.

The first full-loop QA target is:

```text
user gives goal to main session
main session triggers an App Server-native sub-work path that TaskDeck explicitly supports
sub-work reports blocked or ready_for_review through that supported path
manager sees the supported event
manager sends a bounded message to the main session
main session reviews or provides follow-up
manager acknowledges / reviews / closes as appropriate
```

## Why this order

- The current architectural focus is the App Server-first local TaskDeck implementation loop, not provider expansion, desktop packaging, or external decision services.
- The App Server route gives TaskDeck structured Codex turns, command output, and user-input requests instead of relying on Codex TUI transcript interpretation.
- Worker agents should continue to communicate through append-only files and bounded status/reporting surfaces.
- Worker sessions are project-bound; the manager session is a global TaskDeck supervisor launched from the TaskDeck control/document root.
- Manager reads are file-based and global across projects: manager inbox, generated readable views, and file change notifications.
- Manager writes should not be raw Web API calls, direct cross-agent commands, or direct edits to TaskDeck state.
- The manager-facing write path is `taskdeckctl` calling a local IPC endpoint owned by TaskDeck server.
- TaskDeck server remains the only actor that validates, dedupes, logs, executes mutations, and coordinates session effects.
- A real implementation loop needs a messenger, but the messenger must still be bounded by generated runtime capabilities.

## Current constraints

- Do not use Codex TUI or terminal transcript output as machine control data.
- Do not add new Codex TUI parsing when the same behavior belongs in the App Server adapter path.
- Do not add request-file writers or stdout marker blocks as the App Server control path.
- Do not use platform-native multi-agent/sub-agent tools as independently commandable TaskDeck sessions.
- TaskDeck branch work uses `git worktree`: one worktree, one branch, one purpose.
- Do not create disposable full clones for TaskDeck branch work.
- Do not let non-manager agents command other agents directly.
- Do not launch the manager inside an individual project workspace; launch it from the TaskDeck control/document root.
- Do not expose a manager Web API endpoint as the manager-facing write path.
- Do not show unsupported future commands in generated manager-readable action guidance.
- Do not let the manager become the spec owner for the implementation loop; the main session owns spec and review.
- Do not start a SQLite migration as part of the immediate manager-mediated implementation loop work.
- Do not start tmux/session reattach work as part of the immediate manager-mediated implementation loop work; see #60 for future recovery tracking.

## Primary design docs

- `docs/taskdeck-actor-protocol.md`
- `docs/agents/roles/taskdeck-manager.md`

## Primary issue

- #64 Build manager-mediated main/sub-session implementation loop

## Branch worktree lifecycle

Use the main repository as the base development checkout. Create one worktree per branch and purpose for parallel development.

Remote GitHub branches are the durable source of truth. A branch task is complete only after intended changes are committed and pushed.

## Update policy

Update this file only when the short-term execution order or sequencing rationale changes.

Do not copy full issue bodies here.
Do not track completion state here beyond the current priority order.
