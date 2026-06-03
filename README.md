# TaskDeck

TaskDeck is a local supervision UI for running and monitoring multiple AI agent tasks. It wraps PTY-backed agent sessions in a task-centric interface so you can keep track of which task maps to which terminal, which tasks need attention, and where each session is running.

![TaskDeck screenshot](docs/assets/readme-attached-image.png)

## Prerequisites

- Node.js and npm
- Docker, if you want to use the committed Codex or Goose container profiles
- A local workspace where agent commands may safely read, edit, and run files

TaskDeck is intended for local use. Do not expose the server to a LAN or the internet without separate authentication, network controls, and operational protection.

## Install

```bash
npm install
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

Fresh clones may show only the TaskDeck repository in the Project dropdown. To point TaskDeck at your own project folder list, copy the example local config:

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

TaskDeck ships with committed Codex and Goose profiles that expect a Docker container named `ai-agent-sandbox-agent-1` with a `/workspace` directory. For your machine, override profiles in `taskdeck.local.json` or point `TASKDECK_CONFIG` at another config file.

For example:

```bash
TASKDECK_CONFIG=/path/to/taskdeck.profiles.json npm run dev
```

Agent profiles merge by `id`: built-in defaults load first, then committed config, ignored local config, and finally `TASKDECK_CONFIG`.

## Local Data

TaskDeck stores runtime data under `.taskdeck/`, including task records, persisted logs, session labels, presets, and attachments. This directory is intentionally ignored by Git and may contain sensitive agent output.

## Safety Notes

TaskDeck can launch local or container agent CLIs that may edit files and run commands. Docker/container execution is containment, not a complete security boundary. Use full-access agent operation only in a safe or disposable workspace.

## More Documentation

- [Architecture map](docs/architecture.md)
- [Local API reference](docs/api.md)
- [Session identity card experiment](docs/issues/0015-session-identity-first-cards.md)
