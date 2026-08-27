export const DOCUMENT_PDF_LIMITS = {
  maxMarkdownBytes: 1024 * 1024,
  maxRequestBytes: 2 * 1024 * 1024,
  maxHtmlBytes: 6 * 1024 * 1024,
  maxOutputBytes: 24 * 1024 * 1024,
  maxPages: 100,
  maxStderrBytes: 64 * 1024,
  maxStdoutBytes: 16 * 1024,
  timeoutMs: 45_000,
} as const;

export const DOCUMENT_LANGUAGES = ["ko", "en"] as const;
export const DOCUMENT_PAGE_SIZES = ["a4", "letter"] as const;
export const DOCUMENT_ORIENTATIONS = ["portrait", "landscape"] as const;
export const DOCUMENT_TEMPLATES = ["document", "resume"] as const;

export type DocumentLanguage = (typeof DOCUMENT_LANGUAGES)[number];
export type DocumentPageSize = (typeof DOCUMENT_PAGE_SIZES)[number];
export type DocumentOrientation = (typeof DOCUMENT_ORIENTATIONS)[number];
export type DocumentTemplate = (typeof DOCUMENT_TEMPLATES)[number];

export interface DocumentPdfOptions {
  title: string;
  lang: DocumentLanguage;
  pageSize: DocumentPageSize;
  orientation: DocumentOrientation;
  template: DocumentTemplate;
  includePageNumbers: boolean;
}

export const DEFAULT_DOCUMENT_PDF_OPTIONS: Readonly<DocumentPdfOptions> = {
  title: "Document",
  lang: "ko",
  pageSize: "a4",
  orientation: "portrait",
  template: "document",
  includePageNumbers: true,
};

export interface DocumentSource {
  markdown: string;
  bytes: number;
  name: string;
}

export interface DocumentPdfRenderResult {
  pdf: Buffer;
  pages: number;
  durationMs: number;
  renderer: string;
  variant: string;
}
