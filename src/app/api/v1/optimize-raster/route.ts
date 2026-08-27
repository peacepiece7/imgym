import { jobBusyResponse, tryAcquireJobPermit } from "@/lib/api/job-gate";
import { requireApiAccess } from "@/lib/api/access";
import { parseBoundedMultipartFormData } from "@/lib/api/multipart";
import { parseNormalizedCrop, parseRasterResize } from "@/lib/raster/crop";
import { toOptimizedFilename } from "@/lib/raster/filename";
import { AUTO_QUALITY_GATE, optimizeRaster } from "@/lib/raster/optimize-raster";
import { isRasterMode, isRasterOptimizationPolicy } from "@/lib/raster/presets";
import type {
  OptimizeRasterOptions,
  RasterFormat,
  RasterOptimizationPolicy,
} from "@/lib/raster/types";
import { RASTER_LIMITS, validateRaster } from "@/lib/raster/validate-raster";

export const runtime = "nodejs";

const MIME: Record<RasterFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function responseHeaders(requestId: string) {
  return {
    "Cache-Control": "no-store",
    "X-Request-Id": requestId,
  };
}

function parseOptions(value: FormDataEntryValue | null): OptimizeRasterOptions | null {
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

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  let logContext: Record<string, unknown> = {};

  const accessFailure = requireApiAccess(request, requestId);
  if (accessFailure) return accessFailure;

  const releasePermit = tryAcquireJobPermit();
  if (!releasePermit) return jobBusyResponse(requestId);

  try {
    const formResult = await parseBoundedMultipartFormData(request, {
      maxBytes: RASTER_LIMITS.maxBytes + 1024 * 1024,
      allowedFields: ["image", "options"],
      singleFields: ["image", "options"],
    });
    if (!formResult.ok) {
      return Response.json(
        { error: formResult.error },
        { status: formResult.status, headers: responseHeaders(requestId) },
      );
    }
    const formData = formResult.formData;
    const file = formData.get("image");
    const options = parseOptions(formData.get("options"));
    if (!(file instanceof File) || !options) {
      return Response.json(
        { error: "Invalid request" },
        { status: 400, headers: responseHeaders(requestId) },
      );
    }
    if (file.size > RASTER_LIMITS.maxBytes) {
      return Response.json(
        { error: "File is too large" },
        { status: 413, headers: responseHeaders(requestId) },
      );
    }

    const image = Buffer.from(await file.arrayBuffer());
    const validation = validateRaster(image);
    if (!validation.ok) {
      return Response.json(
        { error: validation.error },
        { status: validation.status, headers: responseHeaders(requestId) },
      );
    }
    logContext = {
      inputFormat: validation.format,
      inputBytes: image.byteLength,
      mode: options.mode,
      policy: options.optimization?.policy ?? "standard",
    };

    const result = await optimizeRaster(image, options, request.signal);
    const downloadName = toOptimizedFilename(file.name, result.format);
    const headers = new Headers({
      ...responseHeaders(requestId),
      "Content-Disposition": `attachment; filename="${downloadName}"`,
      "Content-Type": MIME[result.format],
      "X-Original-Bytes": String(image.byteLength),
      "X-Output-Bytes": String(result.image.byteLength),
      "X-Output-Width": String(result.width),
      "X-Output-Height": String(result.height),
      "X-Processing-Ms": result.durationMs.toFixed(1),
      "X-Selected-Preset": result.selection.preset,
      "X-Candidate-Count": String(result.selection.candidates),
      "X-Optimization-Policy": result.selection.policy,
    });
    if (result.selection.ssim !== undefined) {
      headers.set("X-Quality-Gate", AUTO_QUALITY_GATE.version);
      headers.set("X-Quality-Min-SSIM", String(AUTO_QUALITY_GATE.minimumSsim));
      headers.set("X-Quality-Max-MAE", String(AUTO_QUALITY_GATE.maximumMae));
      headers.set("X-Quality-Max-Edge-MAE", String(AUTO_QUALITY_GATE.maximumEdgeMae));
      headers.set("X-Quality-Max-Alpha-MAE", String(AUTO_QUALITY_GATE.maximumAlphaMae));
      headers.set("X-SSIM", result.selection.ssim.toFixed(6));
    }
    if (result.selection.mae !== undefined) headers.set("X-MAE", result.selection.mae.toFixed(6));
    if (result.selection.edgeMae !== undefined) headers.set("X-Edge-MAE", result.selection.edgeMae.toFixed(6));
    if (result.selection.alphaMae !== undefined) headers.set("X-Alpha-MAE", result.selection.alphaMae.toFixed(6));

    return new Response(new Uint8Array(result.image), { status: 200, headers });
  } catch (error) {
    console.error("[optimize-raster]", {
      requestId,
      elapsedMs: Math.round(performance.now() - startedAt),
      ...logContext,
      error,
    });
    return Response.json(
      { error: "Image processing failed.", requestId },
      { status: 500, headers: responseHeaders(requestId) },
    );
  } finally {
    releasePermit();
  }
}
