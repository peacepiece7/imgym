import { createHash } from "node:crypto";
import { runMagick } from "@/lib/raster/image-magick";
import type { RasterFormat } from "@/lib/raster/types";
import { validateRaster } from "@/lib/raster/validate-raster";
import type {
  AssetFacts,
  AssetMetadataFacts,
  ResolvedContentHint,
} from "@/lib/web-assets/types";

const MIME: Record<RasterFormat, AssetFacts["actualMime"]> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const EXTENSIONS: Record<RasterFormat, readonly string[]> = {
  png: ["png"],
  jpeg: ["jpg", "jpeg"],
  webp: ["webp"],
};

interface DetectedMetadata extends AssetMetadataFacts {
  orientation: number | null;
  hasAlpha: boolean;
}

function ascii(data: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...data.subarray(start, start + length));
}

function tiffFacts(input: Uint8Array) {
  const data = input.byteLength >= 6 && ascii(input, 0, 6) === "Exif\0\0" ? input.subarray(6) : input;
  if (data.byteLength < 8) return { orientation: null, gps: false };
  const byteOrder = ascii(data, 0, 2);
  if (byteOrder !== "II" && byteOrder !== "MM") return { orientation: null, gps: false };
  const littleEndian = byteOrder === "II";
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (offset: number) => offset + 2 <= data.byteLength ? view.getUint16(offset, littleEndian) : null;
  const u32 = (offset: number) => offset + 4 <= data.byteLength ? view.getUint32(offset, littleEndian) : null;
  if (u16(2) !== 42) return { orientation: null, gps: false };
  const ifdOffset = u32(4);
  if (ifdOffset === null || ifdOffset + 2 > data.byteLength) return { orientation: null, gps: false };
  const count = u16(ifdOffset);
  if (count === null || count > 4_096) return { orientation: null, gps: false };

  let orientation: number | null = null;
  let gps = false;
  for (let index = 0; index < count; index += 1) {
    const offset = ifdOffset + 2 + index * 12;
    if (offset + 12 > data.byteLength) break;
    const tag = u16(offset);
    const type = u16(offset + 2);
    const values = u32(offset + 4);
    if (tag === 0x0112 && type === 3 && values === 1) {
      const candidate = u16(offset + 8);
      if (candidate !== null && candidate >= 1 && candidate <= 8) orientation = candidate;
    }
    if (tag === 0x8825) gps = true;
  }
  return { orientation, gps };
}

function emptyMetadata(): DetectedMetadata {
  return {
    exif: false,
    iptc: false,
    xmp: false,
    gps: false,
    icc: false,
    cicp: false,
    srgbChunk: false,
    orientation: null,
    hasAlpha: false,
  };
}

function jpegMetadata(data: Uint8Array) {
  const facts = emptyMetadata();
  let offset = 2;
  while (offset + 4 <= data.byteLength) {
    if (data[offset] !== 0xff) break;
    const marker = data[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    const length = (data[offset + 2] << 8) | data[offset + 3];
    if (length < 2 || offset + 2 + length > data.byteLength) break;
    const payload = data.subarray(offset + 4, offset + 2 + length);
    const prefix = ascii(payload, 0, Math.min(payload.byteLength, 40));
    if (marker === 0xe1 && prefix.startsWith("Exif\0\0")) {
      facts.exif = true;
      const parsed = tiffFacts(payload);
      facts.orientation = parsed.orientation;
      facts.gps = parsed.gps;
    } else if (marker === 0xe1 && prefix.includes("http://ns.adobe.com/xap/1.0/")) {
      facts.xmp = true;
    } else if (marker === 0xe2 && prefix.startsWith("ICC_PROFILE\0")) {
      facts.icc = true;
    } else if (marker === 0xed && prefix.startsWith("Photoshop 3.0\0")) {
      facts.iptc = true;
    }
    offset += 2 + length;
  }
  return facts;
}

function pngMetadata(data: Uint8Array) {
  const facts = emptyMetadata();
  let offset = 8;
  while (offset + 12 <= data.byteLength) {
    const view = new DataView(data.buffer, data.byteOffset + offset, data.byteLength - offset);
    const length = view.getUint32(0, false);
    const end = offset + 12 + length;
    if (end > data.byteLength) break;
    const type = ascii(data, offset + 4, 4);
    const payload = data.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR" && payload.byteLength >= 10) facts.hasAlpha = payload[9] === 4 || payload[9] === 6;
    if (type === "tRNS") facts.hasAlpha = true;
    if (type === "iCCP") facts.icc = true;
    if (type === "cICP") facts.cicp = true;
    if (type === "sRGB") facts.srgbChunk = true;
    if (type === "eXIf") {
      facts.exif = true;
      const parsed = tiffFacts(payload);
      facts.orientation = parsed.orientation;
      facts.gps = parsed.gps;
    }
    if (type === "iTXt" && ascii(payload, 0, Math.min(payload.byteLength, 120)).toLowerCase().includes("xml")) {
      facts.xmp = true;
    }
    offset = end;
    if (type === "IEND") break;
  }
  return facts;
}

function webpMetadata(data: Uint8Array) {
  const facts = emptyMetadata();
  let offset = 12;
  while (offset + 8 <= data.byteLength) {
    const view = new DataView(data.buffer, data.byteOffset + offset, data.byteLength - offset);
    const type = ascii(data, offset, 4);
    const length = view.getUint32(4, true);
    const end = offset + 8 + length;
    if (end > data.byteLength) break;
    const payload = data.subarray(offset + 8, end);
    if (type === "VP8X" && payload.byteLength >= 1) facts.hasAlpha = (payload[0] & 0x10) !== 0;
    if (type === "VP8L" && payload.byteLength >= 5 && payload[0] === 0x2f) {
      const bits = new DataView(payload.buffer, payload.byteOffset + 1, 4).getUint32(0, true);
      facts.hasAlpha = ((bits >>> 28) & 1) === 1;
    }
    if (type === "ALPH") facts.hasAlpha = true;
    if (type === "ICCP") facts.icc = true;
    if (type === "EXIF") {
      facts.exif = true;
      const parsed = tiffFacts(payload);
      facts.orientation = parsed.orientation;
      facts.gps = parsed.gps;
    }
    if (type === "XMP ") facts.xmp = true;
    offset = end + (length % 2);
  }
  return facts;
}

export function detectRasterMetadata(data: Uint8Array, format: RasterFormat): DetectedMetadata {
  if (format === "jpeg") return jpegMetadata(data);
  if (format === "png") return pngMetadata(data);
  return webpMetadata(data);
}

function extensionMatches(sourceName: string, format: RasterFormat) {
  const extension = sourceName.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? "";
  return EXTENSIONS[format].includes(extension);
}

function displayDimensions(width: number, height: number, orientation: number | null) {
  return orientation !== null && orientation >= 5
    ? { width: height, height: width }
    : { width, height };
}

async function classifyRaster(
  image: Buffer,
  format: RasterFormat,
  hasAlpha: boolean,
  signal?: AbortSignal,
): Promise<ResolvedContentHint> {
  if (hasAlpha) return "transparent";
  const coder = format === "jpeg" ? "jpeg" : format;
  const result = await runMagick([
    `${coder}:-[0]`,
    "-auto-orient",
    "-thumbnail", "128x128>",
    "-colorspace", "sRGB",
    "-format", "%[entropy]\n%k",
    "info:",
  ], { input: image, signal, stdoutLimit: 1_024 });
  const [entropyText, colorsText] = result.stdout.toString("utf8").trim().split("\n");
  const entropy = Number(entropyText);
  const colors = Number(colorsText);
  if (!Number.isFinite(entropy) || !Number.isFinite(colors)) return format === "jpeg" ? "photo" : "ui";
  if (colors <= 96 && entropy < 0.82) return "logo";
  if (colors <= 1_024 && entropy < 0.72) return "ui";
  return "photo";
}

export async function inspectRasterAsset(
  image: Buffer,
  sourceName: string,
  declaredMime: string | null,
  signal?: AbortSignal,
): Promise<AssetFacts> {
  signal?.throwIfAborted();
  const validation = validateRaster(image);
  if (!validation.ok) throw new Error(validation.error);
  const detected = detectRasterMetadata(image, validation.format);
  const display = displayDimensions(validation.width, validation.height, detected.orientation);
  const actualMime = MIME[validation.format];
  const detectedContent = await classifyRaster(image, validation.format, detected.hasAlpha, signal);
  const metadata: AssetMetadataFacts = {
    exif: detected.exif,
    iptc: detected.iptc,
    xmp: detected.xmp,
    gps: detected.gps,
    icc: detected.icc,
    cicp: detected.cicp,
    srgbChunk: detected.srgbChunk,
  };
  const warnings: string[] = [];
  const matchesExtension = extensionMatches(sourceName, validation.format);
  const declaredMimeMatches = !declaredMime || declaredMime === "application/octet-stream" || declaredMime === actualMime;
  if (!matchesExtension) warnings.push("파일 확장자와 실제 이미지 형식이 다릅니다.");
  if (!declaredMimeMatches) warnings.push("브라우저가 알린 MIME과 실제 이미지 형식이 다릅니다.");
  if (metadata.gps || metadata.exif || metadata.iptc || metadata.xmp) {
    warnings.push("배포 전에 제거할 수 있는 메타데이터가 있습니다.");
  }
  if (display.width > 2_560) warnings.push("일반적인 웹 표시 폭보다 큰 원본입니다.");
  if (detectedContent === "photo" && validation.format === "png") {
    warnings.push("사진형 PNG는 WebP/AVIF 또는 JPEG 변환 이득을 확인하세요.");
  }
  if (detectedContent === "ui" && validation.format === "jpeg") {
    warnings.push("텍스트·UI JPEG는 경계 품질을 특히 확인하세요.");
  }

  return {
    sourceName,
    sha256: createHash("sha256").update(image).digest("hex"),
    declaredMime: declaredMime || null,
    actualMime,
    format: validation.format,
    extensionMatches: matchesExtension,
    declaredMimeMatches,
    encodedBytes: image.byteLength,
    encodedWidth: validation.width,
    encodedHeight: validation.height,
    width: display.width,
    height: display.height,
    pixels: display.width * display.height,
    aspectRatio: Number((display.width / display.height).toFixed(6)),
    bitsPerPixel: Number(((image.byteLength * 8) / (display.width * display.height)).toFixed(3)),
    hasAlpha: detected.hasAlpha,
    frames: 1,
    animated: false,
    orientation: detected.orientation,
    colorProfile: metadata.icc ? "icc" : metadata.cicp ? "cicp" : metadata.srgbChunk ? "srgb" : "unspecified",
    metadata,
    detectedContent,
    warnings,
  };
}
