import type { WebAssetFormat } from "@/lib/web-assets/types";

const EXTENSION: Record<WebAssetFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
  avif: "avif",
};

export function safeAssetStem(filename: string) {
  return filename
    .replace(/\.[^.]*$/, "")
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 64) || "image";
}

export function safeSourceName(filename: string) {
  const basename = filename.replaceAll("\\", "/").split("/").at(-1) ?? "image";
  return basename
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 180) || "image";
}

export function assetDirectory(filename: string, sha256: string, occurrence = 1) {
  const suffix = occurrence > 1 ? `-${occurrence}` : "";
  return `${safeAssetStem(filename)}-${sha256.slice(0, 8)}${suffix}`;
}

export function webAssetPath(
  directory: string,
  stem: string,
  width: number,
  format: WebAssetFormat,
  scale?: 1 | 2 | 3,
) {
  const descriptor = scale ? `@${scale}x` : `-${width}w`;
  return `assets/${directory}/${stem}${descriptor}.${EXTENSION[format]}`;
}

export function formatExtension(format: WebAssetFormat) {
  return EXTENSION[format];
}
