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
GET /api/agent-sessions
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

`GET /api/agent-sessions` returns saved Codex sessions derived from stored task metadata. Sessions require a Codex provider, session id, and precise resume command, exclude obvious synthetic ids such as e2e/smoke/fake/test ids, and deduplicate by provider, agent profile, command environment, and session id.

The server persists tasks and logs under `.taskdeck/`, which is intentionally ignored by Git:

```text
.taskdeck/
  tasks.json
  presets.json
  logs/
    <taskId>.log
```

Multiple tasks can exist in the task list, and multiple PTY-backed agent sessions can run at the same time. Bulk clearing removes non-running tasks and their logs while preserving active tasks; clearing an individual running task stops its PTY and removes that task.

Tasks carry both a low-level process `status` and a supervisor-facing `agentState` such as thinking, working, waiting for input, review ready, done, failed, or stopped. Agent state also carries lightweight `agentStateReason`, `agentStateSource`, and `agentStateConfidence` metadata so operators can distinguish TaskDeck-owned events from heuristic TUI fallback. TaskDeck treats its own lifecycle events as the primary state source: session start, user input, PTY output activity, and process exit. Plain PTY output is a reliable process observation but only a medium-confidence inference of `working`. Silence does not imply thinking, so quiet running PTYs keep their last known supervisor state until a stronger signal arrives. TUI text matching is only a fallback for explicit user-action prompts such as approval or input requests, because agent spinner/status phrases are not stable protocol signals. Task creation is centered on starting an AI agent session in a selected workspace. Agent profiles are limited to container-backed profiles; the committed defaults expose Codex CLI and Goose inside `ai-agent-sandbox-agent-1`, with Codex selected by default. Codex launches through `sh -lc 'TERM=xterm-256color codex'` so the CLI sees a conventional terminal environment. Prefer machine-readable or non-TUI agent modes when an agent exposes one, but keep the PTY path as the current compatibility layer. For Codex profiles, the Session selector offers a new session, recent saved Codex sessions detected from prior tasks, then the fallback `codex resume --last`. Full automatic saved-session discovery is not implemented yet, but TaskDeck does a first-pass Codex session id detection from explicit `codex resume <id>` commands and from recognizable session/conversation id text in task output. Task records preserve the selected agent profile, session mode, detected session id/provider/source/timestamp when available, generated session resume command, resume command when provided, and initial instruction. Detected Codex sessions become available through the existing Resume saved action by filling `resumeCommand` when it is empty or still points at imprecise resume-last behavior, and through the New Agent Session saved-session picker. An optional initial instruction is sent to the running PTY after launch, and follow-up input goes through the bottom composer.

The UI is organized around a supervision-first workspace: the left rail is an expandable task-card list, the center pane is the terminal and persisted log view, the right rail launches new agent sessions, and the composer stays attached to the terminal. Task list filters let the operator focus on all, active, needs-input, review-ready, done, failed/stopped, or risky tasks without changing the underlying task records.

Expanded task cards show command, cwd, process status, exit code, timing, initial instruction when available, and compact diff status. The former top summary strip and right-side task-state panel are intentionally folded into the card model.


Completed and other non-running tasks can be rerun from the expanded selected task card. Rerun starts a new task with the same title, command, and cwd, leaving the original task record and log intact.

Expanded task cards can also resume agent sessions. Tasks with a saved `resumeCommand` show a Resume saved action that starts a new `Resume saved: ...` task in the same cwd without replaying the original initial instruction. Older Codex tasks without saved resume metadata show a lower-priority Resume last action with an inline confirmation because it targets the latest Codex session, not necessarily the selected task. Resume-last tasks are titled `Resume last: ...`. When a resume action is available, the expanded card previews the exact command that will be launched.

The terminal pane keeps xterm.js as the renderer while adding operator controls for follow mode, clearing the current view, reloading persisted logs, copying the bounded visible log buffer, and counting simple search matches.

Terminal input is sent through the fixed bottom composer. It targets the selected running PTY and stays disabled for read-only logs, disconnected sessions, or no selected task. The composer supports multi-line instructions, with prompt snippets, PTY diagnostics, current-PTY container checks, and host-Docker container checks tucked behind a compact Quick actions disclosure. Enter sends, Shift+Enter inserts a newline, Cmd/Ctrl+Enter sends, and IME composition is preserved for Japanese input. Composer instructions submit with bracketed paste followed by terminal Enter (`\r`) so Codex-style TUIs receive even one-line text as a committed instruction. Codex task input is briefly queued during startup so early instructions are not swallowed while the CLI is booting. PTY diagnostics can send `pwd`, `ls`, `git status`, `which codex`, `which goose`, `codex --version`, and `goose --version` to the selected running session. Container checks can send in-PTY `pwd`, `/workspace`, and review/lens directory searches for sessions already inside a container, plus host-Docker checks such as `docker ps` and `/workspace` checks for `ai-agent-sandbox-agent-1`.

TaskDeck also stores the 10 most recent task presets by `command` and `cwd` so common task shapes can be restarted quickly.

## Agent Profiles

Agent profiles can be changed without editing application code. TaskDeck merges profiles by `id`: built-in defaults are loaded first, then `taskdeck.config.json`, then ignored `taskdeck.local.json`, then `TASKDECK_CONFIG`. Later files override matching ids and append new ids, but the server only exposes profiles with Docker-backed commands and diagnostic containers. For machine-local profiles, copy `taskdeck.local.example.json` to `taskdeck.local.json`; that local file is ignored by Git. To point TaskDeck at another profile file, start the server with `TASKDECK_CONFIG=/path/to/taskdeck.profiles.json npm run dev`.

Each profile supports `id`, `label`, `command`, `description`, optional `diagnosticContainer`, and optional `diagnosticWorkspace`. The diagnostics panel uses these fields to inspect/start configured Docker containers and check whether expected container workspace directories exist. The committed profiles are `codex` and `goose`, both running inside `ai-agent-sandbox-agent-1`.
