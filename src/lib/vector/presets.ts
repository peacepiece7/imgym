import type { Options } from "@visioncortex/vtracer";
import type { VectorizeMode, VectorizePreset } from "./types";

export const VTRACER_PRESETS = {
  accurate: {
    preset: "photo",
    mode: "spline",
    filterSpeckle: 2,
    colorPrecision: 8,
    pathPrecision: 4,
    optimize: 1,
  },
  balanced: {
    preset: "poster",
    mode: "spline",
    filterSpeckle: 4,
    colorPrecision: 6,
    simplify: 1,
    pathPrecision: 3,
    maxColors: 64,
    optimize: 1,
  },
  tiny: {
    preset: "poster",
    mode: "spline",
    filterSpeckle: 8,
    colorPrecision: 5,
    simplify: 2.5,
    pathPrecision: 2,
    maxColors: 24,
    optimize: 2,
  },
} as const satisfies Record<VectorizePreset, Options>;

export interface VectorAutoCandidate {
  key: string;
  label: string;
  options: Options;
  floatPrecision: number;
}

export const VECTOR_AUTO_CANDIDATES = [
  {
    key: "accurate",
    label: "Accurate",
    options: { ...VTRACER_PRESETS.accurate },
    floatPrecision: 4,
  },
  {
    key: "balanced",
    label: "Balanced",
    options: { ...VTRACER_PRESETS.balanced },
    floatPrecision: 3,
  },
  {
    key: "balanced-compact",
    label: "Balanced compact",
    options: {
      ...VTRACER_PRESETS.balanced,
      filterSpeckle: 5,
      simplify: 1.5,
      maxColors: 48,
    },
    floatPrecision: 3,
  },
  {
    key: "tiny",
    label: "Tiny",
    options: { ...VTRACER_PRESETS.tiny },
    floatPrecision: 3,
  },
  {
    key: "compact",
    label: "Compact",
    options: {
      ...VTRACER_PRESETS.tiny,
      filterSpeckle: 9,
      simplify: 3,
      maxColors: 16,
    },
    floatPrecision: 2,
  },
  {
    key: "minimum",
    label: "Minimum",
    options: {
      ...VTRACER_PRESETS.tiny,
      filterSpeckle: 12,
      colorPrecision: 4,
      simplify: 4,
      maxColors: 8,
    },
    floatPrecision: 2,
  },
] as const satisfies readonly VectorAutoCandidate[];

export function isVectorizePreset(value: unknown): value is VectorizePreset {
  return value === "accurate" || value === "balanced" || value === "tiny";
}

export function isVectorizeMode(value: unknown): value is VectorizeMode {
  return value === "auto" || isVectorizePreset(value);
}
