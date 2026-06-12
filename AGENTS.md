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

## UI Direction: Session Identity First Cards

TaskDeck currently treats stable task/session identity as an important card-level visual layer. In real multi-agent use, quickly recognizing which task card maps to which terminal/session is part of safe supervision.

For this direction:

- Stable task/session identity may be the primary card-level visual layer.
- Supervision remains semantically central, but should be expressed through ordering, badges, acknowledgement controls, compact state markers, and action prompts.
- `attentionState` remains the primary supervision signal for data, sorting, and action prompts; it should not automatically imply full-card state coloration.
- Avoid drifting back to a design where full-card Needs you / Not now coloration dominates the card surface.
- Selected task state should be visually distinct from task identity color while still feeling like the same identity is active.
- Preserve the visual link between task card identity and terminal identity tint.
- Do not encode session identity and supervision urgency as competing full-card color systems.
- Do not remove supervision logic, PTY behavior, task persistence, or existing task metadata semantics as part of visual work.

## Current Project State

The repository now contains a working MVP application:

```text
apps/server    TaskDeck backend, PTY orchestration, REST API, and WebSocket handling
apps/web       React/Vite frontend
packages/core  Shared task and domain logic
README.md      Project overview and local API notes
AGENTS.md      Repository guidance for AI agents
docs/architecture.md  Project architecture map and refactoring seams
```

`.taskdeck/` is local runtime state for persisted tasks, logs, presets, and related data. It should not be committed.

## Issues And Repository Docs

GitHub Issues are the source of truth for actionable work, open/closed state, task status, and backlog.

Repository-local docs should not become a parallel issue tracker or task status system. Use them for durable design decisions, architectural notes, product context, setup/API references, and implementation tradeoffs that should live close to the code.

If `docs/issues/` is referenced, treat it as historical or decision-record-like context, not as a general backlog. Do not add task status bookkeeping there when a GitHub Issue is the appropriate source of truth.

## Planning Context

For the current short-term execution order, read:

- `docs/current-work-plan.md`

For medium-term product direction and cross-issue design rationale, read:

- `docs/roadmap-context.md`

GitHub Issues remain the source of truth for actionable work, open/closed state, detailed acceptance criteria, and completion state. These planning docs provide sequencing and design context only.

## Domain Concepts

- Task: the central supervision unit, with process status, agent state, risk, logs, metadata, and diff context.
- Task/session identity: the stable visual link between a task card and its terminal/session. This may be the dominant card-level visual channel.
- Supervision state: whether a task may need attention. This is still driven by TaskDeck state such as `attentionState`, but it may be shown through compact UI channels rather than full-card coloration.
- PTY: the pseudo-terminal process behind a running task. It is an interaction mechanism, not the product identity.
- Agent profile: a configured launch profile such as Codex, Goose, container agents, zsh, or custom commands.
- Session mode: how a new agent session starts, such as new session, resume last, custom resume, or saved session.
- Resume last: an imprecise Codex resume mode that targets the latest Codex session.
- Resume saved: a precise resume path using stored task/session metadata when available.
- Saved Codex session: a best-effort session derived from TaskDeck task metadata, not from Codex internal storage.
- Diagnostics: server/UI checks for Docker, configured agent containers, and configured workspaces.

Keep state, risk, diffs, review, and agent supervision central. Terminal/PTY interaction is a means to supervise work, not a chat surface or decorative terminal skin. Keep supervision semantics central while allowing session identity to dominate the card's first visual read.

## AI-First Layering

When decomposing work for child or role sessions, prefer the AI-first layering model in `docs/ai-first-layering.md`.

Treat layers as responsibility boundaries, decision-authority boundaries, and context-cache units for long-lived agent sessions. Useful layers include Core, Protocol, Runtime, UI, App Flow, and Integration.

Use role-specific guidance when available, such as `docs/agents/roles/integration.md` for parent/integration merge work.

## Working Guidelines

- Keep changes scoped to the user's request.
- Prefer small, reviewable commits.
- Preserve user changes already present in the working tree.
- Prefer existing project conventions over introducing new structure.
- Avoid broad refactors unless they are required for the task.
- Add or update tests when changing behavior once a test setup exists.
- Document important setup, API, config, persisted metadata, task semantics, or user-facing workflow changes in the repository rather than only in chat.
- Documentation updates are usually not required for CSS-only visual tuning, spacing, focus rings, animation timing/easing, or small local affordance adjustments unless the change alters user-facing workflow or durable design guidance.
- Do not silently change API names, routes, persisted metadata shapes, or task semantics.
- When removing a feature or UI path, remove or clearly deprecate related backend handlers, config fields, types, docs, and examples so dead code is not mistaken for supported behavior.
- When changing public setup, API routes, response shapes, config behavior, user-facing workflow, persisted metadata, or task semantics, update the relevant README/docs and frontend types together.
- When changing task metadata, maintain backward compatibility with old stored tasks.
- Use GitHub Issues for actionable follow-up work and backlog items.
- Use repo-local docs for durable context and decisions. Treat `docs/issues/` as historical or decision-record-like context, not as the current backlog.
- Keep responsibility-specific implementation guidance in dedicated files under `docs/guides/`, not directly in this top-level router. When introducing or changing a recurring area-specific rule, create or update the relevant guide and link it from this file.
- When changing `apps/web` UI styling, read `docs/guides/ui-style.md`. When changing reusable UI components, shared controls, or icon-only controls, read `docs/guides/ui-components.md`.
- When asked to create TaskDeck child sessions, emit the structured request block defined in `docs/taskdeck-child-session-protocol.md`; do not invent raw launch commands.

## Branch And Worktree Policy

For single-threaded work, prefer working directly on `main` unless the task may leave `main` temporarily broken or hard to use.

Use a separate branch and, when useful, a separate worktree for:

- parallel work by multiple sessions;
- long-running work that should not block `main`;
- risky Runtime/App Flow changes;
- changes that may require intermediate broken states;
- experiments that may be discarded.

Do not create a feature branch merely because a task is documentation-only or issue-driven. If a prompt specifies a branch but the work is single-threaded and low risk, confirm whether that branch is actually required before editing.

## Child Session Branches And Integration

When working as a child session in an isolated branch/worktree, producing local changes is not enough to complete the task.

A child session is complete only after it has:

- committed the relevant changes on its child branch;
- pushed that child branch to `origin`;
- reported the branch name;
- reported the latest commit SHA;
- reported verification commands and results;
- reported changed files and merge notes.

Child sessions must not merge themselves into the parent or integration branch unless the prompt explicitly assigns that session to perform integration.

The parent or integration session owns convergence:

- collect completed child branch reports;
- inspect dependency order and file overlap;
- merge child branches into the parent/integration branch in a deliberate order;
- run verification after each merge or after a clearly safe batch;
- resolve conflicts or send work back to the relevant child session;
- perform the final integration pass.

Use this boundary for TaskDeck child-session work and for manual parallel worktree sessions. A worktree task being locally done is not the same as being integrated into the parent branch.

## Change Authorization Boundary

Only edit files that are directly required by the user's requested task.

Do not turn analysis, diagnosis, recommendations, or proposals into repository changes unless the user explicitly asks for repository edits.

Optional cleanup, docs updates, issue updates, rule updates, formatting sweeps, and adjacent refactors require explicit user approval.

The commit-and-push rule applies only after an authorized repository change has been made. It does not authorize making repository changes.

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
- Do not duplicate instructions or guidance already present in this `AGENTS.md`; update the existing relevant section instead.

After editing:

- Run the standard verification commands appropriate for the change.
- At minimum, run `git diff --check`.
- Run `node --check apps/server/src/server.js` when server code changed.
- Run `npm run build` when application code changed.
- If a check cannot be run, report why.

When finished:

- Commit the relevant changes.
- Push the commit.
- Report what changed, verification results, commit hash, push status, skipped checks, and unexpected files not touched.

## Prompt Handoff Convention

Agents working in this repository should read and follow this `AGENTS.md` before making changes.

Task-specific prompts should focus on the goal, allowed files, current context, required behavior, non-goals, acceptance/manual QA, and task-specific verification.

Repository-wide workflow, commit/push behavior, and standard reporting live in this file and do not need to be repeated in every prompt. Repeating key constraints is still fine for risky or high-blast-radius tasks.

If a task-specific user instruction conflicts with this file, stop and report the conflict unless the user's instruction clearly and safely overrides a non-safety process preference.

## Implementation Cautions

- Task persistence must keep old stored tasks loadable.
- Logs can grow; avoid moving terminal output into unbounded React state.
- PTY process lifecycle, interrupts, server restarts, and task clearing should remain predictable.
- WebSocket task updates should keep task lists, selected task behavior, terminal output, and session metadata in sync.
- Treat `attentionState` as the supervision UI's primary signal for whether the user should look at a task. Prefer `may_need_user` over hiding possibly blocked tasks as merely running.
- `attentionState` remains primary for supervision semantics, sorting, and action prompts, but must not by itself pull the visual design back to full-card Needs you / Not now coloration.
- Agent state should be driven primarily by TaskDeck events such as start, input, PTY output activity, and exit. Do not infer thinking from silence; quiet running PTYs should keep their last known supervisor state until a stronger signal arrives. Treat TUI text matching as a fallback for explicit user-action prompts only.
- Do not add one-off Goose/Codex spinner phrases to infer thinking. Prefer TaskDeck-owned events, process observations, or explicit action prompts. If TUI fallback is used, include reason/source/confidence metadata.
- Keep agent state inference split by adapter (`goose`, `codex`, and `generic`) so Goose behavior can be tuned without accidentally changing Codex supervision semantics.
- Approval prompts may override immediately, but input-prompt fallback should be gated by PTY activity so animated/repainting TUIs are not classified as waiting for input too early.
- PTY activity signals such as visible text, ANSI/cursor-control frames, and carriage returns should remain in-memory process observations, not persisted task metadata.
- Prefer machine-readable or non-TUI agent modes when an agent supports them, but keep PTY compatibility until those modes are proven.
- Approval should eventually become a TaskDeck-side permission boundary instead of a scraped TUI state.
- Agent session metadata is best-effort and should not assume every agent exposes stable ids.
- `GET /api/agent-sessions` lists saved Codex sessions derived from TaskDeck task metadata.
- When documenting `/api/agent-sessions`, use the current response shape from the implementation, not older proposed names.
- `Resume last` is imprecise; `Resume saved` and the saved session picker should use precise stored resume commands when available.
- Agent profile config should merge with built-in profiles rather than replace them wholesale.

## Runtime And Generated Files

Do not commit generated/runtime state, logs, dependency directories, or local environment files.

Common examples:

```text
.taskdeck/
node_modules/
dist/
.env
.DS_Store
```

If new generated files appear during local runs, add or update `.gitignore` only when appropriate for the repository, and mention it in the final report.
