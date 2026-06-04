# UI Style Guide

This guide records current operational rules for `apps/web` UI styling, CSS ownership, and visual variants. Read it before changing shared UI styles or Button visual behavior.

Reusable component responsibility and icon-only controls are covered in `docs/guides/ui-components.md`.

## Button Usage

- New interactive buttons in `apps/web` should use `apps/web/src/components/ui/Button.tsx`; component boundaries and raw-button exceptions are covered in `docs/guides/ui-components.md`.
- Control Button appearance through the existing API:
  - `variant: "panel" | "secondary" | "danger" | "icon"`
  - `size: "sm" | "md"`
  - `fullWidth`
- If a new visual button style is needed, add or revise a `Button` variant instead of styling a local raw button.
- Do not add ad-hoc button colors through parent color inheritance or local selectors.
- Keep disabled button styling centralized in the `.td-button` styles.
- Keep global `button` CSS at reset level only. It must not define application colors, borders, backgrounds, hover, focus, or disabled visuals.
