import { describe, expect, it } from "vitest";
import { parseArgs, renderContactSheet, safeId, summarize } from "./calibrate.mjs";

describe("calibration runner", () => {
  it("parses bounded command-line options", () => {
    expect(parseArgs([
      "--",
      "--base-url", "http://localhost:3100/",
      "--pipeline", "vector",
      "--mode-set", "all",
      "--limit", "12",
      "--timeout-ms", "90000",
    ])).toMatchObject({
      baseUrl: "http://localhost:3100",
      pipeline: "vector",
      modeSet: "all",
      limit: 12,
      timeoutMs: 90_000,
    });
  });

  it("rejects unsafe or unbounded option values", () => {
    expect(() => parseArgs(["--pipeline", "everything"])).toThrow("--pipeline");
    expect(() => parseArgs(["--limit", "501"])).toThrow("--limit");
    expect(() => parseArgs(["--base-url", "file:///tmp/app"])).toThrow("--base-url");
    expect(() => parseArgs(["--base-url", "http://secret@example.com"])).toThrow("--base-url");
  });

  it("creates stable filesystem-safe asset identifiers", () => {
    expect(safeId("logos/Café & Cat.PNG")).toBe("logos-cafe-cat-png");
    expect(safeId("한글 이미지")).toBe("image");
  });

  it("summarizes successful and failed pipeline results", () => {
    expect(summarize([{
      raster: [{ status: "ok" }, { status: "error", httpStatus: 500 }],
      vector: [{ status: "ok" }],
    }])).toEqual({
      images: 1,
      raster: { attempted: 2, succeeded: 1, failed: 1 },
      vector: { attempted: 1, succeeded: 1, failed: 0 },
    });
  });

  it("escapes corpus filenames in the contact sheet", () => {
    const html = renderContactSheet({
      runId: "test",
      configuration: { modeSet: "auto" },
      summary: {
        images: 1,
        raster: { attempted: 0, succeeded: 0 },
        vector: { attempted: 0, succeeded: 0 },
      },
      images: [{
        category: "<category>",
        source: "<script>alert(1)</script>.png",
        original: { outputFile: "assets/original.png", bytes: 100 },
        raster: [],
        vector: [],
      }],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;.png");
    expect(html).toContain("report.json");
  });
});
