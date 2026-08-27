import { basename, extname } from "node:path";
import {
  parseBoundedMultipartFormData,
  type BoundedMultipartResult,
} from "@/lib/api/multipart";
import {
  DEFAULT_DOCUMENT_PDF_OPTIONS,
  DOCUMENT_LANGUAGES,
  DOCUMENT_ORIENTATIONS,
  DOCUMENT_PAGE_SIZES,
  DOCUMENT_PDF_LIMITS,
  DOCUMENT_TEMPLATES,
  type DocumentPdfOptions,
  type DocumentSource,
} from "./types";

const ALLOWED_OPTION_KEYS = new Set([
  "title",
  "lang",
  "pageSize",
  "orientation",
  "template",
  "includePageNumbers",
]);
const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export interface InvalidDocumentInput {
  ok: false;
  error: "Invalid request" | "File is too large" | "Unsupported document";
  status: 400 | 413;
}

export interface ValidDocumentInput {
  ok: true;
  source: DocumentSource;
}

export type DocumentInputResult = InvalidDocumentInput | ValidDocumentInput;

export type DocumentFormDataResult = BoundedMultipartResult;

export async function parseBoundedDocumentFormData(request: Request): Promise<DocumentFormDataResult> {
  return parseBoundedMultipartFormData(request, {
    maxBytes: DOCUMENT_PDF_LIMITS.maxRequestBytes,
    allowedFields: ["document", "markdown", "options"],
    singleFields: ["document", "markdown", "options"],
  });
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function normalizedTitle(value: unknown) {
  if (typeof value !== "string") return null;
  const title = value.replace(/\s+/g, " ").trim();
  return title.length >= 1 && title.length <= 200 ? title : null;
}

export function parseDocumentPdfOptions(value: FormDataEntryValue | null): DocumentPdfOptions | null {
  if (value === null) return { ...DEFAULT_DOCUMENT_PDF_OPTIONS };
  if (typeof value !== "string") return null;

  let candidate: unknown;
  try {
    candidate = JSON.parse(value);
  } catch {
    return null;
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;

  const raw = candidate as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !ALLOWED_OPTION_KEYS.has(key))) return null;

  const title = raw.title === undefined
    ? DEFAULT_DOCUMENT_PDF_OPTIONS.title
    : normalizedTitle(raw.title);
  const lang = raw.lang ?? DEFAULT_DOCUMENT_PDF_OPTIONS.lang;
  const pageSize = raw.pageSize ?? DEFAULT_DOCUMENT_PDF_OPTIONS.pageSize;
  const orientation = raw.orientation ?? DEFAULT_DOCUMENT_PDF_OPTIONS.orientation;
  const template = raw.template ?? DEFAULT_DOCUMENT_PDF_OPTIONS.template;
  const includePageNumbers = raw.includePageNumbers ?? DEFAULT_DOCUMENT_PDF_OPTIONS.includePageNumbers;

  if (
    title === null
    || !isOneOf(lang, DOCUMENT_LANGUAGES)
    || !isOneOf(pageSize, DOCUMENT_PAGE_SIZES)
    || !isOneOf(orientation, DOCUMENT_ORIENTATIONS)
    || !isOneOf(template, DOCUMENT_TEMPLATES)
    || typeof includePageNumbers !== "boolean"
  ) {
    return null;
  }

  return { title, lang, pageSize, orientation, template, includePageNumbers };
}

function validMarkdown(markdown: string, bytes: number) {
  return bytes > 0
    && bytes <= DOCUMENT_PDF_LIMITS.maxMarkdownBytes
    && markdown.trim().length > 0
    && !markdown.includes("\0");
}

function normalizeMarkdown(markdown: string) {
  return markdown.normalize("NFC");
}

export async function parseDocumentSource(formData: FormData): Promise<DocumentInputResult> {
  const markdownEntries = formData.getAll("markdown");
  const fileEntries = formData.getAll("document");
  if (markdownEntries.length + fileEntries.length !== 1) {
    return { ok: false, error: "Invalid request", status: 400 };
  }

  const markdownEntry = markdownEntries[0];
  const fileEntry = fileEntries[0];
  const hasMarkdown = markdownEntries.length === 1 && typeof markdownEntry === "string";
  const hasFile = fileEntries.length === 1 && fileEntry instanceof File;

  if (!hasMarkdown && !hasFile) {
    return { ok: false, error: "Invalid request", status: 400 };
  }

  if (hasMarkdown) {
    const bytes = Buffer.byteLength(markdownEntry, "utf8");
    if (bytes > DOCUMENT_PDF_LIMITS.maxMarkdownBytes) {
      return { ok: false, error: "File is too large", status: 413 };
    }
    if (!validMarkdown(markdownEntry, bytes)) {
      return { ok: false, error: "Unsupported document", status: 400 };
    }
    const normalized = normalizeMarkdown(markdownEntry);
    return {
      ok: true,
      source: { markdown: normalized, bytes: Buffer.byteLength(normalized, "utf8"), name: "document.md" },
    };
  }

  const file = fileEntry as File;
  if (file.size > DOCUMENT_PDF_LIMITS.maxMarkdownBytes) {
    return { ok: false, error: "File is too large", status: 413 };
  }
  const safeName = basename(file.name || "document.md");
  if (!SUPPORTED_EXTENSIONS.has(extname(safeName).toLowerCase())) {
    return { ok: false, error: "Unsupported document", status: 400 };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let markdown: string;
  try {
    markdown = UTF8_DECODER.decode(bytes);
  } catch {
    return { ok: false, error: "Unsupported document", status: 400 };
  }
  if (!validMarkdown(markdown, bytes.byteLength)) {
    return { ok: false, error: "Unsupported document", status: 400 };
  }

  const normalized = normalizeMarkdown(markdown);
  return {
    ok: true,
    source: { markdown: normalized, bytes: Buffer.byteLength(normalized, "utf8"), name: safeName },
  };
}
