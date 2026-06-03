import type { CSSProperties } from "react";

const TASK_IDENTITY_SLOTS = [
  { hue: 14, anchorSaturation: 62, anchorLightness: 58 },
  { hue: 42, anchorSaturation: 56, anchorLightness: 58 },
  { hue: 74, anchorSaturation: 48, anchorLightness: 54 },
  { hue: 110, anchorSaturation: 44, anchorLightness: 52 },
  { hue: 144, anchorSaturation: 44, anchorLightness: 54 },
  { hue: 176, anchorSaturation: 46, anchorLightness: 52 },
  { hue: 206, anchorSaturation: 54, anchorLightness: 56 },
  { hue: 238, anchorSaturation: 54, anchorLightness: 58 },
  { hue: 272, anchorSaturation: 52, anchorLightness: 58 },
  { hue: 302, anchorSaturation: 56, anchorLightness: 58 },
  { hue: 332, anchorSaturation: 60, anchorLightness: 58 },
  { hue: 358, anchorSaturation: 60, anchorLightness: 56 },
] as const;

const TASK_IDENTITY_SWATCH_SATURATION = 52;
const TASK_IDENTITY_SWATCH_LIGHTNESS = 57;
const TASK_CARD_WASH_SATURATION = 32;
const TASK_CARD_WASH_LIGHTNESS = 18;
const TASK_CARD_WASH_ALPHA = 0.48;
const TASK_CARD_WASH_SOFT_ALPHA = 0.26;
const TASK_CARD_HK_REFERENCE = 2 / Math.PI;
const TASK_CARD_HK_STRENGTH = 0.16;
const TASK_CARD_HK_ALPHA_RESPONSE = 0.9;
const TASK_CARD_HK_LIGHTNESS_RESPONSE = 5;
const TASK_CARD_HK_SATURATION_RESPONSE = 12;
const TASK_CARD_WASH_MIN_SATURATION = 28;
const TASK_CARD_WASH_MAX_SATURATION = 42;
const TASK_CARD_WASH_MIN_LIGHTNESS = 15;
const TASK_CARD_WASH_MAX_LIGHTNESS = 20;
const TASK_CARD_WASH_MIN_ALPHA = 0.38;
const TASK_CARD_WASH_MAX_ALPHA = 0.54;
const TASK_CARD_WASH_SOFT_MIN_ALPHA = 0.2;
const TASK_CARD_WASH_SOFT_MAX_ALPHA = 0.31;
const TASK_CARD_BORDER_ALPHA = 0.46;
const TASK_CARD_BAND_ALPHA = 0.74;
const TASK_CARD_GLOW_ALPHA = 0.2;
const TASK_CARD_SELECTED_RING_ALPHA = 0.5;
const TASK_CARD_SELECTED_OUTLINE_ALPHA = 0.3;
const TASK_TERMINAL_SATURATION = 18;
const TASK_TERMINAL_LIGHTNESS = 8;
const TASK_TERMINAL_TINT_ALPHA = 0.34;
const TASK_TERMINAL_TINT_SOFT_ALPHA = 0.2;
const TASK_TERMINAL_TINT_FAINT_ALPHA = 0.08;
const TASK_TERMINAL_BORDER_ALPHA = 0.42;
const TASK_IDENTITY_CELL_HUE_OFFSETS = [0, 24, -18, 180] as const;

export type TaskIdentityCssProperties = CSSProperties & Record<`--task-${string}`, string>;

type TaskIdentitySlot = {
  anchorLightness: number;
  anchorSaturation: number;
  hue: number;
};

// Identity color is separate from task state. The slot is derived only from
// task identity so card and terminal colors remain stable across sorting,
// filtering, attention changes, and task list updates.
export function taskIdentityCssProperties(taskId: string): TaskIdentityCssProperties {
  const slot = TASK_IDENTITY_SLOTS[fallbackTaskIdentitySlotIndex(taskId)];
  return taskIdentityCssPropertiesForSlot(slot);
}

export function taskIdentityTerminalBackground(taskId: string) {
  const slot = TASK_IDENTITY_SLOTS[fallbackTaskIdentitySlotIndex(taskId)];
  return hsl(slot.hue, TASK_TERMINAL_SATURATION, TASK_TERMINAL_LIGHTNESS);
}

function taskIdentityCssPropertiesForSlot(slot: TaskIdentitySlot): TaskIdentityCssProperties {
  const wash = compensatedCardWash(slot.hue);
  const swatches = taskIdentitySwatches(slot.hue);
  return {
    "--task-identity-a": swatches[0],
    "--task-identity-b": swatches[1],
    "--task-identity-c": swatches[2],
    "--task-identity-d": swatches[3],
    "--task-card-wash": hsl(slot.hue, wash.saturation, wash.lightness, wash.alpha),
    "--task-card-wash-soft": hsl(normalizeHue(slot.hue + 24), wash.saturation, wash.lightness, wash.softAlpha),
    "--task-card-border": hsl(slot.hue, TASK_IDENTITY_SWATCH_SATURATION, 45, TASK_CARD_BORDER_ALPHA),
    "--task-card-band": hsl(slot.hue, TASK_IDENTITY_SWATCH_SATURATION, TASK_IDENTITY_SWATCH_LIGHTNESS, TASK_CARD_BAND_ALPHA),
    "--task-card-glow": hsl(slot.hue, TASK_IDENTITY_SWATCH_SATURATION, TASK_IDENTITY_SWATCH_LIGHTNESS, TASK_CARD_GLOW_ALPHA),
    "--task-card-selected-ring": hsl(slot.hue, 34, 70, TASK_CARD_SELECTED_RING_ALPHA),
    "--task-card-selected-outline": hsl(slot.hue, 28, 76, TASK_CARD_SELECTED_OUTLINE_ALPHA),
    "--task-terminal-tint": hsl(slot.hue, 28, 12, TASK_TERMINAL_TINT_ALPHA),
    "--task-terminal-tint-soft": hsl(slot.hue, 24, 11, TASK_TERMINAL_TINT_SOFT_ALPHA),
    "--task-terminal-tint-faint": hsl(slot.hue, 20, 10, TASK_TERMINAL_TINT_FAINT_ALPHA),
    "--task-terminal-border": hsl(slot.hue, TASK_IDENTITY_SWATCH_SATURATION, 45, TASK_TERMINAL_BORDER_ALPHA),
  };
}

function taskIdentitySwatches(hue: number) {
  return TASK_IDENTITY_CELL_HUE_OFFSETS.map((offset, index) => {
    const nextHue = normalizeHue(hue + offset);
    const saturation = index === 3 ? TASK_IDENTITY_SWATCH_SATURATION * 0.62 : TASK_IDENTITY_SWATCH_SATURATION;
    const lightness = index === 3 ? TASK_IDENTITY_SWATCH_LIGHTNESS * 0.82 : TASK_IDENTITY_SWATCH_LIGHTNESS;
    return hsl(nextHue, saturation, lightness);
  });
}

function compensatedCardWash(hue: number) {
  const perceivedBrightness = helmholtzKohlrauschHueResponse(hue);
  const inverseCorrection = 1 - TASK_CARD_HK_STRENGTH * (perceivedBrightness - TASK_CARD_HK_REFERENCE);
  return {
    saturation: clamp(
      TASK_CARD_WASH_SATURATION + (inverseCorrection - 1) * TASK_CARD_HK_SATURATION_RESPONSE,
      TASK_CARD_WASH_MIN_SATURATION,
      TASK_CARD_WASH_MAX_SATURATION,
    ),
    lightness: clamp(
      TASK_CARD_WASH_LIGHTNESS + (inverseCorrection - 1) * TASK_CARD_HK_LIGHTNESS_RESPONSE,
      TASK_CARD_WASH_MIN_LIGHTNESS,
      TASK_CARD_WASH_MAX_LIGHTNESS,
    ),
    alpha: clamp(
      TASK_CARD_WASH_ALPHA * (1 + (inverseCorrection - 1) * TASK_CARD_HK_ALPHA_RESPONSE),
      TASK_CARD_WASH_MIN_ALPHA,
      TASK_CARD_WASH_MAX_ALPHA,
    ),
    softAlpha: clamp(
      TASK_CARD_WASH_SOFT_ALPHA * (1 + (inverseCorrection - 1) * TASK_CARD_HK_ALPHA_RESPONSE),
      TASK_CARD_WASH_SOFT_MIN_ALPHA,
      TASK_CARD_WASH_SOFT_MAX_ALPHA,
    ),
  };
}

function helmholtzKohlrauschHueResponse(hue: number) {
  return Math.abs(Math.sin(degreesToRadians(normalizeHue(hue) - 45)));
}

function fallbackTaskIdentitySlotIndex(taskId: string) {
  return hashTaskId(taskId) % TASK_IDENTITY_SLOTS.length;
}

function hashTaskId(taskId: string) {
  let hash = 2166136261;
  for (let index = 0; index < taskId.length; index += 1) {
    hash ^= taskId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeHue(value: number) {
  return ((value % 360) + 360) % 360;
}

function hsl(hue: number, saturation: number, lightness: number, alpha?: number) {
  const roundedHue = Math.round(hue * 10) / 10;
  const roundedSaturation = Math.round(saturation);
  const roundedLightness = Math.round(lightness);
  if (typeof alpha === "number") {
    return `hsl(${roundedHue} ${roundedSaturation}% ${roundedLightness}% / ${alpha})`;
  }
  return `hsl(${roundedHue} ${roundedSaturation}% ${roundedLightness}%)`;
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
