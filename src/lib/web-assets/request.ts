import {
  MAX_BATCH_BYTES,
  MAX_BATCH_FILES,
  MAX_IMAGE_BYTES,
} from "@/lib/image/batch";
import { safeSourceName } from "@/lib/web-assets/filename";
import type { WebAssetSource } from "@/lib/web-assets/generate";

export const WEB_ASSET_MULTIPART_LIMIT = MAX_BATCH_BYTES + 2 * 1024 * 1024;

export type ParsedWebAssetSources =
  | { ok: true; sources: WebAssetSource[] }
  | { ok: false; error: "Invalid request" | "File is too large"; status: 400 | 413 };

export async function parseWebAssetSources(formData: FormData): Promise<ParsedWebAssetSources> {
  const entries = formData.getAll("images");
  if (entries.length < 1 || entries.length > MAX_BATCH_FILES || entries.some((entry) => !(entry instanceof File))) {
    return { ok: false, error: "Invalid request", status: 400 };
  }
  const files = entries as File[];
  if (files.some((file) => file.size < 1 || file.size > MAX_IMAGE_BYTES)) {
    return { ok: false, error: "File is too large", status: 413 };
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES) {
    return { ok: false, error: "File is too large", status: 413 };
  }
  return {
    ok: true,
    sources: await Promise.all(files.map(async (file) => ({
      name: safeSourceName(file.name),
      mime: file.type || null,
      data: Buffer.from(await file.arrayBuffer()),
    }))),
  };
}
