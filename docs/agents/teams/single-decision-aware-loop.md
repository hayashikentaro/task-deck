# Single Decision-Aware Loop Team

This team is one TaskDeck App Server task that runs multiple small improvement cycles.

It is not a multi-agent team. The same agent switches between controller mode and worker mode inside one Codex App Server session.

## Controller Mode

- Maintain the mission.
- Select the next small task.
- Create the Decision Gateway checkpoint.
- Decide whether to continue or exit.

## Worker Mode

- Implement the selected small task.
- Verify the change.
- Report the result.

## Team Contract

- Do not finish only because one small task is complete.
- Keep each cycle small.
- As a rule, limit one cycle to about 1-2 files of change.
- Ask Decision Gateway before implementation by default.
- If the work grows into a larger change, do not implement it yet. Ask Decision Gateway for guidance.

This template is a thin controller pattern for one App Server session. It is not external orchestration, Main/Worker splitting, or independently commandable subagents.
