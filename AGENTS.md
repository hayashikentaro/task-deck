# AGENTS.md

Guidance for Codex and other AI agents working in this repository.

## Repository Boundary

This repository is intended to track:

```text
https://github.com/hayashikentaro/task-deck
```

Before making changes, confirm you are in the correct local checkout:

```bash
pwd
git remote -v
git status --short --branch
```

The expected remote is:

```text
origin  https://github.com/hayashikentaro/task-deck (fetch)
origin  https://github.com/hayashikentaro/task-deck (push)
```

An SSH remote for the same repository is also acceptable when local authentication requires it:

```text
origin  git@github.com:hayashikentaro/task-deck.git (fetch)
origin  git@github.com:hayashikentaro/task-deck.git (push)
```

Do not edit files outside this repository for TaskDeck work unless the user explicitly asks.

## Product Direction

TaskDeck is a task-aware terminal wrapper. It is not a chatbot UI, and it is not merely a prettier terminal.

The long-term goal is for TaskDeck to become an operational cognition system for supervising multiple AI execution processes. Its interface should be task-centric and centered on state, risk, diffs, and review rather than chat.

Dangerous paths should be structurally constrained where possible. Inside safe capability boundaries, AI agents should be able to operate freely.

## Current Project State

The repository now contains a working MVP application:

```text
apps/server    TaskDeck backend, PTY orchestration, REST API, and WebSocket handling
apps/web       React/Vite frontend
packages/core  Shared task and domain logic
README.md      Project overview and local API notes
AGENTS.md      Repository guidance for AI agents
```

`.taskdeck/` is local runtime state for persisted tasks, logs, presets, and related data. It should not be committed.

## Domain Concepts

- Task: the central supervision unit, with process status, agent state, risk, logs, metadata, and diff context.
- PTY: the pseudo-terminal process behind a running task. It is an interaction mechanism, not the product identity.
- Agent profile: a configured launch profile such as Codex, Goose, container agents, zsh, or custom commands.
- Session mode: how a new agent session starts, such as new session, resume last, custom resume, or saved session.
- Resume last: an imprecise Codex resume mode that targets the latest Codex session.
- Resume saved: a precise resume path using stored task/session metadata when available.
- Saved Codex session: a best-effort session derived from TaskDeck task metadata, not from Codex internal storage.
- Quick actions / PTY checks: compact composer helpers for prompt snippets, PTY diagnostics, and container checks.
- Diagnostics: server/UI checks for Docker, configured agent containers, and configured workspaces.

Keep state, risk, diffs, review, and agent supervision central. Terminal/PTY interaction is a means to supervise work, not a chat surface or decorative terminal skin.

## Working Guidelines

- Keep changes scoped to the user's request.
- Prefer small, reviewable commits.
- Preserve user changes already present in the working tree.
- Prefer existing project conventions over introducing new structure.
- Avoid broad refactors unless they are required for the task.
- Add or update tests when changing behavior once a test setup exists.
- Document important setup, API, or workflow changes in the repository rather than only in chat.
- Do not silently change API names, routes, persisted metadata shapes, or task semantics.
- When changing API routes or response shapes, update README and frontend types together.
- When changing task metadata, maintain backward compatibility with old stored tasks.

## Implementation Cautions

- Task persistence must keep old stored tasks loadable.
- Logs can grow; avoid moving terminal output into unbounded React state.
- PTY process lifecycle, interrupts, server restarts, and task clearing should remain predictable.
- WebSocket task updates should keep task lists, selected task behavior, terminal output, and session metadata in sync.
- Agent session metadata is best-effort and should not assume every agent exposes stable ids.
- `GET /api/agent-sessions` lists saved Codex sessions derived from TaskDeck task metadata.
- `Resume last` is imprecise; `Resume saved` and the saved session picker should use precise stored resume commands when available.
- Agent profile config should merge with built-in profiles rather than replace them wholesale.

## Runtime And Generated Files

- `.taskdeck/` is local runtime state and should remain uncommitted.
- Vite/dev-server temp files may appear during local development.
- Do not commit generated runtime state unless explicitly requested.
- Do not delete untracked files unless the task explicitly asks for cleanup and the file is clearly generated.
- If unexpected untracked files exist, report them rather than modifying them.
- Current observed untracked path: `packages/core/src/tools/`. Do not touch it unless explicitly requested.

## Commit and Push Rule

Whenever repository files are modified, commit the relevant changes and push them to the current branch.

- Do not force push.
- If push fails, report the reason and leave the local commit intact.

## Development Workflow

Inspect `package.json` before introducing new scripts. Prefer existing npm scripts and repository tooling; do not invent replacement tooling if repo scripts exist.

Relevant verification commands:

```bash
node --check apps/server/src/server.js
npm run build
git diff --check
```

For documentation-only changes, `git diff --check` is required, `npm run build` is useful when quick, and `node --check apps/server/src/server.js` is optional unless server code changed.

If a check cannot be run because of sandbox, permissions, or missing local services, report that clearly.

## Handoff Reporting

When handing work back, report:

- What changed.
- Verification commands run.
- Commit hash.
- Push status.
- Known limitations or skipped checks.
- Unexpected files not touched.
