import { requireApiAccess } from "@/lib/api/access";
import { jobBusyResponse, tryAcquireJobPermit } from "@/lib/api/job-gate";
import { parseBoundedMultipartFormData } from "@/lib/api/multipart";
import { DIRECT_SVG_MAX_BYTES, optimizeDirectSvg } from "@/lib/vector/direct-svg";
import type { ApiError } from "@/lib/vector/types";

export const runtime = "nodejs";

function headers(requestId: string) {
  return { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId };
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const accessFailure = requireApiAccess(request, requestId);
  if (accessFailure) return accessFailure;
  const releasePermit = tryAcquireJobPermit();
  if (!releasePermit) return jobBusyResponse(requestId);

  try {
    const parsed = await parseBoundedMultipartFormData(request, {
      maxBytes: DIRECT_SVG_MAX_BYTES + 64 * 1024,
      allowedFields: ["image", "precision"],
      singleFields: ["image", "precision"],
    });
    if (!parsed.ok) {
      return Response.json({ error: parsed.error } satisfies ApiError, {
        status: parsed.status,
        headers: headers(requestId),
      });
    }
    const file = parsed.formData.get("image");
    const precisionValue = parsed.formData.get("precision") ?? "3";
    const precision = typeof precisionValue === "string" ? Number(precisionValue) : Number.NaN;
    if (!(file instanceof File) || file.size < 1 || ![2, 3, 4].includes(precision)) {
      return Response.json({ error: "Unsupported SVG" } satisfies ApiError, {
        status: 400,
        headers: headers(requestId),
      });
    }
    if (file.size > DIRECT_SVG_MAX_BYTES) {
      return Response.json({ error: "File is too large" } satisfies ApiError, {
        status: 413,
        headers: headers(requestId),
      });
    }
    try {
      return Response.json(optimizeDirectSvg(await file.text(), file.name, precision), {
        headers: headers(requestId),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unsupported SVG";
      const known = ["Unsupported SVG", "SVG is too complex", "Unsafe SVG output"].includes(message);
      return Response.json({ error: known ? message : "Unsupported SVG" } satisfies ApiError, {
        status: known && message === "SVG is too complex" ? 422 : 400,
        headers: headers(requestId),
      });
    }
  } finally {
    releasePermit();
  }
}
