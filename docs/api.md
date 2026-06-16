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

`POST /api/diagnostics/containers/:containerName/start` starts a configured diagnostic container when it exists but is stopped.

## Cwd Validation

`POST /api/validate-cwd` accepts:

```json
{ "cwd": "apps/web" }
```

It returns whether the cwd resolves to an existing directory, its absolute path, and git-repository status. The task form uses it to validate cwd before starting a task.

## Attachments

`POST /api/attachments` accepts raw `image/png`, `image/jpeg`, or `image/webp` bodies with `X-TaskDeck-Filename` and returns a pending image attachment. The task composer uses this for its `+` image button. Uploaded image paths are appended to task input as attachment context.

## Tasks

`GET /api/tasks` and `GET /api/tasks/:taskId` return persisted task metadata including the launch command, cwd, agent profile fields, legacy session fields when present, parent/child metadata, and child reported status.

The server still recognizes the legacy `taskdeck-manager` agent profile id as a global manager session marker for manager protocol safety. The committed App Server route does not ship a Codex TUI manager profile. If a task has that profile id, the server ignores any client-selected project cwd, launches it from the document/control root, marks the task with `isManager`, injects a manager-only bootstrap instruction that points at `docs/agents/roles/taskdeck-manager.md`, and injects manager inbox/readable environment variables that point to the actual runtime `dataRoot` files documented in `docs/taskdeck-actor-protocol.md`. Normal worker sessions do not receive these manager-only instructions or manager action environment variables.

`PATCH /api/tasks/:taskId/title` updates the TaskDeck display name used to identify a task/session. When a task has legacy external session metadata, the display name may also be stored against that session key for persisted compatibility. Tasks without session metadata update their own task title.

`PATCH /api/tasks/:taskId/attention/acknowledge` clears the current attention event for a running task without stopping or modifying its active process. The task stores `attentionAcknowledgedAt`, returns to Not now by setting `attentionState` to `none`, and can surface again when future prompt, App Server request, or quiet detection sets a new attention state.

`DELETE /api/tasks` bulk-clears non-running tasks and their logs while preserving active tasks. `DELETE /api/tasks/:taskId` clears a single task; clearing an individual running task stops its active App Server process or PTY and removes that task.

`GET /api/tasks/:taskId/logs?tail=200000` returns a bounded persisted log tail for output replay. `GET /api/tasks/:taskId/diff` returns compact diff context for task review.

## Presets

TaskDeck stores the 10 most recent task presets by `command` and `cwd` so common task shapes can be restarted quickly. `GET /api/presets` reads them, and `DELETE /api/presets` clears them.
