# Roadmap Context

This document records medium-term TaskDeck product direction and cross-issue design rationale.

GitHub Issues remain the source of truth for actionable work and completion state. This document is not a backlog.

## Product direction

TaskDeck is a supervision UI for multiple AI/CLI sessions.

It is not a chatbot UI, a provider-specific Codex UI, or merely a prettier terminal. The medium-term direction is to make TaskDeck easier for other people to use while preserving the core supervision model.

## Medium-term themes

### Desktop app packaging

Package TaskDeck as an Electron desktop app so users can open TaskDeck, choose a workspace, and supervise agent sessions without manually starting server/web processes.

Related issue:

- #55 — Package TaskDeck as an Electron desktop app.

### Multi-agent/provider support

Add Claude support so TaskDeck is not Codex-only.

The design should avoid provider TUI parsing. Provider adapters should reuse generic supervision where possible and add only bounded, robust provider-specific behavior.

Related issue:

- #56 — Add Claude agent adapter support.

### External configuration instead of settings editor UI

Do not build a large settings editor UI while TaskDeck's configuration model is still evolving.

Use external config files, schema validation, examples, and AI-editable guide docs. The app may show diagnostics, loaded config status, and validation errors, but should not become the primary config mutation UI yet.

Related issues:

- #57 — Introduce external TaskDeck config file with schema validation.
- #58 — Add AI-editable TaskDeck config guide docs.
- #59 — Show loaded config and validation diagnostics without adding a settings editor.

## Design stance

- Keep machine control data out of human display planes.
- Prefer file, environment, and request-file protocols for bounded machine-readable coordination.
- Keep child-to-parent reporting constrained.
- Avoid free-form child-to-parent chat.
- Avoid building UI around unstable configuration concepts.
- Prefer diagnostics over settings mutation UI.
- Keep TaskDeck provider-neutral.

## Non-goals for this phase

- Public HTTP API.
- General workflow queue.
- Full settings editor.
- Provider-specific transcript parsers.
- Chatbot-style UX.
- Free-form child-to-parent messaging.
