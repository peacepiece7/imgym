import { imageDimensionsFromData } from "image-dimensions";
import { stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  measureAlphaMae,
  measureAssociatedAlphaDistortion,
  measureEdgeMae,
} from "@/lib/image/image-magick-metric";
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
  RasterOptimizationPolicy,
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
  version: "imagemagick-raster-v3",
  minimumSsim: 0.99,
  maximumMae: 0.02,
  maximumEdgeMae: 0.08,
  maximumAlphaMae: 0.005,
} as const;

interface RasterQuality {
  ssim: number;
  mae: number;
  edgeMae: number;
  alphaMae: number;
}

function passesRasterQuality(quality: RasterQuality) {
  return quality.ssim >= AUTO_QUALITY_GATE.minimumSsim
    && quality.mae <= AUTO_QUALITY_GATE.maximumMae
    && quality.edgeMae <= AUTO_QUALITY_GATE.maximumEdgeMae
    && quality.alphaMae <= AUTO_QUALITY_GATE.maximumAlphaMae;
}

async function measureRasterQuality(
  reference: string,
  candidate: string,
  temporaryDirectory: string,
  signal?: AbortSignal,
): Promise<RasterQuality> {
  const ssim = 1 - await measureAssociatedAlphaDistortion(
    reference, candidate, "SSIM", temporaryDirectory, signal,
  );
  const mae = await measureAssociatedAlphaDistortion(
    reference, candidate, "MAE", temporaryDirectory, signal,
  );
  const edgeMae = await measureEdgeMae(reference, candidate, temporaryDirectory, signal);
  const alphaMae = await measureAlphaMae(reference, candidate, temporaryDirectory, signal);
  return { ssim, mae, edgeMae, alphaMae };
}

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
  lossless?: boolean;
}

async function autoCandidateBytes(path: string) {
  const file = await stat(path);
  if (!file.isFile() || file.size > AUTO_OUTPUT_LIMIT_BYTES) {
    throw new Error("ImageMagick output exceeded the limit");
  }
  return file.size;
}

export function autoCandidates(
  format: RasterFormat,
  policy: RasterOptimizationPolicy = "standard",
): AutoCandidate[] {
  if (format === "png") {
    const standard = [3, 6, 7, 9].map((level) => ({
      label: `PNG compression ${level}`,
      args: ["-define", `png:compression-level=${level}`],
      lossless: true,
    }));
    if (policy === "standard") return standard;
    return [
      ...standard,
      {
        label: "PNG lossless strategy 1",
        args: [
          "-define", "png:compression-level=9",
          "-define", "png:compression-strategy=1",
          "-define", "png:compression-filter=5",
        ],
        lossless: true,
      },
      {
        label: "PNG lossless strategy 2",
        args: [
          "-define", "png:compression-level=9",
          "-define", "png:compression-strategy=2",
          "-define", "png:compression-filter=5",
        ],
        lossless: true,
      },
      ...[256, 128, 64, 32].map((colors) => ({
        label: `PNG palette ${colors}`,
        args: [
          "-colorspace", "sRGB",
          "-dither", "None",
          "-colors", String(colors),
          "-define", "png:compression-level=9",
        ],
      })),
    ];
  }
  if (format === "jpeg") {
    const standard = [92, 90, 88, 86, 82, 78, 72].map((quality) => ({
      label: `JPEG quality ${quality}`,
      args: ["-quality", String(quality), "-sampling-factor", quality >= 88 ? "4:4:4" : "4:2:0"],
    }));
    if (policy === "standard") return standard;
    return [
      ...standard,
      ...[70, 66, 62].map((quality) => ({
        label: `JPEG quality ${quality} optimized`,
        args: [
          "-quality", String(quality),
          "-sampling-factor", "4:2:0",
          "-define", "jpeg:optimize-coding=true",
        ],
      })),
      ...[82, 70].map((quality) => ({
        label: `JPEG quality ${quality} progressive`,
        args: [
          "-quality", String(quality),
          "-sampling-factor", "4:2:0",
          "-define", "jpeg:optimize-coding=true",
          "-interlace", "Plane",
        ],
      })),
    ];
  }
  const standard = [90, 88, 86, 82, 78, 74, 70].map((quality) => ({
    label: `WebP quality ${quality}`,
    args: [
      "-quality", String(quality),
      "-define", `webp:method=${quality >= 88 ? 4 : quality >= 82 ? 5 : 6}`,
      "-define", "webp:alpha-quality=100",
    ],
  }));
  if (policy === "standard") return standard;
  return [
    ...standard,
    ...[68, 64, 60].map((quality) => ({
      label: `WebP quality ${quality} sharp`,
      args: [
        "-quality", String(quality),
        "-define", "webp:method=6",
        "-define", "webp:alpha-quality=100",
        "-define", "webp:use-sharp-yuv=true",
      ],
    })),
    {
      label: "WebP quality 74 filtered",
      args: [
        "-quality", "74",
        "-define", "webp:method=6",
        "-define", "webp:alpha-quality=100",
        "-define", "webp:auto-filter=true",
      ],
    },
    {
      label: "WebP quality 68 sharp filtered",
      args: [
        "-quality", "68",
        "-define", "webp:method=6",
        "-define", "webp:alpha-quality=100",
        "-define", "webp:use-sharp-yuv=true",
        "-define", "webp:auto-filter=true",
      ],
    },
  ];
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

    const candidates = autoCandidates(format, options.optimization?.policy ?? "standard");
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
          let quality: RasterQuality = { ssim: 1, mae, edgeMae: 0, alphaMae: 0 };
          if (encodedCandidate.candidate.lossless) {
            if (mae !== 0) continue;
          } else {
            quality = await measureRasterQuality(
              `miff:${reference}`, `png:${encodedCandidate.filename}`,
              temporaryDirectory,
              searchSignal,
            );
            if (!passesRasterQuality(quality)) continue;
          }
          const image = await readMagickOutputFile(join(temporaryDirectory, encodedCandidate.filename));
          inspectOutput(image, format);
          searchSignal.throwIfAborted();
          return {
            candidate: encodedCandidate.candidate,
            image,
            ...quality,
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
      quality: RasterQuality;
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
        const quality = await measureRasterQuality(
          `miff:${reference}`, coderCandidate, temporaryDirectory, searchSignal,
        );
        if (!passesRasterQuality(quality)) continue;
        const encoded = await readMagickOutputFile(candidatePath);
        inspectOutput(encoded, format);
        selected = { candidate, image: encoded, quality };
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
    return { candidate: selected.candidate, image: selected.image, ...selected.quality, candidates: candidates.length };
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
  const policy = options.optimization?.policy ?? "standard";
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
        policy,
        preset: selected.candidate.label,
        candidates: selected.candidates,
        ssim: selected.ssim,
        mae: selected.mae,
        edgeMae: selected.edgeMae,
        alphaMae: selected.alphaMae,
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
      policy: "standard",
      preset: options.mode,
      candidates: 1,
    },
  };
}
