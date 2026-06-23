# Codex App Server Route Smoke

This note records the manual smoke path for TaskDeck's primary Codex App Server route.

Do this smoke once after batching App Server auth, logging, and UI-state changes. Avoid repeated ChatGPT login attempts during development because repeated login flows can cause exchange failures.

## Scope

The smoke checks the user-facing TaskDeck flow for the default Codex work-session path:

```text
User -> TaskDeck UI -> TaskDeck server -> Codex App Server runtime -> Codex thread
```

It should not require sending raw JSON-RPC through the composer. In normal mode, parseable App Server JSON is hidden from task logs; set `TASKDECK_CODEX_APP_SERVER_DEBUG=1` only when protocol debugging is needed.

## Localhost Caveat

When TaskDeck runs in a container and the browser runs on the host, `localhost` means different things on each side. Open the TaskDeck URL through the host-mapped port, not a container-internal loopback URL. Device-login verification URLs should be opened in the host browser.

## Launch Environment

TaskDeck launches the shared App Server runtime through the configured `codex-app-server` agent profile command and communicates over stdio. The built-in `Codex App Server` profile runs `codex --sandbox danger-full-access --ask-for-approval never app-server --listen stdio://` directly in the TaskDeck server environment because App Server uses JSON over ordinary stdin/stdout pipes rather than a terminal. One runtime subprocess can host multiple parent thread sessions; each TaskDeck task records its App Server thread id once it is ready. TaskDeck also sends `sandbox: "danger-full-access"` and `approvalPolicy: "never"` in `thread/start`, then sends `sandboxPolicy: { type: "dangerFullAccess" }` and `approvalPolicy: "never"` in `turn/start`.

If a machine needs TaskDeck to launch App Server somewhere other than the TaskDeck server environment, override the profile in `taskdeck.local.json`. The Codex login must exist in the same environment that runs the `codex-app-server` profile command.

By default TaskDeck uses the device-code login path. To smoke the browser redirect path, set this in `taskdeck.local.json` or another `TASKDECK_CONFIG` file before starting TaskDeck:

```json
{
  "codexAppServer": {
    "loginMethod": "browserRedirect"
  }
}
```

## Manual Smoke

1. Start TaskDeck normally.
2. Create one task with the default `Codex App Server` profile.
3. If ChatGPT login is required, complete it once using the task log. For `deviceCode`, use the verification URL and user code. For `browserRedirect`, open the login URL.
4. Wait for the task log to show that the App Server adapter is ready.
5. Send one short prompt from the composer.
6. Confirm the task enters an active/running state while the turn is in progress.
7. Confirm the task log shows assistant text, command output when commands run, and `Codex App Server turn completed; ready for next input.`
8. Confirm the composer returns to send-input mode.
9. Optionally send one second short prompt on the same thread and confirm it completes without another login.

## Successful Smoke Expectations

- One ChatGPT login is requested at most when no valid ChatGPT session is already available.
- The first turn is accepted after login or account readiness.
- Command start events are visible when Codex starts a command.
- Command output remains visible under the `Codex App Server command output:` labeled block.
- The turn completes with `Codex App Server turn completed; ready for next input.`
- A second turn on the same task completes without another login.

## Expected Logs

Normal task logs should be human-readable and should not show raw JSON-RPC. Expected high-level messages include:

- App Server initialized and account check started.
- One account refresh attempt only if an auth error occurs.
- Device login URL and user code, or browser login URL, only if login is required; the composer should also expose a direct login action while login is pending.
- Login completed or failed.
- If an invalid or revoked token appears after login, TaskDeck should mark the task as needing input, keep the direct login action available when a login URL is known, and should not report the adapter as ready.
- Thread ready.
- Turn accepted.
- Assistant message text.
- Aggregated command output.
- Turn completed and ready for next input.

If login fails, TaskDeck should not automatically request another login. The failed task should not present normal prompt input as available. Start a new Codex session to request a fresh login.

If login completes but the App Server later reports `token_revoked`, `refresh_token_invalidated`, or `401 Unauthorized`, TaskDeck should keep the task in a user-attention auth-failed state, lock normal composer prompt input for that failed task, and ignore later stale App Server success messages such as thread-ready or MCP startup updates. Fix Codex login in the environment that launches the `codex-app-server` profile, or point that profile at the host environment with the valid login, then start a new Codex session. Starting a new Codex session after a latched auth failure should replace the failed shared App Server runtime instead of reusing it.
