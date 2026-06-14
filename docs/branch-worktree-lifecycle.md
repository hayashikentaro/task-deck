# Branch Worktree Lifecycle

TaskDeck branch work uses `git worktree`.

Use the main repository as the base development checkout. Create one worktree per branch and purpose for parallel development.

Do not create disposable full clones for TaskDeck branch work. Do not choose between clone and worktree.

Remote GitHub branches are the durable source of truth. A branch task is complete only after intended changes are committed and pushed.

Execution and runtime environment setup is outside this policy.

## Source of truth

- Remote GitHub branches are the durable source of truth.
- A branch task is not complete until its intended changes are committed and pushed to `origin`.
- Completion reports must include the branch name, latest commit SHA, pushed remote branch, verification results, changed files, and any unrelated local changes.

## Start from an existing remote branch

```bash
BRANCH=feature/example
NAME=example

cd <main-repository>
git fetch origin
git worktree add ../task-deck-worktrees/"$NAME" "origin/$BRANCH"
cd ../task-deck-worktrees/"$NAME"
git switch "$BRANCH"
```

## Start a new branch

```bash
BRANCH=feature/example
NAME=example

cd <main-repository>
git fetch origin
git switch main
git pull --ff-only origin main
git worktree add -b "$BRANCH" ../task-deck-worktrees/"$NAME" main
cd ../task-deck-worktrees/"$NAME"
git push -u origin "$BRANCH"
```

## Work rules inside a branch worktree

- Keep one worktree, one branch, and one purpose.
- Continue on the current branch or worktree unless explicitly instructed otherwise.
- Before editing, confirm the current repository, remote, branch, and working tree state.
- Preserve unrelated local changes.
- Push intended changes before asking another session to continue the work.

## Status check before handoff

```bash
pwd
git remote -v
git status --short --branch
git branch --show-current
git log --oneline -5
git rev-parse --abbrev-ref --symbolic-full-name @{u}
git rev-list --left-right --count @{u}...HEAD
```

Expected handoff report:

```text
branch: feature/example
remote: origin/feature/example
latest commit: <sha> <message>
verification: <commands and results>
changed files: <files changed>
unrelated local changes: <none or list>
```

## Cleanup after merge

Before removing a branch worktree:

```bash
cd <branch-worktree>

git status --short --branch
git fetch origin
git log --oneline --decorate -5
git rev-list --left-right --count @{u}...HEAD
```

Remove the worktree only when:

```text
[ ] intended changes are committed and pushed
[ ] merge status is known
[ ] working tree state has been reviewed
```

Then remove the local worktree from the main repository:

```bash
cd <main-repository>
git worktree remove ../task-deck-worktrees/example
git worktree prune
```

If the remote branch is merged and no longer needed:

```bash
git push origin --delete feature/example
```
