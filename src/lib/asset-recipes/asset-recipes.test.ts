import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POST as createAssetRecipe } from "@/app/api/v1/asset-recipes/route";
import { generateAssetRecipe } from "@/lib/asset-recipes/generate";
import { parseAssetRecipeOptions } from "@/lib/asset-recipes/options";
import type { AssetRecipeOptions } from "@/lib/asset-recipes/types";
import { runMagick, withMagickTempDirectory } from "@/lib/raster/image-magick";

const TEST_API_KEY = "test-api-key-0123456789abcdefghijklmnop";
const fixture = readFileSync(new URL("../../../test/fixtures/sample.png", import.meta.url));
const source = { name: "sample.png", mime: "image/png", data: fixture };

function parsed(options: AssetRecipeOptions) {
  const form = new FormData();
  form.set("options", JSON.stringify(options));
  return parseAssetRecipeOptions(form.get("options"));
}

describe("asset recipe options", () => {
  it("accepts bounded framing and rejects unsafe values", () => {
    expect(parsed({ recipe: "frame", aspects: ["1:1", "16:9"], focusX: 25, focusY: 75, rotate: 90, flipX: false, flipY: true, trim: true, padding: 12, background: "#112233" })).toMatchObject({ recipe: "frame", aspects: ["1:1", "16:9"] });
    expect(parsed({ recipe: "frame", aspects: ["1:1"], focusX: 101, focusY: 50, rotate: 0, flipX: false, flipY: false, trim: false, padding: 0, background: "#112233" })).toBeNull();
  });

  it("requires alt context and tightly bounded text", () => {
    expect(parsed({ recipe: "social", title: "Release", subtitle: "Asset handoff", alt: "Release preview", background: "#16130f", textColor: "#ffffff" })).toMatchObject({ recipe: "social" });
    expect(parsed({ recipe: "social", title: "Release", subtitle: "", alt: "", background: "#16130f", textColor: "#ffffff" })).toBeNull();
  });
});

describe("asset recipe generation", () => {
  it("uses one focal point for multiple deterministic aspect crops", async () => {
    await withMagickTempDirectory(async (directory) => {
      const pack = await generateAssetRecipe(source, { recipe: "frame", aspects: ["1:1", "16:9", "9:16"], focusX: 20, focusY: 80, rotate: 0, flipX: false, flipY: false, trim: false, padding: 0, background: "#ffffff" }, directory);
      expect(pack.manifest.outputs.filter(({ role }) => role.startsWith("aspect-"))).toHaveLength(3);
      expect(pack.manifest.outputs.map(({ role }) => role)).toContain("lqip");
      expect(pack.previewPath).toContain("frames/1x1.png");
      expect(pack.entries.map(({ name }) => name)).toContain("asset-recipe/sample/manifest.json");
    });
  });

  it("builds web and native icon contracts with safe-zone variants", async () => {
    await withMagickTempDirectory(async (directory) => {
      const pack = await generateAssetRecipe(source, { recipe: "icons", background: "#f1ede3", padding: 12, includeNative: true }, directory);
      const roles = new Set(pack.manifest.outputs.map(({ role }) => role));
      expect(roles.has("favicon")).toBe(true);
      expect(roles.has("pwa-maskable")).toBe(true);
      expect(roles.has("ios-asset-catalog")).toBe(true);
      expect(roles.has("android-adaptive-xml")).toBe(true);
      expect(pack.manifest.outputs.find(({ role }) => role === "pwa-any")).toMatchObject({ width: 192, height: 192 });
      const monochrome = pack.entries.find(({ name }) => name.endsWith("monochrome-512.png"));
      expect(monochrome && "path" in monochrome).toBe(true);
      const corner = await runMagick([(monochrome as { path: string }).path, "-format", "%[pixel:p{0,0}]", "info:-"], { temporaryDirectory: directory });
      expect(corner.stdout.toString()).toMatch(/a\(0\)|,0\)/i);
    });
  }, 30_000);

  it("extracts a palette, WCAG ratios, CSS, and a swatch preview", async () => {
    await withMagickTempDirectory(async (directory) => {
      const pack = await generateAssetRecipe(source, { recipe: "palette", colors: 4, background: "#ffffff" }, directory);
      const palette = pack.entries.find(({ name }) => name.endsWith("palette.json"));
      const data = palette && "data" in palette ? JSON.parse(palette.data.toString()) : null;
      expect(data?.colors.length ?? 0).toBeGreaterThan(0);
      expect(data).toMatchObject({ background: "#ffffff" });
      expect(data?.againstBackground.length ?? 0).toBeGreaterThan(0);
      expect(pack.manifest.outputs.map(({ role }) => role)).toEqual(expect.arrayContaining(["palette-data", "css-variables", "palette-preview", "lqip"]));
    });
  });

  it.each<AssetRecipeOptions>([
    { recipe: "social", title: "Web asset release", subtitle: "Verified handoff", alt: "Warm-toned release preview", background: "#1a1712", textColor: "#ffffff" },
    { recipe: "background", color: "#ffffff", fuzz: 5 },
    { recipe: "watermark", text: "DRAFT", position: "southeast", opacity: 60, color: "#ffffff" },
  ])("renders a preview for $recipe", async (options) => {
    await withMagickTempDirectory(async (directory) => {
      const pack = await generateAssetRecipe(source, options, directory);
      expect(pack.previewPath).toBeTruthy();
      expect(pack.manifest.outputs.find(({ path }) => path === pack.previewPath)?.mime).toMatch(/^image\//);
    });
  }, 30_000);
});

describe("asset recipe API", () => {
  it("returns an authenticated streamed ZIP with hardened headers", async () => {
    process.env.OHMYIMG_API_KEY = TEST_API_KEY;
    const form = new FormData();
    form.set("asset", new File([fixture], "sample.png", { type: "image/png" }));
    form.set("options", JSON.stringify({ recipe: "background", color: "#ffffff", fuzz: 4 }));
    const response = await createAssetRecipe(new Request("http://localhost/api/v1/asset-recipes", { method: "POST", headers: { Authorization: `Bearer ${TEST_API_KEY}` }, body: form }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Number(response.headers.get("x-output-files"))).toBeGreaterThan(0);
    await response.arrayBuffer();
  });
});
