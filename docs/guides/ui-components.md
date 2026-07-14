# UI Components Guide

This guide covers reusable UI component implementation for TaskDeck web clients, especially controls, buttons, compact toolbars, and icon-only components. It is about component responsibility, accessibility, and layout stability, not broad visual styling.

## When To Read

Read this guide when:

- adding or modifying reusable UI components
- replacing raw buttons with shared controls
- working on compact toolbar buttons
- working on icon-only controls
- adding modal or action controls

## Button Component Boundary

- Standard desktop action buttons should use `apps/web-desktop/src/components/ui/Button.tsx`.
- `Button` owns common native button behavior and visual variant hooks.
- Visual styling details remain in `docs/guides/ui-style.md`.
- Do not create local one-off button-like components unless there is a documented exception.
- If a new recurring control pattern appears, make or extend a shared component.

## Icon-Only Controls

- Icon-only controls must have accessible labels, such as `aria-label`, unless visible text is also present.
- `apps/web-desktop/src/components/ui/IconButton.tsx` is the preferred direction for reusable desktop icon-only buttons where the control has no visible text label.
- `IconButton` requires `label`, which becomes the native button's `aria-label`, and accepts inline SVG as children.
- Use its existing `variant: "panel" | "secondary" | "danger" | "ghost"` and `size: "sm" | "md"` API.
- Prefer `IconButton` over raw `<button>` for new recurring compact controls unless there is a documented exception.
- If a control has visible text, use `Button`, not `IconButton`.
- Keep fixed dimensions for compact icon controls.
- Avoid text glyphs such as `×`, `▸`, or `…` when an inline SVG would be more stable.
- For icon-only controls such as disclosure, close, clear, expand/collapse, and directional buttons, use vector icons such as inline SVG instead of text glyphs.
- Reuse or rotate one vector when representing state changes so the visual size does not shift.
- If a new recurring icon-only pattern appears, consider using `IconButton` or extending shared control APIs instead of adding another local raw button pattern.

## Migration Notes

Some raw compact and icon buttons remain intentionally for now, especially TaskList compact toolbar/task-card controls and InputComposer attachment/send controls. They have compact layout and local behavior constraints.

Do not opportunistically migrate those controls during unrelated UI work. Migrate them only in a dedicated task after confirming that `IconButton` fits their layout and behavior, or after deciding that the shared control API should be extended.

## SelectField

- Use `apps/web-desktop/src/components/ui/SelectField.tsx` for labeled native select controls in the desktop client.
- `SelectField` wraps a native `<select>` by design; it is not a custom dropdown.
- `SelectField` owns label, hint, error, `aria-describedby`, and `aria-invalid` wiring.
- Visual tuning of native selects is allowed within the shared component/style boundary.
- Use native `<option>` and `<optgroup>` children.
- If a future custom dropdown is needed, treat it as a separate product/design decision tracked in GitHub Issues instead of an ad-hoc local replacement.
