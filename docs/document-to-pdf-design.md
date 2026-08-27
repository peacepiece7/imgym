# Document to PDF Design

Status: implemented and verified  
Scope: private, authenticated UTF-8 Markdown to tagged PDF

## 1. Goal

The document track converts structured Markdown into a PDF that remains searchable, selectable, and copyable. It must preserve the source reading order and document semantics rather than printing page screenshots or overlaying invisible OCR text on raster pages.

The initial target is resumes, career descriptions, portfolios, technical documents, and table-heavy inventories.

```text
UTF-8 Markdown
  -> validated Markdown token stream
  -> trusted semantic HTML
  -> fixed paged-media CSS
  -> WeasyPrint
  -> tagged PDF/UA-1
```

This is independent from Raster R1/R2 and SVG V1/V2. PDF is not added to the ImageMagick input formats.

## 2. Findings from the local reference PDFs

The Desktop reference set contains three materially different construction patterns:

1. A browser-printed resume uses live text, embedded Unicode fonts, and PDF structure tags. Its extracted text generally follows the intended reading order, and its headings, lists, and table cells are represented semantically.
2. Some portfolio pages are full-page images. They look correct but have no searchable or copyable content.
3. Some generated documents combine a page image with invisible text or draw visual tables without table structure. Text extraction may appear to work, but copied rows and columns can lose their relationships.

OhMyImg follows the first pattern and strengthens it with a PDF/UA output mode. Full-page rasterization, canvas snapshots, and invisible OCR overlays are explicitly excluded.

## 3. Rendering engine decision

### Selected: WeasyPrint 68.1

WeasyPrint is designed for paged HTML/CSS, supports CSS page fragmentation controls, and can generate PDF/UA. Alpine provides a small system package, so the existing Node 24 Alpine image can remain unchanged.

The application invokes a small Python wrapper with `child_process.spawn()` and `shell: false`. The wrapper installs a deny-by-default resource fetcher and calls WeasyPrint with `pdf_variant="pdf/ua-1"`.

Local development uses the repository `.venv` interpreter when present; Docker uses Alpine's packaged Python. `DOCUMENT_PDF_PYTHON_BINARY` is an explicit override, not a lookup performed from request data.

### Not selected for V1

| Engine | Reason |
| --- | --- |
| Chromium/Playwright | Strong browser fidelity and tagged output, but official Playwright browser images do not support Alpine/musl; it adds a large browser and higher runtime cost. |
| ReportLab/PDFKit | Suitable for fixed templates, but reading order, structure tags, tables, and pagination must be constructed manually. |
| Page screenshots | Destroys text search, selection, copy order, accessibility, and table semantics. |
| LibreOffice/DOCX conversion | Useful later, but it adds a second document model and does not share the controlled Markdown pagination contract. |

WeasyPrint major versions can change rendering behavior. Version 68.1 is treated as part of the output contract and must be upgraded intentionally with fixture re-rendering.

## 4. V1 input contract

Accepted inputs:

- pasted UTF-8 Markdown;
- `.md`, `.markdown`, or `.txt` UTF-8 files;
- GFM headings, paragraphs, emphasis, links, block quotes, lists, code blocks, and tables.

Options:

- title: PDF metadata and filename basis;
- language: `ko` or `en`;
- page size: A4 or Letter;
- orientation: portrait or landscape;
- template: document or resume;
- page numbers: enabled or disabled.

V1 deliberately excludes raw HTML, user CSS, JavaScript, DOCX, arbitrary URLs, remote images, embedded files, and attachments. Markdown image syntax is rendered as an explicit text placeholder rather than fetched.

The source is normalized to Unicode NFC before rendering. The semantic HTML DOM stays in source order; the print stylesheet does not use columns, CSS reordering, absolute positioning, or generated meaningful content.

## 5. Copy and semantic-structure contract

The PDF contains real text and uses semantic elements generated from Markdown:

- `h1` through `h6` for headings and PDF bookmarks;
- `p` for paragraphs;
- `ul`, `ol`, and `li` for lists;
- `table`, `thead`, `tbody`, `tr`, `th`, and `td` for tables;
- `blockquote`, `pre`, and `code` for their corresponding blocks;
- `a` only for safe links.

The Korean-capable Noto CJK font is installed in Docker and subset-embedded by WeasyPrint with Unicode mapping. Verification must prove `emb=yes` and `uni=yes`; a visually correct page is not enough.

PDF/UA is a measurable baseline, not a claim that every PDF viewer copies complex tables identically. Extraction order, structure tags, embedded fonts, and visual pages are tested independently.

## 6. Pagination contract

The stylesheet uses the smallest meaningful break unit rather than keeping entire sections or tables on one page.

```css
h1, h2, h3, h4, h5, h6 {
  break-after: avoid-page;
}

p {
  orphans: 3;
  widows: 3;
}

li, tr, blockquote, pre, figure {
  break-inside: avoid-page;
}

thead {
  display: table-header-group;
}
```

Consequences:

- a heading moves with the first following content block;
- normal paragraphs break only between shaped lines and retain at least three lines on both sides when possible;
- a short list item, quote, code block, resume entry, or table row moves as a unit;
- tables may span pages between rows, and their header row repeats;
- table cells never use an independent visual layout that can reorder copied text.

CSS `avoid` is not absolute. The CSS Fragmentation specification allows a renderer to relax avoidance when a block is taller than the printable page. The QA fixture verifies ordinary heading, paragraph, list, resume-entry, and table-row boundaries. An oversized block may still fragment as the standards-defined fallback; a future structured-editor mode may split an oversized resume entry into explicit continuation blocks. Silent font shrinking is not allowed.

## 7. API and process boundary

Canonical endpoint:

```text
POST /api/v1/docs-to-pdf
Authorization: Bearer <OHMYIMG_API_KEY>
Content-Type: multipart/form-data
```

Multipart fields:

- `document`: UTF-8 Markdown file, or `markdown`: UTF-8 string;
- `options`: JSON object matching the V1 options.

The route authenticates before parsing multipart data, uses the shared single-job admission gate, validates bounded input, and returns `application/pdf` with no-store metadata headers.

The renderer:

- uses `spawn(python, args)` with `shell: false`;
- receives request-local input and output file paths as separate arguments;
- emits only bounded JSON metadata over stdout and writes the PDF inside the request directory;
- runs in a request-specific temporary directory;
- does not inherit the owner API key;
- rejects all external resource fetching;
- reads and reconstructs the complete multipart request behind a 2 MiB streaming cap before parsing fields;
- limits runtime, stdout, stderr, pages, and diagnostics;
- is terminated and cleaned up after failure or timeout.

Expected user errors stay short. Internal Python and WeasyPrint diagnostics are logged with the request ID and are not returned to the client.

## 8. Verification

Completion requires all of the following:

- unit tests for options, UTF-8 validation, filename safety, raw HTML escaping, disabled images, and semantic Markdown output;
- authenticated route tests for 401, invalid input, and successful PDF response;
- `pdfinfo` reports `Tagged: yes` and PDF/UA metadata;
- `pdffonts` reports embedded Unicode Korean fonts;
- `pdftotext` preserves normalized Korean/English text and source block order;
- structure inspection finds headings, lists, tables, rows, and cells;
- page-boundary sentinels prove a heading stays with its first block and normal table rows do not split;
- every page is rendered with Poppler and visually checked for clipping, overlap, isolated headings, and broken table rows;
- the Node 24 Docker image runs the same integration checks.

Verification recorded on 2026-08-24:

- 115 Vitest tests, ESLint, TypeScript, and the Next.js production build pass locally;
- the Node 24 Alpine Docker builder runs the same suite and production build with WeasyPrint 68.1;
- a live authenticated request produced a two-page PDF/UA-1 sample;
- `pdfinfo` reports tagged PDF 1.7 output, and `pdffonts` reports every subset font as embedded with Unicode mapping;
- `pdftotext` recovers the Korean/English fixture in source order, keeps the boundary heading with its first paragraph, and keeps all normal table-row markers on one page per row;
- all rendered sample pages were inspected for clipping, overlap, isolated headings, and split table rows.

The integration test repeats the machine-verifiable tagging, font, extraction-order, heading-boundary, and table-row checks through Poppler. `X-PDF-Variant` records the requested WeasyPrint output profile; formal veraPDF conformance validation and browser interaction remain separately recorded deferred checks.

## 9. Deferred extensions

- DOCX ingestion through a separately reviewed semantic importer;
- validated local image assets with mandatory alt text;
- explicit resume-entry or project-entry Markdown extensions;
- oversized-row continuation editing;
- additional templates and custom brand themes;
- veraPDF validation in CI;
- browser end-to-end checks for upload, preview, and download.

These extensions must preserve the same semantic source order and must not introduce arbitrary HTML/CSS or remote resource fetching.

## 10. Primary references

- [WeasyPrint documentation](https://doc.courtbouillon.org/weasyprint/stable/)
- [WeasyPrint PDF/UA guidance](https://doc.courtbouillon.org/weasyprint/latest/common_use_cases.html)
- [WeasyPrint supported CSS](https://doc.courtbouillon.org/weasyprint/latest/api_reference.html)
- [WeasyPrint security guidance](https://doc.courtbouillon.org/weasyprint/latest/first_steps.html)
- [CSS Fragmentation Module Level 3](https://www.w3.org/TR/css-break-3/)
- [markdown-it documentation](https://markdown-it.github.io/markdown-it/)
- [Playwright Docker guidance](https://playwright.dev/docs/docker)
