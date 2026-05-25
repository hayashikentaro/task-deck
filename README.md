# TaskDeck

TaskDeck is a task-aware terminal wrapper. This MVP runs a local Web UI and a Node server that can start a command inside a pseudo-terminal, stream output to the browser, accept keyboard input, and show basic task state.

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

