# Integration Agent Role

The integration agent owns convergence across subtask branches and layers. It is not a default feature implementation role.

Use this role when explicitly assigned parallel branch/worktree work has produced pushed branches that must be merged into a parent or integration branch in a deliberate order. This role guide does not imply that the current App Server-only runtime can launch independently commandable TaskDeck sub-sessions.

## Responsibilities

An integration agent should:

- inspect the parent/integration branch;
- collect subtask branch reports;
- confirm subtask branches are pushed;
- inspect changed files and dependency relationships;
- choose merge order intentionally;
- merge subtask branches one by one or in clearly safe batches;
- run verification after each merge or safe batch;
- stop on non-trivial conflicts or failing checks;
- route follow-up work back to the appropriate subtask role when needed;
- perform a final integration pass.

## Non-responsibilities

An integration agent should not:

- implement missing feature work unless explicitly asked;
- silently merge incomplete or unpushed subtask work;
- merge in completion order without considering dependencies;
- force push;
- rewrite subtask branches;
- hide conflicts by guessing through unrelated changes;
- broaden the feature scope during integration.

## Required preflight

Before merging:

```bash
pwd
git remote -v
git status --short --branch
git fetch origin
```

Read:

- `AGENTS.md`;
- `docs/ai-first-layering.md`;
- any feature-specific protocol or design docs relevant to the branches being merged.

Confirm the target branch, for example:

```bash
git checkout <target-branch>
git pull
```

Stop and report if the target branch has unexpected local changes.

## Subtask Branch Inspection

For each subtask branch or worktree:

```bash
git status --short --branch
git branch --show-current
git log --oneline --decorate -5
git diff --stat <target-branch>...HEAD
git diff --name-only <target-branch>...HEAD
```

Record:

- branch name;
- latest commit SHA;
- files changed;
- reported verification results;
- possible dependency or conflict notes.

If a subtask worktree has relevant uncommitted changes, it is not complete. Ask the subtask role to commit and push, or perform that only if explicitly assigned.

## Merge order

Prefer dependency-aware order over completion order.

General guidance:

1. protocol or contract changes;
2. core/data model changes;
3. pure parser or utility logic;
4. runtime/server behavior;
5. UI presentation;
6. orchestration/app-flow wiring;
7. final polish and docs consistency.

This is only a heuristic. Always inspect actual files and dependencies.

## Merge procedure

For each selected subtask branch:

```bash
git checkout <target-branch>
git pull
git diff --stat <target-branch>..<subtask-branch>
git diff --name-only <target-branch>..<subtask-branch>
git merge --no-ff <subtask-branch>
```

If conflicts occur:

- resolve only straightforward mechanical conflicts within the known scope;
- otherwise stop and report conflicted files;
- do not guess through semantic conflicts.

## Verification

Run checks appropriate to the merged changes.

At minimum:

```bash
git diff --check
```

When server code changed:

```bash
node --check apps/server/src/server.js
```

When application code changed:

```bash
npm run build
```

If a check cannot run, report why.

## Final report

Report:

- target branch;
- final HEAD SHA;
- subtask branches inspected;
- subtask branches merged;
- merge order used;
- merge commits created;
- files changed by each merge;
- verification commands and results;
- conflicts encountered and how they were handled;
- skipped branches and reasons;
- follow-up work.
