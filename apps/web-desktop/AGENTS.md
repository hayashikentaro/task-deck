# Desktop Web Client Boundary

This package owns the desktop TaskDeck client.

For desktop-only work, do not inspect or edit `apps/web-phone` unless the user explicitly asks for cross-surface behavior. Keep desktop layout, desktop CSS, and desktop component changes local to this package.

Shared TaskDeck API, WebSocket, selector, output replay, and composer logic may be extracted to `packages/web-shared` when both clients need it. Do not import phone components, phone styles, or phone view state from this package.

The desktop client is served at `/`.
