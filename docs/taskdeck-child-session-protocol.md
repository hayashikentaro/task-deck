# TaskDeck Child Session Protocol

This document describes the supported file-based protocol for TaskDeck parent/child session coordination.

The active control path for App Server parent sessions is file-based. Parent agents run TaskDeck writer scripts with ordinary CLI arguments. The writer scripts build JSON with fixed code, write request files under `.taskdeck/requests/`, and TaskDeck server reads those files.

Parent agents must not hand-write protocol JSON. Parent agents must not print stdout marker blocks as the App Server control path.

Parent agents must not use platform-native multi-agent or sub-agent tools such as `multi_agent_v1.spawn_agent` to create TaskDeck child sessions. A platform-native sub-agent is not a TaskDeck child session because TaskDeck cannot supervise it, route file-based messages to it, or track its task metadata.

## Supported Transports

### Parent to TaskDeck: file-based request files

Use file-based request files for App Server parent control operations.

Currently implemented:

- create child session requests via `scripts/write-child-session-request.mjs`.
- send follow-up messages from a parent session to an existing child session via a file-based message request writer.

### Child to TaskDeck: status files

Child sessions report bounded latest status by writing JSON to `TASKDECK_STATUS_FILE`.

This is already file-based and remains the supported child-to-TaskDeck reporting path.

### Unsupported: platform-native sub-agent tools

Platform-native multi-agent or sub-agent tools, including `multi_agent_v1.spawn_agent`, are not TaskDeck transports. Do not use them to create TaskDeck child sessions or to send parent-to-child instructions.

Codex App Server may still report native collaboration subagents through structured events such as `collabAgentToolCall`. TaskDeck may show those as read-only native subagent cards for supervision, but they are not file-protocol TaskDeck child sessions: TaskDeck does not launch them, does not assign `spawnedFromParentRequest`, and cannot route parent-to-child instructions to them through the child-session message protocol.

### Deprecated / debug-only stdout marker transport

Stdout marker blocks are not the App Server parent control path.

They may remain available for zsh/manual/debug smoke tests, but docs should not teach them as the normal way to create child sessions or send parent-to-child instructions.

## Create Child Session Request

An App Server parent should create a child session by running the writer script:

```sh
node scripts/write-child-session-request.mjs \
  --title "App Server child session" \
  --work-package app-server-standby \
  --instruction "You are working on hayashikentaro/task-deck. First read AGENTS.md. Do not edit files yet. Report that you are ready and wait for a scoped parent instruction."
```

Do not use `multi_agent_v1.spawn_agent` or any other platform-native sub-agent tool for this operation. Creating a TaskDeck child session means writing a TaskDeck child-session request file through this writer script.

Defaults:

- `--profile codex-app-server`
- `--cwd .`
- `--reason "Create a child session using the file-based TaskDeck request writer."`
- `--file` may be repeated for `filesLikelyToChange`.

The writer reads `TASKDECK_TASK_ID` from the parent task environment and includes it as `parentTaskId` when available.
When `TASKDECK_CHILD_SESSION_REQUEST_DIR` is present, the writer writes the request file to that directory. TaskDeck sets this environment variable for launched tasks so App Server sessions write to the same request directory that the server polls, including container-mapped paths.

The writer creates:

```text
.taskdeck/requests/child-session/<requestId>.request.json
```

It writes to a `.tmp` file first, then atomically renames to `.request.json`.

The writer may print a short human-readable summary and file path. It must not print `TASKDECK_CHILD_SESSION_BATCH_REQUEST` marker blocks.

TaskDeck server polls the request directory, validates request files, launches valid child session requests through trusted local agent profiles, and writes one result file:

```text
.taskdeck/requests/child-session/<requestId>.accepted.json
.taskdeck/requests/child-session/<requestId>.rejected.json
```

Accepted result shape:

```json
{
  "kind": "childSessionRequestResult",
  "version": 1,
  "requestId": "app-server-standby-20260608120000-a1b2c3",
  "state": "accepted",
  "createdTaskIds": ["task_xxx"],
  "processedAt": "2026-06-08T12:00:01.000Z"
}
```

Rejected result shape:

```json
{
  "kind": "childSessionRequestResult",
  "version": 1,
  "requestId": "app-server-standby-20260608120000-a1b2c3",
  "state": "rejected",
  "error": "parentTaskId \"task_xxx\" does not match an existing task.",
  "processedAt": "2026-06-08T12:00:01.000Z"
}
```

## Child Session Request File Shape

The writer creates JSON like this. Parent agents should not hand-write this file.

```json
{
  "kind": "childSessionRequest",
  "version": 1,
  "requestId": "app-server-standby-20260608120000-a1b2c3",
  "createdAt": "2026-06-08T12:00:00.000Z",
  "parentTaskId": "task_parent",
  "reason": "Create a child session using the file-based TaskDeck request writer.",
  "sessions": [
    {
      "title": "App Server child session",
      "agentProfileId": "codex-app-server",
      "cwd": ".",
      "workPackageId": "app-server-standby",
      "filesLikelyToChange": [],
      "initialInstruction": "You are working on hayashikentaro/task-deck. First read AGENTS.md. Do not edit files yet. Report that you are ready and wait for a scoped parent instruction."
    }
  ]
}
```

Top-level fields:

- `kind`: must be `childSessionRequest`.
- `version`: must be `1`.
- `requestId`: stable idempotency key for this request.
- `createdAt`: writer timestamp.
- `parentTaskId`: parent task id from `TASKDECK_TASK_ID` when available.
- `reason`: short explanation of why child sessions are being requested.
- `sessions`: non-empty array of child session requests.

Each `sessions[]` item:

- `title`: user-facing task title for the child session.
- `agentProfileId`: configured TaskDeck agent profile id to use.
- `cwd`: intended working directory for the child session. Defaults to `.` from the writer.
- `workPackageId`: stable id for this work package.
- `filesLikelyToChange`: array of repo-relative paths or globs the child session is expected to touch.
- `initialInstruction`: complete instruction prompt for the child session.

## Working Directory Semantics

`cwd` is resolved and validated by the TaskDeck server before launch.

For parent operation, prefer the writer default:

```text
cwd: .
```

Do not pass the Docker container path shown by `pwd`, such as:

```text
/workspace/task-deck
```

TaskDeck owns the host-to-container workdir mapping for Docker-backed profiles. Parent agents only request a TaskDeck-server-visible or server-resolvable cwd.

The writer rejects container-only `/workspace/...` paths.

## Forbidden Fields

Child session request files and message request files must not contain these fields at any depth:

- `command`
- `rawCommand`
- `shell`
- `env`
- `secrets`
- `autoApprove`

TaskDeck must reject any request containing forbidden fields. Parent agents are not allowed to provide raw launch commands. TaskDeck chooses the launch command from trusted local agent profile configuration.

## Child Task Metadata

When TaskDeck launches a child session from a valid request, the resulting task should carry metadata that links it back to the parent request:

- `parentSessionId`: validated parent task id.
- `spawnedFromParentRequest`: `true` for tasks created from this protocol.
- `workPackageId`: copied from the child session request when provided.
- `filesLikelyToChange`: copied from the child session request when provided.

Parent agents request `workPackageId` and `filesLikelyToChange`, but they do not directly set `parentSessionId` or `spawnedFromParentRequest`.

## Parent-To-Child Message Request

An App Server parent should send follow-up instructions to an existing child session by running the writer script:

```sh
node scripts/write-child-session-message-request.mjs \
  --work-package app-server-standby \
  --message "Please inspect issue #34 and report whether you need more context. Do not edit files."
```

Do not use `multi_agent_v1.spawn_agent` or any other platform-native sub-agent tool for this operation. TaskDeck can route parent-to-child instructions only to TaskDeck child tasks created through the file-based request protocol.

Target one child by either:

- `--work-package <id>` for a `workPackageId` scoped to the validated parent task.
- `--child-session <taskId>` for an exact child task id owned by the validated parent task.

Defaults:

- `--reason "Parent follow-up instruction."`
- `--request-id` may be provided for an explicit idempotency key.

The writer reads `TASKDECK_TASK_ID` from the parent task environment and includes it as `parentTaskId` when available.
When `TASKDECK_CHILD_SESSION_MESSAGE_REQUEST_DIR` is present, the writer writes the message request file to that directory. TaskDeck sets this environment variable for launched tasks so App Server sessions write to the same message request directory that the server polls, including container-mapped paths.

The writer creates:

```text
.taskdeck/requests/child-message/<requestId>.request.json
```

It writes to a `.tmp` file first, then atomically renames to `.request.json`.

The writer may print a short human-readable summary and file path. It must not print `TASKDECK_CHILD_SESSION_MESSAGE_REQUEST` marker blocks.

TaskDeck server polls the request directory, validates request files, resolves the target against child sessions owned by the parent task, sends valid messages through the existing task input path, and writes one result file:

```text
.taskdeck/requests/child-message/<requestId>.accepted.json
.taskdeck/requests/child-message/<requestId>.rejected.json
```

Accepted result shape:

```json
{
  "kind": "childSessionMessageRequestResult",
  "version": 1,
  "requestId": "message-app-server-standby-20260608120000-a1b2c3",
  "state": "accepted",
  "targetTaskId": "task_child",
  "processedAt": "2026-06-08T12:00:01.000Z"
}
```

Rejected result shape:

```json
{
  "kind": "childSessionMessageRequestResult",
  "version": 1,
  "requestId": "message-app-server-standby-20260608120000-a1b2c3",
  "state": "rejected",
  "error": "No child matched workPackageId app-server-standby for this parent.",
  "processedAt": "2026-06-08T12:00:01.000Z"
}
```

The writer creates JSON like this. Parent agents should not hand-write this file.

```json
{
  "kind": "childSessionMessageRequest",
  "version": 1,
  "requestId": "message-app-server-standby-20260608120000-a1b2c3",
  "createdAt": "2026-06-08T12:00:00.000Z",
  "parentTaskId": "task_parent",
  "target": {
    "workPackageId": "app-server-standby"
  },
  "message": "Please inspect issue #34 and report whether you need more context. Do not edit files.",
  "reason": "Parent follow-up instruction."
}
```

The old stdout marker path may exist for zsh/manual/debug use, but App Server parent sessions must use the writer script instead of marker blocks. This document intentionally does not describe the old marker format in detail.

## Child Status File Report

Child-to-TaskDeck reporting is constrained to latest-status reporting.

TaskDeck provides these environment variables to launched task processes, including App Server and PTY-backed profiles:

- `TASKDECK_TASK_ID`: current task id.
- `TASKDECK_PARENT_TASK_ID`: parent task id when the task was spawned from a parent request.
- `TASKDECK_WORK_PACKAGE_ID`: work package id when available.
- `TASKDECK_STATUS_FILE`: absolute path where the child should write its latest status report.
- `TASKDECK_CHILD_SESSION_REQUEST_DIR`: absolute path where a parent should write child session request files through `scripts/write-child-session-request.mjs`.
- `TASKDECK_CHILD_SESSION_MESSAGE_REQUEST_DIR`: absolute path where a parent should write child message request files through `scripts/write-child-session-message-request.mjs`.

Child sessions should not infer the status path. They should write the exact file indicated by `TASKDECK_STATUS_FILE`.

Status report JSON schema:

```json
{
  "kind": "childStatus",
  "version": 1,
  "state": "working",
  "summary": "Short optional human-readable summary.",
  "artifacts": ["optional string references"],
  "detailsFile": ".taskdeck/statuses/example.details.md",
  "updatedAt": "2026-06-07T13:00:00.000Z"
}
```

Fields:

- `kind`: must be `childStatus`.
- `version`: must be `1`.
- `state`: one of `working`, `blocked`, `ready_for_review`, `done`, or `failed`.
- `summary`: optional short string.
- `artifacts`: optional array of string references.
- `detailsFile`: optional path to a Markdown details file.
- `updatedAt`: optional string timestamp.

Write status files atomically so TaskDeck does not read partial JSON:

```sh
tmp="${TASKDECK_STATUS_FILE}.tmp"
cat > "$tmp" <<'JSON'
{
  "kind": "childStatus",
  "version": 1,
  "state": "ready_for_review",
  "summary": "Implementation is ready for review.",
  "artifacts": ["apps/web/src/App.tsx"],
  "detailsFile": ".taskdeck/statuses/issue.details.md"
}
JSON
mv "$tmp" "$TASKDECK_STATUS_FILE"
```

TaskDeck polls status files, ignores `.tmp` files, validates JSON shape, and stores only the latest reported state on the task. A child reporting `done` does not automatically stop or delete the task. A child reporting `failed` does not automatically kill the active process.

Supervision behavior:

- `blocked`, `ready_for_review`, and `failed` are attention-worthy.
- `working` and `done` do not demand attention by themselves.

Free-form child-to-parent protocol blocks are not supported in this MVP. Use `summary`, `artifacts`, and `detailsFile` for bounded reporting.

## Manager Inbox Events

Child status files remain a child-to-TaskDeck reporting path. A child still writes only its latest bounded status JSON to `TASKDECK_STATUS_FILE`, and TaskDeck still owns polling, validation, task metadata updates, and supervision attention state.

When a child task created from a parent request reports an attention-worthy status, TaskDeck also writes a manager inbox event file:

```text
.taskdeck/manager-inbox/<eventId>.json
.taskdeck/manager-inbox/<eventId>.ack.json
```

The first MVP event type is `childStatusChanged` for child states `blocked`, `ready_for_review`, and `failed`. This inbox is intended for a future dedicated manager agent. It is not a push into the parent task input, it is not a free-form child-to-parent chat channel, and it does not use platform-native sub-agent tooling.

TaskDeck also generates manager-readable views from unread valid manager events:

```text
.taskdeck/manager-readable/context.md
.taskdeck/manager-readable/unread-events.json
```

A running `TaskDeck Manager` session receives a short nudge when a new manager event is available. The nudge is not the source of truth; the manager must read the inbox and manager-readable files. For this MVP, the manager reports judgment in the terminal response only, must not write `TASKDECK_STATUS_FILE`, and must not command worker sessions directly.

Read unread valid manager inbox events with:

```sh
node scripts/read-manager-inbox.mjs
```

Read and acknowledge them with:

```sh
node scripts/read-manager-inbox.mjs --ack
```

Acknowledgement creates a sidecar `.ack.json` file and does not delete the event.

## Required Isolation Preflight

Every code-editing child session must include an isolation preflight in `initialInstruction`.

The child session must:

- read `AGENTS.md` before editing;
- avoid editing files in the shared working tree;
- create or switch to a dedicated branch/worktree before code changes;
- stop and report if the branch/worktree cannot be created safely;
- stop and report if unrelated uncommitted changes exist;
- stop and report if the assigned file scope overlaps with another active child session;
- keep changes inside the assigned work package scope.

Documentation-only child sessions should still isolate their work unless the parent instruction explicitly says the shared tree is safe for that specific task.

## Child Completion And Parent Merge Responsibility

Child sessions produce isolated work products. They do not own integration into the parent branch unless they are explicitly assigned as an integration session.

A child session is complete only after it has:

- committed the relevant changes on its child branch;
- pushed that child branch to `origin`;
- reported the branch name;
- reported the latest commit SHA;
- reported verification commands and results;
- reported changed files and any merge notes.

A child session must not merge itself into the parent or integration branch unless the prompt explicitly assigns that session to perform integration.

The parent or integration session is responsible for convergence:

- collect completed child branch reports;
- inspect dependency order and file overlap;
- merge child branches into the parent/integration branch in a deliberate order;
- run verification after each merge or after a clearly safe batch;
- resolve conflicts or send work back to the relevant child session;
- perform the final integration pass.

This means that a child task being finished in its worktree is not the same as the parent task being integrated. Until the child branch is pushed and merged by the parent/integration session, the parent branch has not received the work.

## Local Policy Validation

Beyond structural validation, TaskDeck and parent agents should treat these as protocol or local-policy requirements:

- `filesLikelyToChange` should be present for code-editing work.
- `initialInstruction` should include the required isolation preflight for code-editing work.
- `cwd` must be TaskDeck-server-visible or server-resolvable.
- requested profile, permission, reasoning effort, cwd, and file scope should pass local policy before launch.
- child sessions must stop and report when branch/worktree isolation is unsafe.
- child sessions must stop and report when unrelated uncommitted changes exist.
- child sessions must stop and report when assigned file scope conflicts with another active child session.
- child sessions must push their child branches before reporting completion.
- parent or integration sessions must merge child branches in dependency-aware order.

These policy checks may be enforced by TaskDeck validation, local configuration, or child-session instructions. Do not describe them as implemented behavior unless enforcement exists.

## Security Boundary

This protocol is a request format, not an authority boundary by itself. Trust decisions come from TaskDeck configuration, validation, local policy, and the selected agent profile.

Parent agents may propose child work, but they may not smuggle execution details through raw commands, environment variables, secrets, or auto-approval flags.
