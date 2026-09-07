import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { imageDimensionsFromData } from "image-dimensions";
import { MAGICK_LIMIT_ARGS, runMagick } from "@/lib/raster/image-magick";
import { safeAssetStem, safeSourceName } from "@/lib/web-assets/filename";
import type { ZipEntry } from "@/lib/web-assets/zip";
import { runAssetProcess } from "@/lib/asset-recipes/process";

export const MEDIA_RECIPE_FILE_LIMIT = 20 * 1024 * 1024;
export const MEDIA_RECIPE_MULTIPART_LIMIT = MEDIA_RECIPE_FILE_LIMIT + 128 * 1024;

export type MediaRecipeOptions =
  | { recipe: "gif-video"; background: string }
  | { recipe: "font"; family: string; text: string; licenseConfirmed: true };

const HEX = /^#[0-9a-f]{6}$/i;
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

export function parseMediaRecipeOptions(value: FormDataEntryValue | null): MediaRecipeOptions | null {
  if (typeof value !== "string" || value.length > 12_000) return null;
  let raw: unknown;
  try { raw = JSON.parse(value); } catch { return null; }
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.recipe === "gif-video" && typeof candidate.background === "string" && HEX.test(candidate.background)) return { recipe: "gif-video", background: candidate.background.toLowerCase() };
  if (
    candidate.recipe === "font"
    && candidate.licenseConfirmed === true
    && typeof candidate.family === "string"
    && candidate.family.trim().length > 0
    && candidate.family.length <= 80
    && /^[\p{L}\p{N} ._-]+$/u.test(candidate.family)
    && typeof candidate.text === "string"
    && candidate.text.trim().length > 0
    && candidate.text.length <= 5_000
    && !/[\0\r]/.test(candidate.text)
  ) return { recipe: "font", family: candidate.family.trim(), text: candidate.text, licenseConfirmed: true };
  return null;
}

export async function parseMediaSource(formData: FormData) {
  const file = formData.get("asset");
  if (!(file instanceof File) || file.size < 1) return { ok: false as const, error: "Invalid request", status: 400 as const };
  if (file.size > MEDIA_RECIPE_FILE_LIMIT) return { ok: false as const, error: "File is too large", status: 413 as const };
  return { ok: true as const, source: { name: safeSourceName(file.name), mime: file.type || null, data: Buffer.from(await file.arrayBuffer()) } };
}

async function boundedFile(path: string) {
  const file = await stat(path);
  if (!file.isFile() || file.size < 1 || file.size > 64 * 1024 * 1024) throw new Error("Generated asset exceeded the limit");
  return readFile(path);
}

function unicodeRange(text: string) {
  const points = [...new Set([...text].map((character) => character.codePointAt(0)!).filter((point) => point >= 0x20))].sort((a, b) => a - b);
  return points.map((point) => `U+${point.toString(16).toUpperCase().padStart(4, "0")}`).join(", ");
}

export async function generateMediaRecipe(
  source: { name: string; mime: string | null; data: Buffer },
  options: MediaRecipeOptions,
  temporaryDirectory: string,
  signal?: AbortSignal,
) {
  const stem = safeAssetStem(source.name);
  const root = `media-recipe/${stem}`;
  const entries: ZipEntry[] = [];
  const outputs: Array<{ path: string; role: string; bytes: number; sha256: string }> = [];
  const add = async (relativePath: string, role: string, path: string) => {
    const data = await boundedFile(path);
    const name = `${root}/${relativePath}`;
    entries.push({ name, path });
    outputs.push({ path: name, role, bytes: data.byteLength, sha256: sha256(data) });
  };
  const addData = (relativePath: string, role: string, data: Buffer) => {
    const path = `${root}/${relativePath}`;
    entries.push({ name: path, data });
    outputs.push({ path, role, bytes: data.byteLength, sha256: sha256(data) });
  };

  if (options.recipe === "gif-video") {
    if (source.data.byteLength < 16 || !["GIF87a", "GIF89a"].includes(source.data.toString("ascii", 0, 6))) throw new Error("Unsupported GIF");
    const dimensions = imageDimensionsFromData(new Uint8Array(source.data));
    if (!dimensions || dimensions.type !== "gif" || dimensions.width > 4096 || dimensions.height > 4096 || dimensions.width * dimensions.height > 16_000_000) throw new Error("Unsupported GIF");
    const input = join(temporaryDirectory, "source.gif");
    const webm = join(temporaryDirectory, "animation.webm");
    const mp4 = join(temporaryDirectory, "animation.mp4");
    const poster = join(temporaryDirectory, "poster.png");
    const flattened = join(temporaryDirectory, "flattened.gif");
    await writeFile(input, source.data);
    await runMagick([...MAGICK_LIMIT_ARGS, input, "-coalesce", "-background", options.background, "-alpha", "remove", "-alpha", "off", "-layers", "Optimize", `gif:${flattened}`], { temporaryDirectory, signal });
    const ffmpeg = process.env.FFMPEG_BINARY || "ffmpeg";
    await runAssetProcess(ffmpeg, ["-nostdin", "-v", "error", "-t", "30", "-i", input, "-map", "0:v:0", "-an", "-vf", "fps=30", "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-pix_fmt", "yuva420p", "-loop", "0", "-y", webm], temporaryDirectory, signal);
    await runAssetProcess(ffmpeg, ["-nostdin", "-v", "error", "-t", "30", "-i", flattened, "-map", "0:v:0", "-an", "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-c:v", "libx264", "-crf", "24", "-movflags", "+faststart", "-y", mp4], temporaryDirectory, signal);
    await runAssetProcess(ffmpeg, ["-nostdin", "-v", "error", "-i", input, "-frames:v", "1", "-y", poster], temporaryDirectory, signal);
    await add("motion/animation.webm", "webm", webm);
    await add("motion/animation.mp4", "mp4", mp4);
    await add("motion/poster.png", "poster", poster);
    addData("motion/embed.html", "html", Buffer.from(`<video autoplay muted loop playsinline poster="poster.png"><source src="animation.webm" type="video/webm"><source src="animation.mp4" type="video/mp4"></video>\n`));
  } else {
    if (source.data.byteLength < 4) throw new Error("Unsupported font");
    const signature = source.data.toString("ascii", 0, 4);
    const isCollection = signature === "ttcf";
    const isSfnt = signature === "OTTO" || signature === "true" || isCollection || source.data.readUInt32BE(0) === 0x00010000;
    const isWebFont = signature === "wOFF" || signature === "wOF2";
    if (!isSfnt && !isWebFont) throw new Error("Unsupported font");
    const suffix = signature === "OTTO" ? "otf" : signature === "wOFF" ? "woff" : signature === "wOF2" ? "woff2" : isCollection ? "ttc" : "ttf";
    const input = join(temporaryDirectory, `source.${suffix}`);
    const output = join(temporaryDirectory, "subset.woff2");
    await writeFile(input, source.data);
    await runAssetProcess(process.env.PYFTSUBSET_BINARY || "pyftsubset", [input, ...(isCollection ? ["--font-number=0"] : []), `--output-file=${output}`, "--flavor=woff2", `--text=${options.text}`, "--layout-features=*", "--name-IDs=*", "--name-legacy", "--name-languages=*", "--notdef-glyph", "--recommended-glyphs"], temporaryDirectory, signal);
    await add("font/subset.woff2", "woff2-subset", output);
    const escapedFamily = options.family.replaceAll('"', "\\\"");
    addData("font/font-face.css", "css", Buffer.from(`@font-face {\n  font-family: "${escapedFamily}";\n  src: url("./subset.woff2") format("woff2");\n  font-display: swap;\n  unicode-range: ${unicodeRange(options.text)};\n}\n`));
    addData("font/LICENSE-CHECK.txt", "license-confirmation", Buffer.from("The operator confirmed permission to modify and embed the uploaded font. Oh My Img! does not verify or grant font rights.\n"));
  }

  const manifest = {
    schemaVersion: "ohmyimg.media-recipe-manifest.v1",
    recipe: options,
    input: { name: source.name, mime: source.mime, bytes: source.data.byteLength, sha256: sha256(source.data) },
    outputs,
    warnings: options.recipe === "gif-video"
      ? ["무음 반복 GIF 대체만 지원하며 오디오·일반 영상 편집은 지원하지 않습니다.", "최대 30초·30fps까지만 변환합니다.", "MP4 투명 영역은 선택한 배경색으로 합성합니다."]
      : ["글꼴 라이선스와 누락 글리프 검수 책임은 업로더에게 있습니다."],
  };
  entries.push({ name: `${root}/manifest.json`, data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) });
  return { entries, manifest };
}
