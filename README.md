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

## Workspace Layout

```text
apps/web      Browser UI
apps/server   Local PTY and WebSocket server
packages/core Shared task-state primitives
```

## Local API

```text
GET /api/tasks
GET /api/tasks/:taskId
GET /api/tasks/:taskId/logs
GET /api/tasks/:taskId/diff
```

The server keeps tasks and logs in memory for now. Multiple tasks can exist in the task list, while this iteration still allows one running PTY at a time.
