# Codex App Server Route Smoke

This note records the manual smoke path for TaskDeck's primary Codex App Server route.

Do this smoke once after batching App Server auth, logging, and UI-state changes. Avoid repeated ChatGPT device-code login attempts during development because repeated login flows can cause device-code exchange failures.

## Scope

The smoke checks the user-facing TaskDeck flow for the default Codex work-session path:

```text
User -> TaskDeck UI -> TaskDeck server -> Codex App Server process
```

It should not require sending raw JSON-RPC through the composer. In normal mode, parseable App Server JSON is hidden from task logs; set `TASKDECK_CODEX_APP_SERVER_DEBUG=1` only when protocol debugging is needed.

## Localhost Caveat

When TaskDeck runs in a container and the browser runs on the host, `localhost` means different things on each side. Open the TaskDeck URL through the host-mapped port, not a container-internal loopback URL. Device-login verification URLs should be opened in the host browser.

## Launch Environment

TaskDeck launches the App Server through the configured `codex-app-server` agent profile command and communicates over stdio. The built-in `Codex App Server` profile starts `ai-agent-sandbox-agent-1` and runs `codex --sandbox danger-full-access app-server --listen stdio://` inside it with `docker exec -i`, not `-it`, because App Server uses JSON over ordinary stdin/stdout pipes rather than a terminal. The `danger-full-access` sandbox setting applies inside the configured Docker container and avoids nested Codex sandbox setup in that container.

If host and container Codex installs use different `CODEX_HOME` auth state, authenticate Codex in the container or override that profile in `taskdeck.local.json` so the App Server runs in the environment that owns the intended ChatGPT login.

## Manual Smoke

1. Start TaskDeck normally.
2. Create one task with the default `Codex App Server` profile.
3. If ChatGPT device login is required, complete it once using the verification URL and user code shown in the task log.
4. Wait for the task log to show that the App Server adapter is ready.
5. Send one short prompt from the composer.
6. Confirm the task enters an active/running state while the turn is in progress.
7. Confirm the task log shows assistant text, command output when commands run, and `Codex App Server turn completed; ready for next input.`
8. Confirm the composer returns to send-input mode.
9. Optionally send one second short prompt on the same thread and confirm it completes without another login.

## Successful Smoke Expectations

- One device login is requested at most when no valid ChatGPT session is already available.
- The first turn is accepted after login or account readiness.
- Command start events are visible when Codex starts a command.
- Command output remains visible under the `Codex App Server command output:` labeled block.
- The turn completes with `Codex App Server turn completed; ready for next input.`
- A second turn on the same task completes without another device login.

## Expected Logs

Normal task logs should be human-readable and should not show raw JSON-RPC. Expected high-level messages include:

- App Server initialized and account check started.
- One account refresh attempt only if an auth error occurs.
- Device login URL, user code, and login id only if login is required.
- Login completed or failed.
- If an invalid or revoked token appears after login, TaskDeck should mark the task as needing input and should not report the adapter as ready.
- Thread ready.
- Turn accepted.
- Assistant message text.
- Aggregated command output.
- Turn completed and ready for next input.

If device-code login fails, TaskDeck should not automatically request another code. Restart the task to request a fresh code.

If device-code login completes but the App Server later reports `token_revoked`, `refresh_token_invalidated`, or `401 Unauthorized`, fix Codex login in the environment that launches the `codex-app-server` profile, or point that profile at the host environment with the valid login, then restart the task.
