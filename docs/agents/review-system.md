# AI Review System

This document defines the durable review system for TaskDeck worker, subtask, and session-control changes.

Review agents are disposable execution instances. The review rulebook in this repository is the source of truth. A reviewer should be recreatable from the relevant reviewer profile, the current goal, the diff, verification output, and the architecture/product docs.

## Purpose

TaskDeck may run multiple goal-driven worker sessions in parallel. Those workers can produce useful code quickly, but parallel merge velocity also increases the risk of slow architectural drift.

The review system exists to prevent locally reasonable changes from accumulating into an incoherent system.

Reviewers should help the human operator decide whether to merge, inspect, retry, or reject a change. They should not turn code review into another implementation session unless explicitly assigned to do so.

## Operating Model

```text
Planner / parent session
  -> decomposes work into small goals
Worker sessions
  -> implement in isolated branches or worktrees
Reviewer agents
  -> inspect the result through narrow responsibility gates
Integrator reviewer
  -> combines review reports into a merge recommendation
Human operator
  -> decides merge, inspect, retry, or reject
```

A worker may use `/goal` or another goal-following mechanism, but goal following is not the source of architectural truth. The source of truth is the repository rulebook and the task-specific prompt.

## Reviewer Refresh Policy

Long-lived reviewer sessions should not become the source of implicit judgment.

Refresh reviewers freely when:

- the review conversation has become long;
- the reviewer appears to rely on prior PR context too heavily;
- the reviewer starts making exceptions not grounded in the rulebook;
- the reviewer begins implementing fixes instead of reviewing;
- the review target changes substantially.

A refreshed reviewer must be able to recover its role from:

- this document;
- the relevant profile under `docs/agents/reviewers/`;
- relevant architecture and product docs;
- the current goal;
- changed files and diff;
- verification output when available.

## Review Gates

Use different reviewers for different responsibilities. Narrow gates are preferred over one general-purpose reviewer.

Default gates for most worker changes:

- Boundary Reviewer
- Test/Regression Reviewer
- Integrator Reviewer

Add Architecture Reviewer when a change touches responsibility boundaries, shared concepts, state models, protocol shape, task metadata, persistence, or cross-layer behavior.

Add UX/Product Reviewer when a change touches task cards, supervision states, Needs you / Not now behavior, terminal/composer workflow, review surfaces, or human decision load.

Add Security Reviewer when a change touches command construction, sandbox or permission behavior, environment variables, secrets, file paths, external input, network exposure, or session/subagent control behavior.

## Reviewer Profiles

Profiles live under `docs/agents/reviewers/`:

- `boundary-reviewer.md`
- `architecture-reviewer.md`
- `ux-product-reviewer.md`
- `test-regression-reviewer.md`
- `security-reviewer.md`
- `integrator-reviewer.md`

Each profile defines one role, required inputs, responsibilities, non-responsibilities, and output expectations.

## Model Size Guidance

Model size should follow responsibility, not hierarchy.

Small or local models are useful for patrol-style checks:

- changed file lists;
- scope boundary checks;
- generated/runtime file checks;
- test log summaries;
- output format checks;
- obvious TODO or placeholder detection.

Medium models are useful for focused semantic checks:

- goal/spec matching;
- small responsibility-boundary reviews;
- test meaning checks;
- diff summaries against a narrow rulebook.

Strong cloud models are preferred for high-judgment gates:

- architecture review;
- UX/product doctrine review;
- security review for high-risk areas;
- integrator review;
- comparing multiple worker implementations.

Do not ask small models to decide whether a new concept should exist, whether a product doctrine tradeoff is acceptable, or whether a risky permission model is safe. Use small models to gather evidence and reject obvious violations before expensive review.

## Verdicts

All reviewers should use the shared verdict vocabulary from `docs/agents/reviewers/README.md`:

- `PASS`
- `PASS_WITH_NOTES`
- `BLOCK`
- `NEEDS_HUMAN`

Integrator reports should translate reviewer verdicts into one of:

- `MERGE`
- `INSPECT`
- `RETRY`
- `REJECT`

## Non-Goals

This system is not a replacement for tests, type checks, or human judgment.

This system is not an issue tracker. GitHub Issues remain the source of truth for actionable work, backlog, and status.

This system should not become a style-lawyer layer. Style should be handled by formatting, linting, component contracts, and focused guides wherever possible.
