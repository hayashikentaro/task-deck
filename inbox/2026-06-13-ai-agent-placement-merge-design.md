# AI agent placement design: trunk feature + patch absorption

Status: open
Created: 2026-06-13

## Context

Different products have high human context-switching cost, but running multiple issues in the same product is often useful. The realistic pattern is not to run several large features in parallel. It is to run one larger feature as the main axis while allowing small, independent fixes or instrumentation tasks to proceed around it.

This suggests that TaskDeck should treat merge support as part of AI-agent placement design, not only as a Git conflict utility.

## Core idea

Use a **main feature branch + surrounding patch absorption** model.

- One `major_feature` task is the main branch of work.
- Smaller tasks run in parallel only when they are likely to be absorbable patches.
- The merge/integration agent does not treat all branches equally.
- It rebases or ports the intent of minor patches onto the major feature branch.
- It escalates only when a patch changes product meaning, UX policy, state concepts, persistence, auth, or other core behavior.

## Why this matters

AI can generate many changes quickly, but the bottleneck shifts to integration. The goal is not full autonomous merge. The goal is to reduce human attention to the conflicts that truly require product judgment.

TaskDeck's supervision model maps well to this:

- `Not now`: safe patch absorbed, or merge task continues.
- `Needs you`: product judgment is required.

## Proposed issue/task classes

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

Usually single-lane / not parallel-friendly:

- `major_feature`
- `migration`
- `core_state_change`
- `ux_decision`
- auth / permissions / billing / personal data
- user-facing classification changes

## Merge/integration classifications

The integration agent should classify patch-feature conflicts as:

### SAFE_PATCH

The small task's intent can be preserved and applied to the main feature branch without changing product meaning.

Examples:

- independent import additions
- additional test cases
- docs/comments
- spacing or copy fix that still applies
- development-only observability/needle additions

### PATCH_OBSOLETED

The main feature already solved the patch's intent, or changed the code so the patch is no longer needed.

The agent may propose dropping the patch, but should report why.

### PATCH_NEEDS_REBASE

The patch is still valid, but its application point changed due to the feature branch.

The agent should port the intent rather than mechanically choosing either side.

### PRODUCT_CONFLICT

The patch is not merely a patch anymore. It changes or conflicts with product meaning.

Escalate to `Needs you`.

Examples:

- duplicate state concepts with different names
- UI placement / workflow decisions
- changes to `Needs you` / `Not now` semantics
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

## Product principle for TaskDeck

Do not let merge support introduce extra user-facing complexity.

TaskDeck should keep the UI supervision model coarse:

- `Needs you`
- `Not now`

Detailed classifications such as `SAFE_PATCH`, `PATCH_NEEDS_REBASE`, or `PRODUCT_CONFLICT` are internal/integration-report concepts unless deliberately surfaced in a compact way.

## Suggested first implementation

Do not start with automatic merge resolution. Start with a merge-risk/reporting mode.

Minimum useful output:

- task class: `major_feature`, `minor_fix`, `test_only`, etc.
- changed files per task
- shared files touched
- conflict classification
- whether the patch appears absorbable
- whether the change touches core state / UX / migration / auth / permissions
- recommended integration order
- `Needs you` reasons only for product-level decisions

## Success metric

Measure whether this reduces human merge attention.

Track:

- number of conflicted files
- number of conflict hunks
- `SAFE_PATCH` rate
- `PATCH_NEEDS_REBASE` rate
- `PRODUCT_CONFLICT` rate
- false-safe rate: cases classified as safe but later judged unsafe
- number of actual human product decisions required

The most important early goal is not maximum automation. It is minimizing false `SAFE_PATCH` decisions.
