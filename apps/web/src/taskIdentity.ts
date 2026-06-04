import type { CSSProperties } from "react";

const TASK_IDENTITY_SLOTS = [
  { hue: 14 },
  { hue: 42 },
  { hue: 74 },
  { hue: 110 },
  { hue: 144 },
  { hue: 176 },
  { hue: 206 },
  { hue: 238 },
  { hue: 272 },
  { hue: 302 },
  { hue: 332 },
  { hue: 358 },
] as const;

const TASK_IDENTITY_VISUAL_MODEL = {
  card: {
    saturation: 32,
    lightness: 18,
    softSaturationRatio: 0.82,
  },
  terminal: {
    saturationRatio: 0.82,
    lightnessRatio: 0.68,
    softSaturationRatio: 0.82,
    softLightnessRatio: 0.92,
    faintSaturationRatio: 0.68,
    faintLightnessRatio: 0.84,
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

type TaskIdentitySlot = {
  hue: number;
};

type Tone = {
  saturation: number;
  lightness: number;
};

// Identity color is separate from task state. The slot is derived only from
// task identity so card and terminal colors remain stable across sorting,
// filtering, attention changes, and task list updates.
export function taskIdentityCssProperties(taskId: string): TaskIdentityCssProperties {
  const slot = TASK_IDENTITY_SLOTS[fallbackTaskIdentitySlotIndex(taskId)];
  return taskIdentityCssPropertiesForSlot(slot);
}

function taskIdentityCssPropertiesForSlot(slot: TaskIdentitySlot): TaskIdentityCssProperties {
  const cardTone = compensateToneForHue(slot.hue, TASK_IDENTITY_VISUAL_MODEL.card);
  const cardSoftTone = cardSoftToneFromCardTone(cardTone);
  const terminalTone = terminalToneFromCardTone(cardTone);
  const terminalSoftTone = terminalSoftToneFromTerminalTone(terminalTone);
  const terminalFaintTone = terminalFaintToneFromTerminalTone(terminalTone);
  const accentTone = accentToneFromCardTone(cardTone);
  const gradient = identityGradientAlphas(TASK_IDENTITY_VISUAL_MODEL.gradient.baseAlpha);

  return {
    "--task-card-wash": hsl(slot.hue, cardTone.saturation, cardTone.lightness, gradient.base),
    "--task-card-wash-soft": hsl(slot.hue, cardSoftTone.saturation, cardSoftTone.lightness, gradient.soft),
    "--task-card-border": hsl(slot.hue, accentTone.saturation, accentTone.borderLightness, gradient.border),
    "--task-card-band": hsl(slot.hue, accentTone.saturation, accentTone.bandLightness, gradient.band),
    "--task-card-glow": hsl(slot.hue, accentTone.saturation, accentTone.bandLightness, gradient.glow),
    "--task-terminal-tint": hsl(slot.hue, terminalTone.saturation, terminalTone.lightness, gradient.base),
    "--task-terminal-tint-soft": hsl(
      slot.hue,
      terminalSoftTone.saturation,
      terminalSoftTone.lightness,
      gradient.soft,
    ),
    "--task-terminal-tint-faint": hsl(
      slot.hue,
      terminalFaintTone.saturation,
      terminalFaintTone.lightness,
      gradient.faint,
    ),
    "--task-terminal-border": hsl(slot.hue, accentTone.saturation, accentTone.borderLightness, gradient.terminalBorder),
  };
}

function compensateToneForHue(hue: number, tone: Tone): Tone {
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

function cardSoftToneFromCardTone(cardTone: Tone): Tone {
  const { card } = TASK_IDENTITY_VISUAL_MODEL;
  return {
    saturation: cardTone.saturation * card.softSaturationRatio,
    lightness: cardTone.lightness,
  };
}

function terminalToneFromCardTone(cardTone: Tone): Tone {
  const { terminal } = TASK_IDENTITY_VISUAL_MODEL;
  return {
    saturation: cardTone.saturation * terminal.saturationRatio,
    lightness: cardTone.lightness * terminal.lightnessRatio,
  };
}

function terminalSoftToneFromTerminalTone(terminalTone: Tone): Tone {
  const { terminal } = TASK_IDENTITY_VISUAL_MODEL;
  return {
    saturation: terminalTone.saturation * terminal.softSaturationRatio,
    lightness: terminalTone.lightness * terminal.softLightnessRatio,
  };
}

function terminalFaintToneFromTerminalTone(terminalTone: Tone): Tone {
  const { terminal } = TASK_IDENTITY_VISUAL_MODEL;
  return {
    saturation: terminalTone.saturation * terminal.faintSaturationRatio,
    lightness: terminalTone.lightness * terminal.faintLightnessRatio,
  };
}

function accentToneFromCardTone(cardTone: Tone) {
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
