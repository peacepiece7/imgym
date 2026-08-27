import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/v1/docs-to-pdf/route";
import { toDocumentPdfFilename } from "./filename";
import { buildDocumentHtml } from "./html";
import { parseDocumentPdfOptions, parseDocumentSource } from "./input";
import { renderDocumentMarkdown } from "./markdown";
import { renderDocumentPdf } from "./renderer";
import { DEFAULT_DOCUMENT_PDF_OPTIONS } from "./types";

const TEST_API_KEY = "test-api-key-0123456789abcdefghijklmnop";

function authorizedRequest(form: FormData) {
  process.env.OHMYIMG_API_KEY = TEST_API_KEY;
  return new Request("http://localhost/api/v1/docs-to-pdf", {
    method: "POST",
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    body: form,
  });
}

describe("document input contract", () => {
  it("uses fixed defaults and validates every configurable option", () => {
    expect(parseDocumentPdfOptions(null)).toEqual(DEFAULT_DOCUMENT_PDF_OPTIONS);
    expect(parseDocumentPdfOptions(JSON.stringify({
      title: "  Jane   Kim  ",
      lang: "en",
      pageSize: "letter",
      orientation: "landscape",
      template: "resume",
      includePageNumbers: false,
    }))).toEqual({
      title: "Jane Kim",
      lang: "en",
      pageSize: "letter",
      orientation: "landscape",
      template: "resume",
      includePageNumbers: false,
    });
    expect(parseDocumentPdfOptions(JSON.stringify({ lang: "fr" }))).toBeNull();
    expect(parseDocumentPdfOptions(JSON.stringify({ customCss: "body{}" }))).toBeNull();
  });

  it("accepts exactly one UTF-8 Markdown string or supported file", async () => {
    const markdownForm = new FormData();
    markdownForm.set("markdown", "# Hello\n\n안녕하세요");
    await expect(parseDocumentSource(markdownForm)).resolves.toMatchObject({
      ok: true,
      source: { name: "document.md" },
    });

    const fileForm = new FormData();
    fileForm.set("document", new File(["# Resume"], "resume.MARKDOWN"));
    await expect(parseDocumentSource(fileForm)).resolves.toMatchObject({
      ok: true,
      source: { name: "resume.MARKDOWN" },
    });

    const both = new FormData();
    both.set("markdown", "text");
    both.set("document", new File(["text"], "text.md"));
    await expect(parseDocumentSource(both)).resolves.toMatchObject({ ok: false, status: 400 });

    const duplicateMarkdown = new FormData();
    duplicateMarkdown.append("markdown", "first");
    duplicateMarkdown.append("markdown", "second");
    await expect(parseDocumentSource(duplicateMarkdown)).resolves.toMatchObject({ ok: false, status: 400 });

    const duplicateFiles = new FormData();
    duplicateFiles.append("document", new File(["first"], "first.md"));
    duplicateFiles.append("document", new File(["second"], "second.md"));
    await expect(parseDocumentSource(duplicateFiles)).resolves.toMatchObject({ ok: false, status: 400 });

    const binary = new FormData();
    binary.set("document", new File([new Uint8Array([0xff, 0xfe])], "bad.md"));
    await expect(parseDocumentSource(binary)).resolves.toEqual({
      ok: false,
      error: "Unsupported document",
      status: 400,
    });
  });

  it("normalizes decomposed Unicode to NFC before rendering", async () => {
    const form = new FormData();
    form.set("markdown", "# Cafe\u0301");
    const result = await parseDocumentSource(form);

    expect(result.ok && result.source.markdown).toBe("# Café");
  });
});

describe("semantic, safe document HTML", () => {
  it("keeps headings, lists and tables while omitting HTML and image resources", () => {
    const output = renderDocumentMarkdown(`# Header

- First
- Second

| Name | Value |
| --- | --- |
| A | B |

![portrait](https://example.com/me.png)

<script>alert(1)</script>`);

    expect(output).toContain("<h1>Header</h1>");
    expect(output).toContain("<ul>");
    expect(output).toContain("<table>");
    expect(output).toContain("[portrait]");
    expect(output).not.toContain("<img");
    expect(output).not.toContain("<script>");
    expect(output).toContain("&lt;script&gt;");
  });

  it("uses normal document flow and explicit fragmentation rules", () => {
    const html = buildDocumentHtml("# Resume\n\n| A | B |\n| - | - |\n| 1 | 2 |", {
      ...DEFAULT_DOCUMENT_PDF_OPTIONS,
      title: '<Resume & "Data">',
      pageSize: "letter",
      orientation: "landscape",
      template: "resume",
      includePageNumbers: false,
    });

    expect(html).toContain("<title>&lt;Resume &amp; &quot;Data&quot;&gt;</title>");
    expect(html).toContain("size: Letter landscape");
    expect(html).toContain("break-after: avoid-page");
    expect(html).toContain("orphans: 3");
    expect(html).toContain("thead { display: table-header-group; }");
    expect(html).toContain("tr, th, td");
    expect(html).not.toContain("counter(page)");
  });

  it("creates a safe ASCII download name", () => {
    expect(toDocumentPdfFilename("../../resume.final.md", "Final Resume")).toBe("Final-Resume.pdf");
    expect(toDocumentPdfFilename("이력서.md", "Jane Kim Resume")).toBe("Jane-Kim-Resume.pdf");
    expect(toDocumentPdfFilename("resume.final.md", "이력서")).toBe("resume.final.pdf");
  });
});

describe("POST /api/v1/docs-to-pdf", () => {
  it("renders tagged PDF/UA-1 output and reports bounded metadata", async () => {
    const rows = Array.from({ length: 65 }, (_, index) => `| ${index + 1} | 경력 항목 ${index + 1} |`).join("\n");
    const form = new FormData();
    form.set("markdown", `# 홍길동\n\n## 경력\n\n| Year | Description |\n| --- | --- |\n${rows}`);
    form.set("options", JSON.stringify({
      title: "홍길동 이력서",
      lang: "ko",
      template: "resume",
      includePageNumbers: true,
    }));

    const response = await POST(authorizedRequest(form));
    const pdf = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-pdf-renderer")).toBe("WeasyPrint 68.1");
    expect(response.headers.get("x-pdf-variant")).toBe("PDF/UA-1");
    expect(Number(response.headers.get("x-output-pages"))).toBeGreaterThan(1);
    expect(Number(response.headers.get("x-output-bytes"))).toBe(pdf.byteLength);
    expect(Number(response.headers.get("x-input-characters"))).toBeGreaterThan(100);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);

  it("preserves copy order, embedded Unicode fonts, and meaningful page boundaries", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "test/fixtures/document-pagination.md"),
      "utf8",
    );
    const html = buildDocumentHtml(source, {
      ...DEFAULT_DOCUMENT_PDF_OPTIONS,
      title: "Copy-Safe Resume Sample",
      template: "resume",
    });
    const rendered = await renderDocumentPdf(html);
    const directory = mkdtempSync(join(tmpdir(), "ohmyimg-pdf-verification-"));
    const pdfPath = join(directory, "resume.pdf");

    try {
      writeFileSync(pdfPath, rendered.pdf);

      const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
      expect(info).toMatch(/^Tagged:\s+yes$/m);
      expect(Number(info.match(/^Pages:\s+(\d+)$/m)?.[1])).toBeGreaterThan(1);

      const fonts = execFileSync("pdffonts", [pdfPath], { encoding: "utf8" });
      const fontRows = fonts.split("\n").slice(2).filter((line) => line.trim());
      expect(fontRows.length).toBeGreaterThan(0);
      for (const row of fontRows) {
        expect(row).toMatch(/\byes\s+yes\s+yes\s+\d+\s+\d+\s*$/);
      }

      const extracted = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
        encoding: "utf8",
      });
      const pages = extracted.split("\f");
      const pageOf = (marker: string) => pages.findIndex((page) => page.includes(marker));
      const orderedMarkers = [
        "Copy-Safe Resume",
        "한국어, English, 숫자 1234",
        "HEADING_KEEP_MARKER",
        "HEADING_BODY_MARKER",
        "ROW_01_START",
        "ROW_01_END",
        "ROW_02_START",
        "ROW_02_END",
        "ROW_03_START",
        "ROW_03_END",
        "ROW_04_START",
        "ROW_04_END",
        "ROW_05_START",
        "ROW_05_END",
        "DOCUMENT_END_MARKER",
      ];
      let previousIndex = -1;
      for (const marker of orderedMarkers) {
        const index = extracted.indexOf(marker);
        expect(index, `${marker} should be extractable in source order`).toBeGreaterThan(previousIndex);
        previousIndex = index;
      }

      expect(pageOf("HEADING_KEEP_MARKER")).toBe(pageOf("HEADING_BODY_MARKER"));
      for (let row = 1; row <= 5; row += 1) {
        const number = String(row).padStart(2, "0");
        expect(pageOf(`ROW_${number}_START`)).toBe(pageOf(`ROW_${number}_END`));
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("returns a generic validation response for ambiguous input", async () => {
    const form = new FormData();
    form.set("markdown", "# Text");
    form.set("document", new File(["# Text"], "text.md"));
    const response = await POST(authorizedRequest(form));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
  });

  it("bounds the complete multipart body even without Content-Length", async () => {
    process.env.OHMYIMG_API_KEY = TEST_API_KEY;
    const response = await POST(new Request("http://localhost/api/v1/docs-to-pdf", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
        "Content-Type": "multipart/form-data; boundary=oversized",
      },
      body: new Uint8Array(2 * 1024 * 1024 + 1),
    }));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "File is too large" });

    const unexpected = new FormData();
    unexpected.set("markdown", "# Small document");
    unexpected.set("junk", "not allowed");
    const unexpectedResponse = await POST(authorizedRequest(unexpected));
    expect(unexpectedResponse.status).toBe(400);
    expect(await unexpectedResponse.json()).toEqual({ error: "Invalid request" });
  });
});
