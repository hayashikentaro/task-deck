# TaskDeck

TaskDeck is a local supervision UI for running and monitoring multiple AI agent tasks. On this branch its Codex route uses the structured Codex App Server adapter so TaskDeck can supervise turns, approvals, command output, and user-input requests without treating a TUI transcript as the control protocol. Terminal-backed PTY profiles remain available for shell and non-Codex provider compatibility.

![TaskDeck screenshot](docs/assets/readme-attached-image.png)

## Prerequisites

- Node.js 20 and npm 10, pinned for this repository by Volta (`node` 20.20.2 and `npm` 10.9.8)
- Docker, for the committed Codex App Server and other container-backed profiles
- A local workspace where agent commands may safely read, edit, and run files

TaskDeck is intended for local use. Do not expose the server to a LAN or the internet without separate authentication, network controls, and operational protection.

Verify the Node/npm toolchain from a normal host terminal before installing dependencies:

```bash
node -v
npm -v
```

Do not use a TaskDeck-managed zsh task for this check. Those tasks may inherit npm lifecycle environment from `dev-supervisor`, and local tools such as nodenv or `~/.node-version` can pollute the runtime they see.

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

The dev command runs the local Node server and mounts Vite middleware for the React UI. Server-side code changes require restarting `npm run dev`.

## First Task

1. Use the default `Codex App Server` agent profile in the right rail, or choose another profile explicitly.
2. Choose a project/workspace.
3. Choose a session mode.
4. Start the task.
5. Send instructions from the composer attached to the task log.

Task cards in the left rail show the active tasks and their supervision state. The center pane shows the selected task's live output and persisted log view. For Codex App Server tasks, TaskDeck renders structured App Server messages as human-readable task output and handles approval/user-input requests through the UI.

## Configure Projects

Fresh clones may show only the TaskDeck repository in the Project dropdown. To point TaskDeck at your own project folder list, create the ignored local config:

```bash
cp taskdeck.local.example.json taskdeck.local.json
```

Then edit `taskdeck.local.json`:

```json
{
  "projectRoot": "/Users/you/Projects"
}
```

`projectRoot` is a parent directory whose immediate child directories become Project choices. `taskdeck.local.json` is ignored by Git and is the right place for machine-local paths.

## Configure Agent Profiles

TaskDeck ships with committed Codex App Server, Goose, Aider, Claude, and shell profiles that expect a Docker container named `ai-agent-sandbox-agent-1` with a `/workspace` directory. `Codex App Server` is the only committed Codex work-session route on this branch and uses non-TTY stdio via `docker exec -i` so TaskDeck can exchange App Server JSON over pipes. The regular terminal-backed profiles use interactive `docker exec -it` commands for non-Codex providers and shell compatibility.

Keep normal fresh-clone project setup minimal by putting only `projectRoot` in `taskdeck.local.json`. If you need to override agent profiles, either add an `agentProfiles` array to `taskdeck.local.json`, copy `taskdeck.profiles.example.json` into another ignored local config file, or point `TASKDECK_CONFIG` at another config file.

For example:

```bash
TASKDECK_CONFIG=/path/to/taskdeck.profiles.json npm run dev
```

TaskDeck does not rewrite the App Server profile with Codex CLI/TUI sandbox, reasoning, startup, or resume flags. The committed route intentionally avoids interactive Codex CLI access; custom local profiles are outside the product route for this branch.

Agent profiles merge by `id`: built-in defaults load first, then committed config, ignored local config, and finally `TASKDECK_CONFIG`.

## Branch Worktree Lifecycle

TaskDeck branch work uses `git worktree`. Use the main repository as the base development checkout and create one worktree per branch and purpose.

Remote GitHub branches are the durable source of truth. A branch task is complete only after intended changes are committed and pushed.

See [Branch worktree lifecycle](docs/branch-worktree-lifecycle.md) for the standard setup, handoff, recovery, and cleanup workflow.

## Local Data

TaskDeck stores runtime data under `.taskdeck/`, including task records, persisted logs, session labels, presets, and attachments. This directory is intentionally ignored by Git and may contain sensitive agent output.

TaskDeck also starts local manager action transports and records them in `.taskdeck/run/manager-actions.json`. The preferred transport is the Unix socket at `.taskdeck/run/manager-actions.sock`; a token-protected loopback TCP fallback is advertised for manager sessions running inside Docker containers where a mounted macOS host socket is visible but not connectable. Manager sessions use `taskdeckctl ack`, `taskdeckctl review`, and `taskdeckctl close`; the server validates, logs under `.taskdeck/manager-actions/`, mutates, and broadcasts the result.

## Safety Notes

TaskDeck can launch local or container agent processes that may edit files and run commands. Docker/container execution is containment, not a complete security boundary. Use full-access agent operation only in a safe or disposable workspace.

## More Documentation

- [Architecture map](docs/architecture.md)
- [Local API reference](docs/api.md)
- [Actor protocol and manager control plane](docs/taskdeck-actor-protocol.md)
- [Branch worktree lifecycle](docs/branch-worktree-lifecycle.md)
- [Child session request protocol](docs/taskdeck-child-session-protocol.md)
- [Current work plan](docs/current-work-plan.md)
- [Session identity card experiment](docs/issues/0015-session-identity-first-cards.md)
