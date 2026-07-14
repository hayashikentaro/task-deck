# Phone Web Client Boundary

This package owns the phone TaskDeck client.

For phone-only work, do not inspect or edit `apps/web-desktop` unless the user explicitly asks for cross-surface behavior. The phone UI should be designed around vertical operation and its own views, not as a responsive variant of the desktop layout.

The phone client has three primary surfaces:

- `Terminal`: selected task output, App Server request controls, stop, and composer.
- `Tasks`: task card list and task switching.
- `New Session`: sheet or popover for creating a Codex App Server session.

Shared TaskDeck API, WebSocket, selector, output replay, and composer logic belongs in `packages/web-shared` when it is genuinely needed by both clients. Do not import desktop components, desktop styles, or desktop view state from this package.

The phone client is served at `/phone`.
