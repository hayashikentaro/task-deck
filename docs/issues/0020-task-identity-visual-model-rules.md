# Task identity visual model rules

## Status

Design rule document for #20.

## Context

TaskDeck now uses session identity as a primary visual cue. The goal is to make it easy to match a task card to the correct terminal/session.

The visual implementation has become harder to tune because too many low-level values can independently change color strength, depth, and contrast. This document defines the intended rules before further refactoring.

## Safety boundary

These rules are intentionally limited to color generation and presentation.

Safe to change under this model:

- saturation and lightness calculations
- fixed gradient alpha ratios
- removal of large-surface hue offsets
- card / terminal / border / glow derivation relationships
- CSS variable values generated from `taskIdentity.ts`

Do not change as part of this visual model refactor:

- task id to identity slot assignment semantics
- task sorting
- `attentionState` or supervision semantics
- PTY behavior
- persistence
- API shape
- task metadata shape
- component layout

## Rule 1: hue is identity only

Hue identifies the task/session.

Large visual surfaces should use the same identity hue family:

- card background
- card soft/faint gradient stops
- card border / band / glow
- selected-card identity treatment
- terminal background tint / gradient

Avoid hue offsets such as `hue + 24`, `hue - 18`, or `hue + 180` on large surfaces.

Small identity tokens may use hue offsets if they remain useful, because their job is compact recognition rather than large-surface tone.

## Rule 2: alpha is gradient structure, not color tuning

Alpha should not be used as a general color-strength knob.

Alpha should define fixed gradient stop ratios only:

```text
alpha = baseAlpha * fixedGradientRatio
```

For example:

```text
max   = baseAlpha
soft  = baseAlpha * softRatio
faint = baseAlpha * faintRatio
```

Avoid using alpha for:

- hue-dependent brightness compensation
- making one hue stronger or weaker
- independently tuning card versus terminal identity strength
- compensating red / purple / green perceived weight

Those jobs belong to saturation, lightness, and tone profiles.

## Rule 3: saturation controls identity strength

Saturation is the main control for how much the identity color is felt.

Use saturation to answer questions like:

- should the card feel calmer?
- should the identity be more visible?
- should terminal tint feel closer to the card?

Prefer ratio derivation over independent constants:

```text
card saturation = base
terminal saturation = card saturation * terminalRatio
border saturation = card saturation * borderRatio
glow saturation = card saturation * glowRatio
```

## Rule 4: lightness controls surface depth

Lightness controls how much the surface sinks into or lifts away from the dark UI.

Use lightness to answer questions like:

- is this hue too dark?
- does this card feel too heavy?
- does the terminal tint disappear into the base terminal color?

Do not fix perceived darkness by changing alpha first. Prefer lightness and saturation.

## Rule 5: card is the source of truth; terminal is derived

The card surface is the primary identity surface.

Terminal identity should be derived from the card tone as a quieter profile, not tuned as a separate unrelated color system.

Conceptually:

```text
card tone
  -> card surface
  -> card soft/faint gradient
  -> terminal tone = card tone * terminal profile
       -> terminal max/soft/faint gradient
```

This keeps card and terminal identity aligned while allowing the terminal to remain more subdued for text readability.

## Rule 6: border, band, glow, and selected treatment derive from the surface

Border, band, glow, and selected-card treatment should not become independent color families.

They should read as the same identity hue expressed with different surface roles:

- border = surface outline
- band = stronger surface accent
- glow = surface influence outside the card
- selected = identity-colored selection emphasis

Prefer saturation/lightness deltas or ratios from the base surface tone.

## Rule 7: hue compensation is one function and never changes alpha

Hue-dependent perceived-weight correction should be centralized in one function.

The function may adjust:

- saturation
- lightness

The function should not adjust:

- alpha
- hue slot assignment
- task ordering
- state styling

Conceptually:

```text
compensateToneForHue(hue, tone) -> adjusted saturation/lightness
```

No other part of the system should special-case hue behavior.

## Desired implementation shape

The exact API is not fixed, but future code should move toward this shape:

```ts
const TASK_IDENTITY_VISUAL_MODEL = {
  card: {
    saturation: 32,
    lightness: 18,
  },
  terminal: {
    saturationRatio: 0.75,
    lightnessRatio: 0.75,
  },
  gradient: {
    baseAlpha: 0.48,
    softRatio: 0.55,
    faintRatio: 0.22,
  },
  hueBalance: {
    strength: 0.12,
  },
};
```

The exact numbers can change. The important part is that visual tuning happens through a few meaningful knobs rather than many unrelated constants.

## Acceptance direction for #20

A successful refactor should make these statements true:

- task identity colors remain stable by task id
- large surfaces use one coherent hue family
- alpha is base plus fixed gradient ratios
- hue compensation changes only saturation/lightness
- terminal tone is derived from card tone
- border/band/glow/selected treatment derive from the identity surface
- CSS mostly consumes variables; color decisions live in `taskIdentity.ts`
