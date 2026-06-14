# Codex App Server Smoke

This note records the final manual smoke path for TaskDeck's structured Codex App Server adapter.

Do this smoke once after batching App Server auth, logging, and UI-state changes. Avoid repeated ChatGPT device-code login attempts during development because repeated login flows can cause device-code exchange failures.

## Scope

The smoke checks the user-facing TaskDeck flow:

```text
User -> TaskDeck UI -> TaskDeck server -> Codex App Server process
```

It should not require sending raw JSON-RPC through the composer. In normal mode, parseable App Server JSON is hidden from task logs; set `TASKDECK_CODEX_APP_SERVER_DEBUG=1` only when protocol debugging is needed.

## Manual Smoke

1. Start TaskDeck normally.
2. Create one task with the `Codex App Server (experimental)` profile.
3. If ChatGPT device login is required, complete it once using the verification URL and user code shown in the task log.
4. Wait for the task log to show that the App Server adapter is ready.
5. Send one short prompt from the composer.
6. Confirm the task enters an active/running state while the turn is in progress.
7. Confirm the task log shows assistant text, command output when commands run, and `Codex App Server turn completed; ready for next input.`
8. Confirm the composer returns to send-input mode.
9. Optionally send one second short prompt on the same thread and confirm it completes without another login.

## Expected Logs

Normal task logs should be human-readable and should not show raw JSON-RPC. Expected high-level messages include:

- App Server initialized and account check started.
- One account refresh attempt only if an auth error occurs.
- Device login URL, user code, and login id only if login is required.
- Login completed or failed.
- Thread ready.
- Turn accepted.
- Assistant message text.
- Aggregated command output.
- Turn completed and ready for next input.

If device-code login fails, TaskDeck should not automatically request another code. Restart the task to request a fresh code.
