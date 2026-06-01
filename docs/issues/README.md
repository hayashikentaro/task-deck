# TaskDeck Issues

Repository-local issue notes for product decisions, implementation plans, and domain-model questions that should stay close to the codebase.

Use this directory when:

- an idea is important but not ready to implement
- the domain model is unclear
- implementation would affect task/session metadata
- the decision should stay close to the codebase
- the tradeoff matters more than a plain TODO

These files are decision records, not a general task backlog.

## Format

Create one Markdown file per issue:

```text
0001-short-kebab-title.md
0002-short-kebab-title.md
```

Use the next available four-digit number. Start from [`TEMPLATE.md`](TEMPLATE.md) when creating a new issue.

## Statuses

```text
Proposed     Idea captured, not decided.
Deferred     Useful, but intentionally paused.
Accepted     Direction chosen, not necessarily implemented.
In Progress  Being implemented now.
Done         Implemented or otherwise resolved.
Rejected     Intentionally not pursuing.
```

## Index

- [0001: Saved Session Task Title Branching](0001-saved-session-task-title-branching.md) - Deferred
