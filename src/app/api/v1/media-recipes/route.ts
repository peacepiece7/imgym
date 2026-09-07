import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireApiAccess } from "@/lib/api/access";
import { jobBusyResponse, tryAcquireJobPermit } from "@/lib/api/job-gate";
import { parseBoundedMultipartFormData } from "@/lib/api/multipart";
import { generateMediaRecipe, MEDIA_RECIPE_MULTIPART_LIMIT, parseMediaRecipeOptions, parseMediaSource } from "@/lib/asset-recipes/media";
import { createZipStream } from "@/lib/web-assets/zip";

export const runtime = "nodejs";
const headers = (requestId: string) => ({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId });

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const accessFailure = requireApiAccess(request, requestId);
  if (accessFailure) return accessFailure;
  const releasePermit = tryAcquireJobPermit();
  if (!releasePermit) return jobBusyResponse(requestId);
  let directory = "";
  let streamOwnsCleanup = false;
  const cleanup = async () => { if (directory) await rm(directory, { recursive: true, force: true }); releasePermit(); };
  try {
    const parsed = await parseBoundedMultipartFormData(request, { maxBytes: MEDIA_RECIPE_MULTIPART_LIMIT, allowedFields: ["asset", "options"], singleFields: ["asset", "options"] });
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status, headers: headers(requestId) });
    const options = parseMediaRecipeOptions(parsed.formData.get("options"));
    const source = await parseMediaSource(parsed.formData);
    if (!options || !source.ok) return Response.json({ error: source.ok ? "Invalid request" : source.error }, { status: source.ok ? 400 : source.status, headers: headers(requestId) });
    directory = await mkdtemp(join(tmpdir(), "ohmyimg-media-recipe-"));
    const result = await generateMediaRecipe(source.source, options, directory, request.signal);
    const archive = await createZipStream(result.entries, cleanup);
    streamOwnsCleanup = true;
    return new Response(archive.stream, { headers: { ...headers(requestId), "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${options.recipe}-recipe.zip"`, "Content-Length": String(archive.contentLength), "X-Output-Files": String(result.manifest.outputs.length) } });
  } catch (error) {
    console.error("[media-recipes]", { requestId, error });
    const message = error instanceof Error ? error.message : "Media processing failed";
    const known = ["Unsupported GIF", "Unsupported font", "File is too large"].includes(message);
    return Response.json({ error: known ? message : "Media processing failed", requestId }, { status: message === "File is too large" ? 413 : known ? 422 : 500, headers: headers(requestId) });
  } finally {
    if (!streamOwnsCleanup) await cleanup();
  }
}
