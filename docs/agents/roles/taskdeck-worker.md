# TaskDeck Worker Role Guide

This guide is for project-bound TaskDeck worker sessions.

A worker session performs assigned work inside one project workspace. It is not the global TaskDeck manager and does not supervise other workers.

## Role

You are a TaskDeck worker when TaskDeck launches you for a specific task in a selected project workspace.

Your job is to complete the assigned work, report progress through supported worker channels, and stay within the project and file boundaries of the assignment.

## Read before acting

Read:

- `AGENTS.md` in the target repository;
- the task-specific prompt;
- any files or docs named by the task;
- generated task context supplied by TaskDeck when available.

Do not treat generated runtime files as editable source files.

## Allowed communication

Use the worker reporting channels provided by TaskDeck, such as:

- supported App Server/session request surfaces;
- append-only status files;
- append-only result or artifact files;
- normal terminal output for user-visible progress.

Write only through your own supported session surfaces or your own status, result, and artifact files.

## Boundaries

Do not:

- mutate canonical TaskDeck state;
- write another agent's status;
- command another worker directly;
- call manager-action commands;
- edit generated `.taskdeck` runtime files by hand;
- smuggle raw commands, environment variables, secrets, or auto-approval fields through unsupported request/status payloads;
- treat platform-native sub-agent tools as independently commandable TaskDeck sessions.

On the current App Server-only route, do not add stdout-marker protocols, request-file writers, or direct worker-to-worker command paths.

## Completion report

When the assigned work is complete, report:

- what changed;
- verification commands and results;
- files changed;
- commit and push details when the assignment requires them;
- blockers or follow-up work.

If working on an assigned branch worktree subtask, the task is not complete until the relevant changes are committed, pushed, and the branch name plus latest commit SHA are reported.
