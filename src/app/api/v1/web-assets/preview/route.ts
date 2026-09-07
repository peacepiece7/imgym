import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { requireApiAccess } from "@/lib/api/access";
import { jobBusyResponse, tryAcquireJobPermit } from "@/lib/api/job-gate";
import { parseBoundedMultipartFormData } from "@/lib/api/multipart";
import { generateWebAssetPack } from "@/lib/web-assets/generate";
import { parseWebAssetOptions } from "@/lib/web-assets/options";
import {
  parseWebAssetSources,
  WEB_ASSET_MULTIPART_LIMIT,
} from "@/lib/web-assets/request";

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
  let temporaryDirectory = "";

  try {
    const formResult = await parseBoundedMultipartFormData(request, {
      maxBytes: WEB_ASSET_MULTIPART_LIMIT,
      allowedFields: ["images", "options"],
      singleFields: ["images", "options"],
    });
    if (!formResult.ok) {
      return Response.json(
        { error: formResult.error },
        { status: formResult.status, headers: responseHeaders(requestId) },
      );
    }
    const options = parseWebAssetOptions(formResult.formData.get("options"));
    const parsed = await parseWebAssetSources(formResult.formData);
    if (!options || !parsed.ok || parsed.sources.length !== 1) {
      return Response.json(
        { error: parsed.ok ? "Invalid request" : parsed.error },
        { status: parsed.ok ? 400 : parsed.status, headers: responseHeaders(requestId) },
      );
    }
    temporaryDirectory = await mkdtemp(join(tmpdir(), "ohmyimg-web-preview-"));
    const pack = await generateWebAssetPack(parsed.sources, options, temporaryDirectory, request.signal);
    const item = pack.manifest.items[0];
    const output = item.outputs
      ?.filter((candidate) => candidate.purpose !== "modern")
      .sort((left, right) => right.width - left.width)[0]
      ?? item.outputs?.sort((left, right) => right.width - left.width)[0];
    if (!output) {
      return Response.json(
        { error: item.error ?? "Image processing failed.", requestId },
        { status: 422, headers: responseHeaders(requestId) },
      );
    }
    const entry = pack.entries.find((candidate) => candidate.name === output.path);
    if (!entry || !("path" in entry)) throw new Error("Generated preview entry is missing");
    const data = await readFile(entry.path);
    const headers = new Headers({
      ...responseHeaders(requestId),
      "Content-Disposition": `attachment; filename="${basename(output.path)}"`,
      "Content-Type": output.mime,
      "X-Output-Bytes": String(output.bytes),
      "X-Output-Width": String(output.width),
      "X-Output-Height": String(output.height),
      "X-Output-Format": output.format,
      "X-Quality-Gate": output.quality.gate,
      "X-SSIM": output.quality.ssim.toFixed(6),
      "X-MAE": output.quality.mae.toFixed(6),
      "X-Edge-MAE": output.quality.edgeMae.toFixed(6),
      "X-Alpha-MAE": output.quality.alphaMae.toFixed(6),
    });
    return new Response(new Uint8Array(data), { status: 200, headers });
  } catch (error) {
    console.error("[web-assets-preview]", { requestId, error });
    return Response.json(
      { error: "Image processing failed.", requestId },
      { status: 500, headers: responseHeaders(requestId) },
    );
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    releasePermit();
  }
}
