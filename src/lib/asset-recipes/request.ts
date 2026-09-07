import { safeSourceName } from "@/lib/web-assets/filename";
import type { AssetRecipeSource } from "@/lib/asset-recipes/generate";

export const ASSET_RECIPE_FILE_LIMIT = 20 * 1024 * 1024;
export const ASSET_RECIPE_MULTIPART_LIMIT = ASSET_RECIPE_FILE_LIMIT + 256 * 1024;

export async function parseAssetRecipeSource(formData: FormData): Promise<
  | { ok: true; source: AssetRecipeSource }
  | { ok: false; error: "Invalid request" | "File is too large"; status: 400 | 413 }
> {
  const file = formData.get("asset");
  if (!(file instanceof File) || file.size < 1) return { ok: false, error: "Invalid request", status: 400 };
  if (file.size > ASSET_RECIPE_FILE_LIMIT) return { ok: false, error: "File is too large", status: 413 };
  return {
    ok: true,
    source: {
      name: safeSourceName(file.name),
      mime: file.type || null,
      data: Buffer.from(await file.arrayBuffer()),
    },
  };
}
