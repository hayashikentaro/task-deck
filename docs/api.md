# TaskDeck Local API

TaskDeck exposes a local REST API for the web UI and related operator actions. The API is intended for local use with the TaskDeck server, not as a public network service.

## Routes

```text
GET /api/context
GET /api/diagnostics
POST /api/diagnostics/containers/:containerName/start
POST /api/validate-cwd
POST /api/attachments
POST /api/decision-gateway/pairing-requests
GET /api/tasks
DELETE /api/tasks
GET /api/tasks/:taskId
PATCH /api/tasks/:taskId/title
PATCH /api/tasks/:taskId/attention/acknowledge
PATCH /api/tasks/:taskId/input-lock
POST /api/tasks/:taskId/decision-request
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

## Decision Gateway

`POST /api/decision-gateway/pairing-requests` creates a phone pairing request when `DECISION_GATEWAY_URL` is configured. The server reads or generates the stable local TaskDeck instance id stored under `.taskdeck/taskdeck-instance.json`, sends `{ "taskdeckInstanceId": "...", "taskdeckLabel": "..." }` to `POST <DECISION_GATEWAY_URL>/api/pairing-requests`, and returns `{ "pairingUrl": "...", "expiresAt": "..." }` to the web UI. TaskDeck does not log the returned pairing URL, store mobile browser sessions, poll for decisions, or apply mobile decisions back to agents.

## Tasks

`GET /api/tasks` and `GET /api/tasks/:taskId` return persisted task metadata including the launch command, cwd, agent profile fields, input lock timestamp, App Server thread session identity when available, legacy session fields when present, parent/child metadata, and child reported status.

The server still recognizes the legacy `taskdeck-manager` agent profile id on stored tasks as a global manager session marker for manager protocol safety. The committed App Server route does not expose or launch a Codex TUI manager profile. Normal worker sessions do not receive manager-only instructions or manager action environment variables.

`PATCH /api/tasks/:taskId/title` updates the TaskDeck display name used to identify a task/session. When a task has legacy external session metadata, the display name may also be stored against that session key for persisted compatibility. Tasks without session metadata update their own task title.

`PATCH /api/tasks/:taskId/attention/acknowledge` clears the current attention event for a running task without stopping or modifying its active runtime. The task stores `attentionAcknowledgedAt`, returns to Not now by setting `attentionState` to `none`, and can surface again when a future App Server request, child-status report, or manager action sets a new attention state.

`PATCH /api/tasks/:taskId/input-lock` accepts `{ "locked": true }` or `{ "locked": false }` for running tasks. Locking blocks new user input without moving the task in the list. Unlocking stores a fresh activity timestamp so the operator can resume that task intentionally.

The WebSocket composer sends `{ "type": "codex-app-server-interrupt-turn", "taskId": "..." }` to stop the selected task's active Codex App Server turn. The server translates this into `turn/interrupt` with the task's current App Server `threadId` and active `turnId`; it does not close the TaskDeck task or kill the shared runtime.

`POST /api/tasks/:taskId/decision-request` sends a manual one-way decision request to Decision Gateway when `DECISION_GATEWAY_URL` is configured. TaskDeck includes source context such as task id, session id when available, agent profile, cwd, attention state, and a bounded redacted recent-output snippet. The route returns `{ "ok": true, "decisionUrl": "...", "decisionId": "...", "requestId": "..." }`. It does not change TaskDeck task state, poll for results, resume agents, or deliver decisions back.

`DELETE /api/tasks` bulk-clears tasks and their logs. `DELETE /api/tasks/:taskId` clears a single task; clearing an individual running task stops its active App Server runtime and removes that task.

`GET /api/tasks/:taskId/logs?tail=200000` returns a bounded persisted log tail for output replay. The response also includes the current global `outputSeq` and task-local `taskSeq` so the web UI can reconcile live WebSocket output with the persisted log tail after reconnects or sequence gaps.

WebSocket `output` messages include the appended `data`, global `seq`, task-local `taskSeq`, and lightweight `role`/`kind` metadata. The UI treats the persisted task log as the canonical replay source and uses the sequenced WebSocket stream only for live append updates.

`GET /api/tasks/:taskId/diff` returns compact diff context for task review.

## Presets

TaskDeck stores the 10 most recent task presets by `command` and `cwd` so common task shapes can be restarted quickly. `GET /api/presets` reads them, and `DELETE /api/presets` clears them.
