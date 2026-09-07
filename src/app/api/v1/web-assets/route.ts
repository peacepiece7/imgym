import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireApiAccess } from "@/lib/api/access";
import { jobBusyResponse, tryAcquireJobPermit } from "@/lib/api/job-gate";
import { parseBoundedMultipartFormData } from "@/lib/api/multipart";
import { generateWebAssetPack } from "@/lib/web-assets/generate";
import { parseWebAssetOptions } from "@/lib/web-assets/options";
import {
  parseWebAssetSources,
  WEB_ASSET_MULTIPART_LIMIT,
} from "@/lib/web-assets/request";
import { createZipStream } from "@/lib/web-assets/zip";

export const runtime = "nodejs";

function responseHeaders(requestId: string) {
  return { "Cache-Control": "no-store", "X-Request-Id": requestId };
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  const accessFailure = requireApiAccess(request, requestId);
  if (accessFailure) return accessFailure;
  const releasePermit = tryAcquireJobPermit();
  if (!releasePermit) return jobBusyResponse(requestId);

  let temporaryDirectory = "";
  let streamOwnsCleanup = false;
  const cleanup = async () => {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    releasePermit();
  };

  try {
    const formResult = await parseBoundedMultipartFormData(request, {
      maxBytes: WEB_ASSET_MULTIPART_LIMIT,
      allowedFields: ["images", "options"],
      singleFields: ["options"],
    });
    if (!formResult.ok) {
      return Response.json(
        { error: formResult.error },
        { status: formResult.status, headers: responseHeaders(requestId) },
      );
    }
    const options = parseWebAssetOptions(formResult.formData.get("options"));
    const parsed = await parseWebAssetSources(formResult.formData);
    if (!options || !parsed.ok) {
      const error = parsed.ok ? "Invalid request" : parsed.error;
      const status = parsed.ok ? 400 : parsed.status;
      return Response.json({ error }, { status, headers: responseHeaders(requestId) });
    }

    temporaryDirectory = await mkdtemp(join(tmpdir(), "ohmyimg-web-assets-"));
    const pack = await generateWebAssetPack(parsed.sources, options, temporaryDirectory, request.signal);
    const archive = await createZipStream(pack.entries, cleanup);
    streamOwnsCleanup = true;
    const headers = new Headers({
      ...responseHeaders(requestId),
      "Content-Disposition": 'attachment; filename="web-assets.zip"',
      "Content-Length": String(archive.contentLength),
      "Content-Type": "application/zip",
      "X-Asset-Succeeded": String(pack.manifest.summary.succeeded),
      "X-Asset-Failed": String(pack.manifest.summary.failed),
      "X-Output-Files": String(pack.manifest.summary.outputFiles),
      "X-Output-Bytes": String(pack.manifest.summary.outputBytes),
      "X-Processing-Ms": (performance.now() - startedAt).toFixed(1),
    });
    return new Response(archive.stream, { status: 200, headers });
  } catch (error) {
    console.error("[web-assets]", {
      requestId,
      elapsedMs: Math.round(performance.now() - startedAt),
      error,
    });
    return Response.json(
      { error: "Image processing failed.", requestId },
      { status: 500, headers: responseHeaders(requestId) },
    );
  } finally {
    if (!streamOwnsCleanup) await cleanup();
  }
}
