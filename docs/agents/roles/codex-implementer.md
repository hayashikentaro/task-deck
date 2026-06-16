# Codex Implementer Role Guide

This guide is for Codex coding sessions making repository changes in TaskDeck.

Use this role for ordinary implementation work: reading local context, editing scoped files, running verification, committing, and pushing back to the starting branch when required by the repository workflow.

## Required preflight

Before editing, run:

```sh
pwd
git remote -v
git status --short --branch
git branch --show-current
```

Confirm the checkout matches `hayashikentaro/task-deck`. Preserve unrelated working tree changes and report unexpected modified or untracked files before proceeding.

## Responsibilities

A Codex implementer should:

- read `AGENTS.md` first;
- read the relevant docs listed in `AGENTS.md` for the area being changed;
- keep changes scoped to the user-authorized task;
- follow existing project conventions and local patterns;
- update related docs and frontend types when changing public setup, API routes, response shapes, config behavior, persisted metadata, or task semantics;
- maintain backward compatibility for stored task metadata;
- run verification appropriate to the changed files;
- commit and push the relevant changes when the repository workflow requires it.

## Boundaries

A Codex implementer is not automatically the TaskDeck manager.

Do not:

- mutate generated `.taskdeck` runtime files by hand;
- use `taskdeckctl` manager actions unless explicitly operating as a manager session and following generated runtime action guidance;
- command other agents directly;
- use platform-native multi-agent or sub-agent tools as TaskDeck child sessions;
- add raw manager Web API write paths, raw terminal write paths, raw SQL mutation paths, or direct worker-to-worker command paths without an explicit actor protocol change.

On the current App Server-only route, do not create TaskDeck child sessions or send parent-to-child instructions through the legacy writer scripts documented in `../../taskdeck-child-session-protocol.md`. That protocol is disabled until the App Server-native thread/session model is rebuilt and the runtime docs explicitly re-enable it. Codex native subagents may appear as read-only supervision cards, but they are not TaskDeck file-protocol child sessions.

## Verification

At minimum, run:

```sh
git diff --check
```

Also run the checks required by `AGENTS.md` for the files changed, such as:

```sh
node --check apps/server/src/server.js
npm run verify:server-startup
npm run build
```

If a check is not applicable or cannot run, report why.

## Completion report

Report:

- changed files;
- verification commands and results;
- commit hash and push status when a commit was made;
- any skipped checks;
- unrelated working tree changes left untouched.
