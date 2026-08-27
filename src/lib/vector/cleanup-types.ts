export const VECTOR_COLOR_STOPS = [3, 4, 6, 8, 16, 32, 64, 128, "full"] as const;

export type VectorColorLimit = (typeof VECTOR_COLOR_STOPS)[number];
export type VectorCleanupLevel = 0 | 1 | 2 | 3 | 4;

export interface VectorCleanupAdvanced {
  speckleSize?: number;
  alphaCutoff?: number;
  gradientStep?: number;
  colorPrecision?: number;
  pathSimplify?: number;
}

export interface VectorCleanupOptionsV1 {
  version: 1;
  cleanup: VectorCleanupLevel;
  colors: VectorColorLimit;
  advanced?: VectorCleanupAdvanced;
}

export const DEFAULT_VECTOR_CLEANUP = {
  version: 1,
  cleanup: 2,
  colors: 64,
} as const satisfies VectorCleanupOptionsV1;

function isIntegerBetween(value: unknown, minimum: number, maximum: number) {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function isOptionalNumberBetween(value: unknown, minimum: number, maximum: number) {
  return value === undefined
    || (typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum);
}

export function isVectorCleanupOptions(value: unknown): value is VectorCleanupOptionsV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !["version", "cleanup", "colors", "advanced"].includes(key))) return false;
  if (candidate.version !== 1 || !isIntegerBetween(candidate.cleanup, 0, 4)) return false;
  if (!VECTOR_COLOR_STOPS.includes(candidate.colors as VectorColorLimit)) return false;
  if (candidate.advanced === undefined) return true;
  if (!candidate.advanced || typeof candidate.advanced !== "object" || Array.isArray(candidate.advanced)) return false;
  const advanced = candidate.advanced as Record<string, unknown>;
  if (Object.keys(advanced).some((key) => ![
    "speckleSize", "alphaCutoff", "gradientStep", "colorPrecision", "pathSimplify",
  ].includes(key))) return false;
  return isIntegerBetween(advanced.speckleSize ?? 0, 0, 128)
    && isIntegerBetween(advanced.alphaCutoff ?? 0, 0, 255)
    && isIntegerBetween(advanced.gradientStep ?? 0, 0, 128)
    && isIntegerBetween(advanced.colorPrecision ?? 1, 1, 8)
    && isOptionalNumberBetween(advanced.pathSimplify, 0, 4);
}

export function parseVectorCleanupOptions(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isVectorCleanupOptions(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
