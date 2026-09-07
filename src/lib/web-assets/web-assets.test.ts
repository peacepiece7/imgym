import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POST as inspectAssets } from "@/app/api/v1/inspect-assets/route";
import { POST as createWebAssets } from "@/app/api/v1/web-assets/route";
import { POST as previewWebAsset } from "@/app/api/v1/web-assets/preview/route";
import { runMagick, withMagickTempDirectory } from "@/lib/raster/image-magick";
import {
  detectAvifColorProperties,
  generateWebAssetPack,
  webSafeColorArgs,
} from "@/lib/web-assets/generate";
import { inspectRasterAsset } from "@/lib/web-assets/inspect";
import {
  DEFAULT_WEB_ASSET_OPTIONS,
  parseWebAssetOptions,
  resolveWebAssetWidths,
} from "@/lib/web-assets/options";
import type { WebAssetOptions } from "@/lib/web-assets/types";
import {
  assertSafeZipPath,
  crc32,
  createZipStream,
  WEB_ASSET_ZIP_LIMITS,
} from "@/lib/web-assets/zip";

const TEST_API_KEY = "test-api-key-0123456789abcdefghijklmnop";

function fixture(extension: "png" | "jpg" | "webp") {
  return readFileSync(new URL(`../../../test/fixtures/sample.${extension}`, import.meta.url));
}

function options(overrides: Partial<WebAssetOptions> = {}): WebAssetOptions {
  return {
    ...DEFAULT_WEB_ASSET_OPTIONS,
    altText: "제품 화면 예시",
    includeAvif: false,
    ...overrides,
  };
}

function authorizedRequest(url: string, form: FormData) {
  process.env.OHMYIMG_API_KEY = TEST_API_KEY;
  return new Request(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    body: form,
  });
}

function storedZipEntries(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= data.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const bodyStart = nameStart + nameLength + extraLength;
    const name = Buffer.from(data.subarray(nameStart, nameStart + nameLength)).toString("utf8");
    entries.set(name, Buffer.from(data.subarray(bodyStart, bodyStart + size)));
    offset = bodyStart + size;
  }
  return entries;
}

function jpegWithExif(jpeg: Buffer) {
  const tiff = Buffer.alloc(38);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(6, 18);
  tiff.writeUInt16LE(0x8825, 22);
  tiff.writeUInt16LE(4, 24);
  tiff.writeUInt32LE(1, 26);
  tiff.writeUInt32LE(36, 30);
  tiff.writeUInt32LE(0, 34);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const segment = Buffer.alloc(payload.byteLength + 4);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment.writeUInt16BE(payload.byteLength + 2, 2);
  payload.copy(segment, 4);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

function withDisplayP3Cicp(png: Buffer) {
  const type = Buffer.from("cICP", "ascii");
  const payload = Buffer.from([12, 13, 0, 1]);
  const chunk = Buffer.alloc(12 + payload.byteLength);
  chunk.writeUInt32BE(payload.byteLength, 0);
  type.copy(chunk, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, payload])), 8 + payload.byteLength);
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}

describe("web asset options", () => {
  it("parses the bounded recipe and resolves no-upscale widths", () => {
    const form = new FormData();
    form.set("options", JSON.stringify(options({ customWidths: [320, 640, 1280] })));
    const parsed = parseWebAssetOptions(form.get("options"));
    expect(parsed?.customWidths).toEqual([320, 640, 1280]);
    expect(resolveWebAssetWidths(500, parsed!)).toEqual([{ width: 320 }, { width: 500 }]);
  });

  it("requires human context for non-decorative alt text", () => {
    const form = new FormData();
    form.set("options", JSON.stringify(options({ altText: "" })));
    expect(parseWebAssetOptions(form.get("options"))).toBeNull();
    form.set("options", JSON.stringify(options({ altKind: "decorative", altText: "ignored" })));
    expect(parseWebAssetOptions(form.get("options"))?.altText).toBe("");
  });

  it("validates a separate accessibility decision for every asset", () => {
    const form = new FormData();
    form.set("options", JSON.stringify(options({
      accessibility: [
        { kind: "decorative", text: "ignored" },
        { kind: "functional", text: "상품 상세 보기" },
      ],
    })));
    expect(parseWebAssetOptions(form.get("options"))?.accessibility).toEqual([
      { kind: "decorative", text: "" },
      { kind: "functional", text: "상품 상세 보기" },
    ]);
  });
});

describe("asset preflight", () => {
  it("reports signature facts, alpha, and content hints", async () => {
    const facts = await inspectRasterAsset(fixture("png"), "wrong.jpg", "image/jpeg");
    expect(facts).toMatchObject({
      format: "png",
      actualMime: "image/png",
      extensionMatches: false,
      declaredMimeMatches: false,
      hasAlpha: true,
      frames: 1,
      animated: false,
    });
    expect(facts.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(facts.warnings).toContain("파일 확장자와 실제 이미지 형식이 다릅니다.");
  });

  it("detects orientation and GPS presence without returning metadata values", async () => {
    const facts = await inspectRasterAsset(jpegWithExif(fixture("jpg")), "photo.jpg", "image/jpeg");
    expect(facts.orientation).toBe(6);
    expect(facts.metadata).toMatchObject({ exif: true, gps: true });
    expect(JSON.stringify(facts)).not.toContain("GPSLatitude");
  });

  it("detects alpha encoded directly in lossless WebP", async () => {
    const facts = await inspectRasterAsset(fixture("webp"), "sample.webp", "image/webp");
    expect(facts.hasAlpha).toBe(true);
    expect(facts.detectedContent).toBe("transparent");
  });
});

describe("streamed ZIP", () => {
  it("streams deterministic stored entries and runs cleanup", async () => {
    let cleaned = false;
    const archive = await createZipStream([
      { name: "assets/a.txt", data: Buffer.from("alpha") },
      { name: "manifest.json", data: Buffer.from("{}\n") },
    ], async () => { cleaned = true; });
    const bytes = new Uint8Array(await new Response(archive.stream).arrayBuffer());
    const entries = storedZipEntries(bytes);
    expect(entries.get("assets/a.txt")?.toString()).toBe("alpha");
    expect(entries.get("manifest.json")?.toString()).toBe("{}\n");
    expect(archive.contentLength).toBe(bytes.byteLength);
    expect(cleaned).toBe(true);
  });

  it.each(["../secret", "/absolute", "a\\b", "a//b"])("rejects unsafe path %s", (path) => {
    expect(() => assertSafeZipPath(path)).toThrow("Unsafe ZIP entry path");
  });

  it("runs cleanup when the consumer cancels the stream", async () => {
    let cleaned = false;
    const archive = await createZipStream([
      { name: "large.bin", data: Buffer.alloc(1024 * 1024) },
    ], async () => { cleaned = true; });
    const reader = archive.stream.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cleaned).toBe(true);
  });

  it("bounds entries above the largest valid 10-file custom-width pack", async () => {
    const entries = Array.from({ length: WEB_ASSET_ZIP_LIMITS.maxEntries }, (_, index) => ({
      name: `entry-${index}.txt`,
      data: Buffer.alloc(0),
    }));
    const archive = await createZipStream(entries, async () => undefined);
    await new Response(archive.stream).arrayBuffer();
    expect(archive.entries).toBe(WEB_ASSET_ZIP_LIMITS.maxEntries);
    await expect(createZipStream([
      ...entries,
      { name: "overflow.txt", data: Buffer.alloc(0) },
    ], async () => undefined)).rejects.toThrow("ZIP entry limit exceeded");
  });
});

describe("web asset generation", () => {
  it("uses an ICC transform for profiled Web safe sources", () => {
    const args = webSafeColorArgs({
      exif: false,
      iptc: false,
      xmp: false,
      gps: false,
      icc: true,
      cicp: true,
      srgbChunk: false,
    });
    expect(args).toEqual(expect.arrayContaining(["-profile", "+profile", "*"]));
    expect(() => webSafeColorArgs({
      exif: false,
      iptc: false,
      xmp: false,
      gps: false,
      icc: false,
      cicp: true,
      srgbChunk: false,
    })).toThrow("CICP-only input cannot be safely converted to sRGB");
  });

  it("reads AVIF color methods only from nested colr boxes", () => {
    const box = (type: string, payload: Buffer) => {
      const value = Buffer.alloc(8 + payload.byteLength);
      value.writeUInt32BE(value.byteLength, 0);
      value.write(type, 4, "ascii");
      payload.copy(value, 8);
      return value;
    };
    const color = box("meta", Buffer.concat([
      Buffer.alloc(4),
      box("iprp", box("ipco", Buffer.concat([
        box("colr", Buffer.from("prof-profile", "ascii")),
        box("colr", Buffer.from("nclx-values", "ascii")),
      ]))),
    ]));
    expect(detectAvifColorProperties(color)).toEqual({ icc: true, cicp: true });
    expect(detectAvifColorProperties(box("mdat", Buffer.from("prof nclx", "ascii"))))
      .toEqual({ icc: false, cicp: false });
  });

  it("creates a deterministic quality-gated pack and records partial failure", async () => {
    await withMagickTempDirectory(async (directory) => {
      const pack = await generateWebAssetPack([
        { name: "sample.png", mime: "image/png", data: fixture("png") },
        { name: "bad.png", mime: "image/png", data: Buffer.from("not an image") },
      ], options({ customWidths: [24], includeWebp: true }), directory);
      expect(pack.manifest.summary).toMatchObject({ requested: 2, succeeded: 1, failed: 1 });
      expect(pack.manifest.items[0]).toMatchObject({ status: "succeeded", sourceName: "sample.png" });
      expect(pack.manifest.items[1]).toEqual({
        index: 1,
        status: "failed",
        sourceName: "bad.png",
        error: "Unsupported image",
      });
      const output = pack.manifest.items[0].outputs?.[0];
      expect(output?.quality).toMatchObject({ passed: true, ssim: 1, mae: 0 });
      expect(pack.entries.map(({ name }) => name)).toContain("manifest.json");
      expect(pack.entries.some(({ name }) => name.endsWith(".html"))).toBe(true);
    });
  });

  it("preserves PNG CICP exactly and prunes formats that cannot prove it", async () => {
    await withMagickTempDirectory(async (directory) => {
      const pack = await generateWebAssetPack([
        { name: "display-p3.png", mime: "image/png", data: withDisplayP3Cicp(fixture("png")) },
      ], options({ customWidths: [24], includeWebp: true, includeAvif: true }), directory);
      const item = pack.manifest.items[0];
      expect(item.status).toBe("succeeded");
      expect(item.outputs).toHaveLength(1);
      expect(item.outputs?.[0]).toMatchObject({ format: "png", metadata: { cicp: true } });
      expect(item.pruned).toEqual(expect.arrayContaining([
        { format: "webp", width: 24, reason: "color-profile" },
        { format: "avif", width: 24, reason: "color-profile" },
      ]));
    });
  });

  it("keeps nine successful outputs when one file fails in a ten-file batch", async () => {
    await withMagickTempDirectory(async (directory) => {
      const sources = Array.from({ length: 10 }, (_, index) => ({
        name: `sample-${index}.png`,
        mime: "image/png",
        data: index === 4 ? Buffer.from("not an image") : fixture("png"),
      }));
      const pack = await generateWebAssetPack(
        sources,
        options({ customWidths: [24], includeWebp: false }),
        directory,
      );
      expect(pack.manifest.summary).toMatchObject({ requested: 10, succeeded: 9, failed: 1 });
      expect(pack.manifest.items[4]).toMatchObject({ status: "failed", sourceName: "sample-4.png" });
      expect(pack.manifest.items.filter(({ status }) => status === "succeeded")).toHaveLength(9);
    });
  });

  it("keeps manifest meaning deterministic for the same input and recipe", async () => {
    const manifests: string[] = [];
    for (let run = 0; run < 2; run += 1) {
      await withMagickTempDirectory(async (directory) => {
        const pack = await generateWebAssetPack([
          { name: "same.png", mime: "image/png", data: fixture("png") },
        ], options({ customWidths: [24], includeWebp: false }), directory);
        manifests.push(JSON.stringify(pack.manifest));
      });
    }
    expect(manifests[0]).toBe(manifests[1]);
  });

  it("uses the bounded AVIF delegate available to the canonical runtime", async () => {
    await withMagickTempDirectory(async (directory) => {
      await runMagick([
        "-size", "1x1", "xc:#c8672a",
        "-quality", "72",
        "-define", "heic:speed=9",
        "avif:probe.avif",
      ], { temporaryDirectory: directory });
      const decoded = await runMagick([
        "avif:probe.avif", "-format", "%m %w %h", "info:",
      ], { temporaryDirectory: directory, stdoutLimit: 1_024 });
      expect(decoded.stdout.toString()).toBe("AVIF 1 1");
    });
  });

  it("emits smaller passing WebP and AVIF variants for a representative photo", async () => {
    const generated = await runMagick([
      "-size", "640x360", "gradient:#d98b58-#24364f",
      "-fill", "#f5d7a1", "-draw", "circle 500,100 555,100",
      "-fill", "#1b2430", "-draw", "rectangle 0,270 639,359",
      "-quality", "94", "jpeg:-",
    ]);
    await withMagickTempDirectory(async (directory) => {
      const pack = await generateWebAssetPack([
        { name: "hero.jpg", mime: "image/jpeg", data: generated.stdout },
      ], options({
        customWidths: [320, 640],
        contentHint: "photo",
        includeWebp: true,
        includeAvif: true,
      }), directory);
      const formats = new Set(pack.manifest.items[0].outputs?.map(({ format }) => format));
      expect(formats).toContain("jpeg");
      expect(formats).toContain("webp");
      expect(formats).toContain("avif");
      expect(pack.manifest.items[0].outputs?.every(({ quality }) => quality.passed)).toBe(true);
    });
  }, 120_000);

  it("prunes low-value automatic widths but keeps custom widths", async () => {
    const generated = await runMagick(["-size", "960x540", "xc:#34506a", "png:-"]);
    await withMagickTempDirectory(async (directory) => {
      const automatic = await generateWebAssetPack([
        { name: "flat.png", mime: "image/png", data: generated.stdout },
      ], options({ layout: "card", includeWebp: false }), directory);
      const automaticWidths = automatic.manifest.items[0].outputs?.map(({ width }) => width);
      expect(automaticWidths).toEqual([320, 960]);
      expect(automatic.manifest.items[0].pruned?.filter(({ reason }) => reason === "no-byte-benefit")).toHaveLength(2);
    });
    await withMagickTempDirectory(async (directory) => {
      const custom = await generateWebAssetPack([
        { name: "flat.png", mime: "image/png", data: generated.stdout },
      ], options({ customWidths: [320, 480, 640], includeWebp: false }), directory);
      expect(custom.manifest.items[0].outputs?.map(({ width }) => width)).toEqual([320, 480, 640]);
    });
  });

  it("emits current Next.js 16 and design handoff contracts", async () => {
    await withMagickTempDirectory(async (directory) => {
      const nextPack = await generateWebAssetPack([
        { name: "source.png", mime: "image/png", data: fixture("png") },
      ], options({ profile: "next", loading: "lcp", includePlaceholder: true }), directory);
      const snippet = nextPack.entries.find(({ name }) => name.endsWith(".tsx"));
      expect(snippet && "data" in snippet ? snippet.data.toString() : "").toContain("preload");
      expect(snippet && "data" in snippet ? snippet.data.toString() : "").toContain("blurDataURL");
      expect(snippet && "data" in snippet ? snippet.data.toString() : "").not.toContain("priority");
      expect(nextPack.manifest.items[0].outputs).toHaveLength(1);
    });
    const designSource = await runMagick(["-size", "96x96", "xc:#34506a", "png:-"]);
    await withMagickTempDirectory(async (directory) => {
      const designPack = await generateWebAssetPack([
        { name: "source.png", mime: "image/png", data: designSource.stdout },
      ], options({ profile: "design", designBaseWidth: 32 }), directory);
      expect(designPack.manifest.items[0].outputs?.map(({ scale }) => scale)).toEqual([1, 2, 3]);
      expect(designPack.manifest.items[0].outputs?.map(({ width }) => width)).toEqual([32, 64, 96]);
      expect(designPack.entries.some(({ name }) => name.endsWith(".json"))).toBe(true);
    });
  });

  it("writes per-asset accessibility decisions into snippets and manifest", async () => {
    await withMagickTempDirectory(async (directory) => {
      const pack = await generateWebAssetPack([
        { name: "first.png", mime: "image/png", data: fixture("png") },
        { name: "second.png", mime: "image/png", data: fixture("png") },
      ], options({
        customWidths: [24],
        includeWebp: false,
        accessibility: [
          { kind: "decorative", text: "" },
          { kind: "functional", text: "다음 단계로 이동" },
        ],
      }), directory);
      expect(pack.manifest.items.map(({ accessibility }) => accessibility)).toEqual([
        { kind: "decorative", text: "" },
        { kind: "functional", text: "다음 단계로 이동" },
      ]);
      const snippets = pack.entries
        .filter((entry) => entry.name.endsWith(".html") && "data" in entry)
        .map((entry) => "data" in entry ? entry.data.toString() : "");
      expect(snippets[0]).toContain('alt=""');
      expect(snippets[1]).toContain("다음 단계로 이동");
    });
  });
});

describe("web asset routes", () => {
  it("returns per-file preflight facts", async () => {
    const form = new FormData();
    form.append("images", new File([fixture("webp")], "sample.webp", { type: "image/webp" }));
    const response = await inspectAssets(authorizedRequest("http://localhost/api/v1/inspect-assets", form));
    expect(response.status).toBe(200);
    const payload = await response.json() as { items: Array<{ status: string; facts: { format: string } }> };
    expect(payload.items[0]).toMatchObject({ status: "ready", facts: { format: "webp" } });
  });

  it("returns a streamed archive with manifest and response summary", async () => {
    const form = new FormData();
    form.append("images", new File([fixture("png")], "sample.png", { type: "image/png" }));
    form.set("options", JSON.stringify(options({ customWidths: [24], includeWebp: false })));
    const response = await createWebAssets(authorizedRequest("http://localhost/api/v1/web-assets", form));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("x-asset-succeeded")).toBe("1");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Number(response.headers.get("content-length"))).toBe(bytes.byteLength);
    const entries = storedZipEntries(bytes);
    const manifest = JSON.parse(entries.get("manifest.json")!.toString()) as { summary: { succeeded: number } };
    expect(manifest.summary.succeeded).toBe(1);
  });

  it("returns a quality-gated representative output for preview and individual download", async () => {
    const form = new FormData();
    form.set("images", new File([fixture("png")], "sample.png", { type: "image/png" }));
    form.set("options", JSON.stringify(options({ profile: "next", includePlaceholder: true })));
    const response = await previewWebAsset(authorizedRequest("http://localhost/api/v1/web-assets/preview", form));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-quality-gate")).toBe("imagemagick-raster-v3");
    expect(Number(response.headers.get("x-ssim"))).toBeGreaterThanOrEqual(0.99);
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});
