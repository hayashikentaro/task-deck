# TaskDeck Child Session Request Protocol

This document defines the MVP protocol for asking TaskDeck to launch child agent sessions from a parent session's terminal output.

The current foundation includes this protocol document, a pure parser/validator, and task metadata plumbing. Output-stream integration, auto-launch behavior, initial instruction sending, UI display, and worktree automation are follow-up implementation work.

## Purpose

A parent agent may request one or more child sessions by emitting a structured request block in its terminal output. Once the protocol is wired into TaskDeck output handling, TaskDeck should detect the block, validate it, and auto-launch valid child session requests without a confirmation modal.

This protocol intentionally allows only structured launch metadata. Parent agents must not provide raw commands, shells, environment variables, secrets, or approval bypass flags.

## Request Block

Wrap a single JSON object between these exact markers:

```text
TASKDECK_CHILD_SESSION_BATCH_REQUEST
{
  "version": 1,
  "reason": "Split independent documentation and UI work into isolated child sessions.",
  "sessions": [
    {
      "title": "Document child session protocol",
      "agentProfileId": "codex",
      "agentPermissionLevel": "full_access",
      "cwd": "/workspace/task-deck",
      "workPackageId": "issue-29-protocol-docs",
      "filesLikelyToChange": [
        "docs/taskdeck-child-session-protocol.md",
        "AGENTS.md"
      ],
      "initialInstruction": "You are working on hayashikentaro/task-deck. First read AGENTS.md. Before editing files, create or switch to an isolated branch/worktree for this work package. Stop and report if worktree/branch isolation is unsafe, unrelated changes exist, or the assigned file scope overlaps with another active child session. Then implement the protocol documentation foundation for issue #29."
    }
  ]
}
END_TASKDECK_CHILD_SESSION_BATCH_REQUEST
```

The content between the markers must be valid JSON. Markdown fences around the block are allowed in human-readable output, but the markers themselves are the protocol boundary.

## JSON Shape

Top-level object:

- `version`: protocol version. Use `1`.
- `reason`: short explanation of why child sessions are being requested.
- `sessions`: non-empty array of child session requests.

Each `sessions[]` item:

- `title`: user-facing task title for the child session.
- `agentProfileId`: configured TaskDeck agent profile id to use.
- `agentPermissionLevel`: permission level for the selected agent profile, when applicable. Accepted values are `full_access`, `workspace_write`, and `read_only`.
- `cwd`: intended working directory for the child session.
- `workPackageId`: stable id for this work package. Use it in branch/worktree names when useful.
- `filesLikelyToChange`: array of repo-relative paths or globs the child session is expected to touch.
- `initialInstruction`: complete instruction prompt for the child session.

## Forbidden Fields

Child session requests must not contain these fields at any depth:

- `command`
- `rawCommand`
- `shell`
- `env`
- `secrets`
- `autoApprove`

TaskDeck must reject any request containing forbidden fields. Parent agents are not allowed to provide raw launch commands. TaskDeck chooses the launch command from trusted local agent profile configuration.

## TaskDeck Behavior

For the MVP, TaskDeck should:

- detect request blocks in parent session output;
- parse the JSON between the markers;
- validate protocol version, required fields, field types, permission values, and forbidden fields;
- validate requested profiles, cwd, file scope, and code-editing policy against local policy when that policy layer is implemented;
- auto-launch valid requests without a confirmation modal;
- reject invalid requests and surface a concise error to the parent session/user;
- never execute raw launch commands supplied by a parent agent.

Worktree creation is not performed by TaskDeck in this MVP. Branch/worktree isolation is handled by the child session's `initialInstruction` and by the child agent following repository rules.

## Child Task Metadata

When TaskDeck launches a child session from a valid request, the resulting task should carry metadata that links it back to the parent request:

- `parentSessionId`: the parent task/session id that emitted the request.
- `spawnedFromParentRequest`: `true` for tasks created from this protocol.
- `workPackageId`: copied from the child session request when provided.
- `filesLikelyToChange`: copied from the child session request when provided.

These fields are task metadata. Parent agents request `workPackageId` and `filesLikelyToChange`, but they do not supply `parentSessionId` or `spawnedFromParentRequest` directly.

## Required Isolation Preflight

Every code-editing child session must include an isolation preflight in `initialInstruction`.

The child session must:

- read `AGENTS.md` before editing;
- avoid editing files in the shared working tree;
- create or switch to a dedicated branch/worktree before code changes;
- stop and report if the branch/worktree cannot be created safely;
- stop and report if unrelated uncommitted changes exist;
- stop and report if the assigned file scope overlaps with another active child session;
- keep changes inside the assigned work package scope.

Documentation-only child sessions should still isolate their work unless the parent instruction explicitly says the shared tree is safe for that specific task.

## MVP Parser Validation

The initial pure parser/validator rejects a request block when:

- markers are malformed, nested, unterminated, or appear in an unexpected order;
- JSON is invalid;
- `version` is unsupported;
- `reason` is present but not a string;
- `sessions` is missing, not an array, or empty;
- a session item is not an object;
- required session fields are missing or empty;
- `agentPermissionLevel` is present but not one of `full_access`, `workspace_write`, or `read_only`;
- `workPackageId` is present but not a string;
- `filesLikelyToChange` is present but not an array of strings;
- any forbidden field appears;

The parser is intentionally pure. It does not auto-launch sessions, inspect repository state, manage worktrees, infer whether work is code-editing, or search `initialInstruction` text for isolation-preflight wording.

## Protocol And Local-Policy Validation

Beyond parser-level structural validation, TaskDeck and parent agents should treat these as protocol or local-policy requirements:

- `filesLikelyToChange` should be present for code-editing work.
- `initialInstruction` should include the required isolation preflight for code-editing work.
- `cwd`, profile, permission, and file scope should pass local policy before launch.
- Child sessions must stop and report when branch/worktree isolation is unsafe.
- Child sessions must stop and report when unrelated uncommitted changes exist.
- Child sessions must stop and report when assigned file scope conflicts with another active child session.

These policy checks may be enforced by future TaskDeck validation, local configuration, or child-session instructions. Do not describe them as implemented parser behavior until that enforcement exists.

## Security Boundary

This protocol is a request format, not an authority boundary by itself. Trust decisions come from TaskDeck configuration, validation, local policy, and the selected agent profile.

Parent agents may propose child work, but they may not smuggle execution details through raw commands, environment variables, secrets, or auto-approval flags.
