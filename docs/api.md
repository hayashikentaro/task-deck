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
GET /api/tasks/:taskId
PATCH /api/tasks/:taskId/title
PATCH /api/tasks/:taskId/attention/acknowledge
PATCH /api/tasks/:taskId/input-lock
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

`GET /api/diagnostics` returns merged agent-profile config sources and optional Docker/container diagnostics for locally configured profiles that declare diagnostic containers. The committed App Server profile does not require Docker.

`POST /api/diagnostics/containers/:containerName/start` starts a configured diagnostic container when a local profile explicitly declares one and it exists but is stopped.

## Cwd Validation

`POST /api/validate-cwd` accepts:

```json
{ "cwd": "apps/web" }
```

It returns whether the cwd resolves to an existing directory, its absolute path, and git-repository status. The task form uses it to validate cwd before starting a task.

## Attachments

`POST /api/attachments` accepts raw `image/png`, `image/jpeg`, or `image/webp` bodies with `X-TaskDeck-Filename` and returns a pending image attachment. The task composer uses this for its `+` image button. Uploaded image paths are appended to task input as attachment context.

## Tasks

`GET /api/tasks` and `GET /api/tasks/:taskId` return persisted task metadata including the launch command, cwd, agent profile fields, input lock timestamp, App Server thread session identity when available, legacy session fields when present, parent/child metadata, and child reported status.

The server still recognizes the legacy `taskdeck-manager` agent profile id on stored tasks as a global manager session marker for manager protocol safety. The committed App Server route does not expose or launch a Codex TUI manager profile. Normal worker sessions do not receive manager-only instructions or manager action environment variables.

`PATCH /api/tasks/:taskId/title` updates the TaskDeck display name used to identify a task/session. When a task has legacy external session metadata, the display name may also be stored against that session key for persisted compatibility. Tasks without session metadata update their own task title.

`PATCH /api/tasks/:taskId/attention/acknowledge` clears the current attention event for a running task without stopping or modifying its active runtime. The task stores `attentionAcknowledgedAt`, returns to Not now by setting `attentionState` to `none`, and can surface again when a future App Server request, child-status report, or manager action sets a new attention state.

`PATCH /api/tasks/:taskId/input-lock` accepts `{ "locked": true }` or `{ "locked": false }` for running tasks. Locking blocks new user input without moving the task in the list. Unlocking stores a fresh activity timestamp so the operator can resume that task intentionally.

`DELETE /api/tasks` bulk-clears tasks and their logs. `DELETE /api/tasks/:taskId` clears a single task; clearing an individual running task stops its active App Server runtime and removes that task.

`GET /api/tasks/:taskId/logs?tail=200000` returns a bounded persisted log tail for output replay. `GET /api/tasks/:taskId/diff` returns compact diff context for task review.

## Presets

TaskDeck stores the 10 most recent task presets by `command` and `cwd` so common task shapes can be restarted quickly. `GET /api/presets` reads them, and `DELETE /api/presets` clears them.
