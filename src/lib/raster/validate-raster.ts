import { imageDimensionsFromData } from "image-dimensions";
import { hasRasterAnimation } from "@/lib/image/animation";
import type { RasterFormat } from "@/lib/raster/types";

export const RASTER_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxDimension: 8_192,
  maxPixels: 25_000_000,
} as const;

export type ValidRaster = {
  ok: true;
  format: RasterFormat;
  width: number;
  height: number;
};

export type InvalidRaster = {
  ok: false;
  error: "Unsupported image" | "File is too large" | "Animated images are not supported";
  status: 400 | 413;
};

export function validateRaster(data: Uint8Array): ValidRaster | InvalidRaster {
  if (data.byteLength === 0) return { ok: false, error: "Unsupported image", status: 400 };
  if (data.byteLength > RASTER_LIMITS.maxBytes) {
    return { ok: false, error: "File is too large", status: 413 };
  }

  let dimensions: ReturnType<typeof imageDimensionsFromData>;
  try {
    dimensions = imageDimensionsFromData(new Uint8Array(data));
  } catch {
    return { ok: false, error: "Unsupported image", status: 400 };
  }
  if (
    !dimensions ||
    !["png", "jpeg", "webp"].includes(dimensions.type) ||
    dimensions.width < 1 ||
    dimensions.height < 1
  ) {
    return { ok: false, error: "Unsupported image", status: 400 };
  }
  if (
    dimensions.width > RASTER_LIMITS.maxDimension ||
    dimensions.height > RASTER_LIMITS.maxDimension ||
    dimensions.width * dimensions.height > RASTER_LIMITS.maxPixels
  ) {
    return { ok: false, error: "File is too large", status: 413 };
  }

  try {
    const animated = hasRasterAnimation(data, dimensions.type as RasterFormat);
    if (animated) return { ok: false, error: "Animated images are not supported", status: 400 };
  } catch {
    return { ok: false, error: "Unsupported image", status: 400 };
  }

  return {
    ok: true,
    format: dimensions.type as RasterFormat,
    width: dimensions.width,
    height: dimensions.height,
  };
}
