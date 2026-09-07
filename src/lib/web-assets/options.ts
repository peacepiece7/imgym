import type {
  WebAssetAccessibility,
  WebAssetAltKind,
  WebAssetColorPolicy,
  WebAssetContentHint,
  WebAssetLayout,
  WebAssetLoadingIntent,
  WebAssetOptions,
  WebAssetProfile,
} from "@/lib/web-assets/types";

const PROFILES: readonly WebAssetProfile[] = ["html", "next", "design"];
const LAYOUTS: readonly WebAssetLayout[] = ["hero", "content", "card"];
const CONTENT_HINTS: readonly WebAssetContentHint[] = ["auto", "photo", "ui", "logo", "transparent"];
const COLOR_POLICIES: readonly WebAssetColorPolicy[] = ["preserve", "srgb"];
const ALT_KINDS: readonly WebAssetAltKind[] = ["decorative", "functional", "informative", "complex"];
const LOADING_INTENTS: readonly WebAssetLoadingIntent[] = ["lcp", "lazy"];

export const WEB_ASSET_WIDTH_PRESETS: Record<WebAssetLayout, readonly number[]> = {
  hero: [640, 960, 1280, 1600, 1920],
  content: [480, 768, 1024, 1440],
  card: [320, 480, 640, 960],
};

export const WEB_ASSET_DEFAULT_SIZES: Record<WebAssetLayout, string> = {
  hero: "100vw",
  content: "(max-width: 768px) 100vw, 768px",
  card: "(max-width: 768px) 100vw, 33vw",
};

export const DEFAULT_WEB_ASSET_OPTIONS: WebAssetOptions = {
  profile: "html",
  layout: "hero",
  designBaseWidth: 400,
  sizes: WEB_ASSET_DEFAULT_SIZES.hero,
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
  const sizes = boundedString(raw.sizes, 256);
  const altText = boundedString(raw.altText, 300);
  if (
    !oneOf(raw.profile, PROFILES)
    || !oneOf(raw.layout, LAYOUTS)
    || customWidths === null
    || accessibility === null
    || !Number.isInteger(raw.designBaseWidth)
    || Number(raw.designBaseWidth) < 16
    || Number(raw.designBaseWidth) > 4_096
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
    layout: raw.layout,
    ...(customWidths ? { customWidths } : {}),
    designBaseWidth: Number(raw.designBaseWidth),
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
  scale?: 1 | 2 | 3;
}

export function resolveWebAssetWidths(originalWidth: number, options: WebAssetOptions): ResolvedWidth[] {
  if (options.profile === "next") return [{ width: originalWidth }];
  if (options.profile === "design") {
    return ([1, 2, 3] as const)
      .map((scale) => ({ width: Math.min(originalWidth, options.designBaseWidth * scale), scale }))
      .filter((item, index, all) => all.findIndex(({ width }) => width === item.width) === index);
  }
  const requested = options.customWidths ?? WEB_ASSET_WIDTH_PRESETS[options.layout];
  return [...new Set(requested.map((width) => Math.min(width, originalWidth)))]
    .sort((left, right) => left - right)
    .map((width) => ({ width }));
}

export function isManualWidthSelection(options: WebAssetOptions) {
  return options.profile === "html" && options.customWidths !== undefined;
}
