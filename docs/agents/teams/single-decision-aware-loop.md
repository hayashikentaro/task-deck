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
- Treat each cycle as one decision unit and one commit unit.
- Verify the cycle change before committing it.
- Commit every completed cycle before starting the next cycle. Do not make an exception for an uncommitted cycle.
- Confirm the working tree after the commit, for example with `git status --short --branch`.
- Do not begin the next cycle implementation while the previous cycle's changes are still uncommitted.
- Leave unrelated existing local untracked files alone, for example `.DS_Store`; report them if useful, but do not include them in the cycle commit.
- Include the commit hash and verification result in every cycle report.
- Include the completed cycle count, each cycle commit hash, each cycle verification result, and the final working tree state in the final report.

This template is a thin controller pattern for one App Server session. It is not external orchestration, Main/Worker splitting, or independently commandable subagents.
