import { basename, extname } from "node:path";

function slug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function toDocumentPdfFilename(sourceName: string, title: string) {
  const safeSourceName = basename(sourceName);
  const sourceStem = safeSourceName.slice(0, safeSourceName.length - extname(safeSourceName).length);
  const stem = slug(title) || slug(sourceStem) || "document";
  return `${stem}.pdf`;
}
