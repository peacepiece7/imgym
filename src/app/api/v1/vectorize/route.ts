import { requireApiAccess } from "@/lib/api/access";
import { jobBusyResponse, tryAcquireJobPermit } from "@/lib/api/job-gate";
import { parseBoundedMultipartFormData } from "@/lib/api/multipart";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { analyzeSvg } from "@/lib/vector/analyze-svg";
import { autoOptimizeVector } from "@/lib/vector/auto-optimize";
import { resolveVectorCleanup } from "@/lib/vector/cleanup-presets";
import { parseVectorCleanupOptions } from "@/lib/vector/cleanup-types";
import { toSvgFilename } from "@/lib/vector/filename";
import { isVectorizeMode } from "@/lib/vector/presets";
import { preprocessRasterForVector } from "@/lib/vector/preprocess-raster";
import { optimizeSvg } from "@/lib/vector/svgo";
import { SVG_AUTO_QUALITY_GATE } from "@/lib/vector/similarity";
import type {
  ApiError,
  OptimizeSvgResult,
  SvgStats,
  VectorizeApiResult,
  VectorizeResult,
} from "@/lib/vector/types";
import { IMAGE_LIMITS, validateImage } from "@/lib/vector/validate-image";
import { vectorizeImage, vectorizeWithOptions } from "@/lib/vector/vtracer";

export const runtime = "nodejs";

function responseHeaders(requestId: string) {
  return {
    "Cache-Control": "no-store",
    "X-Request-Id": requestId,
  };
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();

  const accessFailure = requireApiAccess(request, requestId);
  if (accessFailure) return accessFailure;

  const releasePermit = tryAcquireJobPermit();
  if (!releasePermit) return jobBusyResponse(requestId);

  try {
    const formResult = await parseBoundedMultipartFormData(request, {
      maxBytes: IMAGE_LIMITS.maxBytes + 1024 * 1024,
      allowedFields: ["image", "preset", "cleanup"],
      singleFields: ["image", "preset", "cleanup"],
    });
    if (!formResult.ok) {
      return Response.json(
        { error: formResult.error } satisfies ApiError,
        { status: formResult.status, headers: responseHeaders(requestId) },
      );
    }
    const formData = formResult.formData;
    const file = formData.get("image");
    const mode = formData.get("preset");
    const cleanupField = formData.get("cleanup");
    const cleanup = cleanupField === null ? undefined : parseVectorCleanupOptions(cleanupField);

    if (
      !(file instanceof File)
      || !isVectorizeMode(mode)
      || (cleanupField !== null && !cleanup)
      || (mode === "auto" && cleanup !== undefined)
    ) {
      return Response.json(
        { error: "Unsupported image" } satisfies ApiError,
        { status: 400, headers: responseHeaders(requestId) },
      );
    }

    if (file.size > IMAGE_LIMITS.maxBytes) {
      return Response.json(
        { error: "File is too large" } satisfies ApiError,
        { status: 413, headers: responseHeaders(requestId) },
      );
    }

    const image = Buffer.from(await file.arrayBuffer());
    const validation = validateImage(image);
    if (!validation.ok) {
      return Response.json(
        { error: validation.error } satisfies ApiError,
        { status: validation.status, headers: responseHeaders(requestId) },
      );
    }

    let automatic: Awaited<ReturnType<typeof autoOptimizeVector>> | null = null;
    let vectorized: VectorizeResult;
    let optimized: OptimizeSvgResult;
    let stats: SvgStats;
    let preprocessingMs = 0;
    let preprocessedColors: number | undefined;
    if (mode === "auto") {
      automatic = await autoOptimizeVector(image, validation, request.signal);
      vectorized = automatic.vectorized;
      optimized = automatic.optimized;
      stats = automatic.stats;
    } else {
      request.signal.throwIfAborted();
      if (cleanup) {
        const resolved = resolveVectorCleanup(mode, cleanup);
        const preprocessed = await preprocessRasterForVector(image, validation, resolved, request.signal);
        preprocessingMs = preprocessed.durationMs;
        preprocessedColors = preprocessed.colors;
        vectorized = vectorizeWithOptions(preprocessed.image, resolved.vtracer);
      } else {
        vectorized = vectorizeImage(image, { preset: mode });
      }
      await yieldToEventLoop();
      request.signal.throwIfAborted();
      optimized = optimizeSvg(vectorized.svg);
      await yieldToEventLoop();
      request.signal.throwIfAborted();
      stats = analyzeSvg(optimized.svg);
      await yieldToEventLoop();
      request.signal.throwIfAborted();
    }
    const optimizationPercent = optimized.beforeBytes === 0
      ? 0
      : ((optimized.beforeBytes - optimized.afterBytes) / optimized.beforeBytes) * 100;

    return Response.json(
      {
        svg: optimized.svg,
        downloadName: toSvgFilename(file.name),
        input: {
          format: validation.format,
          width: validation.width,
          height: validation.height,
          bytes: image.byteLength,
        },
        output: {
          rawBytes: optimized.beforeBytes,
          optimizedBytes: optimized.afterBytes,
          optimizationPercent,
        },
        timing: {
          preprocessingMs,
          vectorizationMs: automatic?.timing.vectorizationMs ?? vectorized.durationMs,
          optimizationMs: automatic?.timing.optimizationMs ?? optimized.durationMs,
          rasterizationMs: automatic?.timing.rasterizationMs ?? 0,
          measurementMs: automatic?.timing.measurementMs ?? 0,
        },
        ...(preprocessedColors === undefined ? {} : { cleanup: { colors: preprocessedColors } }),
        selection: automatic ? {
          mode,
          candidate: automatic.label,
          candidates: automatic.candidates,
          evaluationWidth: automatic.evaluation.width,
          evaluationHeight: automatic.evaluation.height,
          qualityGate: SVG_AUTO_QUALITY_GATE.version,
          minimumSsim: SVG_AUTO_QUALITY_GATE.minimumSsim,
          maximumMae: SVG_AUTO_QUALITY_GATE.maximumMae,
          maximumEdgeMae: SVG_AUTO_QUALITY_GATE.maximumEdgeMae,
          ssim: automatic.quality.ssim,
          mae: automatic.quality.mae,
          edgeMae: automatic.quality.edgeMae,
        } : {
          mode,
          candidate: mode,
          candidates: 1,
        },
        stats,
      } satisfies VectorizeApiResult,
      { headers: responseHeaders(requestId) },
    );
  } catch (error) {
    console.error("[vectorize]", {
      requestId,
      elapsedMs: Math.round(performance.now() - startedAt),
      error,
    });
    return Response.json(
      { error: "Conversion failed.", requestId } satisfies ApiError,
      { status: 500, headers: responseHeaders(requestId) },
    );
  } finally {
    releasePermit();
  }
}
