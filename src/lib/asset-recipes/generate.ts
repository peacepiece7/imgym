import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { imageDimensionsFromData } from "image-dimensions";
import { MAGICK_LIMIT_ARGS, readMagickOutputFile, runMagick } from "@/lib/raster/image-magick";
import { metadataArgs, stripPngPrivateChunks } from "@/lib/raster/optimize-raster";
import { validateRaster } from "@/lib/raster/validate-raster";
import { safeAssetStem } from "@/lib/web-assets/filename";
import { inspectRasterAsset } from "@/lib/web-assets/inspect";
import type { ZipEntry } from "@/lib/web-assets/zip";
import {
  ASPECT_RATIOS,
  ASSET_RECIPE_ID,
  ASSET_RECIPE_MANIFEST_VERSION,
  type AssetRecipeManifest,
  type AssetRecipeOptions,
  type AssetRecipeOutput,
} from "@/lib/asset-recipes/types";
import { webSafeColorArgs } from "@/lib/web-assets/generate";

export interface AssetRecipeSource {
  name: string;
  mime: string | null;
  data: Buffer;
}

export interface GeneratedAssetRecipe {
  entries: ZipEntry[];
  manifest: AssetRecipeManifest;
  previewPath?: string;
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  json: "application/json",
  css: "text/css",
  html: "text/html",
  xml: "application/xml",
};

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

function extension(path: string) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function dimensions(data: Buffer) {
  try {
    const result = imageDimensionsFromData(new Uint8Array(data));
    return result ? { width: result.width, height: result.height } : {};
  } catch {
    return {};
  }
}

function xml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function lines(value: string, maximum: number, limit: number) {
  const words = value.split(/\s+/).filter(Boolean);
  const output: string[] = [];
  for (const word of words) {
    const current = output.at(-1);
    if (!current || `${current} ${word}`.length > maximum) output.push(word);
    else output[output.length - 1] = `${current} ${word}`;
    if (output.length >= limit) break;
  }
  return output;
}

function textOverlaySvg(
  width: number,
  height: number,
  title: string,
  subtitle: string,
  color: string,
) {
  const titleLines = lines(title, 25, 2);
  const subtitleLines = lines(subtitle, 52, 2);
  const titleSpans = titleLines.map((line, index) => `<tspan x="72" dy="${index ? 72 : 0}">${xml(line)}</tspan>`).join("");
  const subtitleY = 430 + Math.max(0, titleLines.length - 1) * 72;
  const subtitleSpans = subtitleLines.map((line, index) => `<tspan x="72" dy="${index ? 35 : 0}">${xml(line)}</tspan>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><text x="72" y="330" fill="${color}" font-family="Noto Sans CJK KR, Apple SD Gothic Neo, sans-serif" font-size="64" font-weight="700">${titleSpans}</text><text x="72" y="${subtitleY}" fill="${color}" fill-opacity=".82" font-family="Noto Sans CJK KR, Apple SD Gothic Neo, sans-serif" font-size="28">${subtitleSpans}</text></svg>`;
}

function watermarkSvg(width: number, height: number, text: string, color: string, opacity: number, position: Extract<AssetRecipeOptions, { recipe: "watermark" }>["position"]) {
  const margin = Math.max(18, Math.round(Math.min(width, height) * 0.04));
  const coordinates = {
    northwest: [margin, margin, "start", "hanging"],
    northeast: [width - margin, margin, "end", "hanging"],
    southwest: [margin, height - margin, "start", "auto"],
    southeast: [width - margin, height - margin, "end", "auto"],
    center: [width / 2, height / 2, "middle", "middle"],
  }[position];
  const fontSize = Math.max(16, Math.round(Math.min(width, height) * 0.055));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="${coordinates[0]}" y="${coordinates[1]}" text-anchor="${coordinates[2]}" dominant-baseline="${coordinates[3]}" fill="${color}" fill-opacity="${opacity / 100}" stroke="#000" stroke-opacity="${opacity / 300}" stroke-width="2" paint-order="stroke" font-family="Noto Sans CJK KR, Apple SD Gothic Neo, sans-serif" font-size="${fontSize}" font-weight="600">${xml(text)}</text></svg>`;
}

function heicSignature(data: Buffer) {
  if (data.byteLength < 16 || data.toString("ascii", 4, 8) !== "ftyp") return false;
  const brand = data.toString("ascii", 8, 12);
  return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand);
}

function contrast(left: string, right: string) {
  const luminance = (hex: string) => {
    const values = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  const [a, b] = [luminance(left), luminance(right)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

function parsePalette(histogram: string, count: number) {
  const colors = [...histogram.matchAll(/#([0-9A-Fa-f]{6})(?:[0-9A-Fa-f]{2})?\b/g)]
    .map((match) => `#${match[1].toLowerCase()}`);
  return [...new Set(colors)].slice(0, count);
}

export async function generateAssetRecipe(
  source: AssetRecipeSource,
  options: AssetRecipeOptions,
  temporaryDirectory: string,
  signal?: AbortSignal,
): Promise<GeneratedAssetRecipe> {
  const stem = safeAssetStem(source.name);
  const root = `asset-recipe/${stem}`;
  const entries: ZipEntry[] = [];
  const outputs: AssetRecipeOutput[] = [];
  const warnings: string[] = [];
  let previewPath: string | undefined;
  let inputPath = "";
  let width = 0;
  let height = 0;
  let colorArgs: string[] = ["-colorspace", "sRGB", "+profile", "*"];

  const addData = (relativePath: string, role: string, data: Buffer) => {
    const path = `${root}/${relativePath}`;
    entries.push({ name: path, data });
    outputs.push({ path, role, mime: MIME[extension(path)] ?? "application/octet-stream", bytes: data.byteLength, sha256: sha256(data), ...dimensions(data) });
    return path;
  };
  const addFile = async (relativePath: string, role: string, generatedPath: string, stripPng = false) => {
    let data: Buffer = Buffer.from(await readMagickOutputFile(generatedPath));
    if (stripPng) {
      data = stripPngPrivateChunks(data);
      await writeFile(generatedPath, data);
    }
    const path = `${root}/${relativePath}`;
    entries.push({ name: path, path: generatedPath });
    outputs.push({ path, role, mime: MIME[extension(path)] ?? "application/octet-stream", bytes: data.byteLength, sha256: sha256(data), ...dimensions(data) });
    return path;
  };
  const render = async (relativePath: string, role: string, args: readonly string[], coder: string, stripPng = false) => {
    const path = join(temporaryDirectory, relativePath.replaceAll("/", "-"));
    await runMagick([...MAGICK_LIMIT_ARGS, ...args, ...metadataArgs(coder === "jpg" ? "jpeg" : coder === "png" ? "png" : "webp"), `${coder}:${path}`], { temporaryDirectory, signal });
    return addFile(relativePath, role, path, stripPng);
  };

  if (options.recipe === "heic") {
    if (!heicSignature(source.data)) throw new Error("Unsupported HEIC");
    inputPath = join(temporaryDirectory, "source.heic");
    await writeFile(inputPath, source.data);
    const identified = await runMagick(["identify", "-ping", "-format", "%w,%h,%z", `${inputPath}[0]`], { temporaryDirectory, signal, stdoutLimit: 128 });
    const values = identified.stdout.toString().split(",").map(Number);
    [width, height] = values;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 25_000_000) throw new Error("File is too large");
    if (values[2] > 8) throw new Error("HDR HEIC is not supported");
    const base = [`${inputPath}[0]`, "-auto-orient", "-colorspace", "sRGB", "+profile", "*"];
    previewPath = await render("converted/photo.jpg", "jpeg-fallback", [...base, "-quality", "90", "-sampling-factor", "4:2:0", "-interlace", "Plane"], "jpg");
    await render("converted/photo.webp", "webp", [...base, "-quality", "86", "-define", "webp:method=6"], "webp");
    warnings.push("SDR 8-bit 첫 프레임만 변환합니다. HDR gain map과 Live Photo 영상은 포함하지 않습니다.");
  } else {
    const valid = validateRaster(source.data);
    if (!valid.ok) throw new Error(valid.error);
    ({ width, height } = valid);
    inputPath = join(temporaryDirectory, `source.${valid.format === "jpeg" ? "jpg" : valid.format}`);
    await writeFile(inputPath, source.data);
    const facts = await inspectRasterAsset(source.data, source.name, source.mime);
    colorArgs = webSafeColorArgs(facts.metadata);

    if (options.recipe === "frame") {
      const normalized = join(temporaryDirectory, "normalized.miff");
      const transforms = [
        `${inputPath}[0]`, "-auto-orient",
        ...(options.trim ? ["-trim", "+repage"] : []),
        ...(options.flipX ? ["-flop"] : []),
        ...(options.flipY ? ["-flip"] : []),
        ...(options.rotate ? ["-rotate", String(options.rotate)] : []),
        ...(options.padding ? ["-bordercolor", options.background, "-border", `${options.padding}x${options.padding}`] : []),
        ...colorArgs,
        `miff:${normalized}`,
      ];
      await runMagick([...MAGICK_LIMIT_ARGS, ...transforms], { temporaryDirectory, signal });
      const identified = await runMagick(["identify", "-ping", "-format", "%w,%h", normalized], { temporaryDirectory, signal, stdoutLimit: 128 });
      [width, height] = identified.stdout.toString().split(",").map(Number);
      const focus: Record<string, { x: number; y: number; cropWidth: number; cropHeight: number }> = {};
      for (const aspect of options.aspects) {
        const [ratioWidth, ratioHeight] = ASPECT_RATIOS[aspect];
        const ratio = ratioWidth / ratioHeight;
        const cropWidth = Math.min(width, Math.floor(height * ratio));
        const cropHeight = Math.min(height, Math.floor(width / ratio));
        const x = Math.max(0, Math.min(width - cropWidth, Math.round((width - cropWidth) * options.focusX / 100)));
        const y = Math.max(0, Math.min(height - cropHeight, Math.round((height - cropHeight) * options.focusY / 100)));
        focus[aspect] = { x, y, cropWidth, cropHeight };
        const path = await render(`frames/${aspect.replace(":", "x")}.png`, `aspect-${aspect}`, [normalized, "-crop", `${cropWidth}x${cropHeight}+${x}+${y}`, "+repage"], "png", true);
        previewPath ??= path;
      }
      addData("frames/focus.json", "crop-contract", Buffer.from(`${JSON.stringify({ focusX: options.focusX, focusY: options.focusY, crops: focus }, null, 2)}\n`));
    }

    if (options.recipe === "icons") {
      if (!facts.hasAlpha) warnings.push("불투명 원본은 monochrome 알파 마스크가 사각형이 될 수 있으므로 작은 크기 미리보기를 확인하세요.");
      const icon = async (relativePath: string, role: string, size: number, padding = options.padding, background = options.background) => {
        const inner = Math.max(1, Math.round(size * (1 - padding / 50)));
        return render(relativePath, role, [
          "(", "-size", `${size}x${size}`, `xc:${background}`, ")",
          "(", inputPath, "-auto-orient", ...colorArgs, "-resize", `${inner}x${inner}`, ")",
          "-gravity", "center", "-compose", "over", "-composite",
        ], "png", true);
      };
      const faviconInner = Math.max(1, Math.round(48 * (1 - options.padding / 50)));
      await render("icons/favicon.ico", "favicon", [
        "(", "-size", "48x48", `xc:${options.background}`, ")",
        "(", inputPath, "-auto-orient", ...colorArgs, "-resize", `${faviconInner}x${faviconInner}`, ")",
        "-gravity", "center", "-compose", "over", "-composite",
      ], "ico");
      await icon("icons/icon-192.png", "pwa-any", 192);
      await icon("icons/icon-512.png", "pwa-any", 512);
      await icon("icons/apple-touch-icon.png", "apple-touch", 180);
      await icon("icons/maskable-512.png", "pwa-maskable", 512, Math.max(20, options.padding));
      await render("icons/monochrome-512.png", "pwa-monochrome", [
        "(", "-size", "512x512", "xc:none", ")",
        "(", inputPath, "-auto-orient", "-alpha", "extract", "-resize", "384x384", "-gravity", "center", "-background", "black", "-extent", "512x512", ")",
        "-compose", "CopyAlpha", "-composite",
      ], "png", true);
      const manifest = {
        name: stem,
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icons/monochrome-512.png", sizes: "512x512", type: "image/png", purpose: "monochrome" },
        ],
      };
      addData("manifest.webmanifest", "web-manifest", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
      addData("icons/nextjs-names.txt", "nextjs-handoff", Buffer.from("favicon.ico → app/favicon.ico\nicon-512.png → app/icon.png\napple-touch-icon.png → app/apple-icon.png\n"));
      previewPath = `${root}/icons/icon-192.png`;

      if (options.includeNative) {
        await icon("native/ios/AppIcon.appiconset/AppIcon-1024.png", "ios-marketing", 1024);
        addData("native/ios/AppIcon.appiconset/Contents.json", "ios-asset-catalog", Buffer.from(`${JSON.stringify({ images: [{ filename: "AppIcon-1024.png", idiom: "universal", platform: "ios", size: "1024x1024" }], info: { author: "oh-my-img", version: 1 } }, null, 2)}\n`));
        for (const [density, size] of [["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192]] as const) await icon(`native/android/mipmap-${density}/ic_launcher.png`, `android-${density}`, size);
        await icon("native/android/mipmap-xxxhdpi/ic_launcher_foreground.png", "android-adaptive-foreground", 432, 20, "#00000000");
        await render("native/android/mipmap-xxxhdpi/ic_launcher_background.png", "android-adaptive-background", ["-size", "432x432", `xc:${options.background}`], "png", true);
        await render("native/android/mipmap-xxxhdpi/ic_launcher_monochrome.png", "android-monochrome", [
          "(", "-size", "432x432", "xc:none", ")",
          "(", inputPath, "-auto-orient", "-alpha", "extract", "-resize", "264x264", "-gravity", "center", "-background", "black", "-extent", "432x432", ")",
          "-compose", "CopyAlpha", "-composite",
        ], "png", true);
        addData("native/android/mipmap-anydpi-v26/ic_launcher.xml", "android-adaptive-xml", Buffer.from("<adaptive-icon xmlns:android=\"http://schemas.android.com/apk/res/android\"><background android:drawable=\"@mipmap/ic_launcher_background\"/><foreground android:drawable=\"@mipmap/ic_launcher_foreground\"/><monochrome android:drawable=\"@mipmap/ic_launcher_monochrome\"/></adaptive-icon>\n"));
        await icon("native/android/play-store-512.png", "google-play", 512);
      }
    }

    if (options.recipe === "palette") {
      const histogram = await runMagick([...MAGICK_LIMIT_ARGS, inputPath, "-auto-orient", ...colorArgs, "-alpha", "remove", "-resize", "128x128!", "-colors", String(options.colors), "-unique-colors", "-format", "%c", "histogram:info:-"], { temporaryDirectory, signal, stdoutLimit: 32 * 1024 });
      const colors = parsePalette(histogram.stdout.toString(), options.colors);
      if (colors.length < 1) throw new Error("Palette extraction failed");
      const pairs = colors.flatMap((left, index) => colors.slice(index + 1).map((right) => {
        const ratio = contrast(left, right);
        return { foreground: left, background: right, ratio: Number(ratio.toFixed(2)), aaText: ratio >= 4.5, aaaText: ratio >= 7, ui: ratio >= 3 };
      })).sort((left, right) => right.ratio - left.ratio);
      const palette = {
        colors,
        background: options.background,
        againstBackground: colors.map((foreground) => {
          const ratio = contrast(foreground, options.background);
          return { foreground, ratio: Number(ratio.toFixed(2)), aaText: ratio >= 4.5, aaaText: ratio >= 7, ui: ratio >= 3 };
        }),
        contrastPairs: pairs,
      };
      addData("palette/palette.json", "palette-data", Buffer.from(`${JSON.stringify(palette, null, 2)}\n`));
      addData("palette/variables.css", "css-variables", Buffer.from(`:root {\n${colors.map((color, index) => `  --asset-color-${index + 1}: ${color};`).join("\n")}\n}\n`));
      const swatch = join(temporaryDirectory, "palette.png");
      await runMagick([...MAGICK_LIMIT_ARGS, ...colors.flatMap((color) => ["-size", "160x120", `xc:${color}`]), "+append", ...metadataArgs("png"), `png:${swatch}`], { temporaryDirectory, signal });
      previewPath = await addFile("palette/swatches.png", "palette-preview", swatch, true);
    }

    if (options.recipe === "social") {
      const overlayPath = join(temporaryDirectory, "social-overlay.svg");
      await writeFile(overlayPath, textOverlaySvg(1200, 630, options.title, options.subtitle, options.textColor));
      const socialLayers = [
        "(", inputPath, "-auto-orient", ...colorArgs, "-resize", "1200x630^", "-gravity", "center", "-extent", "1200x630", ")",
        "(", "-size", "1200x630", `xc:${options.background}`, "-alpha", "set", "-channel", "A", "-evaluate", "set", "55%", "+channel", ")",
        "-compose", "over", "-composite", overlayPath, "-compose", "over", "-composite",
      ];
      previewPath = await render("social/opengraph-image.png", "open-graph", socialLayers, "png", true);
      await render("social/twitter-image.jpg", "twitter-card", [...socialLayers, "-quality", "90"], "jpg");
      addData("social/metadata.html", "open-graph-markup", Buffer.from(`<meta property="og:image" content="/opengraph-image.png">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta property="og:image:alt" content="${xml(options.alt)}">\n<meta name="twitter:card" content="summary_large_image">\n`));
      addData("social/nextjs-names.txt", "nextjs-handoff", Buffer.from("opengraph-image.png → app/opengraph-image.png\ntwitter-image.jpg → app/twitter-image.jpg\n"));
    }

    if (options.recipe === "background") {
      previewPath = await render("background/transparent.png", "solid-background-removal", [inputPath, "-auto-orient", ...colorArgs, "-alpha", "on", "-fuzz", `${options.fuzz}%`, "-transparent", options.color], "png", true);
      warnings.push("선택 색과 유사한 모든 픽셀을 투명하게 만듭니다. 피사체 내부의 같은 색도 제거될 수 있으며 AI 배경 분리가 아닙니다.");
    }

    if (options.recipe === "watermark") {
      const overlayPath = join(temporaryDirectory, "watermark.svg");
      await writeFile(overlayPath, watermarkSvg(width, height, options.text, options.color, options.opacity, options.position));
      previewPath = await render("watermark/watermarked.png", "watermarked-image", [inputPath, "-auto-orient", ...colorArgs, overlayPath, "-compose", "over", "-composite"], "png", true);
    }

    if (["frame", "social", "palette"].includes(options.recipe)) {
      await render("placeholder/tiny.webp", "lqip", [inputPath, "-auto-orient", ...colorArgs, "-resize", "32x32>", "-quality", "45", "-define", "webp:method=6"], "webp");
    }
  }

  const manifest: AssetRecipeManifest = {
    schemaVersion: ASSET_RECIPE_MANIFEST_VERSION,
    recipe: { id: ASSET_RECIPE_ID, options },
    input: { name: source.name, mime: source.mime, bytes: source.data.byteLength, sha256: sha256(source.data) },
    outputs,
    warnings,
  };
  entries.push({ name: `${root}/manifest.json`, data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) });
  return { entries, manifest, previewPath };
}
