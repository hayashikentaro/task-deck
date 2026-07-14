# TaskDeck Agent Operating Principles

This document records durable TaskDeck-specific principles for AI agents working in this repository.

GitHub Issues remain the source of truth for actionable work, open/closed state, detailed acceptance criteria, and backlog. Repository docs are for durable product context, architecture, setup, protocols, and design decisions. Do not turn repository docs into a parallel issue tracker.

## Product Boundary

TaskDeck is a multi-agent supervision UI. It is not a generic terminal wrapper, a chatbot UI, or merely a prettier terminal.

Keep the interface task-centric and centered on state, risk, diffs, review, and supervision. Codex App Server events are the control signal on the App Server-first route.

TaskDeck remains a same-machine local application even when its web client is opened from a phone or another device through the host machine's LAN IP. Treat that phone/mobile client as another local UI surface over the existing TaskDeck API and WebSocket, not as a new remote-control protocol, cloud relay, or Decision Gateway substitute.

For phone/mobile UI work, prefer structural separation from the desktop surface. Shared code should cover TaskDeck state, API access, WebSocket handling, selectors, output replay, composer rules, and reusable low-level controls. Desktop-specific layout components and phone-specific layout components should not import from each other.

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

- Workers use supported App Server/session surfaces or append-only status/result/artifact files instead of mutating canonical TaskDeck state.
- Manager write operations go through `taskdeckctl`.
- TaskDeck server validates, dedupes, logs, executes mutations, and coordinates App Server session effects.
- Generated runtime action guides expose only actions supported by the running server and CLI.

## Runtime Capabilities

Do not treat future design notes as implemented behavior.

Static docs may describe direction, rationale, and constraints. The running app's generated manager-readable files are the source of truth for available manager actions in that runtime.

Do not add raw manager Web API paths, raw terminal-write paths, direct worker-to-worker command paths, or direct state mutation paths unless an explicit protocol redesign is approved in the same work.

## Generated Files

Runtime-generated files are not hand-edited and must not be committed.

Common runtime/generated paths include:

```text
.taskdeck/
.taskdeck/manager-readable/
.taskdeck/manager-inbox/
apps/web-desktop/dist/
apps/web-phone/dist/
node_modules/
```

If a generated file needs to change, update the code that generates it and verify the generated output locally.
