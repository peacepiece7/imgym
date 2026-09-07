import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/v1/vectorize/route";
import { POST as optimizeDirectSvgRoute } from "@/app/api/v1/optimize-svg/route";
import { analyzeSvg } from "./analyze-svg";
import { optimizeDirectSvg } from "./direct-svg";
import { autoOptimizeVector } from "./auto-optimize";
import { resolveVectorCleanup } from "./cleanup-presets";
import { isVectorCleanupOptions, parseVectorCleanupOptions } from "./cleanup-types";
import { toSvgFilename } from "./filename";
import { isVectorizeMode, VECTOR_AUTO_CANDIDATES, VTRACER_PRESETS } from "./presets";
import {
  passesVectorQuality,
  SVG_AUTO_QUALITY_GATE,
  vectorEvaluationDimensions,
} from "./similarity";
import { optimizeSvg } from "./svgo";
import { preprocessRasterForVector, vectorPreprocessArgs } from "./preprocess-raster";
import type { VectorizeApiResult } from "./types";
import { validateImage } from "./validate-image";
import { vectorizeImage } from "./vtracer";

const MIME = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
} as const;

const TEST_API_KEY = "test-api-key-0123456789abcdefghijklmnop";

function authorizedVectorRequest(form: FormData) {
  process.env.OHMYIMG_API_KEY = TEST_API_KEY;
  return new Request("http://localhost/api/v1/vectorize", {
    method: "POST",
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    body: form,
  });
}

function fixture(format: keyof typeof MIME) {
  const extension = format === "jpeg" ? "jpg" : format;
  return readFileSync(new URL(`../../../test/fixtures/sample.${extension}`, import.meta.url));
}

function animatedPng() {
  const source = fixture("png");
  const chunk = Buffer.alloc(20);
  chunk.writeUInt32BE(8, 0);
  chunk.write("acTL", 4, "ascii");
  chunk.writeUInt32BE(2, 8);
  chunk.writeUInt32BE(0, 12);
  return Buffer.concat([source.subarray(0, 33), chunk, source.subarray(33)]);
}

function animatedWebp() {
  const source = fixture("webp");
  const chunk = Buffer.alloc(18);
  chunk.write("VP8X", 0, "ascii");
  chunk.writeUInt32LE(10, 4);
  chunk[8] = 0x02;
  chunk.writeUIntLE(23, 12, 3);
  chunk.writeUIntLE(23, 15, 3);
  const output = Buffer.concat([source.subarray(0, 12), chunk, source.subarray(12)]);
  output.writeUInt32LE(output.byteLength - 8, 4);
  return output;
}

describe("vector pipeline", () => {
  it.each(["png", "jpeg", "webp"] as const)("validates %s headers", (format) => {
    expect(validateImage(fixture(format))).toMatchObject({
      ok: true,
      format,
      width: 24,
      height: 24,
    });
  });

  it("rejects invalid and oversized input", () => {
    expect(validateImage(Buffer.from("not an image"))).toEqual({
      ok: false,
      error: "Unsupported image",
      status: 400,
    });
    expect(validateImage(Buffer.alloc(10 * 1024 * 1024 + 1))).toEqual({
      ok: false,
      error: "File is too large",
      status: 413,
    });
  });

  it("rejects animated PNG and WebP instead of tracing one frame", () => {
    expect(validateImage(animatedPng())).toEqual({
      ok: false,
      error: "Animated images are not supported",
      status: 400,
    });
    expect(validateImage(animatedWebp())).toEqual({
      ok: false,
      error: "Animated images are not supported",
      status: 400,
    });
  });

  it("keeps all VTracer tuning in three distinct presets", () => {
    expect(Object.keys(VTRACER_PRESETS)).toEqual(["accurate", "balanced", "tiny"]);
    expect(VTRACER_PRESETS.accurate).not.toEqual(VTRACER_PRESETS.balanced);
    expect(VTRACER_PRESETS.balanced).not.toEqual(VTRACER_PRESETS.tiny);
  });

  it("keeps SVG Auto search bounded and recognizes it as a product mode", () => {
    expect(VECTOR_AUTO_CANDIDATES).toHaveLength(6);
    expect(new Set(VECTOR_AUTO_CANDIDATES.map((candidate) => candidate.key)).size).toBe(6);
    expect(isVectorizeMode("auto")).toBe(true);
    expect(isVectorizeMode("unbounded")).toBe(false);
  });

  it("validates cleanup settings and preserves a pre-quantized palette", () => {
    const cleanup = { version: 1, cleanup: 3, colors: 16 } as const;
    expect(isVectorCleanupOptions(cleanup)).toBe(true);
    expect(parseVectorCleanupOptions(JSON.stringify(cleanup))).toEqual(cleanup);
    expect(parseVectorCleanupOptions('{"version":1,"cleanup":9,"colors":16}')).toBeNull();
    expect(parseVectorCleanupOptions('{"version":1,"cleanup":2,"colors":16,"command":"blur"}')).toBeNull();

    const resolved = resolveVectorCleanup("balanced", cleanup);
    expect(resolved.vtracer.colorPrecision).toBe(8);
    expect(resolved.vtracer.maxColors).toBe(16);
    expect(resolved.vtracer.filterSpeckle).toBeGreaterThan(VTRACER_PRESETS.balanced.filterSpeckle);
    expect(vectorPreprocessArgs("png", resolved)).toEqual(expect.arrayContaining([
      "-auto-orient", "+dither", "-colors", "16", "-median", "1",
    ]));
    const alpha = resolveVectorCleanup("balanced", {
      ...cleanup,
      advanced: { alphaCutoff: 128 },
    });
    expect(vectorPreprocessArgs("png", alpha)).toEqual(expect.arrayContaining([
      "-black-threshold", "50.1961%",
    ]));
  });

  it("preprocesses a raster losslessly before vectorization", async () => {
    const validation = validateImage(fixture("jpeg"));
    if (!validation.ok) throw new Error("Fixture must be valid");
    const resolved = resolveVectorCleanup("balanced", { version: 1, cleanup: 2, colors: 6 });
    const cleaned = await preprocessRasterForVector(fixture("jpeg"), validation, resolved);

    expect(validateImage(cleaned.image)).toMatchObject({ ok: true, format: "png", width: 24, height: 24 });
    expect(cleaned.colors).toBeLessThanOrEqual(6);
    expect(cleaned.durationMs).toBeGreaterThan(0);
  });

  it("bounds similarity evaluation dimensions and applies all quality gates", () => {
    expect(vectorEvaluationDimensions(2_048, 1_024)).toEqual({ width: 512, height: 256 });
    expect(vectorEvaluationDimensions(24, 24)).toEqual({ width: 24, height: 24 });
    expect(passesVectorQuality({
      ssim: SVG_AUTO_QUALITY_GATE.minimumSsim,
      mae: SVG_AUTO_QUALITY_GATE.maximumMae,
      edgeMae: SVG_AUTO_QUALITY_GATE.maximumEdgeMae,
      rasterizationMs: 1,
      measurementMs: 1,
    })).toBe(true);
    expect(passesVectorQuality({
      ssim: SVG_AUTO_QUALITY_GATE.minimumSsim - 0.01,
      mae: 0,
      edgeMae: 0,
      rasterizationMs: 1,
      measurementMs: 1,
    })).toBe(false);
  });

  it("vectorizes, optimizes, and analyzes an image", () => {
    const vectorized = vectorizeImage(fixture("png"), { preset: "balanced" });
    const optimized = optimizeSvg(vectorized.svg);
    const stats = analyzeSvg(optimized.svg);

    expect(optimized.svg).toContain("<svg");
    expect(optimized.svg).toContain("viewBox");
    expect(optimized.afterBytes).toBeLessThanOrEqual(optimized.beforeBytes);
    expect(stats.paths).toBeGreaterThan(0);
    expect(stats.commands).toBeGreaterThan(0);
    expect(stats.colors).toBeGreaterThan(0);
  });

  it("searches SVG candidates and selects a measured result", async () => {
    const image = fixture("png");
    const selected = await autoOptimizeVector(image, {
      format: "png",
      width: 24,
      height: 24,
    });

    expect(selected.candidates).toBe(6);
    expect(selected.optimized.svg).toContain("<svg");
    expect(selected.optimized.afterBytes).toBeGreaterThan(0);
    expect(selected.quality.ssim).toBeGreaterThanOrEqual(SVG_AUTO_QUALITY_GATE.minimumSsim);
    expect(selected.quality.mae).toBeLessThanOrEqual(SVG_AUTO_QUALITY_GATE.maximumMae);
    expect(selected.quality.edgeMae).toBeLessThanOrEqual(SVG_AUTO_QUALITY_GATE.maximumEdgeMae);
    expect(selected.timing.rasterizationMs).toBeGreaterThan(0);
    expect(selected.timing.measurementMs).toBeGreaterThan(0);
  });

  it("surfaces a VTracer failure to the route boundary", () => {
    expect(() =>
      vectorizeImage(Buffer.from("not encoded image data"), { preset: "balanced" }),
    ).toThrow();
  });

  it("removes active content and rejects unsafe vector output", () => {
    const source = '<svg viewBox="0 0 10 10"><title>Mark</title><desc>Brand mark</desc><script>alert(1)</script><image href="https://example.com/a.png"/><foreignObject/><path onclick="alert(1)" fill="url(https://example.com/a)" d="M0 0h1v1z"/></svg>';
    const optimized = optimizeSvg(source);
    expect(optimized.svg).not.toContain("script");
    expect(optimized.svg).not.toContain("foreignObject");
    expect(optimized.svg).not.toContain("https://");
    expect(optimized.svg).toContain("<title>Mark</title>");
    expect(optimized.svg).toContain("<desc>Brand mark</desc>");
    expect(() => analyzeSvg('<svg><foreignObject /></svg>')).toThrow("Unsafe SVG output");
  });

  it("does not invent a viewBox from percentage dimensions or retain external stylesheets", () => {
    const result = optimizeSvg('<?xml-stylesheet href="https://example.com/a.css"?><svg width="100%" height="100%"><path d="M0 0h200v300z"/></svg>');
    expect(result.svg).not.toContain("xml-stylesheet");
    expect(result.svg).not.toContain("viewBox");
  });

  it("preserves zero-length marker lines whose rendering differs as paths", () => {
    const result = optimizeSvg('<svg viewBox="0 0 20 20"><defs><marker id="dot"><circle cx="5" cy="5" r="5"/></marker></defs><line x1="10" y1="10" x2="10" y2="10" marker-start="url(#dot)"/></svg>');
    expect(result.svg).toContain("<line");
    expect(result.svg).toContain('marker-start="url(#');
  });

  it("optimizes a direct SVG with a bounded safety report", () => {
    const result = optimizeDirectSvg(
      '<svg width="10" height="10"><script/><path onclick="x()" d="M0 0h10v10z"/></svg>',
      "brand.svg",
    );
    expect(result.downloadName).toBe("brand.svg");
    expect(result.svg).toContain("viewBox");
    expect(result.safety).toMatchObject({ scriptsRemoved: 1, eventHandlersRemoved: 1 });
    expect(result.stats.elements).toBeGreaterThan(0);
  });

  it("creates a safe SVG filename", () => {
    expect(toSvgFilename("my cat.photo.JPG")).toBe("my-cat.photo.svg");
    expect(toSvgFilename("../../.jpg")).toBe("vectorized.svg");
  });
});

describe("POST /api/v1/vectorize", () => {
  it.each(["png", "jpeg", "webp"] as const)("converts %s end to end", async (format) => {
    const form = new FormData();
    form.set("image", new File([fixture(format)], `sample.${format}`, { type: MIME[format] }));
    form.set("preset", "balanced");
    const response = await POST(authorizedVectorRequest(form));
    const result = (await response.json()) as VectorizeApiResult;

    expect(response.status).toBe(200);
    expect(result.svg).toContain("<svg");
    expect(result.input.format).toBe(format);
    expect(result.downloadName).toBe("sample.svg");
    expect(result.stats.paths).toBeGreaterThan(0);
    expect(result.selection).toEqual({ mode: "balanced", candidate: "balanced", candidates: 1 });
  });

  it("returns SVG Auto search metadata", async () => {
    const form = new FormData();
    form.set("image", new File([fixture("png")], "sample.png", { type: MIME.png }));
    form.set("preset", "auto");
    const response = await POST(authorizedVectorRequest(form));
    const result = (await response.json()) as VectorizeApiResult;

    expect(response.status).toBe(200);
    expect(result.selection.mode).toBe("auto");
    expect(result.selection.candidates).toBe(6);
    expect(result.selection.qualityGate).toBe(SVG_AUTO_QUALITY_GATE.version);
    expect(SVG_AUTO_QUALITY_GATE.version).toBe("imagemagick-svg-v2");
    expect(result.selection.ssim).toBeGreaterThanOrEqual(SVG_AUTO_QUALITY_GATE.minimumSsim);
    expect(result.svg).toContain("<svg");
  });

  it("applies optional raster cleanup before a manual conversion", async () => {
    const form = new FormData();
    form.set("image", new File([fixture("png")], "sample.png", { type: MIME.png }));
    form.set("preset", "balanced");
    form.set("cleanup", JSON.stringify({ version: 1, cleanup: 3, colors: 6 }));
    const response = await POST(authorizedVectorRequest(form));
    const result = (await response.json()) as VectorizeApiResult;

    expect(response.status).toBe(200);
    expect(result.cleanup?.colors).toBeLessThanOrEqual(6);
    expect(result.timing.preprocessingMs).toBeGreaterThan(0);
    expect(result.svg).toContain("<svg");
  });

  it("rejects malformed cleanup settings", async () => {
    const form = new FormData();
    form.set("image", new File([fixture("png")], "sample.png", { type: MIME.png }));
    form.set("preset", "balanced");
    form.set("cleanup", JSON.stringify({ version: 1, cleanup: 99, colors: 6 }));
    const response = await POST(authorizedVectorRequest(form));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unsupported image" });
  });

  it("does not silently ignore cleanup settings in Auto", async () => {
    const form = new FormData();
    form.set("image", new File([fixture("png")], "sample.png", { type: MIME.png }));
    form.set("preset", "auto");
    form.set("cleanup", JSON.stringify({ version: 1, cleanup: 2, colors: 16 }));
    const response = await POST(authorizedVectorRequest(form));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unsupported image" });
  });

  it("returns a useful validation error", async () => {
    const form = new FormData();
    form.set("image", new File(["nope"], "bad.png"));
    form.set("preset", "balanced");
    const response = await POST(authorizedVectorRequest(form));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unsupported image" });
  });

  it.each([
    ["animated.png", "image/png", animatedPng],
    ["animated.webp", "image/webp", animatedWebp],
  ])("rejects %s at the route boundary", async (name, mime, buildImage) => {
    const form = new FormData();
    form.set("image", new File([buildImage()], name, { type: mime }));
    form.set("preset", "balanced");
    const response = await POST(authorizedVectorRequest(form));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Animated images are not supported" });
  });
});

describe("POST /api/v1/optimize-svg", () => {
  it("preserves self-contained CSS but removes unsafe style imports", async () => {
    const form = new FormData();
    form.set("image", new File([
      '<svg width="16" height="16"><style>.x{fill:red}</style><path class="x" d="M0 0h16v16z"/></svg>',
    ], "icon.svg", { type: "image/svg+xml" }));
    const response = await optimizeDirectSvgRoute(authorizedVectorRequest(form));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(result).toMatchObject({ downloadName: "icon.svg", safety: { stylesRemoved: 0 } });
    expect(result.svg).toContain("fill:red");

    const unsafeForm = new FormData();
    unsafeForm.set("image", new File([
      '<svg width="16" height="16"><style>@import url(https://example.com/a.css);.x{fill:red}</style><path class="x" d="M0 0h16v16z"/></svg>',
    ], "unsafe.svg", { type: "image/svg+xml" }));
    const unsafeResponse = await optimizeDirectSvgRoute(authorizedVectorRequest(unsafeForm));
    const unsafeResult = await unsafeResponse.json();
    expect(unsafeResult.safety.stylesRemoved).toBe(1);
    expect(unsafeResult.svg).not.toContain("<style");
  });

  it("rejects XML entities before optimization", async () => {
    const form = new FormData();
    form.set("image", new File(['<!DOCTYPE svg [<!ENTITY x "boom">]><svg><text>&x;</text></svg>'], "bad.svg"));
    const response = await optimizeDirectSvgRoute(authorizedVectorRequest(form));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unsupported SVG" });
  });
});
