import type { RasterFormat } from "@/lib/raster/types";

export const WEB_ASSET_RECIPE_ID = "ohmyimg-web-assets-r1";
export const WEB_ASSET_MANIFEST_VERSION = "ohmyimg.web-assets-manifest.v1";

export type WebAssetProfile = "html" | "next" | "design";
export type WebAssetLayout = "hero" | "content" | "card";
export type WebAssetContentHint = "auto" | "photo" | "ui" | "logo" | "transparent";
export type ResolvedContentHint = Exclude<WebAssetContentHint, "auto">;
export type WebAssetColorPolicy = "preserve" | "srgb";
export type WebAssetAltKind = "decorative" | "functional" | "informative" | "complex";
export type WebAssetLoadingIntent = "lcp" | "lazy";
export type WebAssetFormat = RasterFormat | "avif";

export interface WebAssetAccessibility {
  kind: WebAssetAltKind;
  text: string;
}

export interface WebAssetOptions {
  profile: WebAssetProfile;
  layout: WebAssetLayout;
  customWidths?: number[];
  designBaseWidth: number;
  sizes: string;
  contentHint: WebAssetContentHint;
  colorPolicy: WebAssetColorPolicy;
  altKind: WebAssetAltKind;
  altText: string;
  accessibility?: WebAssetAccessibility[];
  loading: WebAssetLoadingIntent;
  includeWebp: boolean;
  includeAvif: boolean;
  includePlaceholder: boolean;
}

export interface AssetMetadataFacts {
  exif: boolean;
  iptc: boolean;
  xmp: boolean;
  gps: boolean;
  icc: boolean;
  cicp: boolean;
  srgbChunk: boolean;
}

export interface AssetFacts {
  sourceName: string;
  sha256: string;
  declaredMime: string | null;
  actualMime: "image/png" | "image/jpeg" | "image/webp";
  format: RasterFormat;
  extensionMatches: boolean;
  declaredMimeMatches: boolean;
  encodedBytes: number;
  encodedWidth: number;
  encodedHeight: number;
  width: number;
  height: number;
  pixels: number;
  aspectRatio: number;
  bitsPerPixel: number;
  hasAlpha: boolean;
  frames: 1;
  animated: false;
  orientation: number | null;
  colorProfile: "icc" | "cicp" | "srgb" | "unspecified";
  metadata: AssetMetadataFacts;
  detectedContent: ResolvedContentHint;
  warnings: string[];
}

export type AssetInspectionItem =
  | { index: number; status: "ready"; facts: AssetFacts }
  | { index: number; status: "failed"; sourceName: string; error: string };

export interface AssetQuality {
  gate: "imagemagick-raster-v3";
  passed: boolean;
  ssim: number;
  mae: number;
  edgeMae: number;
  alphaMae: number;
}

export interface WebAssetOutput {
  path: string;
  purpose: "fallback" | "modern" | "next-source" | "design-scale";
  format: WebAssetFormat;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  scale?: 1 | 2 | 3;
  quality: AssetQuality;
  metadata: AssetMetadataFacts;
}

export interface PrunedCandidate {
  format: WebAssetFormat;
  width: number;
  reason: "duplicate-width" | "no-upscale" | "no-byte-benefit" | "quality-gate" | "color-profile" | "larger-than-fallback";
  bytes?: number;
}

export interface WebAssetManifestItem {
  index: number;
  status: "succeeded" | "failed";
  sourceName: string;
  directory?: string;
  input?: AssetFacts;
  resolvedContent?: ResolvedContentHint;
  outputs?: WebAssetOutput[];
  pruned?: PrunedCandidate[];
  snippetPath?: string;
  placeholderIncluded?: boolean;
  accessibility?: WebAssetAccessibility;
  warnings?: string[];
  error?: string;
}

export interface WebAssetManifest {
  schemaVersion: typeof WEB_ASSET_MANIFEST_VERSION;
  recipe: {
    id: typeof WEB_ASSET_RECIPE_ID;
    profile: WebAssetProfile;
    layout: WebAssetLayout;
    customWidths: number[] | null;
    designBaseWidth: number;
    sizes: string;
    contentHint: WebAssetContentHint;
    colorPolicy: WebAssetColorPolicy;
    accessibility: "per-asset";
    loading: WebAssetLoadingIntent;
    formats: { webp: boolean; avif: boolean };
    includePlaceholder: boolean;
    qualityGate: {
      id: "imagemagick-raster-v3";
      minimumSsim: number;
      maximumMae: number;
      maximumEdgeMae: number;
      maximumAlphaMae: number;
    };
  };
  summary: {
    requested: number;
    succeeded: number;
    failed: number;
    outputFiles: number;
    outputBytes: number;
  };
  items: WebAssetManifestItem[];
}
