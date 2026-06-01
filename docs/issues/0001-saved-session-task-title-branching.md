# Issue 0001: Saved Session Task Title Branching

## Status

Deferred.

## Context

TaskDeck recently introduced a TaskDeck display name that can be shared between task cards and the saved Codex session picker. This made it easier for a human operator to identify the same external AI session across the task list and the session dropdown.

The next proposed change was to apply duplicate-name numbering when creating a task from a saved session, similar to how new sessions are numbered:

```text
Documents investigation
Documents investigation (2)
Documents investigation (3)
```

## Desired User Outcome

When the same saved session is started multiple times, the resulting task cards should be easy to distinguish.

The user explicitly wants branching to be possible:

```text
same saved session id
different TaskDeck task cards
distinct visible card titles
```

## Proposed Direction

Treat names as a parent/child relationship:

```text
sessionLabel = the saved session / resume target name
task.title   = the individual execution card name
```

For a task created from a saved session:

```text
Session label: Documents investigation
Task title:    Documents investigation (2)
```

The saved session dropdown would continue to show the session label, while task cards could show individual execution titles.

## Domain Risk

This may weaken the currently useful invariant:

```text
Task card title matches saved session dropdown label.
```

That invariant helps humans identify a session across the UI. If task titles branch while the dropdown remains stable, the UI must clearly communicate the relationship between:

- saved session identity
- task execution instance
- external agent session id

Otherwise TaskDeck may accidentally create multiple competing Japanese/user-facing names for the same work.

## Open Questions

- Should task cards prioritize `task.title` or `sessionLabel`?
- Should expanded task cards show both `Task title` and `Session label`?
- Should duplicate numbering apply only to cards created from saved sessions, or also to resume-last tasks?
- Should editing a task card title update only that task, or also update the shared session label?
- Is a separate `runIndex` or execution marker better than mutating the visible title?

## Non-Goals For Now

- Do not change saved session identity semantics yet.
- Do not add more persisted metadata until the domain model is settled.
- Do not break precise Codex resume commands or saved session filtering.

## Tentative Recommendation

Pause implementation until TaskDeck explicitly models the difference between:

```text
external session identity
TaskDeck display label
individual task execution title
```

If branching is implemented later, prefer showing both the task execution title and the parent session label somewhere in the card details so the operator can trace the relationship.
