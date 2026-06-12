# Current Work Plan

This document records the current short-term work order for AI-assisted TaskDeck development.

GitHub Issues remain the source of truth for actionable work, open/closed state, detailed acceptance criteria, and task completion state. This document only records current sequencing rationale.

## Current priority order

1. #53 — Suppress Codex startup update check UI.
2. #52 — Add file-based parent-to-child message request transport.
3. #55 — Package TaskDeck as an Electron desktop app.
4. #56 — Add Claude agent adapter support.
5. #57 — Introduce external TaskDeck config file with schema validation.
6. #58 — Add AI-editable TaskDeck config guide docs.
7. #59 — Show loaded config and validation diagnostics without adding a settings editor.

## Why this order

- #53 is small and reduces Codex startup TUI noise before manual QA.
- #52 removes the remaining stdout-marker parent-to-child control path.
- #55 and #56 should come after #52 so Electron and Claude support do not freeze deprecated stdout-control assumptions into new surfaces.
- #57, #58, and #59 can follow once the agent/control surface is more stable.

## Current constraints

- Do not use Codex TUI or terminal transcript output as machine control data.
- Do not add a settings editor UI yet.
- Do not redesign child session creation while implementing #52.
- Do not change child status file reporting as part of #52.
- Prefer file-based request transport for parent-to-TaskDeck control paths.

## Update policy

Update this file only when the short-term execution order or sequencing rationale changes.

Do not copy full issue bodies here.
Do not track completion state here beyond the current priority order.
