import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { measureAssociatedAlphaDistortion } from "@/lib/image/image-magick-metric";
import { MAGICK_LIMIT_ARGS, runMagick } from "@/lib/raster/image-magick";
import type { RasterFormat } from "@/lib/raster/types";

const EVALUATION_MAX_DIMENSION = 512;

const CODERS: Record<RasterFormat, string> = {
  png: "png",
  jpeg: "jpeg",
  webp: "webp",
};

export const SVG_AUTO_QUALITY_GATE = {
  version: "imagemagick-svg-v2",
  minimumSsim: 0.75,
  maximumMae: 0.12,
  maximumEdgeMae: 0.25,
} as const;

export interface VectorQuality {
  ssim: number;
  mae: number;
  edgeMae: number;
  rasterizationMs: number;
  measurementMs: number;
}

export function vectorEvaluationDimensions(width: number, height: number) {
  const scale = Math.min(1, EVALUATION_MAX_DIMENSION / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function distortion(output: Buffer) {
  const value = Number.parseFloat(output.toString("utf8"));
  if (!Number.isFinite(value)) throw new Error("ImageMagick returned an invalid SVG metric");
  return value;
}

async function measureEdges(
  reference: string,
  candidate: string,
  temporaryDirectory: string,
  signal?: AbortSignal,
) {
  const result = await runMagick([
    ...MAGICK_LIMIT_ARGS,
    "(", reference, "-alpha", "remove", "-colorspace", "gray", "-morphology", "Convolve", "Sobel", ")",
    "(", candidate, "-alpha", "remove", "-colorspace", "gray", "-morphology", "Convolve", "Sobel", ")",
    "-metric", "MAE",
    "-compare",
    "-format", "%[distortion]",
    "info:",
  ], { signal, temporaryDirectory, stdoutLimit: 1_024 });
  return distortion(result.stdout);
}

export async function createVectorReference(
  image: Buffer,
  format: RasterFormat,
  dimensions: { width: number; height: number },
  temporaryDirectory: string,
  signal?: AbortSignal,
) {
  const filename = "vector-reference.miff";
  await runMagick([
    ...MAGICK_LIMIT_ARGS,
    `${CODERS[format]}:-[0]`,
    "+repage",
    "-resize", `${dimensions.width}x${dimensions.height}!`,
    "-alpha", "set",
    "-colorspace", "sRGB",
    "-depth", "8",
    `miff:${filename}`,
  ], { input: image, signal, temporaryDirectory });
  return `miff:${filename}`;
}

export async function evaluateVectorCandidate(
  svg: string,
  reference: string,
  dimensions: { width: number; height: number },
  index: number,
  temporaryDirectory: string,
  signal?: AbortSignal,
): Promise<VectorQuality> {
  signal?.throwIfAborted();
  const svgFilename = `vector-candidate-${index}.svg`;
  const rasterFilename = `vector-candidate-${index}.miff`;
  const candidate = `miff:${rasterFilename}`;
  await writeFile(join(temporaryDirectory, svgFilename), svg, { encoding: "utf8", signal });
  const rasterStartedAt = performance.now();
  await runMagick([
    ...MAGICK_LIMIT_ARGS,
    "-background", "none",
    `svg:${svgFilename}[0]`,
    "+repage",
    "-resize", `${dimensions.width}x${dimensions.height}!`,
    "-alpha", "set",
    "-colorspace", "sRGB",
    "-depth", "8",
    candidate,
  ], { signal, temporaryDirectory });
  const rasterizationMs = performance.now() - rasterStartedAt;

  const measurementStartedAt = performance.now();
  const ssim = 1 - await measureAssociatedAlphaDistortion(
    reference,
    candidate,
    "SSIM",
    temporaryDirectory,
    signal,
  );
  const mae = await measureAssociatedAlphaDistortion(
    reference,
    candidate,
    "MAE",
    temporaryDirectory,
    signal,
  );
  const edgeMae = await measureEdges(reference, candidate, temporaryDirectory, signal);

  return {
    ssim: Math.max(0, Math.min(1, ssim)),
    mae,
    edgeMae,
    rasterizationMs,
    measurementMs: performance.now() - measurementStartedAt,
  };
}

export function passesVectorQuality(quality: VectorQuality) {
  return quality.ssim >= SVG_AUTO_QUALITY_GATE.minimumSsim
    && quality.mae <= SVG_AUTO_QUALITY_GATE.maximumMae
    && quality.edgeMae <= SVG_AUTO_QUALITY_GATE.maximumEdgeMae;
}
