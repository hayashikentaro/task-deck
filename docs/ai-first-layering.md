# AI-First Layering

TaskDeck is being developed with multiple AI agent sessions as first-class collaborators. This document captures a working design principle for using architectural layers as AI session boundaries.

This is not a strict Clean Architecture template. Use it as a practical way to shape agent responsibilities, decision authority, context reuse, and integration flow.

## Core idea

AI-first layering treats a layer as all of the following:

- a responsibility boundary;
- a decision-authority boundary;
- a context-cache unit for long-lived agent sessions;
- a merge/integration boundary;
- a way to reduce accidental cross-layer changes.

Traditional layering helps humans reason about maintainability. AI-first layering also helps agents know what to read, what they may change, what they must not decide locally, and when to return work to a parent or integration session.

## Why this matters for TaskDeck

AI agents tend to implement in whatever location is most convenient unless the working boundary is explicit. Layering should make it easier for agents to:

- keep prompts shorter by reading only relevant files;
- avoid changing unrelated layers;
- preserve durable context inside role-specific child sessions;
- route follow-up work to an existing specialist session;
- make merge order and conflict ownership clearer;
- identify when a decision crosses a layer boundary and should be escalated.

For TaskDeck, this supports the direction where a parent session coordinates role-bearing child sessions rather than only spawning disposable one-off workers.

## Suggested layers

These layers are intentionally practical rather than rigid.

### Core

Owns product concepts and stable domain semantics.

Examples:

- Task/session meaning;
- supervision concepts;
- parent/child task metadata semantics;
- persisted task compatibility rules.

Typical files:

- `packages/core/src/*`

Core sessions may decide what a concept means. They should not decide UI layout, App Server/PTY timing, or protocol transport details unless explicitly asked.

### Protocol

Owns machine-readable boundaries between agents, TaskDeck, and runtime flows.

Examples:

- `TASKDECK_CHILD_SESSION_BATCH_REQUEST`;
- forbidden fields;
- validation rules;
- child result/report formats;
- parent-to-child instruction request formats.

Typical files:

- `docs/taskdeck-child-session-protocol.md`;
- `apps/web/src/childSessionRequests.ts`;
- future protocol/parser modules.

Protocol sessions should keep contracts explicit and testable. They should not build UI workflows or raw launch commands.

### Runtime

Owns side-effectful runtime behavior.

Examples:

- Codex App Server subprocess lifecycle;
- App Server JSON-RPC request/notification handling;
- PTY lifecycle;
- input queueing;
- websocket server behavior;
- process start/exit handling;
- server-side initial instruction delivery.

Typical files:

- `apps/server/src/server.js`

Runtime sessions should be careful with timing, process lifecycle, and existing queue mechanisms. They should not alter protocol semantics or UI presentation without coordination.

### UI

Owns presentation, interaction affordances, and visual hierarchy.

Examples:

- Task cards;
- child badges;
- expanded task-card metadata;
- action buttons;
- CSS and visual emphasis.

Typical files:

- `apps/web/src/components/*`;
- `apps/web/src/styles.css`;
- `docs/guides/ui-style.md`;
- `docs/guides/ui-components.md`.

UI sessions should not change supervision semantics or server behavior merely to satisfy display needs.

### App Flow

Owns frontend orchestration and lifecycle wiring.

Examples:

- WebSocket event handling;
- parent output detection;
- parse -> validate -> create child task flow;
- dedupe;
- status/error messages;
- connecting trusted launch helpers to task creation.

Typical files:

- `apps/web/src/App.tsx`;
- `apps/web/src/agentLaunch.ts`;
- related orchestration helpers.

App Flow sessions often cross layer boundaries. They should reuse Protocol, Core, Runtime, and UI pieces rather than redefining their rules.

### Integration

Owns convergence across child branches and layers.

Examples:

- collecting pushed child branches;
- deciding merge order;
- merging into the integration branch;
- running checks after merges;
- resolving conflicts or routing work back to the correct child session;
- final integration passes.

Typical files:

- no single ownership area;
- uses Git state, reports, diffs, and checks.

Integration sessions should not become another feature implementation session unless explicitly assigned. Their main job is convergence.

## Parent and child session model

A parent/planning session should:

- decompose work by layer when useful;
- define stable interfaces before parallel work begins;
- route work to existing role sessions when appropriate;
- spawn new child sessions only when a role/session does not already fit;
- collect child reports;
- assign integration work deliberately.

A child session should:

- work within its assigned role and scope;
- refresh current repository state before acting;
- stop and report when a requested change crosses its authority;
- commit and push its child branch;
- report branch, commit, changed files, checks, and merge notes.

A child session should not merge itself into the parent/integration branch unless it is explicitly acting as the integration session.

## Review-driven parent session model

A parent session can also act like a long-lived product/technical decision maker rather than only a task splitter. In that model, implementation sessions and reviewer sessions are deliberately separated.

The parent session should preserve the durable product context:

- product intent and user preference;
- issue ordering and trade-offs;
- accepted, rejected, and deferred review findings;
- which follow-up issues were created;
- final merge or defer decisions.

Reviewer child sessions should usually be treated as refreshable inspection tools rather than long-lived owners. Reviewers are valuable because they can keep a viewpoint independent from the implementation session. They should be refreshed or recreated when stale context would weaken the review.

Useful reviewer roles include:

- Boundary reviewer: checks AI-first layering, authority boundaries, and cross-layer leakage.
- Regression reviewer: checks whether existing behavior still works.
- Security/capability reviewer: checks raw command use, ambiguous targets, permission boundaries, and risky side effects.
- UX friction reviewer: checks whether supervision UI adds unnecessary human confirmation or hides important attention signals.
- Integration reviewer: checks branch state, merge order, conflicts, and verification results.

Reviewer sessions should be given an explicit failure-detection objective. They are not implementation helpers by default. A useful reviewer prompt should ask for blocking issues, non-blocking concerns, questions, and follow-up candidates instead of asking the reviewer to make the implementation look good.

A typical review loop is:

1. Parent sends implementation work to an implementation child.
2. Implementation child commits, pushes, and reports a structured result.
3. Parent starts or refreshes one or more reviewer children with specific review roles.
4. Reviewer children return structured findings.
5. Parent decides which findings are blocking, which are follow-ups, and which are intentionally accepted risks.
6. Parent sends only the selected blocking fixes back to the implementation child.
7. Only the relevant reviewers are refreshed for the next round.
8. Integration reviewer or integration session performs merge readiness checks.

Keep review loops finite. Prefer a small number of rounds, such as one implementation review plus one focused re-review. Non-blocking findings should usually become follow-up issues instead of keeping the implementation loop open indefinitely.

This model is not primarily about token savings. Its value is independent perspectives, conflict of interest separation, regression protection, and explicit parent-level judgment.

## Refresh preflight for long-lived role sessions

Long-lived child sessions are useful because they keep layer-specific context. They can also become stale. Before acting on a new instruction, a role session should:

- fetch the latest integration branch;
- inspect files relevant to its role and scope;
- compare current repository state with earlier assumptions;
- avoid relying only on previous chat context;
- stop and report unsafe branch/worktree state or unexpected changes.

## When to add role docs

Do not create role documents for every possible layer up front. Add them when they are repeatedly useful or when a recurring task has already exposed coordination problems.

Good first candidates:

- `docs/agents/roles/integration.md` because merge/convergence ownership has already caused confusion;
- future App Flow role docs when auto-launch orchestration becomes complex.

Avoid creating a template repository until these rules have been exercised and updated inside TaskDeck itself. A separate template without product feedback can become stale quickly.

## Practical rule of thumb

Parallelize across layers when the interface is clear.

Keep work sequential when the change is a vertical orchestration flow through the same central files.

Examples:

- Good parallel work: docs, parser, runtime, UI display.
- Better sequential work: parent output -> parse -> trusted command build -> child task creation -> dedupe -> status messaging.
