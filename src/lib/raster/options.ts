import { parseNormalizedCrop, parseRasterResize } from "@/lib/raster/crop";
import { isRasterMode, isRasterOptimizationPolicy } from "@/lib/raster/presets";
import type { OptimizeRasterOptions, RasterOptimizationPolicy } from "@/lib/raster/types";

/**
 * Lives here rather than beside the route so the documented examples can be
 * checked against the real contract; every other endpoint already keeps its
 * parser in lib for the same reason.
 */
export function parseOptimizeRasterOptions(
  value: FormDataEntryValue | null,
): OptimizeRasterOptions | null {
  if (typeof value !== "string") return null;
  let candidate: unknown;
  try {
    candidate = JSON.parse(value);
  } catch {
    return null;
  }
  if (!candidate || typeof candidate !== "object") return null;
  const raw = candidate as Record<string, unknown>;
  const crop = parseNormalizedCrop(raw.crop);
  const resize = parseRasterResize(raw.resize);
  if (!crop || !resize || !isRasterMode(raw.mode)) return null;
  let policy: RasterOptimizationPolicy = "standard";
  if (raw.optimization !== undefined) {
    if (!raw.optimization || typeof raw.optimization !== "object") return null;
    const optimization = raw.optimization as Record<string, unknown>;
    if (!isRasterOptimizationPolicy(optimization.policy)) return null;
    policy = optimization.policy;
  }
  if (raw.mode !== "auto" && policy !== "standard") return null;
  return { crop, resize, mode: raw.mode, optimization: { policy } };
}
