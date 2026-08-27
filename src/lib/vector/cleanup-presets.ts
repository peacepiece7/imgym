import type { Options } from "@visioncortex/vtracer";
import type { VectorCleanupOptionsV1 } from "./cleanup-types";
import { VTRACER_PRESETS } from "./presets";
import type { VectorizePreset } from "./types";

const CLEANUP_LEVELS = [
  { speckleDelta: -3, simplifyDelta: -1, medianRadius: 0 },
  { speckleDelta: -2, simplifyDelta: -0.5, medianRadius: 0 },
  { speckleDelta: 0, simplifyDelta: 0, medianRadius: 0 },
  { speckleDelta: 4, simplifyDelta: 0.75, medianRadius: 1 },
  { speckleDelta: 8, simplifyDelta: 1.5, medianRadius: 2 },
] as const;

export interface ResolvedVectorCleanup {
  medianRadius: number;
  alphaCutoff?: number;
  colors: VectorCleanupOptionsV1["colors"];
  vtracer: Options;
}

export function resolveVectorCleanup(
  preset: VectorizePreset,
  cleanup: VectorCleanupOptionsV1,
): ResolvedVectorCleanup {
  const base: Options = VTRACER_PRESETS[preset];
  const level = CLEANUP_LEVELS[cleanup.cleanup];
  const advanced = cleanup.advanced;
  const vtracer: Options = {
    ...base,
    filterSpeckle: advanced?.speckleSize
      ?? Math.max(0, Math.min(128, (base.filterSpeckle ?? 4) + level.speckleDelta)),
    simplify: advanced?.pathSimplify
      ?? Math.max(0, Math.min(4, (base.simplify ?? 0) + level.simplifyDelta)),
    layerDifference: advanced?.gradientStep ?? base.layerDifference,
  };

  if (cleanup.colors === "full") {
    delete vtracer.maxColors;
    vtracer.colorPrecision = advanced?.colorPrecision ?? base.colorPrecision ?? 8;
  } else {
    vtracer.colorPrecision = 8;
    vtracer.maxColors = cleanup.colors;
  }

  return {
    medianRadius: level.medianRadius,
    alphaCutoff: advanced?.alphaCutoff,
    colors: cleanup.colors,
    vtracer,
  };
}
