import { parseNormalizedCrop } from "@/lib/raster/crop";
import type { NormalizedCrop } from "@/lib/raster/types";
import type {
  WebAssetAccessibility,
  WebAssetAltKind,
  WebAssetColorPolicy,
  WebAssetContentHint,
  WebAssetDevice,
  WebAssetLoadingIntent,
  WebAssetOptions,
  WebAssetProfile,
  WebAssetTargetSize,
} from "@/lib/web-assets/types";

const PROFILES: readonly WebAssetProfile[] = ["devices", "single"];
const TARGET_SIZES: readonly WebAssetTargetSize[] = ["original", "mobile", "tablet", "desktop"];
const CONTENT_HINTS: readonly WebAssetContentHint[] = ["auto", "photo", "ui", "logo", "transparent"];
const COLOR_POLICIES: readonly WebAssetColorPolicy[] = ["preserve", "srgb"];
const ALT_KINDS: readonly WebAssetAltKind[] = ["decorative", "functional", "informative", "complex"];
const LOADING_INTENTS: readonly WebAssetLoadingIntent[] = ["lcp", "lazy"];

/** One width per device class. The whole "devices" pack is these three times the formats. */
export const WEB_ASSET_DEVICE_WIDTHS: Record<WebAssetDevice, number> = {
  mobile: 640,
  tablet: 1024,
  desktop: 1920,
};

export const WEB_ASSET_DEVICES: readonly WebAssetDevice[] = ["mobile", "tablet", "desktop"];

export const WEB_ASSET_DEVICE_WIDTH_LIST: readonly number[] = WEB_ASSET_DEVICES
  .map((device) => WEB_ASSET_DEVICE_WIDTHS[device]);

/** The sizes attribute the three device widths imply, so nobody has to write it. */
export const WEB_ASSET_DEFAULT_SIZES = "(max-width: 640px) 100vw, (max-width: 1024px) 100vw, 1920px";

export const DEFAULT_WEB_ASSET_OPTIONS: WebAssetOptions = {
  profile: "devices",
  targetSize: "original",
  crop: null,
  sizes: WEB_ASSET_DEFAULT_SIZES,
  contentHint: "auto",
  colorPolicy: "preserve",
  altKind: "informative",
  altText: "",
  loading: "lazy",
  includeWebp: true,
  includeAvif: true,
  includePlaceholder: true,
};

function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function boundedString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

function parseWidths(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null;
  if (value.some((width) => !Number.isInteger(width) || width < 16 || width > 8_192)) return null;
  return [...new Set(value as number[])].sort((left, right) => left - right);
}

function parseOptionalCrop(value: unknown): NormalizedCrop | null | undefined {
  if (value === undefined || value === null) return null;
  const crop = parseNormalizedCrop(value);
  return crop ?? undefined;
}

function parseCrops(value: unknown): (NormalizedCrop | null)[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) return null;
  const parsed: (NormalizedCrop | null)[] = [];
  for (const candidate of value) {
    const crop = parseOptionalCrop(candidate);
    if (crop === undefined) return null;
    parsed.push(crop);
  }
  return parsed;
}

function parseAccessibility(value: unknown): WebAssetAccessibility[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) return null;
  const parsed: WebAssetAccessibility[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return null;
    const raw = candidate as Record<string, unknown>;
    const text = boundedString(raw.text, 300);
    if (!oneOf(raw.kind, ALT_KINDS) || text === null || (raw.kind !== "decorative" && text.trim().length === 0)) {
      return null;
    }
    parsed.push({ kind: raw.kind, text: raw.kind === "decorative" ? "" : text.trim() });
  }
  return parsed;
}

export function parseWebAssetOptions(value: FormDataEntryValue | null): WebAssetOptions | null {
  if (typeof value !== "string") return null;
  let candidate: unknown;
  try {
    candidate = JSON.parse(value);
  } catch {
    return null;
  }
  if (!candidate || typeof candidate !== "object") return null;
  const raw = candidate as Record<string, unknown>;
  const customWidths = parseWidths(raw.customWidths);
  const accessibility = parseAccessibility(raw.accessibility);
  const crop = parseOptionalCrop(raw.crop);
  const crops = parseCrops(raw.crops);
  const sizes = boundedString(raw.sizes, 256);
  const altText = boundedString(raw.altText, 300);
  if (
    !oneOf(raw.profile, PROFILES)
    || !oneOf(raw.targetSize, TARGET_SIZES)
    || customWidths === null
    || accessibility === null
    || crop === undefined
    || crops === null
    || sizes === null
    || /[<>\r\n]/.test(sizes)
    || !oneOf(raw.contentHint, CONTENT_HINTS)
    || !oneOf(raw.colorPolicy, COLOR_POLICIES)
    || !oneOf(raw.altKind, ALT_KINDS)
    || altText === null
    || !oneOf(raw.loading, LOADING_INTENTS)
    || typeof raw.includeWebp !== "boolean"
    || typeof raw.includeAvif !== "boolean"
    || typeof raw.includePlaceholder !== "boolean"
  ) {
    return null;
  }
  if (raw.altKind !== "decorative" && altText.trim().length === 0) return null;

  return {
    profile: raw.profile,
    ...(customWidths ? { customWidths } : {}),
    targetSize: raw.targetSize,
    crop,
    ...(crops ? { crops } : {}),
    sizes,
    contentHint: raw.contentHint,
    colorPolicy: raw.colorPolicy,
    altKind: raw.altKind,
    altText: raw.altKind === "decorative" ? "" : altText.trim(),
    ...(accessibility ? { accessibility } : {}),
    loading: raw.loading,
    includeWebp: raw.includeWebp,
    includeAvif: raw.includeAvif,
    includePlaceholder: raw.includePlaceholder,
  };
}

export interface ResolvedWidth {
  width: number;
}

/**
 * `sourceWidth` is the width after cropping, not the width of the uploaded
 * file: a crop is what the person chose to keep, so it is what gets scaled.
 */
export function resolveWebAssetWidths(sourceWidth: number, options: WebAssetOptions): ResolvedWidth[] {
  if (options.profile === "single") {
    const requested = options.targetSize === "original"
      ? sourceWidth
      : WEB_ASSET_DEVICE_WIDTHS[options.targetSize];
    return [{ width: Math.min(requested, sourceWidth) }];
  }
  const requested = options.customWidths ?? WEB_ASSET_DEVICE_WIDTH_LIST;
  return [...new Set(requested.map((width) => Math.min(width, sourceWidth)))]
    .sort((left, right) => left - right)
    .map((width) => ({ width }));
}

export function isManualWidthSelection(options: WebAssetOptions) {
  return options.profile === "devices" && options.customWidths !== undefined;
}

/** The widths a pack was asked for, before no-upscale clamping — used to report pruning. */
export function requestedWebAssetWidths(options: WebAssetOptions): readonly number[] {
  if (options.profile === "single") {
    return options.targetSize === "original" ? [] : [WEB_ASSET_DEVICE_WIDTHS[options.targetSize]];
  }
  return options.customWidths ?? WEB_ASSET_DEVICE_WIDTH_LIST;
}
