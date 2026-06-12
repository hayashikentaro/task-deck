# TaskDeck Agent Operating Principles

This document records durable TaskDeck-specific principles for AI agents working in this repository.

GitHub Issues remain the source of truth for actionable work, open/closed state, detailed acceptance criteria, and backlog. Repository docs are for durable product context, architecture, setup, protocols, and design decisions. Do not turn repository docs into a parallel issue tracker.

## Product Boundary

TaskDeck is a multi-agent supervision UI. It is not a generic terminal wrapper, a chatbot UI, or merely a prettier terminal.

Keep the interface task-centric and centered on state, risk, diffs, review, and supervision. PTY interaction is an implementation mechanism for supervising work, not the product identity.

## Supervision Model

Keep supervision buckets simple:

```text
Needs you
Not now
```

Avoid over-classifying agent or attention states. Prefer a small number of operator-facing states backed by clear evidence over a large taxonomy inferred from fragile terminal text.

`attentionState` is the primary supervision signal for whether the operator should look at a task. It may drive sorting, badges, acknowledgement controls, compact state markers, and action prompts. It should not force full-card urgency coloring that competes with stable task/session identity.

## Boundaries Over Behavioral Rules

Prefer structural boundaries over relying on long behavioral instructions.

Examples:

- Workers write append-only status/result/request files instead of mutating canonical TaskDeck state.
- Manager write operations go through `taskdeckctl`.
- TaskDeck server validates, dedupes, logs, executes mutations, and coordinates PTY/session effects.
- Generated runtime action guides expose only actions supported by the running server and CLI.

## Runtime Capabilities

Do not treat future design notes as implemented behavior.

Static docs may describe direction, rationale, and constraints. The running app's generated manager-readable files are the source of truth for available manager actions in that runtime.

Manager actions must go through `taskdeckctl`. Do not add raw manager Web API paths, raw terminal-write paths, direct worker-to-worker command paths, or direct state mutation paths unless the actor protocol is explicitly changed in the same work.

## Generated Files

Runtime-generated files are not hand-edited and must not be committed.

Common runtime/generated paths include:

```text
.taskdeck/
.taskdeck/manager-readable/
.taskdeck/manager-inbox/
apps/web/dist/
node_modules/
```

If a generated file needs to change, update the code that generates it and verify the generated output locally.
