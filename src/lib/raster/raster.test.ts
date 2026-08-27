import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readFile, stat, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/optimize-raster/route";
import {
  measureAlphaMae,
  measureAssociatedAlphaDistortion,
  measureEdgeMae,
} from "@/lib/image/image-magick-metric";
import {
  FULL_IMAGE_CROP,
  imageMagickCropGeometry,
  imageMagickResizeGeometry,
  normalizedCropToPixels,
  parseNormalizedCrop,
  parseRasterResize,
  percentCropToNormalized,
} from "./crop";
import { encoderArgs, isRasterMode, isRasterOptimizationPolicy } from "./presets";
import { toOptimizedFilename } from "./filename";
import { readMagickOutputFile, runMagick, withMagickTempDirectory } from "./image-magick";
import {
  AUTO_QUALITY_GATE,
  autoCandidates,
  manualOptimizeArgs,
  metadataArgs,
  optimizeRaster,
} from "./optimize-raster";
import { validateRaster } from "./validate-raster";

function fixture(extension: "png" | "jpg" | "webp") {
  return readFileSync(new URL(`../../../test/fixtures/sample.${extension}`, import.meta.url));
}

const TEST_API_KEY = "test-api-key-0123456789abcdefghijklmnop";

function authorizedRasterRequest(form: FormData) {
  process.env.OHMYIMG_API_KEY = TEST_API_KEY;
  return new Request("http://localhost/api/v1/optimize-raster", {
    method: "POST",
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    body: form,
  });
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

function withExifOrientation(jpeg: Buffer, orientation: number) {
  const exif = Buffer.from([
    0xff, 0xe1, 0x00, 0x22,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  return Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
}

describe("raster trust boundary", () => {
  it.each([
    ["png", "png"],
    ["jpg", "jpeg"],
    ["webp", "webp"],
  ] as const)("accepts a static %s by signature", (extension, format) => {
    expect(validateRaster(fixture(extension))).toMatchObject({
      ok: true,
      format,
      width: 24,
      height: 24,
    });
  });

  it("rejects malformed and oversized data", () => {
    expect(validateRaster(Buffer.from("not an image"))).toEqual({
      ok: false,
      error: "Unsupported image",
      status: 400,
    });
    expect(validateRaster(Buffer.alloc(10 * 1024 * 1024 + 1))).toEqual({
      ok: false,
      error: "File is too large",
      status: 413,
    });
  });

  it("enforces decoded dimension and pixel limits from the encoded header", () => {
    const maxEdge = Buffer.from(fixture("png"));
    maxEdge.writeUInt32BE(8_192, 16);
    maxEdge.writeUInt32BE(1, 20);
    expect(validateRaster(maxEdge)).toMatchObject({ ok: true, width: 8_192, height: 1 });

    const maxPixels = Buffer.from(fixture("png"));
    maxPixels.writeUInt32BE(5_000, 16);
    maxPixels.writeUInt32BE(5_000, 20);
    expect(validateRaster(maxPixels)).toMatchObject({ ok: true, width: 5_000, height: 5_000 });

    const tooWide = Buffer.from(fixture("png"));
    tooWide.writeUInt32BE(8_193, 16);
    expect(validateRaster(tooWide)).toMatchObject({ ok: false, error: "File is too large", status: 413 });

    const tooManyPixels = Buffer.from(fixture("png"));
    tooManyPixels.writeUInt32BE(5_001, 16);
    tooManyPixels.writeUInt32BE(5_000, 20);
    expect(validateRaster(tooManyPixels)).toMatchObject({ ok: false, error: "File is too large", status: 413 });
  });

  it("rejects a truncated image even when its signature and dimensions look valid", () => {
    expect(validateRaster(fixture("png").subarray(0, 33))).toEqual({
      ok: false,
      error: "Unsupported image",
      status: 400,
    });
  });

  it("rejects animated PNG input", () => {
    expect(validateRaster(animatedPng())).toEqual({
      ok: false,
      error: "Animated images are not supported",
      status: 400,
    });
  });

  it("rejects animated WebP input", () => {
    expect(validateRaster(animatedWebp())).toEqual({
      ok: false,
      error: "Animated images are not supported",
      status: 400,
    });
  });
});

describe("normalized crop and resize", () => {
  it("converts the UI percent crop into the normalized server contract", () => {
    const normalized = percentCropToNormalized({ x: 25, y: 20, width: 50, height: 60 });
    expect(normalized?.x).toBeCloseTo(0.25);
    expect(normalized?.y).toBeCloseTo(0.2);
    expect(normalized?.width).toBeCloseTo(0.5);
    expect(normalized?.height).toBeCloseTo(0.6);
    expect(percentCropToNormalized({ x: 0, y: 0, width: 0, height: 100 })).toBeNull();
  });

  it("uses half-open pixel bounds so fractional edges do not lose pixels", () => {
    expect(normalizedCropToPixels({ x: 0.101, y: 0.202, width: 0.5, height: 0.5 }, 100, 50)).toEqual({
      x: 10,
      y: 10,
      width: 51,
      height: 26,
    });
  });

  it("clamps harmless floating point drift and rejects empty crops", () => {
    expect(parseNormalizedCrop({ x: -1e-12, y: 0, width: 1.000000000001, height: 1 })).toEqual(FULL_IMAGE_CROP);
    expect(parseNormalizedCrop({ x: -0.1, y: 0, width: 1, height: 1 })).toBeNull();
    expect(parseNormalizedCrop({ x: 0.9, y: 0, width: 0.2, height: 1 })).toBeNull();
    expect(parseNormalizedCrop({ x: 1, y: 0, width: 0, height: 1 })).toBeNull();
    expect(parseNormalizedCrop({ x: Number.NaN, y: 0, width: 1, height: 1 })).toBeNull();
  });

  it("builds one post-orientation crop geometry expression", () => {
    expect(imageMagickCropGeometry({ x: 0.25, y: 0.2, width: 0.5, height: 0.6 })).toBe(
      "%[fx:ceil(0.75*w)-floor(0.25*w)]x%[fx:ceil(0.8*h)-floor(0.2*h)]+%[fx:floor(0.25*w)]+%[fx:floor(0.2*h)]",
    );
  });

  it("parses bounded resize dimensions and prevents enlargement", () => {
    expect(parseRasterResize({ maxWidth: 1600 })).toEqual({ maxWidth: 1600, maxHeight: undefined });
    expect(parseRasterResize({ maxWidth: 8193 })).toBeNull();
    expect(imageMagickResizeGeometry({ maxWidth: 1600, maxHeight: 1200 })).toBe("1600x1200>");
    expect(imageMagickResizeGeometry({})).toBeNull();
  });
});

describe("raster presets", () => {
  it.each(["high", "balanced", "small", "auto"])("recognizes %s", (mode) => {
    expect(isRasterMode(mode)).toBe(true);
  });

  it("accepts only the two public optimization policies", () => {
    expect(isRasterOptimizationPolicy("standard")).toBe(true);
    expect(isRasterOptimizationPolicy("smaller")).toBe(true);
    expect(isRasterOptimizationPolicy("quality=1")).toBe(false);
  });

  it("keeps aggressive encoder flags inside bounded server-owned candidate tables", () => {
    expect(autoCandidates("png", "standard")).toHaveLength(4);
    expect(autoCandidates("png", "smaller")).toHaveLength(10);
    expect(autoCandidates("jpeg", "smaller")).toHaveLength(12);
    expect(autoCandidates("webp", "smaller")).toHaveLength(12);
    expect(autoCandidates("png", "smaller").some(({ args }) => args.includes("32"))).toBe(true);
    expect(autoCandidates("jpeg", "smaller").some(({ args }) => args.includes("Plane"))).toBe(true);
    expect(autoCandidates("webp", "smaller").some(({ args }) => args.includes("webp:use-sharp-yuv=true"))).toBe(true);
  });

  it("keeps format-specific encoder controls centralized", () => {
    expect(encoderArgs("jpeg", "high")).toContain("92");
    expect(encoderArgs("webp", "balanced")).toContain("webp:method=5");
    expect(encoderArgs("png", "small")).toContain("png:compression-level=9");
  });

  it.each(["png", "jpeg", "webp"] as const)("removes private metadata but preserves ICC for %s", (format) => {
    const args = metadataArgs(format);
    expect(args).toContain("!icc,*");
    expect(args).not.toContain("*");
    expect(args).toContain("comment");
  });

  it("creates a safe same-format download name", () => {
    expect(toOptimizedFilename("../../my photo.JPEG", "jpeg")).toBe("my-photo-optimized.jpg");
    expect(toOptimizedFilename(".png", "png")).toBe("image-optimized.png");
  });
});

describe("ImageMagick raster pipeline", () => {
  it("ignores invisible RGB differences after associating alpha for metrics", async () => {
    await withMagickTempDirectory(async (directory) => {
      await runMagick(["-size", "8x8", "xc:#00000000", "miff:hidden-black.miff"], {
        temporaryDirectory: directory,
      });
      await runMagick(["-size", "8x8", "xc:#ffffff00", "miff:hidden-white.miff"], {
        temporaryDirectory: directory,
      });

      const ssim = await measureAssociatedAlphaDistortion(
        "miff:hidden-black.miff",
        "miff:hidden-white.miff",
        "SSIM",
        directory,
      );
      const mae = await measureAssociatedAlphaDistortion(
        "miff:hidden-black.miff",
        "miff:hidden-white.miff",
        "MAE",
        directory,
      );
      expect(ssim).toBeCloseTo(0, 8);
      expect(mae).toBeCloseTo(0, 8);
    });
  });

  it("still detects a real alpha-channel loss after association", async () => {
    await withMagickTempDirectory(async (directory) => {
      await runMagick(["-size", "8x8", "xc:#ff000000", "miff:transparent.miff"], {
        temporaryDirectory: directory,
      });
      await runMagick(["-size", "8x8", "xc:#ff0000ff", "miff:opaque.miff"], {
        temporaryDirectory: directory,
      });

      const mae = await measureAssociatedAlphaDistortion(
        "miff:transparent.miff",
        "miff:opaque.miff",
        "MAE",
        directory,
      );
      expect(mae).toBeGreaterThan(AUTO_QUALITY_GATE.maximumMae);
      expect(await measureAlphaMae(
        "miff:transparent.miff",
        "miff:opaque.miff",
        directory,
      )).toBeGreaterThan(AUTO_QUALITY_GATE.maximumAlphaMae);
    });
  });

  it("detects moved hard edges independently of whole-image similarity", async () => {
    await withMagickTempDirectory(async (directory) => {
      await runMagick(["-size", "32x32", "xc:white", "-fill", "black", "-draw", "rectangle 0,0 15,31", "miff:left.miff"], {
        temporaryDirectory: directory,
      });
      await runMagick(["-size", "32x32", "xc:white", "-fill", "black", "-draw", "rectangle 0,0 17,31", "miff:right.miff"], {
        temporaryDirectory: directory,
      });
      expect(await measureEdgeMae("miff:left.miff", "miff:right.miff", directory)).toBeGreaterThan(0);
    });
  });

  it("returns only the selected PNG pixels when resize is disabled", async () => {
    const source = fixture("png");
    const result = await optimizeRaster(source, {
      crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      mode: "high",
    });
    const expectedImage = await runMagick([
      "png:-[0]", "-crop", "12x12+6+6", "+repage", "png:-",
    ], { input: source });
    const expected = await runMagick([
      "png:-[0]", "-format", "%#", "info:",
    ], { input: expectedImage.stdout, stdoutLimit: 1_024 });
    const actual = await runMagick([
      "png:-[0]", "-format", "%#", "info:",
    ], { input: result.image, stdoutLimit: 1_024 });

    expect([result.width, result.height]).toEqual([12, 12]);
    expect(actual.stdout.toString()).toBe(expected.stdout.toString());
  });

  it.each([
    ["png", "png"],
    ["jpg", "jpeg"],
    ["webp", "webp"],
  ] as const)("crops, bounds-resizes, and encodes %s", async (extension, format) => {
    const result = await optimizeRaster(fixture(extension), {
      crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      resize: { maxWidth: 8, maxHeight: 8 },
      mode: "balanced",
    });

    expect(result.format).toBe(format);
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
    expect(result.selection).toEqual({
      mode: "balanced",
      policy: "standard",
      preset: "balanced",
      candidates: 1,
    });
    expect(result.image.byteLength).toBeGreaterThan(0);
  });

  it("places orientation before crop and resize in one process", () => {
    const args = manualOptimizeArgs("jpeg", {
      crop: FULL_IMAGE_CROP,
      resize: { maxWidth: 20 },
      mode: "high",
    }, "high");
    expect(args.indexOf("-auto-orient")).toBeLessThan(args.indexOf("-crop"));
    expect(args.indexOf("-crop")).toBeLessThan(args.indexOf("-resize"));
    expect(args).toContain("jpeg:-[0]");
    expect(args.at(-1)).toBe("jpeg:-");
  });

  it("honors EXIF orientation before reporting output dimensions", async () => {
    const generated = await runMagick(["-size", "40x20", "gradient:red-blue", "jpeg:-"]);
    const orientedJpeg = withExifOrientation(generated.stdout, 6);
    const result = await optimizeRaster(orientedJpeg, {
      crop: FULL_IMAGE_CROP,
      mode: "high",
    });

    expect(result.width).toBe(20);
    expect(result.height).toBe(40);
    const metadata = await runMagick([
      "jpeg:-[0]", "-format", "%[orientation]", "info:",
    ], { input: result.image, stdoutLimit: 1_024 });
    expect(metadata.stdout.toString()).toBe("Undefined");
  });

  it("normalizes all eight EXIF orientations", async () => {
    const generated = await runMagick(["-size", "40x20", "gradient:red-blue", "jpeg:-"]);
    for (let orientation = 1; orientation <= 8; orientation += 1) {
      const result = await optimizeRaster(withExifOrientation(generated.stdout, orientation), {
        crop: FULL_IMAGE_CROP,
        mode: "high",
      });
      const swapsAxes = orientation >= 5;
      expect([result.width, result.height], `orientation ${orientation}`).toEqual(
        swapsAxes ? [20, 40] : [40, 20],
      );
    }
  });

  it("applies normalized top-left crops in every oriented coordinate space", async () => {
    const generated = await runMagick([
      "-size", "40x20", "xc:red",
      "-fill", "lime", "-draw", "rectangle 20,0 39,9",
      "-fill", "blue", "-draw", "rectangle 0,10 19,19",
      "-fill", "yellow", "-draw", "rectangle 20,10 39,19",
      "-quality", "100", "-sampling-factor", "4:4:4", "jpeg:-",
    ]);
    const expected = [
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
      [0, 0, 1],
      [1, 1, 0],
      [0, 1, 0],
    ];

    for (let orientation = 1; orientation <= 8; orientation += 1) {
      const result = await optimizeRaster(withExifOrientation(generated.stdout, orientation), {
        crop: { x: 0, y: 0, width: 0.4, height: 0.4 },
        mode: "high",
      });
      const sampled = await runMagick([
        "jpeg:-[0]", "-colorspace", "sRGB", "-format",
        "%[fx:mean.r],%[fx:mean.g],%[fx:mean.b]", "info:",
      ], { input: result.image, stdoutLimit: 1_024 });
      const channels = sampled.stdout.toString().split(",").map(Number);
      for (const [index, value] of channels.entries()) {
        expect(value, `orientation ${orientation}, channel ${index}`).toBeCloseTo(expected[orientation - 1][index], 0);
      }
    }
  });

  it.each(
    (["png", "jpg", "webp"] as const).flatMap((extension) =>
      (["high", "balanced", "small"] as const).map((mode) => [extension, mode] as const),
    ),
  )("runs the %s %s preset", async (extension, mode) => {
    const result = await optimizeRaster(fixture(extension), { crop: FULL_IMAGE_CROP, mode });
    expect(result.selection.preset).toBe(mode);
    expect(result.image.byteLength).toBeGreaterThan(0);
  });

  it("never enlarges an image to the requested maximum", async () => {
    const result = await optimizeRaster(fixture("png"), {
      crop: FULL_IMAGE_CROP,
      resize: { maxWidth: 100, maxHeight: 100 },
      mode: "balanced",
    });
    expect([result.width, result.height]).toEqual([24, 24]);
  });

  it("terminates output that exceeds the wrapper cap", async () => {
    await expect(runMagick(["-size", "10x10", "xc:red", "rgb:-"], {
      stdoutLimit: 10,
    })).rejects.toThrow("output exceeded the limit");
  });

  it("bounds Auto candidate files before reading them into memory", async () => {
    await withMagickTempDirectory(async (directory) => {
      const path = join(directory, "candidate.png");
      await writeFile(path, Buffer.alloc(11));
      await expect(readMagickOutputFile(path, 10)).rejects.toThrow("output exceeded the limit");
    });
  });

  it("terminates diagnostics that exceed the wrapper cap", async () => {
    const manyInputs = Array.from({ length: 21 }, () => "logo:");
    await expect(runMagick(["-debug", "all", ...manyInputs, "+append", "null:"]))
      .rejects.toThrow("diagnostics exceeded the limit");
  });

  it("keeps CMYK JPEG output in the source color space", async () => {
    const generated = await runMagick([
      "-size", "64x32", "gradient:red-blue", "-colorspace", "CMYK",
      "-quality", "95", "jpeg:-",
    ]);
    const result = await optimizeRaster(generated.stdout, { crop: FULL_IMAGE_CROP, mode: "high" });
    const colorspace = await runMagick([
      "jpeg:-[0]", "-format", "%[colorspace]", "info:",
    ], { input: result.image, stdoutLimit: 1_024 });
    expect(colorspace.stdout.toString()).toBe("CMYK");
  });

  it.each(["png", "webp"] as const)("preserves the alpha channel in %s output", async (format) => {
    const generated = await runMagick([
      "-size", "64x32", "xc:none",
      "-fill", "#ff000080", "-draw", "rectangle 0,0 31,31",
      "-fill", "#0000ff80", "-draw", "rectangle 32,0 63,31",
      `${format}:-`,
    ]);
    const result = await optimizeRaster(generated.stdout, { crop: FULL_IMAGE_CROP, mode: "high" });
    const alpha = await runMagick([
      `${format}:-[0]`, "-format", "%[fx:mean.a]", "info:",
    ], { input: result.image, stdoutLimit: 1_024 });
    expect(Number(alpha.stdout.toString())).toBeCloseTo(0.5, 2);
  });

  it.each([
    ["png", 4],
    ["jpg", 7],
  ] as const)("searches a bounded Auto candidate set for %s", async (extension, candidates) => {
    const result = await optimizeRaster(fixture(extension), {
      crop: FULL_IMAGE_CROP,
      mode: "auto",
    });

    expect(result.selection.mode).toBe("auto");
    expect(result.selection.candidates).toBe(candidates);
    expect(AUTO_QUALITY_GATE.version).toBe("imagemagick-raster-v3");
    expect(result.selection.ssim).toBeGreaterThanOrEqual(0.99);
    expect(result.selection.mae).toBeLessThanOrEqual(0.02);
    expect(result.selection.edgeMae).toBeLessThanOrEqual(AUTO_QUALITY_GATE.maximumEdgeMae);
    expect(result.selection.alphaMae).toBeLessThanOrEqual(AUTO_QUALITY_GATE.maximumAlphaMae);
  });

  it("searches WebP candidates when the calibrated gates can be met", async () => {
    const generated = await runMagick(["-size", "32x32", "xc:#884422", "webp:-"]);
    const result = await optimizeRaster(generated.stdout, { crop: FULL_IMAGE_CROP, mode: "auto" });
    expect(result.selection.candidates).toBe(7);
    expect(result.selection.ssim).toBeGreaterThanOrEqual(0.99);
  });

  it.each([
    ["png", 10],
    ["jpg", 12],
    ["webp", 12],
  ] as const)("runs the bounded Smaller candidate family for %s behind the same quality gate", async (extension, candidates) => {
    const result = await optimizeRaster(fixture(extension), {
      crop: FULL_IMAGE_CROP,
      mode: "auto",
      optimization: { policy: "smaller" },
    });
    expect(result.selection.policy).toBe("smaller");
    expect(result.selection.candidates).toBe(candidates);
    expect(result.selection.ssim).toBeGreaterThanOrEqual(AUTO_QUALITY_GATE.minimumSsim);
    expect(result.selection.mae).toBeLessThanOrEqual(AUTO_QUALITY_GATE.maximumMae);
    expect(result.selection.edgeMae).toBeLessThanOrEqual(AUTO_QUALITY_GATE.maximumEdgeMae);
    expect(result.selection.alphaMae).toBeLessThanOrEqual(AUTO_QUALITY_GATE.maximumAlphaMae);
  });

  it("does not reject transparent WebP because the encoder normalized invisible RGB", async () => {
    const result = await optimizeRaster(fixture("webp"), {
      crop: FULL_IMAGE_CROP,
      mode: "auto",
    });
    expect(result.selection.ssim).toBeGreaterThanOrEqual(AUTO_QUALITY_GATE.minimumSsim);
    expect(result.selection.mae).toBeLessThanOrEqual(AUTO_QUALITY_GATE.maximumMae);
  });

  it("preserves the abort reason raised while an Auto candidate is running", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel raster Auto candidate");
    const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;
    let checks = 0;
    Object.defineProperty(controller.signal, "throwIfAborted", {
      configurable: true,
      value: function throwIfAborted(this: AbortSignal) {
        checks += 1;
        if (checks === 3) queueMicrotask(() => controller.abort(reason));
        nativeThrowIfAborted.call(this);
      },
    });
    const anySignal = vi.spyOn(AbortSignal, "any").mockReturnValue(controller.signal);

    try {
      await expect(optimizeRaster(fixture("jpg"), {
        crop: FULL_IMAGE_CROP,
        mode: "auto",
      }, controller.signal)).rejects.toBe(reason);
    } finally {
      anySignal.mockRestore();
    }
  });

  it("checks the Auto deadline immediately before returning a lossy winner", async () => {
    const controller = new AbortController();
    const reason = new Error("expire raster Auto before return");
    const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;
    let checks = 0;
    Object.defineProperty(controller.signal, "throwIfAborted", {
      configurable: true,
      value: function throwIfAborted(this: AbortSignal) {
        checks += 1;
        if (checks === 10) controller.abort(reason);
        nativeThrowIfAborted.call(this);
      },
    });
    const anySignal = vi.spyOn(AbortSignal, "any").mockReturnValue(controller.signal);

    try {
      await expect(optimizeRaster(fixture("jpg"), {
        crop: FULL_IMAGE_CROP,
        mode: "auto",
      }, controller.signal)).rejects.toBe(reason);
      expect(checks).toBe(10);
    } finally {
      anySignal.mockRestore();
    }
  });
});

describe("POST /api/v1/optimize-raster", () => {
  it.each([
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
    ["webp", "image/webp"],
  ] as const)("returns an optimized %s with binary metadata", async (extension, mime) => {
    const form = new FormData();
    form.set("image", new File([fixture(extension)], `sample.${extension}`, { type: mime }));
    form.set("options", JSON.stringify({
      crop: { x: 0, y: 0, width: 1, height: 1 },
      resize: { maxWidth: 12, maxHeight: 12 },
      mode: "balanced",
    }));
    const response = await POST(authorizedRasterRequest(form));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(mime);
    expect(response.headers.get("content-disposition")).toContain(`sample-optimized.${extension}`);
    expect(response.headers.get("x-output-width")).toBe("12");
    expect(response.headers.get("x-output-height")).toBe("12");
    expect(response.headers.get("x-selected-preset")).toBe("balanced");
    expect(response.headers.get("x-optimization-policy")).toBe("standard");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("accepts Smaller only for Auto and reports the selected policy", async () => {
    const autoForm = new FormData();
    autoForm.set("image", new File([fixture("png")], "sample.png", { type: "image/png" }));
    autoForm.set("options", JSON.stringify({
      crop: FULL_IMAGE_CROP,
      mode: "auto",
      optimization: { policy: "smaller" },
    }));
    const autoResponse = await POST(authorizedRasterRequest(autoForm));
    expect(autoResponse.status).toBe(200);
    expect(autoResponse.headers.get("x-optimization-policy")).toBe("smaller");
    expect(autoResponse.headers.get("x-candidate-count")).toBe("10");

    const manualForm = new FormData();
    manualForm.set("image", new File([fixture("png")], "sample.png", { type: "image/png" }));
    manualForm.set("options", JSON.stringify({
      crop: FULL_IMAGE_CROP,
      mode: "balanced",
      optimization: { policy: "smaller" },
    }));
    const manualResponse = await POST(authorizedRasterRequest(manualForm));
    expect(manualResponse.status).toBe(400);
    expect(await manualResponse.json()).toEqual({ error: "Invalid request" });
  });

  it("returns concise validation errors", async () => {
    const form = new FormData();
    form.set("image", new File(["nope"], "bad.png"));
    form.set("options", JSON.stringify({ crop: FULL_IMAGE_CROP, mode: "balanced" }));
    const response = await POST(authorizedRasterRequest(form));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unsupported image" });
  });

  it("does not leak process diagnostics through a route failure", async () => {
    const previous = process.env.IMAGEMAGICK_BINARY;
    process.env.IMAGEMAGICK_BINARY = "missing-ohmyimg-magick";
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const form = new FormData();
      form.set("image", new File([fixture("png")], "sample.png", { type: "image/png" }));
      form.set("options", JSON.stringify({ crop: FULL_IMAGE_CROP, mode: "balanced" }));
      const response = await POST(authorizedRasterRequest(form));
      const payload = await response.json() as { error: string; requestId: string };
      expect(response.status).toBe(500);
      expect(payload.error).toBe("Image processing failed.");
      expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.stringify(payload)).not.toContain("missing-ohmyimg-magick");
      expect(errorLog).toHaveBeenCalledOnce();
    } finally {
      errorLog.mockRestore();
      if (previous === undefined) delete process.env.IMAGEMAGICK_BINARY;
      else process.env.IMAGEMAGICK_BINARY = previous;
    }
  });

  it("does not pass the owner API key to ImageMagick or its delegates", async () => {
    const previousBinary = process.env.IMAGEMAGICK_BINARY;
    const previousKey = process.env.OHMYIMG_API_KEY;
    process.env.IMAGEMAGICK_BINARY = process.execPath;
    process.env.OHMYIMG_API_KEY = TEST_API_KEY;
    try {
      const result = await runMagick([
        "-e",
        "process.stdout.write(process.env.OHMYIMG_API_KEY ?? 'absent')",
      ]);
      expect(result.stdout.toString("utf8")).toBe("absent");
    } finally {
      if (previousBinary === undefined) delete process.env.IMAGEMAGICK_BINARY;
      else process.env.IMAGEMAGICK_BINARY = previousBinary;
      if (previousKey === undefined) delete process.env.OHMYIMG_API_KEY;
      else process.env.OHMYIMG_API_KEY = previousKey;
    }
  });

  it("terminates an active ImageMagick child when its request is cancelled", async () => {
    const previousBinary = process.env.IMAGEMAGICK_BINARY;
    process.env.IMAGEMAGICK_BINARY = process.execPath;
    const controller = new AbortController();
    const startedAt = performance.now();
    try {
      const running = runMagick([
        "-e",
        "setInterval(() => undefined, 1000)",
      ], { signal: controller.signal });
      setTimeout(() => controller.abort(), 25);
      await expect(running).rejects.toThrow("ImageMagick was cancelled");
      expect(performance.now() - startedAt).toBeLessThan(2_000);
    } finally {
      if (previousBinary === undefined) delete process.env.IMAGEMAGICK_BINARY;
      else process.env.IMAGEMAGICK_BINARY = previousBinary;
    }
  });

  it.skipIf(process.platform === "win32")(
    "terminates ImageMagick delegate processes with the parent",
    async () => {
      const previousBinary = process.env.IMAGEMAGICK_BINARY;
      process.env.IMAGEMAGICK_BINARY = process.execPath;
      const controller = new AbortController();
      let delegatePid: number | undefined;

      try {
        await withMagickTempDirectory(async (directory) => {
          const pidPath = join(directory, "delegate.pid");
          const heartbeatPath = join(directory, "delegate.heartbeat");
          const delegateSource = [
            'const fs = require("node:fs")',
            "const heartbeat = process.argv[1]",
            "process.on(\"SIGTERM\", () => undefined)",
            'const timer = setInterval(() => fs.appendFileSync(heartbeat, "x"), 20)',
            "setTimeout(() => clearInterval(timer), 5000)",
          ].join(";");
          const parentSource = [
            'const fs = require("node:fs")',
            'const { spawn } = require("node:child_process")',
            `const delegate = spawn(process.execPath, ["-e", ${JSON.stringify(delegateSource)}, process.argv[2]], { stdio: "ignore" })`,
            "fs.writeFileSync(process.argv[1], String(delegate.pid))",
            "setInterval(() => undefined, 1000)",
          ].join(";");
          const running = runMagick(["-e", parentSource, pidPath, heartbeatPath], {
            signal: controller.signal,
            temporaryDirectory: directory,
          });
          const outcome = running.then(
            () => new Error("ImageMagick unexpectedly completed"),
            (error: unknown) => error,
          );

          for (let attempt = 0; attempt < 100; attempt += 1) {
            try {
              delegatePid = Number(await readFile(pidPath, "utf8"));
              if ((await stat(heartbeatPath)).size > 0) break;
            } catch {
              // Wait until the fake delegate has started and written once.
            }
            await delay(10);
          }
          expect(delegatePid).toBeGreaterThan(0);
          expect((await stat(heartbeatPath)).size).toBeGreaterThan(0);

          controller.abort();
          expect(await outcome).toMatchObject({ message: "ImageMagick was cancelled" });
          await delay(1_150);
          const stoppedSize = (await stat(heartbeatPath)).size;
          await delay(150);
          expect((await stat(heartbeatPath)).size).toBe(stoppedSize);
        });
      } finally {
        controller.abort();
        if (delegatePid) {
          try {
            process.kill(delegatePid, "SIGKILL");
          } catch {
            // The expected path already terminated the delegate process group.
          }
        }
        if (previousBinary === undefined) delete process.env.IMAGEMAGICK_BINARY;
        else process.env.IMAGEMAGICK_BINARY = previousBinary;
      }
    },
  );
});
