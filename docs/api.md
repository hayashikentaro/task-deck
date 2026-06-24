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
GET /api/decision-gateway/mailbox/local
GET /api/decision-gateway/leases/local
GET /api/tasks
PATCH /api/tasks/order
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

`POST /api/decision-gateway/pairing-requests` creates a phone pairing request when `DECISION_GATEWAY_URL` is configured. The server reads or generates the stable local TaskDeck instance id stored under `.taskdeck/taskdeck-instance.json`, sends `{ "taskdeckInstanceId": "...", "taskdeckLabel": "..." }` to `POST <DECISION_GATEWAY_URL>/api/pairing-requests`, and returns `{ "pairingUrl": "...", "expiresAt": "..." }` to the web UI. TaskDeck does not log the returned pairing URL or store mobile browser sessions.

When `TASKDECK_DECISION_GATEWAY_API_TOKEN` is configured, TaskDeck adds `Authorization: Bearer <token>` to every outbound Decision Gateway TaskDeck API request: decision requests, pairing requests, mailbox polling, and mailbox acknowledgements. When the token is unset, TaskDeck sends no Authorization header. Authentication failures are reported as `Decision Gateway authentication failed.` without logging or returning the token value.

When `DECISION_GATEWAY_URL` is configured, TaskDeck polls outward to `GET <DECISION_GATEWAY_URL>/api/taskdeck/mailbox?taskdeckInstanceId=<id>&limit=20` using the same stable local `taskdeckInstanceId`. Ask decision request payloads also include `source.taskdeckInstanceId` so Decision Gateway can create mailbox items addressed back to this TaskDeck instance. `DECISION_GATEWAY_MAILBOX_POLL_MS` optionally overrides the default 30000 ms interval. Mailbox polling is disabled quietly when `DECISION_GATEWAY_URL` is missing.

Received `decision_result` mailbox items are persisted under `.taskdeck/decision-gateway-mailbox.json` before TaskDeck posts `POST <DECISION_GATEWAY_URL>/api/taskdeck/mailbox/:id/ack` with `{ "taskdeckInstanceId": "..." }`. Malformed mailbox payloads and records that fail local persistence are not acknowledged.

Outbound Ask decision requests are persisted as local leases under `.taskdeck/decision-gateway-leases.json`. A lease records `leaseId`, `decisionGatewayDecisionId`, `decisionGatewayUrl`, `requestId`, `taskId`, optional `sessionId`, App Server `threadId`, `turnId` and `callId` when available, `taskdeckInstanceId`, `status`, `createdAt`, `expiresAt`, received mailbox metadata, delivery timestamps, delivery error, and received decision payload when available. Lease statuses include `pending`, `received`, `delivered`, `delivery_failed`, `stale`, and `unmatched`; legacy `expired` and `cancelled` statuses remain loadable. `DECISION_GATEWAY_DECISION_LEASE_TTL_MS` optionally overrides the default 1800000 ms TTL.

`GET /api/decision-gateway/mailbox/local` returns locally recorded mailbox items for UI rendering. Records carry `validationStatus` as `valid`, `unmatched`, or `stale`. TaskDeck may acknowledge valid, unmatched, and stale records after local persistence.

`GET /api/decision-gateway/leases/local` returns locally recorded decision leases with their current delivery status. Pending leases are marked `stale` lazily during mailbox polling.

TaskDeck registers a Codex App Server dynamic tool on thread start by default:

```json
{
  "namespace": "taskdeck",
  "name": "request_decision",
  "inputSchema": {
    "type": "object",
    "required": ["decisionQuestion", "goal", "urgency", "semanticSummary", "materials"],
    "properties": {
      "decisionQuestion": { "type": "string" },
      "goal": { "type": "string" },
      "axis": { "type": "string" },
      "urgency": { "type": "string", "enum": ["normal", "blocking"] },
      "semanticSummary": { "type": "string" },
      "materials": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["type", "text"],
          "properties": {
            "type": { "type": "string", "enum": ["text"] },
            "label": { "type": "string" },
            "text": { "type": "string" }
          }
        }
      },
      "recommendedDecision": { "type": ["string", "null"] },
      "relevantFacts": { "type": "array", "items": { "type": "string" } },
      "risks": { "type": "array", "items": { "type": "string" } }
    }
  }
}
```

The dynamic tool is the preferred session-triggered path for human decisions. TaskDeck receives `item/tool/call`, resolves `threadId` to the active TaskDeck task/session from its own App Server runtime mapping, ignores any model-supplied routing fields, sends the request through the same Decision Gateway helper used by manual Ask, and records the same pending lease. Manual Ask from the task card remains the operator-triggered fallback when the tool is unavailable.

The tool response is a pending status and decision URL for model awareness.

Mailbox polling automatically delivers valid matched decisions back to the originating Codex App Server thread by starting a new App Server turn. TaskDeck uses only host-owned lease data and current task/thread mappings for routing. The mailbox item may be rejected as `unmatched` or `stale`, and already delivered leases are not delivered again. Delivery failure marks the lease `delivery_failed`, preserves the mailbox result locally, and surfaces the error in task state/log output. `TASKDECK_DISABLE_DYNAMIC_DECISION_TOOL=1` and `TASKDECK_DISABLE_DECISION_AUTO_DELIVER=1` are development/emergency escape hatches; they are not normal setup.

The delivered turn text is scoped to the lease and original question. It prefers the normalized mailbox payload fields `action.action` and `action.note`, delivering the action as `proceed`, `revise_plan`, or `need_more_information` with any note as additional constraints, plan feedback, or requested missing materials. Decision delivery never uses PTY/stdin injection, direct Decision Gateway-to-agent communication, file inboxes, stdout markers, remote command execution, or a broad automatic apply path.

## Tasks

## Team Templates

TaskDeck optionally reads `taskdeck.team-templates.json` from the repository root. The supported Decision Gateway-oriented templates are `decision-aware-solo`, which starts one Codex App Server task as a decision-aware solo implementation controller, and `decision-aware-loop`, which keeps one App Server task running through multiple small implementation cycles.

The `decision-aware-loop` template treats each completed cycle as a required commit unit: verify, commit, report the commit hash, confirm the working tree, then continue to the next cycle until a state-based exit condition applies. This is a prompt/template operating contract, not runtime cycle-count persistence or a change to the App Server startup flow.

Each template connects the `codex-app-server` agent profile to one team and role. Its `promptFiles` are read relative to the TaskDeck document root and prepended to the user launch instruction. These templates are small Decision Gateway-oriented slices; they are not multi-agent orchestration, Main/Worker splitting, or independently commandable subagents.

`GET /api/context` includes `teamTemplates` for launch UI use. Tasks started with a template persist `teamTemplateId`, `teamId`, `roleId`, `decisionGatewayMode`, and `decisionResultHandling` metadata while older task records without those fields remain loadable.

`GET /api/tasks` and `GET /api/tasks/:taskId` return persisted task metadata including the launch command, cwd, agent profile fields, input lock timestamp, App Server thread session identity when available, legacy session fields when present, parent/child metadata, child reported status, and `taskOrderIndex` when a manual card order is stored.

The server still recognizes the legacy `taskdeck-manager` agent profile id on stored tasks for persisted compatibility. The committed App Server route does not expose or launch a Codex TUI manager profile.

`PATCH /api/tasks/:taskId/title` updates the TaskDeck display name used to identify a task/session. When a task has legacy external session metadata, the display name may also be stored against that session key for persisted compatibility. Tasks without session metadata update their own task title.

`PATCH /api/tasks/:taskId/attention/acknowledge` clears the current attention event for a running task without stopping or modifying its active runtime. The task stores `attentionAcknowledgedAt`, returns to Not now by setting `attentionState` to `none`, and can surface again when a future App Server request, child-status report, or manager action sets a new attention state.

`PATCH /api/tasks/:taskId/input-lock` accepts `{ "locked": true }` or `{ "locked": false }` for running tasks. Locking blocks new user input without moving the task in the list. Unlocking stores a fresh activity timestamp so the operator can resume that task intentionally.

`PATCH /api/tasks/order` accepts `{ "taskIds": ["..."] }` from the web UI and persists the local task card display order under `.taskdeck/task-order.json`. The order is UI-only metadata; it does not change task state, running sessions, App Server thread routing, supervision status, or selection fallback behavior. Missing, duplicate, cleared, or non-normal task ids are ignored during normalization.

The WebSocket composer sends `{ "type": "codex-app-server-interrupt-turn", "taskId": "..." }` to stop the selected task's active Codex App Server turn. The server translates this into `turn/interrupt` with the task's current App Server `threadId` and active `turnId`; it does not close the TaskDeck task or kill the shared runtime.

`POST /api/tasks/:taskId/decision-request` sends a manual one-way decision request to Decision Gateway when `DECISION_GATEWAY_URL` is configured. TaskDeck includes source context such as the stable `source.taskdeckInstanceId`, task id, session id when available, agent profile, cwd, attention state, and a bounded redacted recent-output snippet. The route returns `{ "ok": true, "decisionUrl": "...", "decisionId": "...", "requestId": "..." }` and records a local pending lease for later mailbox validation.

`DELETE /api/tasks` bulk-clears tasks and their logs. `DELETE /api/tasks/:taskId` clears a single task; clearing an individual running task stops its active App Server runtime and removes that task.

`GET /api/tasks/:taskId/logs?tail=200000` returns a bounded persisted log tail for output replay. The response also includes the current global `outputSeq` and task-local `taskSeq` so the web UI can reconcile live WebSocket output with the persisted log tail after reconnects or sequence gaps.

WebSocket `output` messages include the appended `data`, global `seq`, task-local `taskSeq`, and lightweight `role`/`kind` metadata. The UI treats the persisted task log as the canonical replay source and uses the sequenced WebSocket stream only for live append updates.

`GET /api/tasks/:taskId/diff` returns compact diff context for task review.

## Presets

TaskDeck stores the 10 most recent task presets by `command` and `cwd` so common task shapes can be restarted quickly. `GET /api/presets` reads them, and `DELETE /api/presets` clears them.
