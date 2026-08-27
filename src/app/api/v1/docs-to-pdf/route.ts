import { requireApiAccess } from "@/lib/api/access";
import { jobBusyResponse, tryAcquireJobPermit } from "@/lib/api/job-gate";
import { toDocumentPdfFilename } from "@/lib/document/filename";
import { buildDocumentHtml } from "@/lib/document/html";
import {
  parseBoundedDocumentFormData,
  parseDocumentPdfOptions,
  parseDocumentSource,
} from "@/lib/document/input";
import { renderDocumentPdf } from "@/lib/document/renderer";

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
  let logContext: Record<string, unknown> = {};

  const accessFailure = requireApiAccess(request, requestId);
  if (accessFailure) return accessFailure;

  const releasePermit = tryAcquireJobPermit();
  if (!releasePermit) return jobBusyResponse(requestId);

  try {
    const formResult = await parseBoundedDocumentFormData(request);
    if (!formResult.ok) {
      return Response.json(
        { error: formResult.error },
        { status: formResult.status, headers: responseHeaders(requestId) },
      );
    }

    const formData = formResult.formData;
    const options = parseDocumentPdfOptions(formData.get("options"));
    const input = await parseDocumentSource(formData);
    if (!options || !input.ok) {
      const error = input.ok ? "Invalid request" : input.error;
      const status = input.ok ? 400 : input.status;
      return Response.json({ error }, { status, headers: responseHeaders(requestId) });
    }

    logContext = {
      inputBytes: input.source.bytes,
      template: options.template,
      pageSize: options.pageSize,
      orientation: options.orientation,
    };

    const html = buildDocumentHtml(input.source.markdown, options);
    const result = await renderDocumentPdf(html, request.signal);
    const downloadName = toDocumentPdfFilename(input.source.name, options.title);
    const headers = new Headers({
      ...responseHeaders(requestId),
      "Content-Disposition": `attachment; filename="${downloadName}"`,
      "Content-Language": options.lang,
      "Content-Type": "application/pdf",
      "X-Input-Bytes": String(input.source.bytes),
      "X-Input-Characters": String(input.source.markdown.length),
      "X-Output-Bytes": String(result.pdf.byteLength),
      "X-Output-Pages": String(result.pages),
      "X-Processing-Ms": (performance.now() - startedAt).toFixed(1),
      "X-Rendering-Ms": result.durationMs.toFixed(1),
      "X-PDF-Renderer": result.renderer,
      "X-PDF-Variant": result.variant,
    });

    return new Response(new Uint8Array(result.pdf), { status: 200, headers });
  } catch (error) {
    console.error("[docs-to-pdf]", {
      requestId,
      elapsedMs: Math.round(performance.now() - startedAt),
      ...logContext,
      error,
    });
    return Response.json(
      { error: "Document conversion failed.", requestId },
      { status: 500, headers: responseHeaders(requestId) },
    );
  } finally {
    releasePermit();
  }
}
