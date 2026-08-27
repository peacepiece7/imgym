import { imageDimensionsFromData } from "image-dimensions";
import { stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { measureAssociatedAlphaDistortion } from "@/lib/image/image-magick-metric";
import { imageMagickCropGeometry, imageMagickResizeGeometry } from "@/lib/raster/crop";
import {
  MAGICK_LIMIT_ARGS,
  readMagickOutputFile,
  runMagick,
  withMagickTempDirectory,
} from "@/lib/raster/image-magick";
import { encoderArgs } from "@/lib/raster/presets";
import type {
  OptimizeRasterOptions,
  OptimizeRasterResult,
  RasterFormat,
  RasterPreset,
} from "@/lib/raster/types";
import { validateRaster } from "@/lib/raster/validate-raster";

const CODERS: Record<RasterFormat, string> = {
  png: "png",
  jpeg: "jpeg",
  webp: "webp",
};

const AUTO_OUTPUT_LIMIT_BYTES = 32 * 1024 * 1024;
export const RASTER_AUTO_SEARCH_BUDGET_MS = 90_000;

export const AUTO_QUALITY_GATE = {
  version: "imagemagick-v2",
  minimumSsim: 0.99,
  maximumMae: 0.02,
} as const;

export function metadataArgs(format: RasterFormat) {
  const profileArgs = ["+profile", "!icc,*", "+set", "comment"];
  if (format === "png") {
    return [
      ...profileArgs,
      "-define", "png:exclude-chunk=EXIF,iTXt,tEXt,zTXt,date",
    ];
  }
  return profileArgs;
}

function transformArgs(format: RasterFormat, options: OptimizeRasterOptions) {
  const coder = CODERS[format];
  const resize = imageMagickResizeGeometry(options.resize ?? {});
  return [
    ...MAGICK_LIMIT_ARGS,
    `${coder}:-[0]`,
    "-auto-orient",
    "+repage",
    "-crop", imageMagickCropGeometry(options.crop),
    "+repage",
    ...(resize ? ["-resize", resize] : []),
  ];
}

export function manualOptimizeArgs(
  format: RasterFormat,
  options: OptimizeRasterOptions,
  preset: RasterPreset,
) {
  return [
    ...transformArgs(format, options),
    ...metadataArgs(format),
    ...encoderArgs(format, preset),
    `${CODERS[format]}:-`,
  ];
}

function inspectOutput(image: Uint8Array, expectedFormat: RasterFormat) {
  const dimensions = imageDimensionsFromData(new Uint8Array(image));
  if (!dimensions || dimensions.type !== expectedFormat || dimensions.width < 1 || dimensions.height < 1) {
    throw new Error("ImageMagick returned an invalid output image");
  }
  return { width: dimensions.width, height: dimensions.height };
}

interface AutoCandidate {
  label: string;
  args: string[];
}

async function autoCandidateBytes(path: string) {
  const file = await stat(path);
  if (!file.isFile() || file.size > AUTO_OUTPUT_LIMIT_BYTES) {
    throw new Error("ImageMagick output exceeded the limit");
  }
  return file.size;
}

function autoCandidates(format: RasterFormat): AutoCandidate[] {
  if (format === "png") {
    return [3, 6, 7, 9].map((level) => ({
      label: `PNG compression ${level}`,
      args: ["-define", `png:compression-level=${level}`],
    }));
  }
  if (format === "jpeg") {
    return [92, 90, 88, 86, 82, 78, 72].map((quality) => ({
      label: `JPEG quality ${quality}`,
      args: ["-quality", String(quality), "-sampling-factor", quality >= 88 ? "4:4:4" : "4:2:0"],
    }));
  }
  return [90, 88, 86, 82, 78, 74, 70].map((quality) => ({
    label: `WebP quality ${quality}`,
    args: [
      "-quality", String(quality),
      "-define", `webp:method=${quality >= 88 ? 4 : quality >= 82 ? 5 : 6}`,
      "-define", "webp:alpha-quality=100",
    ],
  }));
}

async function autoOptimize(
  image: Buffer,
  format: RasterFormat,
  options: OptimizeRasterOptions,
  signal?: AbortSignal,
) {
  const searchSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(RASTER_AUTO_SEARCH_BUDGET_MS)])
    : AbortSignal.timeout(RASTER_AUTO_SEARCH_BUDGET_MS);
  const result = await withMagickTempDirectory(async (temporaryDirectory) => {
    searchSignal.throwIfAborted();
    const reference = "reference.miff";
    await runMagick([
      ...transformArgs(format, options),
      "-colorspace", "sRGB",
      "-alpha", "set",
      `miff:${reference}`,
    ], { input: image, signal: searchSignal, temporaryDirectory });

    const candidates = autoCandidates(format);
    if (format === "png") {
      const encodedCandidates: Array<{
        candidate: AutoCandidate;
        filename: string;
        index: number;
        bytes: number;
      }> = [];
      for (const [index, candidate] of candidates.entries()) {
        searchSignal.throwIfAborted();
        const filename = `candidate-${index}.png`;
        try {
          await runMagick([
            ...MAGICK_LIMIT_ARGS,
            `miff:${reference}`,
            ...metadataArgs(format),
            ...candidate.args,
            `png:${filename}`,
          ], { signal: searchSignal, temporaryDirectory });
          encodedCandidates.push({
            candidate,
            filename,
            index,
            bytes: await autoCandidateBytes(join(temporaryDirectory, filename)),
          });
        } catch (error) {
          searchSignal.throwIfAborted();
          console.warn("[optimize-raster:candidate]", { candidate: candidate.label, error });
          if (index === 0) throw error;
        }
      }

      const ranked = [...encodedCandidates]
        .sort((left, right) => left.bytes - right.bytes || left.index - right.index);
      for (const encodedCandidate of ranked) {
        searchSignal.throwIfAborted();
        try {
          const mae = await measureAssociatedAlphaDistortion(
            `miff:${reference}`,
            `png:${encodedCandidate.filename}`,
            "MAE",
            temporaryDirectory,
            searchSignal,
          );
          if (mae !== 0) continue;
          const image = await readMagickOutputFile(join(temporaryDirectory, encodedCandidate.filename));
          inspectOutput(image, format);
          searchSignal.throwIfAborted();
          return {
            candidate: encodedCandidate.candidate,
            image,
            ssim: 1,
            mae,
            candidates: candidates.length,
          };
        } catch (error) {
          searchSignal.throwIfAborted();
          console.warn("[optimize-raster:candidate]", {
            candidate: encodedCandidate.candidate.label,
            error,
          });
          if (encodedCandidate.index === 0) throw error;
        }
      }
      searchSignal.throwIfAborted();
      throw new Error("Auto Optimize found no acceptable result");
    }

    let selected: {
      candidate: AutoCandidate;
      image: Buffer;
      ssim: number;
      mae: number;
    } | undefined;
    for (const [index, candidate] of candidates.entries()) {
      searchSignal.throwIfAborted();
      const filename = `candidate-${index}.${format === "jpeg" ? "jpg" : format}`;
      const candidatePath = join(temporaryDirectory, filename);
      try {
        await runMagick([
          ...MAGICK_LIMIT_ARGS,
          `miff:${reference}`,
          ...metadataArgs(format),
          ...candidate.args,
          `${CODERS[format]}:${filename}`,
        ], { signal: searchSignal, temporaryDirectory });
        const bytes = await autoCandidateBytes(candidatePath);
        if (selected && bytes >= selected.image.byteLength) continue;

        const coderCandidate = `${CODERS[format]}:${filename}`;
        const ssim = 1 - await measureAssociatedAlphaDistortion(
          `miff:${reference}`,
          coderCandidate,
          "SSIM",
          temporaryDirectory,
          searchSignal,
        );
        const mae = await measureAssociatedAlphaDistortion(
          `miff:${reference}`,
          coderCandidate,
          "MAE",
          temporaryDirectory,
          searchSignal,
        );
        if (ssim < AUTO_QUALITY_GATE.minimumSsim || mae > AUTO_QUALITY_GATE.maximumMae) continue;
        const encoded = await readMagickOutputFile(candidatePath);
        inspectOutput(encoded, format);
        selected = { candidate, image: encoded, ssim, mae };
      } catch (error) {
        searchSignal.throwIfAborted();
        console.warn("[optimize-raster:candidate]", { candidate: candidate.label, error });
        if (index === 0) throw error;
      } finally {
        await unlink(candidatePath).catch(() => undefined);
      }
    }
    if (!selected) {
      searchSignal.throwIfAborted();
      throw new Error("Auto Optimize found no acceptable result");
    }
    searchSignal.throwIfAborted();
    return { ...selected, candidates: candidates.length };
  });
  searchSignal.throwIfAborted();
  return result;
}

export async function optimizeRaster(
  image: Buffer,
  options: OptimizeRasterOptions,
  signal?: AbortSignal,
): Promise<OptimizeRasterResult> {
  signal?.throwIfAborted();
  const validation = validateRaster(image);
  if (!validation.ok) throw new Error(validation.error);

  const startedAt = performance.now();
  if (options.mode === "auto") {
    const selected = await autoOptimize(image, validation.format, options, signal);
    const dimensions = inspectOutput(selected.image, validation.format);
    return {
      image: selected.image,
      format: validation.format,
      ...dimensions,
      durationMs: performance.now() - startedAt,
      selection: {
        mode: "auto",
        preset: selected.candidate.label,
        candidates: selected.candidates,
        ssim: selected.ssim,
        mae: selected.mae,
      },
    };
  }

  const result = await runMagick(manualOptimizeArgs(validation.format, options, options.mode), {
    input: image,
    signal,
  });
  const dimensions = inspectOutput(result.stdout, validation.format);
  return {
    image: result.stdout,
    format: validation.format,
    ...dimensions,
    durationMs: performance.now() - startedAt,
    selection: {
      mode: options.mode,
      preset: options.mode,
      candidates: 1,
    },
  };
}
