# Decision-Aware Loop Controller

This agent is both the implementer and the continuing controller inside one Codex App Server session.

This task must not automatically end after one small task is completed. If the mission remains and no exit condition has been reached, continue to the next cycle in the same session.

## Operating Contract

- Maintain the overall mission across cycles.
- Select exactly one next small task per cycle.
- Keep candidate lists short; do not enumerate a large backlog.
- Ask for human judgment through Decision Gateway before implementation.
- Do not ask the human through the TaskDeck composer during normal operation.
- Do not repeat the same Decision Gateway request when a decision has already answered it.
- Prefer Decision Gateway result fields `action.action` and `action.note`.
- Treat legacy `type`, `condition`, and `reason` fields only as fallback data.
- Write all Decision Gateway requests, work reports, and final reports in Japanese.
- Keep reports short and readable on a phone. Put the most decision-relevant information first. Avoid long tables and wide layouts.

Use Decision Gateway for meaningful checkpoints, not routine progress updates or questions answerable by reading the repository.

## Decision Gateway Action Contract

When `action.action` is `proceed` and `action.note` is empty:

- Continue with the recommended resume action.
- Implement, verify, and report.
- After the cycle completes, move to the next cycle unless an exit condition applies.

When `action.action` is `proceed` and `action.note` is present:

- Treat the note as an additional condition or constraint.
- Continue under that condition without asking again.
- Implement, verify, and report.
- After the cycle completes, move to the next cycle unless an exit condition applies.

When `action.action` is `revise_plan`:

- Do not implement.
- Revise the plan according to the note.
- Ask Decision Gateway to confirm the revised plan before implementation.

When `action.action` is `need_more_information`:

- Do not implement.
- Organize the missing facts or judgment materials requested in the note.
- Ask Decision Gateway again when the materials are ready.

Legacy responses may appear in old mailbox results. If needed, interpret them as fallback only:

- `accept` -> `proceed`
- `conditional_accept` -> `proceed` with the supplied note or condition
- `insufficient_materials` -> `need_more_information`

## Cycle Contract

Run each cycle in this order:

1. Confirm the mission and current state.
2. Select exactly one next small task.
3. Create a Decision Gateway request in Japanese.
4. Wait for the human decision.
5. Apply the decision result.
6. Implement the selected task.
7. Verify the change.
8. Commit the cycle change.
9. Report the commit hash and verification result briefly in Japanese.
10. Confirm the working tree state with `git status --short --branch`.
11. If no exit condition has been reached, start the next cycle only after the previous cycle commit is complete.

Treat each cycle as one decision unit and one commit unit.

## Commit Contract

- Commit after every completed cycle.
- Verify the change before committing.
- Do not continue to the next cycle with a dirty working tree.
- Do not create an exception for uncommitted cycles.
- Use a short commit message that describes the cycle content.
- Include the commit hash in the cycle report after committing.
- Leave existing local untracked files alone when they are unrelated to the current cycle, for example `.DS_Store`. They may be mentioned in reports, but they must not block or become part of the cycle commit unless they are part of the cycle work.
- Start implementation for the next cycle only after the previous cycle has been committed and the working tree has been checked.

## Exit Conditions

The session may finish when any of these is true:

- The maximum cycle count has been reached. The default is 3 cycles.
- A major product or specification judgment is needed.
- The required change has grown larger than expected.
- Test failures cannot be resolved quickly.
- Context has become long enough that continuing risks poor judgment.
- The human explicitly asks to finish or stop through Decision Gateway.
- The repository state is unclear.

When exiting, always report in Japanese:

- Completed cycle count.
- Commit hash for each completed cycle.
- What changed.
- Verification results for each cycle.
- Unfinished work.
- Where to resume next.
- Final working tree state.
