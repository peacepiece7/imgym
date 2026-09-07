import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { generateMediaRecipe, parseMediaRecipeOptions } from "@/lib/asset-recipes/media";
import { runAssetProcess } from "@/lib/asset-recipes/process";
import { runMagick, withMagickTempDirectory } from "@/lib/raster/image-magick";

function options(value: unknown) {
  const form = new FormData();
  form.set("options", JSON.stringify(value));
  return parseMediaRecipeOptions(form.get("options"));
}

describe("media recipe options", () => {
  it("requires an explicit font rights confirmation", () => {
    expect(options({ recipe: "font", family: "Project Sans", text: "ABC 가나다", licenseConfirmed: false })).toBeNull();
    expect(options({ recipe: "font", family: "Project Sans", text: "ABC 가나다", licenseConfirmed: true })).toMatchObject({ recipe: "font", licenseConfirmed: true });
  });

  it("bounds GIF conversion to the fixed muted-loop recipe", () => {
    expect(options({ recipe: "gif-video", background: "#ffffff" })).toEqual({ recipe: "gif-video", background: "#ffffff" });
    expect(options({ recipe: "gif-video", background: "transparent;movie" })).toBeNull();
  });
});

describe("font recipe", () => {
  it("creates a WOFF2 subset, CSS unicode range, and rights receipt", async () => {
    const path = [
      "/usr/share/fonts/noto/NotoSansCJK-Regular.ttc",
      "/System/Library/Fonts/SFNSMono.ttf",
    ].find(existsSync);
    expect(path).toBeTruthy();
    await withMagickTempDirectory(async (directory) => {
      const pack = await generateMediaRecipe(
        { name: path!.endsWith(".ttc") ? "noto.ttc" : "mono.ttf", mime: "font/ttf", data: readFileSync(path!) },
        { recipe: "font", family: "Project Sans", text: "ABC 123", licenseConfirmed: true },
        directory,
      );
      expect(pack.manifest.outputs.map(({ role }) => role)).toEqual(["woff2-subset", "css", "license-confirmation"]);
      const font = pack.entries.find(({ name }) => name.endsWith("subset.woff2"));
      const css = pack.entries.find(({ name }) => name.endsWith("font-face.css"));
      expect(font && "path" in font ? readFileSync(font.path).toString("ascii", 0, 4) : "").toBe("wOF2");
      expect(css && "data" in css ? css.data.toString() : "").toContain("unicode-range: U+0020, U+0031");
    });
  }, 30_000);
});

describe("GIF video recipe", () => {
  const ffmpegAvailable = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
  it.runIf(ffmpegAvailable)("creates bounded VP9, H.264, poster, and embed outputs", async () => {
    await withMagickTempDirectory(async (directory) => {
      const gif = await runMagick(["-delay", "10", "-loop", "0", "-size", "32x32", "xc:none", "-fill", "red", "-draw", "circle 16,16 16,5", "(", "+clone", "-flop", ")", "gif:-"], { temporaryDirectory: directory });
      const pack = await generateMediaRecipe({ name: "motion.gif", mime: "image/gif", data: gif.stdout }, { recipe: "gif-video", background: "#f1ede3" }, directory);
      expect(pack.manifest.outputs.map(({ role }) => role)).toEqual(["webm", "mp4", "poster", "html"]);
      const signatures = pack.entries.filter((entry) => "path" in entry).map((entry) => readFileSync(entry.path).subarray(0, 4).toString("hex"));
      expect(signatures).toEqual(expect.arrayContaining(["1a45dfa3", "89504e47"]));
      expect(pack.manifest.warnings).toContain("최대 30초·30fps까지만 변환합니다.");
      const mp4 = pack.entries.find((entry) => entry.name.endsWith("animation.mp4"));
      expect(mp4 && "path" in mp4).toBe(true);
      const pixel = await runAssetProcess("ffmpeg", ["-nostdin", "-v", "error", "-i", (mp4 as { path: string }).path, "-vf", "crop=2:2:0:0,format=rgb24", "-frames:v", "1", "-f", "rawvideo", "-"], directory);
      expect(pixel.stdout[0]).toBeGreaterThanOrEqual(235);
      expect(pixel.stdout[0]).toBeLessThanOrEqual(250);
      expect(pixel.stdout[1]).toBeGreaterThanOrEqual(228);
      expect(pixel.stdout[1]).toBeLessThanOrEqual(245);
      expect(pixel.stdout[2]).toBeGreaterThanOrEqual(218);
      expect(pixel.stdout[2]).toBeLessThan(245);
      expect(pixel.stdout[0]).toBeGreaterThan(pixel.stdout[1]);
      expect(pixel.stdout[1]).toBeGreaterThan(pixel.stdout[2]);
    });
  }, 30_000);
});
