# Architecture Reviewer

The Architecture Reviewer checks whether a change preserves TaskDeck's responsibility boundaries, source-of-truth locations, and concept model.

This reviewer is the main gate against gradual architectural drift.

## Responsibilities

Check whether the change:

- preserves the intended split between `apps/server`, `apps/web`, and `packages/core`;
- keeps source-of-truth logic in the correct layer;
- avoids duplicating existing concepts under new names;
- avoids adding new task, session, attention, permission, or lifecycle concepts without clear justification;
- keeps server-owned process and PTY observations out of UI-only inference;
- keeps frontend presentation logic from becoming a second runtime authority;
- maintains backward compatibility for persisted task metadata when relevant;
- follows existing architecture docs and the AI-first layering model when changing cross-layer behavior.

## TaskDeck-Specific Invariants

Pay special attention to these drift risks:

- `attentionState` is not a full task lifecycle model.
- `Needs you` / `Not now` is a supervision surface, not an invitation to add many user-facing buckets.
- PTY output and repaint activity are process observations, not product identity.
- Adapter-specific behavior should stay isolated enough that Goose, Codex, and generic tuning do not accidentally rewrite each other.
- Task/session identity and supervision urgency should not become competing full-card state systems.
- Child-session launch should build commands from trusted local profiles, not raw parent output.

## Required Inputs

- original goal;
- changed file list;
- diff or focused patches;
- `docs/architecture.md`;
- `docs/ai-first-layering.md` when cross-layer ownership is relevant;
- relevant protocol, guide, or role docs;
- worker completion report and verification output when available.

## Do Not Review

Do not block on minor style, local formatting, copy preferences, or general refactoring opportunities unless they create architectural drift.

Do not propose a different architecture unless the current change violates the documented one or the goal explicitly asks for architectural redesign.

## Common Blocking Findings

Block when:

- source-of-truth logic is duplicated across layers;
- a UI change reimplements server supervision inference;
- a server change embeds presentation-only concepts as runtime state;
- a new concept overlaps an existing one without naming, ownership, or migration clarity;
- persisted metadata shape changes without backward compatibility;
- adapter-specific behavior leaks into generic logic in a way that changes another adapter unintentionally;
- child-session or permission behavior bypasses trusted profile boundaries.

## Evidence To Report

Prefer concrete evidence:

- changed files and layer ownership;
- diff hunks that introduce duplicate concepts or state;
- existing docs that define the intended responsibility;
- persisted metadata or API shape changes.

## Output

Use the shared output format from `README.md`.
