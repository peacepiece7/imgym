import { requireApiAccess } from "@/lib/api/access";
import { jobBusyResponse, tryAcquireJobPermit } from "@/lib/api/job-gate";
import { parseBoundedMultipartFormData } from "@/lib/api/multipart";
import { inspectRasterAsset } from "@/lib/web-assets/inspect";
import {
  parseWebAssetSources,
  WEB_ASSET_MULTIPART_LIMIT,
} from "@/lib/web-assets/request";
import type { AssetInspectionItem } from "@/lib/web-assets/types";

export const runtime = "nodejs";

function responseHeaders(requestId: string) {
  return { "Cache-Control": "no-store", "X-Request-Id": requestId };
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const accessFailure = requireApiAccess(request, requestId);
  if (accessFailure) return accessFailure;
  const releasePermit = tryAcquireJobPermit();
  if (!releasePermit) return jobBusyResponse(requestId);

  try {
    const formResult = await parseBoundedMultipartFormData(request, {
      maxBytes: WEB_ASSET_MULTIPART_LIMIT,
      allowedFields: ["images"],
    });
    if (!formResult.ok) {
      return Response.json(
        { error: formResult.error },
        { status: formResult.status, headers: responseHeaders(requestId) },
      );
    }
    const parsed = await parseWebAssetSources(formResult.formData);
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.error },
        { status: parsed.status, headers: responseHeaders(requestId) },
      );
    }

    const items: AssetInspectionItem[] = [];
    for (const [index, source] of parsed.sources.entries()) {
      try {
        items.push({
          index,
          status: "ready",
          facts: await inspectRasterAsset(source.data, source.name, source.mime, request.signal),
        });
      } catch (error) {
        if (request.signal.aborted) request.signal.throwIfAborted();
        const message = error instanceof Error ? error.message : "Unsupported image";
        items.push({
          index,
          status: "failed",
          sourceName: source.name,
          error: ["Unsupported image", "File is too large", "Animated images are not supported"].includes(message)
            ? message
            : "Image processing failed.",
        });
      }
    }
    return Response.json({ items }, { headers: responseHeaders(requestId) });
  } catch (error) {
    console.error("[inspect-assets]", { requestId, error });
    return Response.json(
      { error: "Image processing failed.", requestId },
      { status: 500, headers: responseHeaders(requestId) },
    );
  } finally {
    releasePermit();
  }
}
