# TaskDeck

TaskDeck is a local supervision UI for running and monitoring AI agent tasks. On this branch the only committed task launch route is Codex App Server, started directly in the TaskDeck server environment with stdio JSON. TaskDeck supervises structured turns, command output, and user-input requests without treating a TUI transcript as the control protocol.

![TaskDeck screenshot](docs/assets/readme-attached-image.png)

## Prerequisites

- Node.js 20 and npm 10, pinned for this repository by Volta (`node` 20.20.2 and `npm` 10.9.8)
- Codex CLI available in the same environment that runs the TaskDeck server
- A local workspace where agent commands may safely read, edit, and run files

TaskDeck is intended for local use. In constrained setups, the same local web client may be opened from another device through the host machine's LAN IP; the operator owns the trusted network boundary, host binding, firewall, and other deployment controls. TaskDeck is not designed as a public internet service.

Verify the Node/npm toolchain from a normal host terminal before installing dependencies:

```bash
node -v
npm -v
```

Do not use a TaskDeck-managed task for this check. Those tasks may inherit npm lifecycle environment from `dev-supervisor`, and local tools such as nodenv or `~/.node-version` can pollute the runtime they see.

## Install

```bash
npm ci
```

## Run

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

The desktop client is served at `/`. The phone client is served as a separate web app at:

```text
http://localhost:3000/phone
```

The dev command runs the local Node server and mounts Vite middleware for both React clients. Server-side code changes require restarting `npm run dev`.

## First Task

1. Use the default `Codex App Server` launch form in the right rail.
2. Choose a project/workspace.
3. Start the task.
4. Send instructions from the composer attached to the task log.

Task cards in the left rail show the active tasks and their supervision state. The center pane shows the selected task's live output and persisted log view. For Codex App Server tasks, TaskDeck renders structured App Server messages as human-readable task output, handles user-input requests through the UI, and exposes model and reasoning-effort selectors in the composer. Selector changes apply to the next instruction and later turns.

The desktop and phone composers accept PNG, JPEG, WebP, GIF, HEIC, and HEIF images; UTF-8 text and common source-code files; and PDF, DOCX, XLSX, and PPTX documents up to 12 MB each. Images are delivered as native Codex App Server image input, while other files are made available to Codex through their task-owned local paths.

The desktop output view makes web URLs, localhost URLs, `file://` URLs, absolute paths, and `~/` paths clickable. Web links, including ChatGPT login URLs, open in the desktop browser. Local paths open on the machine running the TaskDeck server; hovering them previews supported files and directories under that machine's home directory. The separate phone client does not expose local-path actions.

## Configure Projects

Fresh clones may show only the TaskDeck repository in the Project dropdown. To point TaskDeck at your own project folder list, create the ignored local config:

```bash
cp taskdeck.local.example.json taskdeck.local.json
```

Then edit `taskdeck.local.json`:

```json
{
  "projectRoot": "/Users/you/Projects",
  "defaultModel": "gpt-5.6",
  "codexAppServer": {
    "loginMethod": "deviceCode"
  }
}
```

`projectRoot` is a parent directory whose immediate child directories become Project choices. `defaultModel` is optional; when set, TaskDeck passes it to Codex App Server for each new thread. Without it, Codex uses its own configured default. Once App Server is initialized, TaskDeck loads the available model catalog for the composer selector. `taskdeck.local.json` is ignored by Git and is the right place for machine-local paths and model defaults.

`codexAppServer.loginMethod` controls how TaskDeck asks Codex App Server to start ChatGPT login when no valid cached session is available. The default is `deviceCode`, which preserves the existing verification URL plus user-code flow. Set it to `browserRedirect` to have App Server return a ChatGPT login URL that you open directly in a browser. The resulting Codex login is still cached in the same environment that runs the `codex-app-server` profile command.

## Configure Agent Profiles

TaskDeck ships one committed launch profile on this branch:

```text
codex --sandbox danger-full-access --ask-for-approval never app-server --listen stdio://
```

That command runs directly in the TaskDeck server environment. Do not assume TaskDeck will start or enter a separate Docker container. If a local machine needs a wrapper, put that override in ignored local config; do not treat the wrapper as the product route for this branch.

Keep normal fresh-clone project setup minimal by putting `projectRoot` and, when needed, `defaultModel` in `taskdeck.local.json`. If you need a machine-local launch wrapper, override the `codex-app-server` profile in `taskdeck.local.json`, copy `taskdeck.profiles.example.json` into another ignored local config file, or point `TASKDECK_CONFIG` at another config file. Additional profile ids are ignored by the current App Server-only launch surface.

For example:

```bash
TASKDECK_CONFIG=/path/to/taskdeck.profiles.json npm run dev
```

The committed App Server route uses `danger-full-access` and `--ask-for-approval never` in the TaskDeck server environment. TaskDeck also passes full-access/no-approval overrides to App Server `thread/start` and `turn/start`. TaskDeck does not otherwise synthesize Codex CLI/TUI reasoning, startup, or resume flags for this profile. The committed route intentionally avoids interactive Codex CLI access; custom local profiles are outside the product route for this branch.

Agent profiles merge by `id`: built-in defaults load first, then committed config, ignored local config, and finally `TASKDECK_CONFIG`.

Team templates are product runtime config, not docs-only prompts. TaskDeck loads default templates from `taskdeck.team-templates.json`, then merges `teamTemplates` entries from `taskdeck.config.json`, ignored `taskdeck.local.json`, and `TASKDECK_CONFIG` by `id` so local configs can add or override templates without editing docs.

## Decision Gateway

TaskDeck can pair a phone through Decision Gateway, send a manual one-way decision request from a task card, and poll the Decision Result Mailbox. Configure the gateway URL before starting TaskDeck:

```bash
PORT=3001 DECISION_GATEWAY_URL=http://localhost:3000 npm run dev
```

The `PORT=3001` example keeps TaskDeck from colliding with a local Decision Gateway dev server running on `localhost:3000`. If Decision Gateway is running elsewhere, set `DECISION_GATEWAY_URL` to that base URL.

Mailbox polling uses the same stable local `taskdeckInstanceId` as the Pair phone flow. Set `DECISION_GATEWAY_MAILBOX_POLL_MS` to override the default 30000 ms interval. If `DECISION_GATEWAY_URL` is missing, mailbox polling is disabled quietly.

For deployed or production Decision Gateway instances that protect TaskDeck-facing endpoints, set `TASKDECK_DECISION_GATEWAY_API_TOKEN`. When this token is set, TaskDeck sends `Authorization: Bearer <token>` to Decision Gateway for decision requests, pairing requests, mailbox polling, and mailbox acknowledgements. When unset, TaskDeck sends no Authorization header, preserving local development behavior.

Use **Pair phone** in the right rail to create a pairing request. TaskDeck calls `POST /api/pairing-requests` on Decision Gateway with the stable local `taskdeckInstanceId` and a simple local label, then displays the returned `pairingUrl` as a QR code with its expiry time and a copyable URL fallback. The phone scans the QR and completes pairing on Decision Gateway. Decision Gateway owns mobile browser sessions.

When configured, use **Ask for decision** on a task card. TaskDeck sends source context and a bounded redacted recent-output snippet to `POST /api/decision-requests` on Decision Gateway, shows the returned decision URL, and persists a pending local decision lease under `.taskdeck/decision-gateway-leases.json`. The lease records the returned Decision Gateway decision id, request id, decision URL, local task id, session id when available, local `taskdeckInstanceId`, status, creation time, expiry, received decision payload, and delivery state. `DECISION_GATEWAY_DECISION_LEASE_TTL_MS` overrides the default 1800000 ms lease TTL.

TaskDeck exposes the Codex App Server dynamic tool `taskdeck.request_decision` to running App Server sessions by default. The session provides bounded decision content only; TaskDeck resolves the task/session identity server-side, sends the request through Decision Gateway, records the same kind of pending lease, and returns a pending status plus decision URL to the session.

When the mailbox returns decision results addressed to this TaskDeck instance, TaskDeck records them under `.taskdeck/decision-gateway-mailbox.json`, validates them against the local pending lease and task/session metadata, then acknowledges the mailbox item. Pending task cards show **Decision pending**. Valid matched mobile decisions automatically start a new turn on the originating Codex App Server thread. The delivered message is scoped to the lease/question and uses the TaskDeck action model: `proceed`, `revise_plan`, or `need_more_information`, with `action.note` as additional constraints, plan feedback, or requested missing materials. PC action is not required for the normal matched case. Unmatched, stale, duplicate, or blocked deliveries remain local exceptional states and can show **Decision delivery failed**. `TASKDECK_DISABLE_DYNAMIC_DECISION_TOOL=1` and `TASKDECK_DISABLE_DECISION_AUTO_DELIVER=1` are emergency/development escape hatches, not normal setup.

For local testing, run Decision Gateway locally first, then start TaskDeck with `PORT=3001 DECISION_GATEWAY_URL=http://localhost:3000 npm run dev`. If Supabase is not configured yet, the local Decision Gateway may use its file-store fallback for first verification. For deployed Decision Gateway use, Supabase is required for reliable deployed workspace loading. Slack remains notification-only.

TaskDeck remains the local trust root. Decision Gateway is only the cloud decision surface and mailbox; it never talks directly to agents. Local pending leases are TaskDeck's safety boundary: any decision delivery path must require a valid non-expired lease match for `requestId`, `taskId`, `sessionId`, and `taskdeckInstanceId`. Delivery uses the existing Codex App Server thread/turn path, never PTY/stdin injection, stdout marker parsing, file inboxes, remote command execution, or broad automatic apply outside the scoped decision.

## Branch Worktree Lifecycle

TaskDeck branch work uses `git worktree`. Use the main repository as the base development checkout and create one worktree per branch and purpose.

Remote GitHub branches are the durable source of truth. A branch task is complete only after intended changes are committed and pushed.

See [Branch worktree lifecycle](docs/branch-worktree-lifecycle.md) for the standard setup, handoff, recovery, and cleanup workflow.

## Local Data

TaskDeck stores runtime data under `.taskdeck/`, including task records, local task card display order, persisted logs, session labels, presets, attachments, and received Decision Gateway mailbox records. This directory is intentionally ignored by Git and may contain sensitive agent output. Dragging task cards in the left rail persists only the local UI order under `.taskdeck/task-order.json`; it does not change task state, App Server thread routing, or agent execution.

TaskDeck also starts local manager action transports and records them in `.taskdeck/run/manager-actions.json`. The preferred transport is the Unix socket at `.taskdeck/run/manager-actions.sock`; a token-protected loopback TCP fallback is advertised for environments where a mounted macOS host socket is visible but not connectable. The supported local commands are `taskdeckctl ack`, `taskdeckctl review`, and `taskdeckctl close`; the server validates, logs under `.taskdeck/manager-actions/`, mutates, and broadcasts the result.

## Safety Notes

TaskDeck can launch local agent processes that may edit files and run commands. Docker/container wrapping, when locally configured, is containment, not a complete security boundary. Use full-access agent operation only in a safe or disposable workspace.

## More Documentation

- [Architecture map](docs/architecture.md)
- [Local API reference](docs/api.md)
- [Actor protocol redesign placeholder](docs/taskdeck-actor-protocol.md)
- [Branch worktree lifecycle](docs/branch-worktree-lifecycle.md)
