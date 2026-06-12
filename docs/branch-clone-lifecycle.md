# Branch Clone Lifecycle

TaskDeck AI-assisted branch work uses disposable full clones instead of `git worktree`.

The goal is to make local state replaceable. Remote GitHub branches are the durable source of truth; local clones, `node_modules`, `.taskdeck/`, local caches, and local config files are runtime state.

## Source of truth

- Remote GitHub branches are the only durable source of truth.
- A branch task is not complete until its intended changes are committed and pushed to `origin`.
- Completion reports must include the branch name, latest commit SHA, pushed remote branch, verification results, changed files, and any unrelated local changes.
- If local state is broken, ambiguous, copied across environments, or points to unavailable paths such as `/workspace`, discard it and reclone from the remote branch.

## Local layout

Use one stable clone and disposable feature clones:

```text
~/Documents/task-deck                    stable/main clone
~/Documents/task-deck-branches/<slug>    disposable feature clone
```

For the current manager-write verification branch, the fixed local layout is:

```text
branch: feature/manager-write-path
clone path: /Users/hayashikentarou/Documents/task-deck-manager-write
port: 3001
```

## Start from an existing remote branch

```bash
BRANCH=feature/manager-write-path
NAME=manager-write-path
PORT=3001

cd ~/Documents
mkdir -p task-deck-branches
cd task-deck-branches

git clone -b "$BRANCH" git@github.com:hayashikentaro/task-deck.git "$NAME"
cd "$NAME"

cat > taskdeck.local.json <<JSON
{
  "projectRoot": "/Users/hayashikentarou/Documents"
}
JSON

cat > .taskdeck-branch.json <<JSON
{
  "branch": "$BRANCH",
  "cloneName": "$NAME",
  "port": $PORT,
  "purpose": "feature branch verification"
}
JSON

npm_config_cache="$PWD/.npm-cache" npm ci
HOST=0.0.0.0 PORT=$PORT npm run dev
```

## Start a new branch

```bash
BRANCH=feature/some-feature
NAME=some-feature
PORT=3002

cd ~/Documents/task-deck
git checkout main
git pull --ff-only origin main

cd ~/Documents
mkdir -p task-deck-branches
cd task-deck-branches

git clone git@github.com:hayashikentaro/task-deck.git "$NAME"
cd "$NAME"

git checkout -b "$BRANCH"
git push -u origin "$BRANCH"

cat > taskdeck.local.json <<JSON
{
  "projectRoot": "/Users/hayashikentarou/Documents"
}
JSON

cat > .taskdeck-branch.json <<JSON
{
  "branch": "$BRANCH",
  "cloneName": "$NAME",
  "port": $PORT,
  "purpose": "feature branch work"
}
JSON

npm_config_cache="$PWD/.npm-cache" npm ci
HOST=0.0.0.0 PORT=$PORT npm run dev
```

## Work rules inside a feature clone

- Keep one branch, one purpose, and one port per feature clone.
- Do not use `git worktree`.
- Do not depend on another clone's `.git` metadata, `node_modules`, `.taskdeck/`, or local config.
- Keep `taskdeck.local.json` local and ignored.
- Keep `.taskdeck-branch.json` local and ignored.
- Use `npm_config_cache="$PWD/.npm-cache" npm ci` to avoid global npm cache permission problems.
- Push intended changes before asking another session to continue the work.

## Status check before handoff

```bash
git status --short --branch
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
working tree: clean
unrelated local changes: none
```

## Cleanup after merge

Before deleting a feature clone:

```bash
cd ~/Documents/task-deck-branches/<slug>

git status --short --branch
git fetch origin
git log --oneline --decorate -5
git rev-list --left-right --count @{u}...HEAD
```

Delete only when:

```text
[ ] working tree is clean or intentionally abandoned
[ ] useful changes are pushed
[ ] merge status is known
[ ] no local-only config needs to be preserved
[ ] `.taskdeck/` runtime data is no longer needed
```

Then remove the local clone:

```bash
cd ~/Documents/task-deck-branches
rm -rf <slug>
```

If the remote branch is merged and no longer needed:

```bash
git push origin --delete feature/example
```

## Recovery rule

When in doubt, do not repair the local clone. Preserve it if needed, then reclone from the remote branch:

```bash
cd ~/Documents
mv task-deck-branches/<slug> task-deck-branches/<slug>.broken-$(date +%Y%m%d%H%M%S)
git clone -b <branch> git@github.com:hayashikentaro/task-deck.git task-deck-branches/<slug>
```
