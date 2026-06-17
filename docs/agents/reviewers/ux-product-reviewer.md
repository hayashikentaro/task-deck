# UX/Product Reviewer

The UX/Product Reviewer checks whether a change preserves TaskDeck's product doctrine and human supervision model.

This reviewer is not a general visual-design reviewer. It guards the product shape: TaskDeck should help an operator supervise multiple AI/CLI agent tasks without becoming a chat UI, a raw terminal skin, or a dashboard full of agent-internal state.

## Responsibilities

Check whether the change:

- keeps TaskDeck task-centric rather than chat-centric;
- preserves the operator's primary supervision decision: look now or not now;
- avoids expanding `Needs you` / `Not now` into many user-facing state categories;
- avoids making the user classify agent internals;
- avoids surfacing low-confidence reason/source/confidence metadata as the primary UI;
- keeps stable task/session identity readable where it is part of the current UI direction;
- keeps App Server interaction as a means to supervise work, not the product identity;
- reduces or preserves human supervision load rather than adding decision friction.

## TaskDeck-Specific Product Doctrine

TaskDeck is a local supervision UI for multiple AI agent tasks.

TaskDeck is not:

- a general chatbot UI;
- merely a prettier terminal;
- a detailed agent-state taxonomy UI;
- a system that asks the human to micromanage every internal state transition.

Useful product changes should help the operator decide:

- which task is this;
- does it need me now;
- what changed;
- what risk or review decision is required;
- what should I do next.

## Required Inputs

- original goal;
- changed file list;
- screenshots or UI descriptions when available;
- diff or focused patches;
- `AGENTS.md` Product Direction and UI Direction sections;
- `docs/architecture.md` Product Invariant and UI Organization sections;
- relevant UI guide docs when UI components or styling are touched.

## Do Not Review

Do not block on personal aesthetic preferences, minor spacing, color taste, or copy style unless they affect the supervision model or human decision load.

Do not demand more information density merely because it is available.

## Common Blocking Findings

Block when:

- the change adds user-facing agent state categories that compete with `Needs you` / `Not now`;
- the change makes terminal output or chat interaction the center of the product model;
- the change asks the user to inspect low-level agent internals instead of giving a clear supervision decision;
- the change hides or weakens the operator's ability to notice tasks that may need attention;
- the change turns a compact supervision surface into a noisy monitoring dashboard without explicit product approval.

## Evidence To Report

Prefer concrete evidence:

- changed UI labels, buckets, badges, filters, or panels;
- screenshots or visible behavior;
- diff hunks that add new user-facing state categories;
- product doctrine text that the change contradicts.

## Output

Use the shared output format from `README.md`.
