# TaskDeck

TaskDeck is a task-aware terminal wrapper. This MVP runs a local React UI and a Node server that can start a command inside a pseudo-terminal, stream output to xterm.js in the browser, accept keyboard input, and show task state.

## Getting Started

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

The dev command runs the local server directly and mounts Vite as middleware for the React UI. Server-side code changes require restarting `npm run dev`.

## Workspace Layout

```text
apps/web      Browser UI
apps/server   Local PTY and WebSocket server
packages/core Shared task-state primitives
```

## Local API

```text
GET /api/context
POST /api/validate-cwd
GET /api/tasks
DELETE /api/tasks
GET /api/tasks/:taskId
DELETE /api/tasks/:taskId
GET /api/tasks/:taskId/logs
GET /api/tasks/:taskId/logs?tail=200000
GET /api/tasks/:taskId/diff
GET /api/presets
DELETE /api/presets
```

`GET /api/context` returns the repository root, default cwd, server cwd, shell, path separator, git-repository status, and in-repository cwd suggestions for task creation.

`POST /api/validate-cwd` accepts `{ "cwd": "apps/web" }` and returns whether the cwd resolves to an existing directory, its absolute path, and git-repository status. The task form uses it to validate cwd before starting a task.

The server persists tasks and logs under `.taskdeck/`, which is intentionally ignored by Git:

```text
.taskdeck/
  tasks.json
  presets.json
  logs/
    <taskId>.log
```

Multiple tasks can exist in the task list, while this iteration still allows one running PTY at a time. Clearing tasks removes non-running tasks and their logs while preserving any active task.

The UI includes a compact fleet summary for total, running, completed, failed, interrupted, and high/medium risk task counts. Task list filters let the operator focus on all, running, failed/interrupted, completed, or risky tasks without changing the underlying task records.

Completed and other non-running tasks can be rerun from the selected task state pane. Rerun starts a new task with the same title, command, and cwd, leaving the original task record and log intact. Rerun is disabled while another task is running.

The terminal pane keeps xterm.js as the renderer while adding operator controls for follow mode, clearing the current view, reloading persisted logs, copying the bounded visible log buffer, and counting simple search matches.

TaskDeck also stores the 10 most recent task presets by `command` and `cwd` so common task shapes can be restarted quickly.
