# AGENTS.md

Guidance for Codex and other AI agents working in this repository.

This file is the repository router and workflow checklist. Durable product principles, actor boundaries, and role-specific guidance live in the linked docs.

## Repository Boundary

This repository is intended to track:

```text
https://github.com/hayashikentaro/task-deck
```

Before making changes, confirm you are in the correct local checkout:

```sh
pwd
git remote -v
git status --short --branch
git branch --show-current
```

The expected remote is:

```text
origin  https://github.com/hayashikentaro/task-deck (fetch)
origin  https://github.com/hayashikentaro/task-deck (push)
```

An SSH remote for the same repository is also acceptable:

```text
origin  git@github.com:hayashikentaro/task-deck.git (fetch)
origin  git@github.com:hayashikentaro/task-deck.git (push)
```

Do not edit files outside this repository for TaskDeck work unless the user explicitly asks.

## Required Context

Read the relevant docs before changing the matching area:

- Product and agent operating principles: `docs/agents/operating-principles.md`
- Actor-specific documentation map: `docs/agents/README.md`
- GPT collaborator role guidance: `docs/agents/roles/gpt-collaborator.md`
- Current short-term execution order: `docs/current-work-plan.md`
- TaskDeck actor and manager control-plane boundary: `docs/taskdeck-actor-protocol.md`
- Dedicated manager role guidance: `docs/agents/roles/taskdeck-manager.md`
- AI-first layering and responsibility boundaries: `docs/ai-first-layering.md`
- Integration role guidance when doing parent/integration merge work: `docs/agents/roles/integration.md`
- UI styling changes: `docs/guides/ui-style.md`
- Reusable UI components, shared controls, or icon-only controls: `docs/guides/ui-components.md`
- Child-session file protocol: `docs/taskdeck-child-session-protocol.md`

GitHub Issues are the source of truth for actionable work, open/closed state, detailed acceptance criteria, and backlog. Repository docs are durable context and design guidance, not a parallel issue tracker.

If `docs/issues/` is referenced, treat it as historical or decision-record-like context, not as a general backlog. Do not add task status bookkeeping there when a GitHub Issue is the appropriate source of truth.

Do not treat future design notes as implemented behavior. Runtime-generated files and generated manager action guides describe the capabilities of the running app instance.

Do not add personal cross-repository shortcuts or aliases such as `t_`, `k_`, or `th_` to this repository.

## Actor Boundary

For parent/child sessions, manager behavior, agent-to-TaskDeck communication, request transports, or PTY command delivery, follow `docs/taskdeck-actor-protocol.md`.

At a high level:

- Non-manager agents may only write append-only status, result, artifact, or explicitly supported request files.
- Non-manager agents must not mutate canonical TaskDeck state.
- Non-manager agents must not command other agents directly.
- Manager sessions are global TaskDeck supervisor sessions launched from the TaskDeck control/document root, not an individual project workspace.
- Manager write operations must go through `taskdeckctl`.
- TaskDeck server is the only actor that may validate, dedupe, log, execute mutations, and deliver PTY input to another session.

Do not add raw Web API manager-write paths, raw terminal-write paths, raw SQL mutation paths, or direct worker-to-worker command paths unless the user explicitly approves a protocol change and `docs/taskdeck-actor-protocol.md` is updated in the same change.

When asked to create TaskDeck child sessions or send parent-to-child instructions, use the writer scripts defined in `docs/taskdeck-child-session-protocol.md`. Do not use platform-native multi-agent/sub-agent tools and do not treat those agents as TaskDeck child sessions.

## Branch And Worktree Policy

TaskDeck branch work uses `git worktree`.

Use `develop` as the default active development branch. Treat `main` as a protected upstream/release branch: do not check out, edit on, commit to, or push `main` unless the user explicitly asks for `main` work.

Use the current repository checkout as the default working checkout when starting branch work. If the current checkout is already on a branch selected by the user, continue using that checkout for that branch's development unless the user explicitly asks to move the work elsewhere.

Create one worktree per branch and purpose for parallel development when parallel work is actually needed. Do not redirect a requested branch checkout to another existing worktree unless the user asked to use that worktree.

Do not create disposable full clones for TaskDeck branch work. Do not choose between clone and worktree.

Remote GitHub branches are the durable source of truth. A branch task is complete only after intended changes are committed and pushed.

Before editing files, check and record the current branch and working tree state:

```sh
pwd
git remote -v
git status --short --branch
git branch --show-current
```

Continue on the current branch or worktree unless explicitly instructed otherwise. When the user asks to check out, switch to, or continue on a branch, perform that branch operation in the current checkout first, preserving user changes and reporting any blockers. If no branch is specified for ordinary development work, use `develop` rather than `main`.

When committing and pushing, push back to the same branch that was current at the start of the task.

Preserve user changes already present in the working tree. If the working tree has unrelated changes, do not overwrite them; report them before proceeding.

Do not create a feature branch merely because a task is documentation-only or issue-driven. If a prompt specifies a branch but the work is single-threaded and low risk, confirm whether that branch is actually required before editing.

## Child Session Integration

When working as a child session on a branch worktree, producing local changes is not enough to complete the task.

A child session is complete only after it has:

- committed the relevant changes on its child branch;
- pushed that child branch to `origin`;
- reported the branch name;
- reported the latest commit SHA;
- reported verification commands and results;
- reported changed files and merge notes.

Child sessions must not merge themselves into the parent or integration branch unless the prompt explicitly assigns that session to perform integration.

The parent or integration session owns convergence: collect child branch reports, inspect dependency order and file overlap, merge deliberately, run verification, resolve conflicts, and perform the final integration pass.

## Change Authorization

Only edit files that are directly required by the user's requested task.

Do not turn analysis, diagnosis, recommendations, or proposals into repository changes unless the user explicitly asks for repository edits.

Optional cleanup, docs updates, issue updates, rule updates, formatting sweeps, and adjacent refactors require explicit user approval.

The commit-and-push rule applies only after an authorized repository change has been made. It does not authorize making repository changes.

## Working Guidelines

- Keep changes scoped to the user's request.
- Prefer small, reviewable commits.
- Preserve existing user changes.
- Prefer existing project conventions over introducing new structure.
- Avoid broad refactors unless they are required for the task.
- Add or update tests when changing behavior once a test setup exists.
- Document important setup, API, config, persisted metadata, task semantics, or user-facing workflow changes in the repository rather than only in chat.
- Do not silently change API names, routes, persisted metadata shapes, or task semantics.
- When removing a feature or UI path, remove or clearly deprecate related backend handlers, config fields, types, docs, and examples.
- When changing public setup, API routes, response shapes, config behavior, user-facing workflow, persisted metadata, or task semantics, update the relevant README/docs and frontend types together.
- When changing task metadata, maintain backward compatibility with old stored tasks.
- Use GitHub Issues for actionable follow-up work and backlog items.

## Standard Task Workflow

For every implementation task in this repository, follow this workflow unless the user explicitly says otherwise.

Before editing:

- Confirm the current repository with `pwd`.
- Confirm the remote with `git remote -v`.
- Check the working tree with `git status --short --branch`.
- Preserve existing user changes.
- If unexpected changes or untracked files exist, report them instead of modifying or deleting them.

While editing:

- Keep changes scoped to the requested task.
- Prefer small, reviewable changes.
- Avoid broad refactors unless they are required for the task.
- Follow existing project conventions.
- When changing API routes, response shapes, persisted metadata, or task semantics, update related docs and frontend types together.
- Do not duplicate long instructions already covered by linked docs; update the relevant dedicated guide instead.

After editing:

- Run the standard verification commands appropriate for the change.
- At minimum, run `git diff --check`.
- Run `node --check apps/server/src/server.js` when server code changed.
- Run `npm run verify:server-startup` when `apps/server/src/server.js` or server-consumed `@taskdeck/core` exports/imports changed. `node --check` is not sufficient because it does not catch missing runtime imports or top-level `ReferenceError`s.
- Run `npm run build` when application code changed.
- Do not report completion if a required verification command fails.
- If a check cannot be run, report why.

When finished:

- Commit the relevant changes.
- Push the commit.
- Report what changed, verification results, commit hash, push status, skipped checks, and unexpected files not touched.

## Prompt Handoff

Agents working in this repository should read and follow this `AGENTS.md` before making changes.

Task-specific prompts should focus on the goal, allowed files, current context, required behavior, non-goals, acceptance/manual QA, and task-specific verification.

Repository-wide workflow, commit/push behavior, and standard reporting live in this file and do not need to be repeated in every prompt. Repeating key constraints is still fine for risky or high-blast-radius tasks.

If a task-specific user instruction conflicts with this file, stop and report the conflict unless the user's instruction clearly and safely overrides a non-safety process preference.

## Implementation Cautions

- Task persistence must keep old stored tasks loadable.
- Logs can grow; avoid moving terminal output into unbounded React state.
- App Server and PTY process lifecycle, interrupts, server restarts, and task clearing should remain predictable.
- WebSocket task updates should keep task lists, selected task behavior, task output, and session metadata in sync.
- Treat `attentionState` as the supervision UI's primary signal for whether the user should look at a task.
- Agent state should be driven primarily by TaskDeck events such as start, input, Codex App Server status/request events, PTY output activity, and exit.
- Do not infer thinking from silence; quiet running PTYs should keep their last known supervisor state until a stronger signal arrives.
- For Codex work sessions, use Codex App Server status/request events as the control signal.
- Treat TUI text matching as a fallback for explicit user-action prompts only.
- Do not add one-off terminal spinner phrases to infer thinking.
- Keep agent state inference split by adapter (`codex-app-server`, `goose`, and `generic`).
- Approval prompts may override immediately, but input-prompt fallback should be gated by PTY activity.
- PTY activity signals should remain in-memory process observations, not persisted task metadata.
- Agent session metadata is best-effort and should not assume every agent exposes stable ids.
