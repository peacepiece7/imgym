import { imageDimensionsFromData } from "image-dimensions";
import { hasRasterAnimation } from "@/lib/image/animation";

const SUPPORTED_FORMATS = new Set(["png", "jpeg", "webp"]);

export const IMAGE_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxDimension: 8_192,
  maxPixels: 40_000_000,
  maxRawSvgBytes: 25 * 1024 * 1024,
} as const;

export type ValidImage = {
  ok: true;
  format: "png" | "jpeg" | "webp";
  width: number;
  height: number;
};

export type InvalidImage = {
  ok: false;
  error: "Unsupported image" | "File is too large" | "Animated images are not supported";
  status: 400 | 413;
};

export function validateImage(data: Uint8Array): ValidImage | InvalidImage {
  if (data.byteLength === 0) {
    return { ok: false, error: "Unsupported image", status: 400 };
  }

  if (data.byteLength > IMAGE_LIMITS.maxBytes) {
    return { ok: false, error: "File is too large", status: 413 };
  }

  let dimensions: ReturnType<typeof imageDimensionsFromData>;
  try {
    // image-dimensions expects a zero-offset ArrayBuffer; Node Buffers may be pooled views.
    dimensions = imageDimensionsFromData(new Uint8Array(data));
  } catch {
    return { ok: false, error: "Unsupported image", status: 400 };
  }

  if (
    !dimensions ||
    !SUPPORTED_FORMATS.has(dimensions.type) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    return { ok: false, error: "Unsupported image", status: 400 };
  }

  if (
    dimensions.width > IMAGE_LIMITS.maxDimension ||
    dimensions.height > IMAGE_LIMITS.maxDimension ||
    dimensions.width * dimensions.height > IMAGE_LIMITS.maxPixels
  ) {
    return { ok: false, error: "File is too large", status: 413 };
  }

  try {
    if (hasRasterAnimation(data, dimensions.type as ValidImage["format"])) {
      return { ok: false, error: "Animated images are not supported", status: 400 };
    }
  } catch {
    return { ok: false, error: "Unsupported image", status: 400 };
  }

  return {
    ok: true,
    format: dimensions.type as ValidImage["format"],
    width: dimensions.width,
    height: dimensions.height,
  };
}
