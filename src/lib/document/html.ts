import { renderDocumentMarkdown } from "./markdown";
import { DOCUMENT_PDF_LIMITS, type DocumentPdfOptions } from "./types";

const PAGE_SIZE: Record<DocumentPdfOptions["pageSize"], string> = {
  a4: "A4",
  letter: "Letter",
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function documentStyles(options: DocumentPdfOptions) {
  const size = `${PAGE_SIZE[options.pageSize]} ${options.orientation}`;
  const pageNumbers = options.includePageNumbers
    ? `
      @bottom-center {
        content: counter(page) " / " counter(pages);
        color: #667085;
        font-family: sans-serif;
        font-size: 8.5pt;
      }`
    : "";

  return `
    @page {
      size: ${size};
      margin: 18mm 17mm 20mm;
      ${pageNumbers}
    }

    *, *::before, *::after { box-sizing: border-box; }

    html {
      color: #17202a;
      font-family: "Noto Sans CJK KR", "Apple SD Gothic Neo", "Malgun Gothic", Arial, sans-serif;
      font-size: 10.5pt;
      line-height: 1.58;
      font-synthesis: none;
      font-variant-ligatures: none;
      hyphens: none;
    }

    body { margin: 0; }

    main {
      display: block;
      max-width: none;
      overflow-wrap: anywhere;
      word-break: normal;
    }

    h1, h2, h3, h4, h5, h6 {
      color: #101828;
      line-height: 1.24;
      margin: 1.15em 0 0.45em;
      break-after: avoid-page;
      page-break-after: avoid;
      break-inside: avoid-page;
      page-break-inside: avoid;
    }

    h1 + *, h2 + *, h3 + *, h4 + *, h5 + *, h6 + * {
      break-before: avoid-page;
      page-break-before: avoid;
    }

    h1 { font-size: 22pt; margin-top: 0; }
    h2 { font-size: 15.5pt; border-bottom: 0.7pt solid #d0d5dd; padding-bottom: 0.22em; }
    h3 { font-size: 12.2pt; }
    h4, h5, h6 { font-size: 10.8pt; }

    p {
      margin: 0 0 0.72em;
      orphans: 3;
      widows: 3;
    }

    ul, ol { margin: 0.25em 0 0.8em; padding-left: 1.55em; }

    li {
      margin: 0.12em 0;
      break-inside: avoid-page;
      page-break-inside: avoid;
    }

    li > p { margin: 0.1em 0; }

    blockquote, pre {
      break-inside: avoid-page;
      page-break-inside: avoid;
    }

    blockquote {
      border-left: 2.5pt solid #98a2b3;
      color: #475467;
      margin: 0.8em 0;
      padding: 0.2em 0 0.2em 0.9em;
    }

    pre {
      background: #f2f4f7;
      border: 0.5pt solid #d0d5dd;
      border-radius: 3pt;
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 8.6pt;
      line-height: 1.45;
      margin: 0.8em 0;
      padding: 0.72em;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    code {
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 0.9em;
    }

    table {
      border-collapse: collapse;
      margin: 0.75em 0 1em;
      width: 100%;
      break-inside: auto;
      page-break-inside: auto;
    }

    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }

    tr, th, td {
      break-inside: avoid-page;
      page-break-inside: avoid;
    }

    th, td {
      border: 0.55pt solid #d0d5dd;
      padding: 0.42em 0.55em;
      text-align: left;
      vertical-align: top;
      orphans: 2;
      widows: 2;
    }

    th { background: #f2f4f7; color: #344054; font-weight: 650; }

    a { color: #175cd3; text-decoration: underline; }
    hr { border: 0; border-top: 0.7pt solid #d0d5dd; margin: 1.2em 0; }

    .image-alt { color: #667085; font-style: italic; }
    img, svg, iframe, object, embed, video, audio, canvas { display: none !important; }

    .document--resume { font-size: 9.7pt; line-height: 1.47; }
    .document--resume h1 { text-align: center; font-size: 20pt; margin-bottom: 0.2em; }
    .document--resume h2 { font-size: 13.4pt; margin-top: 0.9em; }
    .document--resume h3 { font-size: 11.2pt; margin-top: 0.72em; }
    .document--resume p { margin-bottom: 0.48em; }
    .document--resume table { margin: 0.48em 0 0.72em; }
    .document--resume th, .document--resume td { padding: 0.32em 0.45em; }
  `;
}

export function buildDocumentHtml(source: string, options: DocumentPdfOptions) {
  const body = renderDocumentMarkdown(source);
  const html = `<!doctype html>
<html lang="${options.lang}">
<head>
  <meta charset="utf-8">
  <meta name="generator" content="OhMyImg Docs to PDF">
  <title>${escapeHtml(options.title)}</title>
  <style>${documentStyles(options)}</style>
</head>
<body>
  <main class="document document--${options.template}">
${body}
  </main>
</body>
</html>`;

  if (Buffer.byteLength(html, "utf8") > DOCUMENT_PDF_LIMITS.maxHtmlBytes) {
    throw new Error("Generated HTML exceeded the limit");
  }
  return html;
}
