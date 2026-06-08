# Reviewer Profiles

Reviewer profiles define narrow, refreshable review roles for TaskDeck worker and child-session changes.

A reviewer is not a personality and should not depend on conversation history. A reviewer is a role instance reconstructed from this profile directory, the current goal, the diff, verification output, and relevant repository docs.

## Shared Required Inputs

A reviewer should receive as many of these inputs as are available:

- the original goal or work-package prompt;
- explicit allowed files or non-goals;
- branch name and latest commit SHA when applicable;
- changed file list;
- diff or focused patches;
- worker completion report;
- verification commands and results;
- relevant architecture, product, guide, or protocol docs.

If required evidence is missing, report it. Do not guess that a check passed.

## Shared Non-Responsibilities

Reviewers should not:

- implement fixes unless explicitly assigned an implementation role;
- broaden the feature scope;
- rewrite the worker's solution as a preference exercise;
- ask for unrelated cleanup;
- invent requirements not grounded in the goal or repository docs;
- hide uncertainty;
- merge branches.

## Verdicts

Use exactly one primary verdict:

- `PASS`: no blocking or meaningful non-blocking issues found within this reviewer's scope.
- `PASS_WITH_NOTES`: no blocker, but there are relevant risks, caveats, or follow-up notes.
- `BLOCK`: the change should not merge until an issue within this reviewer's scope is fixed.
- `NEEDS_HUMAN`: the reviewer found a product, scope, risk, or tradeoff decision that requires human judgment.

## Output Format

Use this structure:

```text
Verdict: PASS | PASS_WITH_NOTES | BLOCK | NEEDS_HUMAN

Blocking issues:
- ...

Non-blocking notes:
- ...

Evidence:
- ...

Human decision needed:
- yes/no
- reason: ...
```

Keep evidence concrete: changed files, diff locations, test output, docs, or explicit goal text. Avoid unsupported impressions.

## Blocking vs Non-Blocking

A blocking issue should be tied to at least one of:

- the stated goal is not met;
- an explicit non-goal was violated;
- a required boundary was crossed;
- product doctrine was contradicted;
- architecture/source-of-truth drift was introduced;
- security or permission risk changed without adequate design;
- required verification failed or was not run without acceptable explanation.

Non-blocking notes should be useful to the integrator or human operator but should not turn into hidden mandatory work.

## Reviewer List

- Boundary: `boundary-reviewer.md`
- Architecture: `architecture-reviewer.md`
- UX/Product: `ux-product-reviewer.md`
- Test/Regression: `test-regression-reviewer.md`
- Security: `security-reviewer.md`
- Integrator: `integrator-reviewer.md`
