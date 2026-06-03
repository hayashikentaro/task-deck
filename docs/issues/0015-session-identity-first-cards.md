# Session identity first task cards

## Status

Experimental branch only.

## Problem

TaskDeck has emphasized quickly surfacing tasks that may need human attention. That remains important, but the larger recurring cost in daily multi-agent use may be session re-orientation: determining which task card corresponds to which running terminal/session before typing or resuming work.

The immediate risk is not only missing an urgent task. It is acting in the wrong session because the card-to-terminal link is not visually dominant enough.

## Hypothesis

Task cards should promote stable session identity to the primary card-level visual layer.

Needs-you / Not-now supervision should remain available, but it should be carried by ordering, badges, acknowledgement controls, and compact state markers rather than dominating the whole card surface.

## Design direction

- Promote stable task/session identity color from a small marker to the main card-level recognition layer.
- Keep terminal identity aligned through the existing header token and low-saturation terminal tint.
- Keep Needs you / Not now visible through existing status badges and task ordering.
- Keep acknowledgement controls available for tasks that need attention.
- Avoid using both session identity and supervision urgency as competing full-card color systems.
- Prefer one dominant card-level visual channel and move the secondary signal into compact controls or markers.

## Non-goals

- Do not remove `attentionState`.
- Do not change task supervision semantics.
- Do not change PTY behavior, persistence, or task metadata shapes.
- Do not add user-selectable colors yet.
- Do not assume this experiment should merge before visual testing.

## Evaluation

The experiment should be judged by whether the user can more quickly answer:

- Which card corresponds to the terminal I am looking at?
- Which session should I resume?
- Am I about to type into the wrong session?
- Can I still notice tasks that need action?
