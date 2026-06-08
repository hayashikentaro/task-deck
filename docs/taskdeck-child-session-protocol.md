# TaskDeck Child Session Request Protocol

This document defines the MVP protocol for asking TaskDeck to launch child agent sessions from a parent session's terminal output.

The current MVP includes this protocol document, a pure parser/validator, task metadata plumbing, parent-output detection, modal-free auto-launch for valid requests, initial instruction sending, parent-to-child message routing, and minimal child metadata UI. Worktree automation and broader parent/child coordination flows remain out of scope.

## Current Transport Status

This stdout marker transport is currently a **manual/debug transport**. It is known to work from clean shell-like sessions such as `zsh`, where the terminal output contains the exact marker lines and valid JSON content.

It is **not reliable as the primary transport for Codex parent sessions**. Codex-style terminal UIs can render user input, assistant output, command summaries, bullets, indentation, transcript folding, and line wrapping into the visible task output. That can corrupt what TaskDeck sees as the block content, causing nested-block or invalid-JSON rejections even when the logical request is valid.

For now:

- use this stdout protocol for zsh/manual smoke tests and controlled debug output;
- do not use stdout marker blocks as the Codex parent control channel;
- keep parent-to-child request semantics, parser validation, target resolution, and dedupe behavior as useful protocol work;
- use the file-based request writer for Codex parent operation.

Issue #44 adds the first file-based child-to-TaskDeck transport: child sessions report constrained promise-like states such as `working`, `blocked`, `ready_for_review`, `done`, and `failed` through a latest-status JSON file. Parent-created child session requests now also have a file-based intake so Codex parents can run a writer script instead of printing protocol JSON through a human-oriented terminal UI.

## Purpose

A parent agent may request one or more child sessions by writing a file-based request through TaskDeck's writer script. Shell-like parent sessions may also emit structured stdout marker blocks for manual/debug use. TaskDeck validates valid requests and auto-launches child sessions without a confirmation modal.

This protocol intentionally allows only structured launch metadata. Parent agents must not provide raw commands, shells, environment variables, secrets, or approval bypass flags.

## Request Block

Wrap a single JSON object between these exact markers:

```text
TASKDECK_CHILD_SESSION_BATCH_REQUEST
{
  "version": 1,
  "reason": "Split independent documentation and UI work into isolated child sessions.",
  "sessions": [
    {
      "title": "Document child session protocol",
      "agentProfileId": "codex",
      "agentPermissionLevel": "full_access",
      "agentReasoningEffort": "high",
      "cwd": "/Users/hayashikentarou/Documents/task-deck",
      "workPackageId": "issue-29-protocol-docs",
      "filesLikelyToChange": [
        "docs/taskdeck-child-session-protocol.md",
        "AGENTS.md"
      ],
      "initialInstruction": "You are working on hayashikentaro/task-deck. First read AGENTS.md. Before editing files, create or switch to an isolated branch/worktree for this work package. Stop and report if worktree/branch isolation is unsafe, unrelated changes exist, or the assigned file scope overlaps with another active child session. When finished, commit and push your child branch, then report the branch name, commit SHA, push status, verification results, and merge notes. Do not merge into the parent branch unless explicitly assigned as the integration session. Then implement the protocol documentation foundation for issue #29."
    }
  ]
}
END_TASKDECK_CHILD_SESSION_BATCH_REQUEST
```

The content between the markers must be valid JSON. Markdown fences around the block are allowed in human-readable output, but the markers themselves are the protocol boundary.

Parent agents should not hand-write this JSON. The preferred path is for the agent to fill typed fields and let TaskDeck-owned code serialize the final block with `JSON.stringify`, such as `createChildSessionBatchRequestBlock` in `apps/web/src/childSessionRequestGenerator.ts`. Fixed serialization prevents common malformed-output failures such as missing braces, raw newlines inside string values, missing top-level closing braces, and omitted required work package metadata.

The stdout marker transport remains strict JSON. Do not make the parser more permissive to compensate for LLM-authored JSON. Generate the block from structured fields when available, then print the generated block exactly.

## File-Based Request Writer

Codex parent sessions should use the file-based writer instead of stdout marker blocks. The parent fills ordinary CLI arguments; fixed code builds the JSON request and writes it atomically to TaskDeck's request queue.

Example:

```sh
node scripts/write-child-session-request.mjs \
  --title "Codex low child session" \
  --work-package codex-low-standby \
  --instruction "You are working on hayashikentaro/task-deck. First read AGENTS.md. Do not edit files yet. Report that you are ready and wait for a scoped parent instruction."
```

Defaults:

- `--profile codex`
- `--permission read_only`
- `--reasoning low`
- `--cwd .`
- `--reason "Create a child session using the file-based TaskDeck request writer."`
- `--file` may be repeated for `filesLikelyToChange`.

The writer reads `TASKDECK_TASK_ID` from the parent task environment and writes:

```text
.taskdeck/requests/child-session/<requestId>.request.json
```

It writes to a `.tmp` file first, then renames to `.request.json`. The script may print a short human-readable summary and file path, but it must not print `TASKDECK_CHILD_SESSION_BATCH_REQUEST` marker blocks.

TaskDeck server polls this directory, validates request files, launches valid requests through trusted local agent profiles, and writes one result file:

```text
.taskdeck/requests/child-session/<requestId>.accepted.json
.taskdeck/requests/child-session/<requestId>.rejected.json
```

Accepted result shape:

```json
{
  "kind": "childSessionRequestResult",
  "version": 1,
  "requestId": "codex-low-standby-20260608120000-a1b2c3",
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
  "requestId": "codex-low-standby-20260608120000-a1b2c3",
  "state": "rejected",
  "error": "parentTaskId \"task_xxx\" does not match an existing task.",
  "processedAt": "2026-06-08T12:00:01.000Z"
}
```

Parent agents must not hand-write request JSON files. They should run the writer with CLI arguments and let the writer serialize JSON. `cwd` defaults to `.` and must be TaskDeck-server-visible or server-resolvable; the writer rejects container-only `/workspace/...` paths.

## JSON Shape

Top-level object:

- `version`: protocol version. Use `1`.
- `reason`: short explanation of why child sessions are being requested.
- `sessions`: non-empty array of child session requests.

Each `sessions[]` item:

- `title`: user-facing task title for the child session.
- `agentProfileId`: configured TaskDeck agent profile id to use.
- `agentPermissionLevel`: permission level for the selected agent profile, when applicable. Accepted values are `full_access`, `workspace_write`, and `read_only`.
- `agentReasoningEffort`: optional Codex reasoning effort for Codex child sessions. Accepted values are `low`, `medium`, `high`, and `xhigh`. Missing or invalid values are treated as default/unset. Non-Codex child sessions ignore this field.
- `cwd`: intended working directory for the child session. This must be a TaskDeck-server-visible host path, not the container-visible path seen by an agent running inside Docker.
- `workPackageId`: stable id for this work package. Use it in branch/worktree names when useful.
- `filesLikelyToChange`: array of repo-relative paths or globs the child session is expected to touch.
- `initialInstruction`: complete instruction prompt for the child session.

## Working Directory Semantics

`cwd` is resolved and validated by the TaskDeck server before launch. Therefore parent agents must provide the host-side path that the TaskDeck server can stat.

For Docker-backed profiles, do **not** put the container path from the parent agent's `pwd` into the request. A Codex parent running inside the sandbox may see:

```text
/workspace/task-deck
```

but the request should use the corresponding host-visible path, for example:

```text
/Users/hayashikentarou/Documents/task-deck
```

TaskDeck then derives the container workdir from the configured project root and rewrites the trusted local profile command's `docker exec -w ...` value. In other words:

```text
request cwd:              /Users/hayashikentarou/Documents/task-deck
launched Docker workdir:   /workspace/task-deck
```

Parent agents must not infer or supply raw Docker launch commands. They only request a host-visible `cwd`; TaskDeck owns the host-to-container mapping.

If a parent agent is unsure which host path corresponds to its current container path, it should stop and ask the user or use a documented TaskDeck-provided context value rather than guessing from `pwd`.

## Forbidden Fields

Child session launch and message requests must not contain these fields at any depth:

- `command`
- `rawCommand`
- `shell`
- `env`
- `secrets`
- `autoApprove`

TaskDeck must reject any request containing forbidden fields. Parent agents are not allowed to provide raw launch commands. TaskDeck chooses the launch command from trusted local agent profile configuration.

## TaskDeck Behavior

For the MVP, TaskDeck should:

- scan file-based child session request files written by `scripts/write-child-session-request.mjs`;
- write accepted/rejected result files for file-based requests;
- detect request blocks in parent session output;
- parse the JSON between the markers;
- validate protocol version, required fields, field types, permission values, and forbidden fields;
- validate requested profiles, cwd, file scope, and code-editing policy against local policy when that policy layer is implemented;
- auto-launch valid requests without a confirmation modal;
- reject invalid requests and surface a concise error to the parent session/user;
- never execute raw launch commands supplied by a parent agent.

Worktree creation is not performed by TaskDeck in this MVP. Branch/worktree isolation is handled by the child session's `initialInstruction` and by the child agent following repository rules.

## Child Task Metadata

When TaskDeck launches a child session from a valid request, the resulting task should carry metadata that links it back to the parent request:

- `parentSessionId`: the parent task/session id that emitted the request.
- `spawnedFromParentRequest`: `true` for tasks created from this protocol.
- `workPackageId`: copied from the child session request when provided.
- `filesLikelyToChange`: copied from the child session request when provided.

These fields are task metadata. Parent agents request `workPackageId` and `filesLikelyToChange`, but they do not supply `parentSessionId` or `spawnedFromParentRequest` directly.

## Parent-To-Child Message Request

After a child session exists, a parent session may send a follow-up instruction by emitting a second structured block:

```text
TASKDECK_CHILD_SESSION_MESSAGE_REQUEST
{
  "version": 1,
  "target": {
    "childSessionId": "task_xxx",
    "workPackageId": "issue-30-runtime"
  },
  "message": "Please report your current status and whether you need more input.",
  "reason": "Manual status check."
}
END_TASKDECK_CHILD_SESSION_MESSAGE_REQUEST
```

The `target` object must include at least one of:

- `childSessionId`: exact child task id.
- `workPackageId`: work package id for a child task spawned by the same parent.

For the MVP, TaskDeck resolves exactly one existing child task. `childSessionId` matching is exact and must still identify a child of the emitting parent. `workPackageId` matching is limited to tasks whose `parentSessionId` is the emitting parent task id and whose `spawnedFromParentRequest` is true. Missing, ambiguous, non-child, non-running, or locked targets are rejected with a concise status message.

TaskDeck sends the message through the existing task input path and wraps it so the child can see the source:

```text
Parent instruction from <parent title or id>:
<message>
```

Child session output is not treated as a source for message routing requests.

## Current Operational Limitations

This stdout-based request transport assumes clean terminal output. It should be considered verified for shell-like parent sessions that can emit exact marker blocks, such as `zsh` smoke tests.

It is currently not considered verified for natural Codex-parent operation. In observed manual testing, asking a Codex parent to "create a child session" caused Codex to print a human-formatted protocol block. The rendered output included bullets, indentation, line wrapping, and surrounding command/transcript text, which can break JSON parsing or trigger nested-block rejection.

Additionally, a Codex parent running inside Docker may see a container path such as `/workspace/task-deck` from `pwd`. That path is not the correct `cwd` value for the request unless TaskDeck itself is also running in that same filesystem namespace. Use the TaskDeck-server-visible host path in the request and let TaskDeck rewrite the Docker workdir.

Do not rely on a Codex parent session printing stdout blocks as the control mechanism. Use `scripts/write-child-session-request.mjs` for Codex parent-created child sessions.

## Child Status File Report

Child-to-TaskDeck reporting is intentionally constrained to latest-status reporting. It is not a general child-to-parent chat channel, message bus, or artifact transport.

TaskDeck provides these environment variables to launched PTYs:

- `TASKDECK_TASK_ID`: current task id.
- `TASKDECK_PARENT_TASK_ID`: parent task id when the task was spawned from a parent request.
- `TASKDECK_WORK_PACKAGE_ID`: work package id when available.
- `TASKDECK_STATUS_FILE`: absolute path where the child should write its latest status report.

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
- `detailsFile`: optional path to a Markdown details file. TaskDeck treats this as a path/reference and does not render large Markdown content in this MVP.
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

TaskDeck polls status files, ignores `.tmp` files, validates JSON shape, and stores only the latest reported state on the task. A child reporting `done` does not automatically stop or delete the task. A child reporting `failed` does not automatically kill the PTY.

Supervision behavior:

- `blocked`, `ready_for_review`, and `failed` are attention-worthy.
- `working` and `done` do not demand attention by themselves.

Free-form child-to-parent protocol blocks are not supported in this MVP. Use `summary`, `artifacts`, and `detailsFile` for bounded reporting.

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

## MVP Parser Validation

The initial pure parser/validator rejects a request block when:

- markers are malformed, nested, unterminated, or appear in an unexpected order;
- JSON is invalid;
- `version` is unsupported;
- `reason` is present but not a string;
- `sessions` is missing, not an array, or empty;
- a session item is not an object;
- required session fields are missing or empty;
- `agentPermissionLevel` is present but not one of `full_access`, `workspace_write`, or `read_only`;
- `workPackageId` is present but not a string;
- `filesLikelyToChange` is present but not an array of strings;
- any forbidden field appears;

The parser is intentionally pure. It does not auto-launch sessions, inspect repository state, manage worktrees, infer whether work is code-editing, or search `initialInstruction` text for isolation-preflight wording.

`agentReasoningEffort` is normalized rather than rejected. Valid values are preserved for Codex child sessions; invalid, non-string, or missing values become default/unset.

## Protocol And Local-Policy Validation

Beyond parser-level structural validation, TaskDeck and parent agents should treat these as protocol or local-policy requirements:

- `filesLikelyToChange` should be present for code-editing work.
- `initialInstruction` should include the required isolation preflight for code-editing work.
- `cwd` must be a TaskDeck-server-visible host path. Container-only paths such as `/workspace/...` must not be used as request `cwd` unless TaskDeck itself can stat that path.
- `cwd`, profile, permission, and file scope should pass local policy before launch.
- Child sessions must stop and report when branch/worktree isolation is unsafe.
- Child sessions must stop and report when unrelated uncommitted changes exist.
- Child sessions must stop and report when assigned file scope conflicts with another active child session.
- Child sessions must push their child branches before reporting completion.
- Parent or integration sessions must merge child branches in dependency-aware order.

These policy checks may be enforced by future TaskDeck validation, local configuration, or child-session instructions. Do not describe them as implemented parser behavior until that enforcement exists.

## Security Boundary

This protocol is a request format, not an authority boundary by itself. Trust decisions come from TaskDeck configuration, validation, local policy, and the selected agent profile.

Parent agents may propose child work, but they may not smuggle execution details through raw commands, environment variables, secrets, or auto-approval flags.
