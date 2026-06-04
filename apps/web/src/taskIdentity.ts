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
  { hue: 27, anchorSaturation: 58, anchorLightness: 58 },
  { hue: 58, anchorSaturation: 52, anchorLightness: 56 },
  { hue: 92, anchorSaturation: 46, anchorLightness: 53 },
  { hue: 126, anchorSaturation: 44, anchorLightness: 53 },
  { hue: 159, anchorSaturation: 45, anchorLightness: 53 },
  { hue: 191, anchorSaturation: 50, anchorLightness: 54 },
  { hue: 222, anchorSaturation: 54, anchorLightness: 57 },
  { hue: 255, anchorSaturation: 53, anchorLightness: 58 },
  { hue: 287, anchorSaturation: 54, anchorLightness: 58 },
  { hue: 318, anchorSaturation: 58, anchorLightness: 58 },
  { hue: 346, anchorSaturation: 60, anchorLightness: 57 },
  { hue: 6, anchorSaturation: 60, anchorLightness: 57 },
] as const;

const TASK_IDENTITY_SWATCH_SATURATION = 52;
const TASK_IDENTITY_SWATCH_LIGHTNESS = 57;
const TASK_IDENTITY_CELL_HUE_OFFSETS = [0, 24, -18, 180] as const;
const TASK_IDENTITY_VISUAL_MODEL = {
  card: {
    saturation: 32,
    lightness: 18,
  },
  terminal: {
    saturationRatio: 0.82,
    lightnessRatio: 0.68,
  },
  terminalSelection: {
    saturationRatio: 1.2,
    lightnessDelta: 18,
  },
  accent: {
    saturationRatio: 1.62,
    borderLightnessDelta: 27,
    bandLightnessDelta: 39,
  },
  gradient: {
    baseAlpha: 0.48,
    softRatio: 0.54,
    faintRatio: 0.17,
    borderRatio: 0.96,
    bandRatio: 1.54,
    glowRatio: 0.42,
    terminalBorderRatio: 0.88,
  },
  hueBalance: {
    reference: 2 / Math.PI,
    strength: 0.16,
    saturationResponse: 12,
    lightnessResponse: 5,
    saturationMin: 28,
    saturationMax: 42,
    lightnessMin: 15,
    lightnessMax: 20,
  },
} as const;

export type TaskIdentityCssProperties = CSSProperties & Record<`--task-${string}`, string>;

type TaskIdentityInput = {
  identityColorSlot?: number;
  taskId: string;
};

type TaskIdentitySlot = {
  anchorLightness: number;
  anchorSaturation: number;
  hue: number;
};

// Identity color is separate from task state. New tasks carry a fixed metadata
// slot; taskId hashing is only a fallback for older stored tasks.
export function taskIdentityCssProperties({ identityColorSlot, taskId }: TaskIdentityInput): TaskIdentityCssProperties {
  const slot = TASK_IDENTITY_SLOTS[taskIdentitySlotIndex({ identityColorSlot, taskId })];
  return taskIdentityCssPropertiesForSlot(slot);
}

function taskIdentitySlotIndex({ identityColorSlot, taskId }: TaskIdentityInput) {
  if (Number.isFinite(identityColorSlot) && typeof identityColorSlot === "number" && identityColorSlot >= 0) {
    return Math.floor(identityColorSlot) % TASK_IDENTITY_SLOTS.length;
  }
  return fallbackTaskIdentitySlotIndex(taskId);
}

function taskIdentityCssPropertiesForSlot(slot: TaskIdentitySlot): TaskIdentityCssProperties {
  const cardTone = compensateToneForHue(slot.hue, TASK_IDENTITY_VISUAL_MODEL.card);
  const terminalTone = terminalToneFromCardTone(cardTone);
  const terminalSelectionTone = terminalSelectionToneFromCardTone(cardTone);
  const accentTone = accentToneFromCardTone(cardTone);
  const gradient = identityGradientAlphas(TASK_IDENTITY_VISUAL_MODEL.gradient.baseAlpha);
  const swatches = taskIdentitySwatches(slot.hue);
  return {
    "--task-identity-a": swatches[0],
    "--task-identity-b": swatches[1],
    "--task-identity-c": swatches[2],
    "--task-identity-d": swatches[3],
    "--task-card-wash": hsl(slot.hue, cardTone.saturation, cardTone.lightness, gradient.base),
    "--task-card-wash-soft": hsl(slot.hue, cardTone.saturation * 0.82, cardTone.lightness, gradient.soft),
    "--task-card-border": hsl(slot.hue, accentTone.saturation, accentTone.borderLightness, gradient.border),
    "--task-card-band": hsl(slot.hue, accentTone.saturation, accentTone.bandLightness, gradient.band),
    "--task-card-glow": hsl(slot.hue, accentTone.saturation, accentTone.bandLightness, gradient.glow),
    "--task-terminal-tint": hsl(slot.hue, terminalTone.saturation, terminalTone.lightness, gradient.base),
    "--task-terminal-tint-soft": hsl(slot.hue, terminalTone.saturation * 0.82, terminalTone.lightness * 0.92, gradient.soft),
    "--task-terminal-tint-faint": hsl(slot.hue, terminalTone.saturation * 0.68, terminalTone.lightness * 0.84, gradient.faint),
    "--task-terminal-border": hsl(slot.hue, accentTone.saturation, accentTone.borderLightness, gradient.terminalBorder),
    "--task-terminal-selection": hsl(slot.hue, terminalSelectionTone.saturation, terminalSelectionTone.lightness),
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

function compensateToneForHue(hue: number, tone: { saturation: number; lightness: number }) {
  const { hueBalance } = TASK_IDENTITY_VISUAL_MODEL;
  const perceivedBrightness = helmholtzKohlrauschHueResponse(hue);
  const inverseCorrection = 1 - hueBalance.strength * (perceivedBrightness - hueBalance.reference);
  return {
    saturation: clamp(
      tone.saturation + (inverseCorrection - 1) * hueBalance.saturationResponse,
      hueBalance.saturationMin,
      hueBalance.saturationMax,
    ),
    lightness: clamp(
      tone.lightness + (inverseCorrection - 1) * hueBalance.lightnessResponse,
      hueBalance.lightnessMin,
      hueBalance.lightnessMax,
    ),
  };
}

function terminalToneFromCardTone(cardTone: { saturation: number; lightness: number }) {
  const { terminal } = TASK_IDENTITY_VISUAL_MODEL;
  return {
    saturation: cardTone.saturation * terminal.saturationRatio,
    lightness: cardTone.lightness * terminal.lightnessRatio,
  };
}

function terminalSelectionToneFromCardTone(cardTone: { saturation: number; lightness: number }) {
  const { terminalSelection } = TASK_IDENTITY_VISUAL_MODEL;
  return {
    saturation: cardTone.saturation * terminalSelection.saturationRatio,
    lightness: cardTone.lightness + terminalSelection.lightnessDelta,
  };
}

function accentToneFromCardTone(cardTone: { saturation: number; lightness: number }) {
  const { accent } = TASK_IDENTITY_VISUAL_MODEL;
  return {
    saturation: cardTone.saturation * accent.saturationRatio,
    borderLightness: cardTone.lightness + accent.borderLightnessDelta,
    bandLightness: cardTone.lightness + accent.bandLightnessDelta,
  };
}

function identityGradientAlphas(baseAlpha: number) {
  const { gradient } = TASK_IDENTITY_VISUAL_MODEL;
  return {
    base: baseAlpha,
    soft: baseAlpha * gradient.softRatio,
    faint: baseAlpha * gradient.faintRatio,
    border: baseAlpha * gradient.borderRatio,
    band: baseAlpha * gradient.bandRatio,
    glow: baseAlpha * gradient.glowRatio,
    terminalBorder: baseAlpha * gradient.terminalBorderRatio,
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
