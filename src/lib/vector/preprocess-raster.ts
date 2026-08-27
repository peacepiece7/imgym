import { imageDimensionsFromData } from "image-dimensions";
import { MAGICK_LIMIT_ARGS, runMagick } from "@/lib/raster/image-magick";
import type { ResolvedVectorCleanup } from "./cleanup-presets";
import type { ValidImage } from "./validate-image";

const INPUT_CODERS = { png: "png", jpeg: "jpeg", webp: "webp" } as const;

export interface PreprocessedVectorRaster {
  image: Buffer;
  durationMs: number;
  colors: number;
}

export function vectorPreprocessArgs(format: ValidImage["format"], options: ResolvedVectorCleanup) {
  const colorArgs = options.colors === "full"
    ? []
    : ["-quantize", "transparent", "+dither", "-colors", String(options.colors)];
  const alphaArgs = options.alphaCutoff === undefined
    ? []
    : [
        "-alpha", "set", "-channel", "A", "-black-threshold",
        `${((options.alphaCutoff / 255) * 100).toFixed(4)}%`, "+channel",
      ];
  return [
    ...MAGICK_LIMIT_ARGS,
    `${INPUT_CODERS[format]}:-[0]`,
    "-auto-orient", "+repage",
    "-colorspace", "sRGB", "-depth", "8",
    ...(options.medianRadius > 0 ? ["-median", String(options.medianRadius)] : []),
    ...alphaArgs,
    "-background", "none", "-alpha", "background",
    ...colorArgs,
    "+profile", "*",
    "png:-",
  ];
}

async function countColors(image: Buffer, signal?: AbortSignal) {
  const { stdout } = await runMagick([
    ...MAGICK_LIMIT_ARGS,
    "png:-[0]", "-format", "%k", "info:",
  ], { input: image, signal, stdoutLimit: 64 });
  const count = Number.parseInt(stdout.toString("ascii"), 10);
  if (!Number.isInteger(count) || count < 1) throw new Error("ImageMagick returned an invalid color count");
  return count;
}

export async function preprocessRasterForVector(
  image: Buffer,
  validation: ValidImage,
  options: ResolvedVectorCleanup,
  signal?: AbortSignal,
): Promise<PreprocessedVectorRaster> {
  const startedAt = performance.now();
  const { stdout } = await runMagick(vectorPreprocessArgs(validation.format, options), { input: image, signal });
  const dimensions = imageDimensionsFromData(new Uint8Array(stdout));
  if (!dimensions || dimensions.type !== "png" || dimensions.width < 1 || dimensions.height < 1) {
    throw new Error("ImageMagick returned an invalid vector input");
  }
  const colors = await countColors(stdout, signal);
  return { image: stdout, colors, durationMs: performance.now() - startedAt };
}
