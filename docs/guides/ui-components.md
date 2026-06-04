# UI Components Guide

This guide covers reusable UI component implementation in `apps/web`, especially controls, buttons, compact toolbars, and icon-only components. It is about component responsibility, accessibility, and layout stability, not broad visual styling.

## When To Read

Read this guide when:

- adding or modifying reusable UI components
- replacing raw buttons with shared controls
- working on compact toolbar buttons
- working on icon-only controls
- adding modal or action controls

## Button Component Boundary

- Standard action buttons should use `apps/web/src/components/ui/Button.tsx`.
- `Button` owns common native button behavior and visual variant hooks.
- Visual styling details remain in `docs/guides/ui-style.md`.
- Do not create local one-off button-like components unless there is a documented exception.
- If a new recurring control pattern appears, make or extend a shared component.

## Icon-Only Controls

- Icon-only controls must have accessible labels, such as `aria-label`, unless visible text is also present.
- Prefer a future shared `IconButton` or `Button variant="icon"` path instead of ad-hoc raw buttons.
- Keep fixed dimensions for compact icon controls.
- Avoid text glyphs such as `x`, `>`, or `...` when an inline SVG would be more stable.
- For icon-only controls such as disclosure, close, clear, expand/collapse, and directional buttons, use vector icons such as inline SVG instead of text glyphs.
- Reuse or rotate one vector when representing state changes so the visual size does not shift.

## Migration Notes

Some raw compact and icon buttons remain temporarily, including TaskList compact toolbar/task-card icons, Terminal reload, Codex refresh, and InputComposer attachment/send controls.

Future work should migrate them deliberately after deciding whether `Button variant="icon"` is sufficient or a dedicated `IconButton` component is needed.
