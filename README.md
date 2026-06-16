# TaskDeck

TaskDeck is a local supervision UI for running and monitoring multiple AI agent tasks. It wraps PTY-backed agent sessions in a task-centric interface so you can keep track of which task maps to which terminal, which tasks need attention, and where each session is running.

![TaskDeck screenshot](docs/assets/readme-attached-image.png)

## Prerequisites

- Node.js 20 and npm 10, pinned for this repository by Volta (`node` 20.20.2 and `npm` 10.9.8)
- Docker, if you want to use the committed Codex or Goose container profiles
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

1. Choose an agent profile in the right rail.
2. Choose a project/workspace.
3. Choose a session mode.
4. Start the task.
5. Send instructions from the composer attached to the terminal.

Task cards in the left rail show the active tasks and their supervision state. The center terminal shows the selected task's PTY output and persisted log view.

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

TaskDeck ships with committed Codex and Goose profiles that expect a Docker container named `ai-agent-sandbox-agent-1` with a `/workspace` directory.

Keep normal fresh-clone project setup minimal by putting only `projectRoot` in `taskdeck.local.json`. If you need to override agent profiles, either add an `agentProfiles` array to `taskdeck.local.json`, copy `taskdeck.profiles.example.json` into another ignored local config file, or point `TASKDECK_CONFIG` at another config file.

For example:

```bash
TASKDECK_CONFIG=/path/to/taskdeck.profiles.json npm run dev
```

For TaskDeck-launched Codex sessions, TaskDeck adds `-c check_for_update_on_startup=false` to suppress Codex CLI startup update prompts in supervised PTY sessions.

Agent profiles merge by `id`: built-in defaults load first, then committed config, ignored local config, and finally `TASKDECK_CONFIG`.

### Codex App Server development auth persistence

The experimental `codex-app-server` profile uses the normal Codex ChatGPT login flow. To avoid repeating device-code login after TaskDeck development restarts, run that profile with a stable local `CODEX_HOME` and Codex's file-backed credential store. Do not use `OPENAI_API_KEY`, `CODEX_ACCESS_TOKEN`, copied tokens, or any login bypass for this path.

Create a local Codex home outside the repository:

```bash
mkdir -p "$HOME/.taskdeck-codex-home"
chmod 700 "$HOME/.taskdeck-codex-home"
printf '%s\n' 'cli_auth_credentials_store = "file"' > "$HOME/.taskdeck-codex-home/config.toml"
CODEX_HOME="$HOME/.taskdeck-codex-home" codex login --device-auth
CODEX_HOME="$HOME/.taskdeck-codex-home" codex login status
```

Then override the App Server profile in ignored local config, such as `taskdeck.local.json` or a file pointed to by `TASKDECK_CONFIG`:

```json
{
  "agentProfiles": [
    {
      "id": "codex-app-server",
      "label": "Codex App Server (persistent auth)",
      "command": "sh -lc 'export CODEX_HOME=\"$HOME/.taskdeck-codex-home\"; mkdir -p \"$CODEX_HOME\"; exec codex app-server --listen stdio://'",
      "description": "Codex App Server using a stable CODEX_HOME for development auth persistence."
    }
  ]
}
```

The auth cache stays in `$HOME/.taskdeck-codex-home` and must remain local and ignored. Restart TaskDeck with the same profile command and confirm the App Server starts without a new device-code login.

## Branch Worktree Lifecycle

TaskDeck branch work uses `git worktree`. Use the main repository as the base development checkout and create one worktree per branch and purpose.

Remote GitHub branches are the durable source of truth. A branch task is complete only after intended changes are committed and pushed.

See [Branch worktree lifecycle](docs/branch-worktree-lifecycle.md) for the standard setup, handoff, recovery, and cleanup workflow.

## Local Data

TaskDeck stores runtime data under `.taskdeck/`, including task records, persisted logs, session labels, presets, and attachments. This directory is intentionally ignored by Git and may contain sensitive agent output.

TaskDeck also starts local manager action transports and records them in `.taskdeck/run/manager-actions.json`. The preferred transport is the Unix socket at `.taskdeck/run/manager-actions.sock`; a token-protected loopback TCP fallback is advertised for manager sessions running inside Docker containers where a mounted macOS host socket is visible but not connectable. Manager sessions use `taskdeckctl ack`, `taskdeckctl review`, and `taskdeckctl close`; the server validates, logs under `.taskdeck/manager-actions/`, mutates, and broadcasts the result.

## Safety Notes

TaskDeck can launch local or container agent CLIs that may edit files and run commands. Docker/container execution is containment, not a complete security boundary. Use full-access agent operation only in a safe or disposable workspace.

## More Documentation

- [Architecture map](docs/architecture.md)
- [Local API reference](docs/api.md)
- [Actor protocol and manager control plane](docs/taskdeck-actor-protocol.md)
- [Branch worktree lifecycle](docs/branch-worktree-lifecycle.md)
- [Child session request protocol](docs/taskdeck-child-session-protocol.md)
- [Current work plan](docs/current-work-plan.md)
- [Session identity card experiment](docs/issues/0015-session-identity-first-cards.md)
