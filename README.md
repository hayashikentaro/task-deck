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
GET /api/diagnostics
POST /api/diagnostics/containers/:containerName/start
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

`GET /api/context` returns the repository root, default cwd, server cwd, shell, path separator, git-repository status, in-repository cwd suggestions, and configured agent profiles for task creation.

`GET /api/diagnostics` returns Docker reachability, merged agent-profile config sources, configured agent-container status, and configured container workspace checks. The right-rail Agent Diagnostics panel surfaces this server diagnostics API in the UI. `POST /api/diagnostics/containers/:containerName/start` starts a configured diagnostic container when it exists but is stopped.

`POST /api/validate-cwd` accepts `{ "cwd": "apps/web" }` and returns whether the cwd resolves to an existing directory, its absolute path, and git-repository status. The task form uses it to validate cwd before starting a task.

The server persists tasks and logs under `.taskdeck/`, which is intentionally ignored by Git:

```text
.taskdeck/
  tasks.json
  presets.json
  logs/
    <taskId>.log
```

Multiple tasks can exist in the task list, and multiple PTY-backed agent sessions can run at the same time. Bulk clearing removes non-running tasks and their logs while preserving active tasks; clearing an individual running task stops its PTY and removes that task.

Tasks carry both a low-level process `status` and a supervisor-facing `agentState` such as thinking, working, waiting for input, review ready, done, failed, or stopped. Task creation is centered on starting an AI agent session in a selected workspace. Agent profiles are merged from built-in defaults, committed `taskdeck.config.json`, ignored `taskdeck.local.json`, and optional `TASKDECK_CONFIG`; the committed default includes Codex CLI and Goose commands for the AI development container, separate Goose Container Shell and Goose Container direct profiles for `chrome-goose-1`, plus aider, zsh, and custom PTY fallback entries. Goose is selected by default so local or lower-cost experimentation is the first path. The launcher lets the operator choose a new session, resume the last Codex session with `codex resume --last`, or provide a custom resume command for an external agent session. Automatic session discovery is not implemented yet. Task records preserve the selected agent profile, session mode, resume command when provided, and initial instruction. An optional initial instruction is sent to the running PTY after launch, and follow-up input goes through the bottom composer.

The UI is organized around a supervision-first workspace: the left rail is an expandable task-card list, the center pane is the terminal and persisted log view, the right rail launches new agent sessions, and the composer stays attached to the terminal. Task list filters let the operator focus on all, active, needs-input, review-ready, done, failed/stopped, or risky tasks without changing the underlying task records.

Expanded task cards show command, cwd, process status, exit code, timing, initial instruction when available, and compact diff status. The former top summary strip and right-side task-state panel are intentionally folded into the card model.


Completed and other non-running tasks can be rerun from the expanded selected task card. Rerun starts a new task with the same title, command, and cwd, leaving the original task record and log intact.

Expanded task cards can also resume agent sessions. Tasks with a saved `resumeCommand` show a Resume saved action that starts a new `Resume saved: ...` task in the same cwd without replaying the original initial instruction. Older Codex tasks without saved resume metadata show a lower-priority Resume last action with an inline confirmation because it targets the latest Codex session, not necessarily the selected task. Resume-last tasks are titled `Resume last: ...`. When a resume action is available, the expanded card previews the exact command that will be launched.

The terminal pane keeps xterm.js as the renderer while adding operator controls for follow mode, clearing the current view, reloading persisted logs, copying the bounded visible log buffer, and counting simple search matches.

Terminal input is sent through the fixed bottom composer. It targets the selected running PTY and stays disabled for read-only logs, disconnected sessions, or no selected task. The composer supports multi-line instructions, insert quick actions, and PTY diagnostics quick actions. Enter sends, Shift+Enter inserts a newline, Cmd/Ctrl+Enter sends, and IME composition is preserved for Japanese input. PTY diagnostics can send `pwd`, `ls`, `git status`, `which codex`, `which goose`, `codex --version`, and `goose --version` to the selected running session.

TaskDeck also stores the 10 most recent task presets by `command` and `cwd` so common task shapes can be restarted quickly.

## Agent Profiles

Agent profiles can be changed without editing application code. TaskDeck merges profiles by `id`: built-in defaults are loaded first, then `taskdeck.config.json`, then ignored `taskdeck.local.json`, then `TASKDECK_CONFIG`. Later files override matching ids and append new ids. For machine-local profiles, copy `taskdeck.local.example.json` to `taskdeck.local.json`; that local file is ignored by Git. To point TaskDeck at another profile file, start the server with `TASKDECK_CONFIG=/path/to/taskdeck.profiles.json npm run dev`.

Each profile supports `id`, `label`, `command`, `description`, optional `diagnosticContainer`, and optional `diagnosticWorkspace`. The diagnostics panel uses these fields to inspect/start configured Docker containers and check whether expected container workspace directories exist. The committed Goose container profiles are `goose-container-shell` (`Goose Container Shell`, opens bash) and `goose-container-direct` (`Goose Container`, runs `docker exec -it -w /workspace chrome-goose-1 bash -lc 'goose'`).
