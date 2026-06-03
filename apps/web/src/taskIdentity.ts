import type { CSSProperties } from "react";

const TASK_IDENTITY_COUNT = 24;
const TASK_IDENTITY_HUE_STEP = 137.508;
const TASK_IDENTITY_SWATCH_SATURATION = 52;
const TASK_IDENTITY_SWATCH_LIGHTNESS = 57;
const TASK_CARD_WASH_SATURATION = 36;
const TASK_CARD_WASH_LIGHTNESS = 18;
const TASK_CARD_WASH_ALPHA = 0.48;
const TASK_CARD_WASH_SOFT_ALPHA = 0.26;
const TASK_CARD_BORDER_ALPHA = 0.46;
const TASK_CARD_BAND_ALPHA = 0.74;
const TASK_CARD_GLOW_ALPHA = 0.2;
const TASK_TERMINAL_SATURATION = 18;
const TASK_TERMINAL_LIGHTNESS = 8;
const TASK_TERMINAL_TINT_ALPHA = 0.34;
const TASK_TERMINAL_BORDER_ALPHA = 0.42;
const TASK_IDENTITY_CELL_HUE_OFFSETS = [0, 24, -18, 180] as const;

type TaskIdentityCssProperties = CSSProperties & Record<`--task-${string}`, string>;

// Identity color is separate from task state. Hues rotate around the color wheel
// with a golden-angle step and wrap after TASK_IDENTITY_COUNT; constants stay
// centralized so design/vibe tuning does not touch task logic.
export function taskIdentityCssProperties(taskId: string): TaskIdentityCssProperties {
  const hue = taskIdentityHue(taskId);
  const swatches = TASK_IDENTITY_CELL_HUE_OFFSETS.map((offset, index) => {
    const nextHue = normalizeHue(hue + offset);
    const saturation = index === 3 ? TASK_IDENTITY_SWATCH_SATURATION * 0.62 : TASK_IDENTITY_SWATCH_SATURATION;
    const lightness = index === 3 ? TASK_IDENTITY_SWATCH_LIGHTNESS * 0.82 : TASK_IDENTITY_SWATCH_LIGHTNESS;
    return hsl(nextHue, saturation, lightness);
  });

  return {
    "--task-identity-a": swatches[0],
    "--task-identity-b": swatches[1],
    "--task-identity-c": swatches[2],
    "--task-identity-d": swatches[3],
    "--task-card-wash": hsl(hue, TASK_CARD_WASH_SATURATION, TASK_CARD_WASH_LIGHTNESS, TASK_CARD_WASH_ALPHA),
    "--task-card-wash-soft": hsl(normalizeHue(hue + 24), TASK_CARD_WASH_SATURATION, TASK_CARD_WASH_LIGHTNESS, TASK_CARD_WASH_SOFT_ALPHA),
    "--task-card-border": hsl(hue, TASK_IDENTITY_SWATCH_SATURATION, 45, TASK_CARD_BORDER_ALPHA),
    "--task-card-band": hsl(hue, TASK_IDENTITY_SWATCH_SATURATION, TASK_IDENTITY_SWATCH_LIGHTNESS, TASK_CARD_BAND_ALPHA),
    "--task-card-glow": hsl(hue, TASK_IDENTITY_SWATCH_SATURATION, TASK_IDENTITY_SWATCH_LIGHTNESS, TASK_CARD_GLOW_ALPHA),
    "--task-terminal-tint": hsl(hue, 28, 12, TASK_TERMINAL_TINT_ALPHA),
    "--task-terminal-border": hsl(hue, TASK_IDENTITY_SWATCH_SATURATION, 45, TASK_TERMINAL_BORDER_ALPHA),
  };
}

export function taskIdentityTerminalBackground(taskId: string) {
  const hue = taskIdentityHue(taskId);
  return hsl(hue, TASK_TERMINAL_SATURATION, TASK_TERMINAL_LIGHTNESS);
}

function taskIdentityHue(taskId: string) {
  const identityIndex = hashTaskId(taskId) % TASK_IDENTITY_COUNT;
  return normalizeHue(identityIndex * TASK_IDENTITY_HUE_STEP);
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
