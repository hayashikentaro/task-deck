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

Do not edit files outside this repository for TaskDeck work unless the user explicitly asks.

## Current Project State

At the time this file was created, the GitHub repository had no advertised remote refs and this local checkout had no application files yet. Treat any future app framework, package manager, test runner, and style rules as source-of-truth once they are added to the repository.

## Working Guidelines

- Keep changes scoped to the user's request.
- Preserve user changes already present in the working tree.
- Prefer existing project conventions over introducing new structure.
- Add or update tests when changing behavior once a test setup exists.
- Avoid broad refactors unless they are required for the task.
- Document important setup or workflow changes in the repository rather than only in chat.

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

