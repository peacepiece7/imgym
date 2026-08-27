export interface BoundedMultipartOptions {
  maxBytes: number;
  allowedFields: readonly string[];
  singleFields?: readonly string[];
}

export type BoundedMultipartResult =
  | { ok: true; formData: FormData }
  | { ok: false; error: "Invalid request" | "File is too large"; status: 400 | 413 };

export async function parseBoundedMultipartFormData(
  request: Request,
  options: BoundedMultipartOptions,
): Promise<BoundedMultipartResult> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !/\bboundary=/i.test(contentType)) {
    return { ok: false, error: "Invalid request", status: 400 };
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) > options.maxBytes) {
    return { ok: false, error: "File is too large", status: 413 };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, error: "Invalid request", status: 400 };

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > options.maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, error: "File is too large", status: 413 };
    }
    chunks.push(value);
  }

  const body = Buffer.concat(chunks, receivedBytes);
  let formData: FormData;
  try {
    formData = await new Response(body, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    return { ok: false, error: "Invalid request", status: 400 };
  }

  const allowedFields = new Set(options.allowedFields);
  if ([...formData.keys()].some((key) => !allowedFields.has(key))) {
    return { ok: false, error: "Invalid request", status: 400 };
  }
  if (options.singleFields?.some((key) => formData.getAll(key).length > 1)) {
    return { ok: false, error: "Invalid request", status: 400 };
  }
  return { ok: true, formData };
}
