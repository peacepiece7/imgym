import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { requireApiAccess } from "@/lib/api/access";
import { jobBusyResponse, tryAcquireJobPermit } from "@/lib/api/job-gate";
import { parseBoundedMultipartFormData } from "@/lib/api/multipart";
import { generateAssetRecipe } from "@/lib/asset-recipes/generate";
import { parseAssetRecipeOptions } from "@/lib/asset-recipes/options";
import { ASSET_RECIPE_MULTIPART_LIMIT, parseAssetRecipeSource } from "@/lib/asset-recipes/request";

export const runtime = "nodejs";
const responseHeaders = (requestId: string) => ({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId });

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const accessFailure = requireApiAccess(request, requestId);
  if (accessFailure) return accessFailure;
  const releasePermit = tryAcquireJobPermit();
  if (!releasePermit) return jobBusyResponse(requestId);
  let temporaryDirectory = "";
  try {
    const parsed = await parseBoundedMultipartFormData(request, { maxBytes: ASSET_RECIPE_MULTIPART_LIMIT, allowedFields: ["asset", "options"], singleFields: ["asset", "options"] });
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status, headers: responseHeaders(requestId) });
    const options = parseAssetRecipeOptions(parsed.formData.get("options"));
    const source = await parseAssetRecipeSource(parsed.formData);
    if (!options || !source.ok) return Response.json({ error: source.ok ? "Invalid request" : source.error }, { status: source.ok ? 400 : source.status, headers: responseHeaders(requestId) });
    temporaryDirectory = await mkdtemp(join(tmpdir(), "ohmyimg-asset-preview-"));
    const result = await generateAssetRecipe(source.source, options, temporaryDirectory, request.signal);
    const output = result.manifest.outputs.find(({ path }) => path === result.previewPath);
    const entry = result.entries.find(({ name }) => name === result.previewPath);
    if (!output || !entry || !("path" in entry) || !output.mime.startsWith("image/")) return Response.json({ error: "Preview is unavailable" }, { status: 422, headers: responseHeaders(requestId) });
    return new Response(new Uint8Array(await readFile(entry.path)), { headers: { ...responseHeaders(requestId), "Content-Type": output.mime, "Content-Disposition": `attachment; filename="${basename(output.path)}"`, "X-Output-Bytes": String(output.bytes), "X-Output-Width": String(output.width ?? 0), "X-Output-Height": String(output.height ?? 0), "X-Output-Role": output.role } });
  } catch (error) {
    console.error("[asset-recipes-preview]", { requestId, error });
    return Response.json({ error: "Asset processing failed", requestId }, { status: 422, headers: responseHeaders(requestId) });
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    releasePermit();
  }
}
