# [Design] AI agent placement: main feature + patch absorption merge model

Status: open
Created: 2026-06-13

## Summary

Treat merge support as part of AI-agent placement design.

Realistic parallel AI development is not several large features running independently. It is usually one large feature running as the main axis, with smaller fixes/tests/docs/instrumentation tasks running around it. In that situation, most merge work can be handled safely as patch absorption, while only product-level conflicts should require human judgment.

## Core model

Use a **main feature branch + surrounding patch absorption** model.

- One `major_feature` task is the main axis.
- Smaller tasks run in parallel only when likely to be absorbable.
- A merge/integration agent treats the major feature as the structural base.
- Minor task intent is ported onto the major feature branch.
- Escalate only when the patch changes product meaning, UX, state, persistence, auth, permissions, or other core behavior.

## Task classes

Parallel-friendly:

- `minor_fix`
- `test_only`
- `docs_only`
- `instrumentation`
- small UI polish that does not change workflow meaning

Caution:

- `refactor`
- shared utility changes
- common component changes

Usually single-lane:

- `major_feature`
- `migration`
- `core_state_change`
- `ux_decision`
- auth / permissions / billing / personal data
- user-facing classification changes

## Integration classifications

### SAFE_PATCH

The small task's intent can be preserved and applied to the main feature branch without changing product meaning.

Examples:

- independent import additions
- additional tests
- docs/comments
- simple copy/spacing fixes
- development-only observability needles

### PATCH_OBSOLETED

The main feature already solved the patch's intent, or changed the code so the patch no longer applies.

The agent may propose dropping the patch, but should report why.

### PATCH_NEEDS_REBASE

The patch remains valid, but its application point changed.

The agent should port intent rather than mechanically choosing one side.

### PRODUCT_CONFLICT

The patch is no longer merely a patch. It changes or conflicts with product meaning.

Escalate to `Needs you`.

Examples:

- duplicate state concepts with different names
- UI placement / workflow decisions
- `Needs you` / `Not now` semantic changes
- state transition priority
- migrations, auth, permissions, billing, data deletion
- user-facing classifications, confidence, safety judgments, or detailed agent states

## Merge agent principle

The merge agent is an integrator, not an implementer.

It should:

1. identify the main feature branch and patch branches
2. inspect changed files and conflict hunks
3. preserve patch intent where safe
4. avoid inventing new product behavior
5. avoid silently choosing one branch over another when both change meaning
6. classify conflicts before resolving them
7. run typecheck/tests when available
8. output a merge report with risks and required manual checks
9. escalate product decisions to `Needs you`

## TaskDeck product principle

Do not let merge support introduce extra user-facing complexity.

The supervision model should remain coarse:

- `Needs you`
- `Not now`

Detailed classifications such as `SAFE_PATCH`, `PATCH_NEEDS_REBASE`, and `PRODUCT_CONFLICT` should be internal/reporting concepts unless deliberately surfaced in a compact way.

## First implementation

Start with reporting, not automatic merge resolution.

Minimum useful output:

- task class
- changed files per task
- shared files touched
- conflict classification
- whether the patch appears absorbable
- whether it touches core state / UX / migration / auth / permissions
- recommended integration order
- `Needs you` reasons for product-level decisions only

## Success metrics

Track:

- conflicted files
- conflict hunks
- `SAFE_PATCH` rate
- `PATCH_NEEDS_REBASE` rate
- `PRODUCT_CONFLICT` rate
- false-safe rate: classified safe but later judged unsafe
- number of actual human product decisions required

The first goal is not maximum automation. It is minimizing false `SAFE_PATCH` decisions while reducing the number of conflict hunks a human must read.
