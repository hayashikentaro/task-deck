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
const TASK_CARD_WASH_SATURATION = 36;
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
const TASK_TERMINAL_BORDER_ALPHA = 0.42;
const TASK_IDENTITY_CELL_HUE_OFFSETS = [0, 24, -18, 180] as const;

export type TaskIdentityCssProperties = CSSProperties & Record<`--task-${string}`, string>;

type TaskIdentitySlot = {
  anchorLightness: number;
  anchorSaturation: number;
  hue: number;
};

type OklabColor = {
  a: number;
  b: number;
  l: number;
};

// Identity color is separate from task state. The visible-task assignment uses
// a fixed candidate palette and greedily spreads slots apart so neighboring
// cards are easier to distinguish in the current rendered set.
export function taskIdentityCssProperties(taskId: string, visibleTaskIds: readonly string[] = []): TaskIdentityCssProperties {
  const slot = TASK_IDENTITY_SLOTS[taskIdentitySlotIndexForTask(taskId, visibleTaskIds)];
  return taskIdentityCssPropertiesForSlot(slot);
}

export function taskIdentityCssPropertiesForVisibleTasks(taskIds: readonly string[]) {
  const assignments = assignVisibleTaskIdentitySlots(taskIds);
  const styles = new Map<string, TaskIdentityCssProperties>();
  for (const taskId of taskIds) {
    const slot = TASK_IDENTITY_SLOTS[assignments.get(taskId) ?? fallbackTaskIdentitySlotIndex(taskId)];
    styles.set(taskId, taskIdentityCssPropertiesForSlot(slot));
  }
  return styles;
}

export function taskIdentityTerminalBackground(taskId: string, visibleTaskIds: readonly string[] = []) {
  const slot = TASK_IDENTITY_SLOTS[taskIdentitySlotIndexForTask(taskId, visibleTaskIds)];
  return hsl(slot.hue, TASK_TERMINAL_SATURATION, TASK_TERMINAL_LIGHTNESS);
}

function assignVisibleTaskIdentitySlots(taskIds: readonly string[]) {
  const assignments = new Map<string, number>();
  const assignedSlotIndexes: number[] = [];

  for (const taskId of taskIds) {
    const candidateIndexes =
      assignedSlotIndexes.length < TASK_IDENTITY_SLOTS.length
        ? TASK_IDENTITY_SLOTS.map((_, index) => index).filter((index) => !assignedSlotIndexes.includes(index))
        : TASK_IDENTITY_SLOTS.map((_, index) => index);

    let bestSlotIndex = candidateIndexes[0] ?? fallbackTaskIdentitySlotIndex(taskId);
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestTieBreak = Number.NEGATIVE_INFINITY;

    for (const slotIndex of candidateIndexes) {
      const slot = TASK_IDENTITY_SLOTS[slotIndex];
      const score = assignedSlotIndexes.length === 0 ? 0 : minimumOklabDistance(slot, assignedSlotIndexes);
      const tieBreak = hashTaskId(`${taskId}:${slotIndex}`);
      if (score > bestScore || (score === bestScore && tieBreak > bestTieBreak)) {
        bestSlotIndex = slotIndex;
        bestScore = score;
        bestTieBreak = tieBreak;
      }
    }

    assignments.set(taskId, bestSlotIndex);
    assignedSlotIndexes.push(bestSlotIndex);
  }

  return assignments;
}

function minimumOklabDistance(slot: TaskIdentitySlot, assignedSlotIndexes: number[]) {
  let minimumDistance = Number.POSITIVE_INFINITY;
  const currentLab = slotAnchorOklab(slot);
  for (const assignedSlotIndex of assignedSlotIndexes) {
    const assignedLab = slotAnchorOklab(TASK_IDENTITY_SLOTS[assignedSlotIndex]);
    const distance = oklabDistance(currentLab, assignedLab);
    if (distance < minimumDistance) {
      minimumDistance = distance;
    }
  }
  return minimumDistance;
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

function slotAnchorOklab(slot: TaskIdentitySlot): OklabColor {
  return rgbToOklab(hslToRgb(slot.hue, slot.anchorSaturation, slot.anchorLightness));
}

function taskIdentitySlotIndexForTask(taskId: string, visibleTaskIds: readonly string[]) {
  if (visibleTaskIds.includes(taskId)) {
    const assignment = assignVisibleTaskIdentitySlots(visibleTaskIds);
    const slotIndex = assignment.get(taskId);
    if (typeof slotIndex === "number") {
      return slotIndex;
    }
  }
  return fallbackTaskIdentitySlotIndex(taskId);
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

function hslToRgb(hue: number, saturation: number, lightness: number) {
  const normalizedHue = normalizeHue(hue);
  const normalizedSaturation = clamp01(saturation / 100);
  const normalizedLightness = clamp01(lightness / 100);
  const chroma = (1 - Math.abs(2 * normalizedLightness - 1)) * normalizedSaturation;
  const huePrime = normalizedHue / 60;
  const secondary = chroma * (1 - Math.abs((huePrime % 2) - 1));

  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime >= 0 && huePrime < 1) {
    red = chroma;
    green = secondary;
  } else if (huePrime < 2) {
    red = secondary;
    green = chroma;
  } else if (huePrime < 3) {
    green = chroma;
    blue = secondary;
  } else if (huePrime < 4) {
    green = secondary;
    blue = chroma;
  } else if (huePrime < 5) {
    red = secondary;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondary;
  }

  const match = normalizedLightness - chroma / 2;
  return {
    red: (red + match) * 255,
    green: (green + match) * 255,
    blue: (blue + match) * 255,
  };
}

function rgbToOklab(rgb: { blue: number; green: number; red: number }): OklabColor {
  const red = srgbToLinear(rgb.red / 255);
  const green = srgbToLinear(rgb.green / 255);
  const blue = srgbToLinear(rgb.blue / 255);

  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;

  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  return {
    l: 0.2104542553 * lRoot + 0.7936177850 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.4285922050 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.8086757660 * sRoot,
  };
}

function srgbToLinear(value: number) {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return ((value + 0.055) / 1.055) ** 2.4;
}

function oklabDistance(left: OklabColor, right: OklabColor) {
  const deltaL = left.l - right.l;
  const deltaA = left.a - right.a;
  const deltaB = left.b - right.b;
  return Math.sqrt(deltaL * deltaL + deltaA * deltaA + deltaB * deltaB);
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
