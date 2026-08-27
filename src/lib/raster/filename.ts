import type { RasterFormat } from "@/lib/raster/types";

const EXTENSION: Record<RasterFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};

export function toOptimizedFilename(filename: string, format: RasterFormat) {
  const stem = filename
    .replace(/\.[^.]*$/, "")
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80) || "image";
  return `${stem}-optimized.${EXTENSION[format]}`;
}

