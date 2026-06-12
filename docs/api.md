# TaskDeck Local API

TaskDeck exposes a local REST API for the web UI and related operator actions. The API is intended for local use with the TaskDeck server, not as a public network service.

## Routes

```text
GET /api/context
GET /api/diagnostics
POST /api/diagnostics/containers/:containerName/start
POST /api/validate-cwd
POST /api/attachments
GET /api/tasks
DELETE /api/tasks
GET /api/agent-sessions
PATCH /api/agent-sessions/:sessionKey/label
GET /api/tasks/:taskId
PATCH /api/tasks/:taskId/title
PATCH /api/tasks/:taskId/attention/acknowledge
DELETE /api/tasks/:taskId
GET /api/tasks/:taskId/logs
GET /api/tasks/:taskId/logs?tail=200000
GET /api/tasks/:taskId/diff
GET /api/presets
DELETE /api/presets
```

## Context

`GET /api/context` returns the TaskDeck app repository root, document/control root, runtime data root, default cwd, server cwd, shell, path separator, git-repository status, in-repository cwd suggestions, configured project suggestions, and configured agent profiles for task creation.

## Diagnostics

`GET /api/diagnostics` returns Docker reachability, merged agent-profile config sources, configured agent-container status, and configured container workspace checks. The right-rail Agent Diagnostics panel surfaces this server diagnostics API in the UI.

`POST /api/diagnostics/containers/:containerName/start` starts a configured diagnostic container when it exists but is stopped. Agent Diagnostics can also start dedicated Codex auth tasks for container-side `codex logout` and `codex login --device-auth`, so auth commands do not get typed into an already-running agent TUI.

## Cwd Validation

`POST /api/validate-cwd` accepts:

```json
{ "cwd": "apps/web" }
```

It returns whether the cwd resolves to an existing directory, its absolute path, and git-repository status. The task form uses it to validate cwd before starting a task.

## Attachments

`POST /api/attachments` accepts raw `image/png`, `image/jpeg`, or `image/webp` bodies with `X-TaskDeck-Filename` and returns a pending image attachment. The terminal composer uses this for its `+` image button. Uploaded image paths are appended to the PTY input as attachment context.

## Saved Agent Sessions

`GET /api/agent-sessions` returns saved Codex sessions derived from stored task metadata and Codex's container-side session JSONL storage under `/home/dev/.codex/sessions`.

Sessions require a Codex provider, session id, and precise resume command. The server excludes obvious synthetic ids such as e2e/smoke/fake/test ids and deduplicates by provider, agent profile, command environment, and session id. Container-side `/workspace` cwd values are mapped back to the host bind source when Docker mount information is available.

`PATCH /api/agent-sessions/:sessionKey/label` updates the TaskDeck display name used for a saved session.

## Tasks

`GET /api/tasks` and `GET /api/tasks/:taskId` return persisted task metadata including the launch command, cwd, agent profile fields, session fields, parent/child metadata, child reported status, and Codex-specific launch metadata when present. `agentReasoningEffort` is present for Codex tasks started with a non-default reasoning effort and is omitted or empty for default reasoning and non-Codex tasks.

Tasks started with the built-in `taskdeck-manager` agent profile are global manager sessions. The server ignores any client-selected project cwd for that profile, launches it from the document/control root, marks the task with `isManager`, and injects manager inbox/readable environment variables that point to the actual runtime `dataRoot` files documented in `docs/taskdeck-actor-protocol.md`.

`PATCH /api/tasks/:taskId/title` updates the TaskDeck display name used to identify a task/session. When a task has an external session id, the display name is stored against that session key so matching task cards and the saved-session dropdown show the same human-readable label. Tasks without a detected session id still update their own task title.

`PATCH /api/tasks/:taskId/attention/acknowledge` clears the current attention event for a running task without stopping or modifying its PTY. The task stores `attentionAcknowledgedAt`, returns to Not now by setting `attentionState` to `none`, and can surface again when future prompt or quiet detection sets a new attention state.

`DELETE /api/tasks` bulk-clears non-running tasks and their logs while preserving active tasks. `DELETE /api/tasks/:taskId` clears a single task; clearing an individual running task stops its PTY and removes that task.

`GET /api/tasks/:taskId/logs?tail=200000` returns a bounded persisted log tail for terminal replay. `GET /api/tasks/:taskId/diff` returns compact diff context for task review.

## Presets

TaskDeck stores the 10 most recent task presets by `command` and `cwd` so common task shapes can be restarted quickly. `GET /api/presets` reads them, and `DELETE /api/presets` clears them.
