import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireApiAccess } from "@/lib/api/access";
import { jobBusyResponse, tryAcquireJobPermit } from "@/lib/api/job-gate";
import { parseBoundedMultipartFormData } from "@/lib/api/multipart";
import { generateAssetRecipe } from "@/lib/asset-recipes/generate";
import { parseAssetRecipeOptions } from "@/lib/asset-recipes/options";
import { ASSET_RECIPE_MULTIPART_LIMIT, parseAssetRecipeSource } from "@/lib/asset-recipes/request";
import { createZipStream } from "@/lib/web-assets/zip";

export const runtime = "nodejs";

const responseHeaders = (requestId: string) => ({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId });

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
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
    const parsed = await parseBoundedMultipartFormData(request, {
      maxBytes: ASSET_RECIPE_MULTIPART_LIMIT,
      allowedFields: ["asset", "options"],
      singleFields: ["asset", "options"],
    });
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status, headers: responseHeaders(requestId) });
    const options = parseAssetRecipeOptions(parsed.formData.get("options"));
    const source = await parseAssetRecipeSource(parsed.formData);
    if (!options || !source.ok) return Response.json({ error: source.ok ? "Invalid request" : source.error }, { status: source.ok ? 400 : source.status, headers: responseHeaders(requestId) });
    temporaryDirectory = await mkdtemp(join(tmpdir(), "ohmyimg-asset-recipe-"));
    const result = await generateAssetRecipe(source.source, options, temporaryDirectory, request.signal);
    const archive = await createZipStream(result.entries, cleanup);
    streamOwnsCleanup = true;
    return new Response(archive.stream, {
      headers: {
        ...responseHeaders(requestId),
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${options.recipe}-asset-recipe.zip"`,
        "Content-Length": String(archive.contentLength),
        "X-Output-Files": String(result.manifest.outputs.length),
        "X-Output-Bytes": String(result.manifest.outputs.reduce((sum, output) => sum + output.bytes, 0)),
      },
    });
  } catch (error) {
    console.error("[asset-recipes]", { requestId, error });
    const message = error instanceof Error ? error.message : "Asset processing failed";
    const known = ["Unsupported image", "Unsupported HEIC", "HDR HEIC is not supported", "File is too large", "CICP-only input cannot be safely converted to sRGB"].includes(message);
    return Response.json({ error: known ? message : "Asset processing failed", requestId }, { status: message === "File is too large" ? 413 : known ? 422 : 500, headers: responseHeaders(requestId) });
  } finally {
    if (!streamOwnsCleanup) await cleanup();
  }
}
