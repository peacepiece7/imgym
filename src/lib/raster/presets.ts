import type {
  RasterFormat,
  RasterMode,
  RasterOptimizationPolicy,
  RasterPreset,
} from "@/lib/raster/types";

const PRESETS: Record<RasterPreset, Record<RasterFormat, readonly string[]>> = {
  high: {
    jpeg: ["-quality", "92", "-sampling-factor", "4:4:4"],
    webp: ["-quality", "90", "-define", "webp:method=4", "-define", "webp:alpha-quality=100"],
    png: ["-define", "png:compression-level=3"],
  },
  balanced: {
    jpeg: ["-quality", "82", "-sampling-factor", "4:2:0"],
    webp: ["-quality", "82", "-define", "webp:method=5", "-define", "webp:alpha-quality=100"],
    png: ["-define", "png:compression-level=7"],
  },
  small: {
    jpeg: ["-quality", "72", "-sampling-factor", "4:2:0"],
    webp: ["-quality", "72", "-define", "webp:method=6", "-define", "webp:alpha-quality=100"],
    png: ["-define", "png:compression-level=9"],
  },
};

export const RASTER_MODES: readonly RasterMode[] = ["high", "balanced", "small", "auto"];
export const RASTER_OPTIMIZATION_POLICIES: readonly RasterOptimizationPolicy[] = ["standard", "smaller"];

export function isRasterMode(value: unknown): value is RasterMode {
  return typeof value === "string" && RASTER_MODES.includes(value as RasterMode);
}

export function isRasterOptimizationPolicy(value: unknown): value is RasterOptimizationPolicy {
  return typeof value === "string"
    && RASTER_OPTIMIZATION_POLICIES.includes(value as RasterOptimizationPolicy);
}

export function encoderArgs(format: RasterFormat, preset: RasterPreset) {
  return [...PRESETS[preset][format]];
}
