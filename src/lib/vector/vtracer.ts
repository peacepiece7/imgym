import { convertBuffer } from "@visioncortex/vtracer";
import type { Options } from "@visioncortex/vtracer";
import { VTRACER_PRESETS } from "./presets";
import type { VectorizeOptions, VectorizeResult } from "./types";
import { IMAGE_LIMITS } from "./validate-image";

export function vectorizeImage(
  image: Buffer,
  options: VectorizeOptions,
): VectorizeResult {
  return vectorizeWithOptions(image, VTRACER_PRESETS[options.preset]);
}

export function vectorizeWithOptions(
  image: Buffer,
  options: Options,
): VectorizeResult {
  const startedAt = performance.now();
  const svg = convertBuffer(image, options);

  if (!svg.includes("<svg") || Buffer.byteLength(svg) > IMAGE_LIMITS.maxRawSvgBytes) {
    throw new Error("Invalid vectorizer output");
  }

  return {
    svg,
    durationMs: performance.now() - startedAt,
  };
}
