# Shared Web Client Boundary

This package owns code that can be used by both TaskDeck web clients.

Keep this package UI-surface neutral. It may contain shared types, API helpers, WebSocket helpers, selectors, output replay helpers, and composer rules. It must not import from `apps/web-desktop` or `apps/web-phone`.

Do not place desktop-specific layout, phone-specific layout, CSS surface policy, or route/view state here. If behavior is only needed by one client, keep it in that client package.
