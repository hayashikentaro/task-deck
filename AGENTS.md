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

The long-term goal is for TaskDeck to become an operational cognition system for supervising multiple AI execution processes. Its interface should be task-centric and centered on state, risk, and diffs rather than chat.

Dangerous paths should eventually be structurally constrained. Inside safe capability boundaries, AI agents should be able to operate freely.

## Current Project State

At the time this file was last updated, the repository only contained agent guidance and had no application files yet. Treat any future app framework, package manager, test runner, and style rules as source-of-truth once they are added to the repository.

## Working Guidelines

- Keep changes scoped to the user's request.
- Preserve user changes already present in the working tree.
- Prefer existing project conventions over introducing new structure.
- Add or update tests when changing behavior once a test setup exists.
- Avoid broad refactors unless they are required for the task.
- Document important setup or workflow changes in the repository rather than only in chat.

## Commit and Push Rule

Whenever repository files are modified, commit the relevant changes and push them to the current branch.

- Do not force push.
- If push fails, report the reason and leave the local commit intact.

## Development Workflow

When project files are added, prefer the repository's own scripts and tooling. Common places to check:

```bash
ls
find . -maxdepth 2 -type f
```

If a package manifest appears, inspect it before installing or running commands:

```bash
cat package.json
```

Use the scripts defined by the project for development, linting, formatting, tests, and builds. Do not invent replacement commands when local scripts exist.

## Verification

Before handing work back, run the most relevant available checks. In a new or partially scaffolded repository, at minimum report:

- What changed.
- Which verification commands were run.
- Any checks that could not be run because the project has not been scaffolded yet.
