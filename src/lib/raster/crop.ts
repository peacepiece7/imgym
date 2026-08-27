import type { NormalizedCrop, RasterResize } from "@/lib/raster/types";

const CROP_EPSILON = 1e-9;
const MAX_OUTPUT_DIMENSION = 8_192;

export const FULL_IMAGE_CROP: NormalizedCrop = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};

interface PercentageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseNormalizedCrop(value: unknown): NormalizedCrop | null {
  if (!value || typeof value !== "object") return null;
  const crop = value as Record<string, unknown>;
  if (
    !isFiniteNumber(crop.x) ||
    !isFiniteNumber(crop.y) ||
    !isFiniteNumber(crop.width) ||
    !isFiniteNumber(crop.height)
  ) {
    return null;
  }

  const rawRight = crop.x + crop.width;
  const rawBottom = crop.y + crop.height;
  if (
    crop.x < -CROP_EPSILON ||
    crop.y < -CROP_EPSILON ||
    crop.width <= CROP_EPSILON ||
    crop.height <= CROP_EPSILON ||
    rawRight > 1 + CROP_EPSILON ||
    rawBottom > 1 + CROP_EPSILON
  ) {
    return null;
  }

  const x = Math.min(1, Math.max(0, crop.x));
  const y = Math.min(1, Math.max(0, crop.y));
  const right = Math.min(1, Math.max(0, rawRight));
  const bottom = Math.min(1, Math.max(0, rawBottom));

  if (right - x <= CROP_EPSILON || bottom - y <= CROP_EPSILON) return null;
  return { x, y, width: right - x, height: bottom - y };
}

export function percentCropToNormalized(crop: PercentageCrop): NormalizedCrop | null {
  return parseNormalizedCrop({
    x: crop.x / 100,
    y: crop.y / 100,
    width: crop.width / 100,
    height: crop.height / 100,
  });
}

function parseDimension(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isFiniteNumber(value) || !Number.isInteger(value) || value < 1 || value > MAX_OUTPUT_DIMENSION) {
    return null;
  }
  return value;
}

export function parseRasterResize(value: unknown): RasterResize | null {
  if (value === undefined) return {};
  if (!value || typeof value !== "object") return null;
  const resize = value as Record<string, unknown>;
  const maxWidth = parseDimension(resize.maxWidth);
  const maxHeight = parseDimension(resize.maxHeight);
  if (maxWidth === null || maxHeight === null) return null;
  return { maxWidth, maxHeight };
}

export function normalizedCropToPixels(
  crop: NormalizedCrop,
  imageWidth: number,
  imageHeight: number,
) {
  const left = Math.floor(crop.x * imageWidth);
  const top = Math.floor(crop.y * imageHeight);
  const right = Math.ceil((crop.x + crop.width) * imageWidth);
  const bottom = Math.ceil((crop.y + crop.height) * imageHeight);
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function decimal(value: number) {
  return String(Number(value.toFixed(12)));
}

export function imageMagickCropGeometry(crop: NormalizedCrop) {
  const x = decimal(crop.x);
  const y = decimal(crop.y);
  const right = decimal(crop.x + crop.width);
  const bottom = decimal(crop.y + crop.height);
  return [
    `%[fx:ceil(${right}*w)-floor(${x}*w)]`,
    `x%[fx:ceil(${bottom}*h)-floor(${y}*h)]`,
    `+%[fx:floor(${x}*w)]`,
    `+%[fx:floor(${y}*h)]`,
  ].join("");
}

export function imageMagickResizeGeometry(resize: RasterResize) {
  if (!resize.maxWidth && !resize.maxHeight) return null;
  return `${resize.maxWidth ?? ""}x${resize.maxHeight ?? ""}>`;
}
