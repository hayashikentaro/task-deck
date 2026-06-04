# UI Style Guide

This guide records current operational rules for `apps/web` UI styling and reusable UI components. Read it before changing shared UI components, buttons, or related styles.

## Button Usage

- New interactive buttons in `apps/web` should use `apps/web/src/components/ui/Button.tsx`.
- Raw `<button>` usage is limited to the `Button` implementation, clearly documented exceptions, and temporary migration cases.
- Use `Button` for standard action buttons. Some compact icon and special-layout controls remain raw buttons during migration; future replacements should prefer `Button` unless an exception is documented.
- Control Button appearance through the existing API:
  - `variant: "panel" | "secondary" | "danger" | "icon"`
  - `size: "sm" | "md"`
  - `fullWidth`
- If a new visual button style is needed, add or revise a `Button` variant instead of styling a local raw button.
- Do not add ad-hoc button colors through parent color inheritance or local selectors.
- Keep disabled button styling centralized in the `.td-button` styles.
- Keep global `button` CSS at reset level only. It must not define application colors, borders, backgrounds, hover, focus, or disabled visuals.

For icon-only controls such as disclosure, close, clear, expand/collapse, and directional buttons, use vector icons such as inline SVG instead of text glyphs. Keep dimensions fixed and rotate or reuse one vector for state changes so the visual size does not shift.
