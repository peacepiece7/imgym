import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  measureAlphaMae,
  measureAssociatedAlphaDistortion,
  measureEdgeMae,
} from "@/lib/image/image-magick-metric";
import {
  MAGICK_LIMIT_ARGS,
  readMagickOutputFile,
  runMagick,
} from "@/lib/raster/image-magick";
import {
  AUTO_QUALITY_GATE,
  metadataArgs,
  stripPngPrivateChunks,
} from "@/lib/raster/optimize-raster";
import type { RasterFormat } from "@/lib/raster/types";
import {
  isManualWidthSelection,
  resolveWebAssetWidths,
  WEB_ASSET_WIDTH_PRESETS,
  type ResolvedWidth,
} from "@/lib/web-assets/options";
import { assetDirectory, safeAssetStem, webAssetPath } from "@/lib/web-assets/filename";
import { detectRasterMetadata, inspectRasterAsset } from "@/lib/web-assets/inspect";
import {
  designHandoffSnippet,
  htmlPictureSnippet,
  nextImageSnippet,
} from "@/lib/web-assets/snippets";
import {
  WEB_ASSET_MANIFEST_VERSION,
  WEB_ASSET_RECIPE_ID,
  type AssetMetadataFacts,
  type AssetQuality,
  type PrunedCandidate,
  type ResolvedContentHint,
  type WebAssetFormat,
  type WebAssetManifest,
  type WebAssetManifestItem,
  type WebAssetOptions,
  type WebAssetOutput,
} from "@/lib/web-assets/types";
import type { ZipEntry } from "@/lib/web-assets/zip";

const MIME: Record<WebAssetFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
};

const CODER: Record<WebAssetFormat, string> = {
  png: "png",
  jpeg: "jpeg",
  webp: "webp",
  avif: "avif",
};

export interface WebAssetSource {
  name: string;
  mime: string | null;
  data: Buffer;
}

export interface GeneratedWebAssetPack {
  entries: ZipEntry[];
  manifest: WebAssetManifest;
}

interface GeneratedVariant {
  output: WebAssetOutput;
  filePath: string;
}

interface VariantRequest {
  sourceMetadata: AssetMetadataFacts;
  sourcePng?: Buffer;
  reference: string;
  format: WebAssetFormat;
  width: number;
  height: number;
  purpose: WebAssetOutput["purpose"];
  content: ResolvedContentHint;
  options: WebAssetOptions;
  temporaryDirectory: string;
  internalName: string;
  zipPath: string;
  scale?: 1 | 2 | 3;
  signal?: AbortSignal;
}

function outputMetadata(data: Buffer, format: WebAssetFormat): AssetMetadataFacts {
  if (format !== "avif") {
    const detected = detectRasterMetadata(data, format);
    return {
      exif: detected.exif,
      iptc: detected.iptc,
      xmp: detected.xmp,
      gps: detected.gps,
      icc: detected.icc,
      cicp: detected.cicp,
      srgbChunk: detected.srgbChunk,
    };
  }
  const color = detectAvifColorProperties(data);
  return {
    exif: data.includes(Buffer.from("Exif")),
    iptc: false,
    xmp: data.includes(Buffer.from("application/rdf+xml")),
    gps: false,
    icc: color.icc,
    cicp: color.cicp,
    srgbChunk: false,
  };
}

const AVIF_COLOR_CONTAINERS = new Set(["meta", "iprp", "ipco"]);

export function detectAvifColorProperties(data: Buffer) {
  const color = { icc: false, cicp: false };
  const walk = (start: number, end: number, depth: number) => {
    if (depth > 4) return;
    let offset = start;
    while (offset + 8 <= end) {
      let size = data.readUInt32BE(offset);
      const type = data.toString("ascii", offset + 4, offset + 8);
      let headerBytes = 8;
      if (size === 1) {
        if (offset + 16 > end) return;
        const extended = data.readBigUInt64BE(offset + 8);
        if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return;
        size = Number(extended);
        headerBytes = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < headerBytes || offset + size > end) return;
      const payloadStart = offset + headerBytes;
      const boxEnd = offset + size;
      if (type === "colr" && payloadStart + 4 <= boxEnd) {
        const method = data.toString("ascii", payloadStart, payloadStart + 4);
        color.icc ||= method === "prof" || method === "rICC";
        color.cicp ||= method === "nclx";
      } else if (AVIF_COLOR_CONTAINERS.has(type)) {
        walk(payloadStart + (type === "meta" ? 4 : 0), boxEnd, depth + 1);
      }
      offset = boxEnd;
    }
  };
  walk(0, data.byteLength, 0);
  return color;
}

function encoderArgs(format: WebAssetFormat, content: ResolvedContentHint) {
  if (format === "png") return ["-define", "png:compression-level=8"];
  if (format === "jpeg") {
    return [
      "-quality", "94",
      "-sampling-factor", "4:4:4",
      "-define", "jpeg:optimize-coding=true",
      "-interlace", "Plane",
    ];
  }
  if (format === "webp") {
    if (content !== "photo") {
      return ["-define", "webp:lossless=true", "-define", "webp:method=6"];
    }
    return [
      "-quality", "88",
      "-define", "webp:method=6",
      "-define", "webp:alpha-quality=100",
      "-define", "webp:use-sharp-yuv=true",
    ];
  }
  return [
    "-quality", content === "photo" ? "72" : "90",
    "-define", "heic:speed=9",
  ];
}

const SRGB_PROFILE_PATHS = [
  "/usr/share/color/icc/colord/sRGB.icc",
  "/System/Library/ColorSync/Profiles/sRGB Profile.icc",
] as const;

export function webSafeColorArgs(sourceMetadata: AssetMetadataFacts) {
  if (sourceMetadata.cicp && !sourceMetadata.icc) {
    throw new Error("CICP-only input cannot be safely converted to sRGB");
  }
  if (!sourceMetadata.icc) return ["-colorspace", "sRGB", "+profile", "*"];
  const profile = SRGB_PROFILE_PATHS.find(existsSync);
  if (!profile) throw new Error("sRGB color profile is unavailable");
  return ["-intent", "Relative", "-black-point-compensation", "-profile", profile, "+profile", "*"];
}

function outputMetadataArgs(
  format: WebAssetFormat,
  colorPolicy: WebAssetOptions["colorPolicy"],
  sourceMetadata: AssetMetadataFacts,
) {
  if (colorPolicy === "srgb") return webSafeColorArgs(sourceMetadata);
  if (format === "avif") return ["+profile", "!icc,*", "+set", "comment"];
  return metadataArgs(format);
}

async function measureQuality(
  reference: string,
  candidate: string,
  temporaryDirectory: string,
  signal?: AbortSignal,
): Promise<AssetQuality> {
  const mae = await measureAssociatedAlphaDistortion(
    reference, candidate, "MAE", temporaryDirectory, signal,
  );
  if (mae === 0) {
    return { gate: AUTO_QUALITY_GATE.version, passed: true, ssim: 1, mae: 0, edgeMae: 0, alphaMae: 0 };
  }
  const [ssimDistortion, edgeMae, alphaMae] = await Promise.all([
    measureAssociatedAlphaDistortion(reference, candidate, "SSIM", temporaryDirectory, signal),
    measureEdgeMae(reference, candidate, temporaryDirectory, signal),
    measureAlphaMae(reference, candidate, temporaryDirectory, signal),
  ]);
  const ssim = 1 - ssimDistortion;
  const passed = ssim >= AUTO_QUALITY_GATE.minimumSsim
    && mae <= AUTO_QUALITY_GATE.maximumMae
    && edgeMae <= AUTO_QUALITY_GATE.maximumEdgeMae
    && alphaMae <= AUTO_QUALITY_GATE.maximumAlphaMae;
  return { gate: AUTO_QUALITY_GATE.version, passed, ssim, mae, edgeMae, alphaMae };
}

async function generateVariant(request: VariantRequest): Promise<{
  variant: GeneratedVariant | null;
  reason?: "quality-gate" | "color-profile";
}> {
  request.signal?.throwIfAborted();
  const outputPath = join(request.temporaryDirectory, request.internalName);
  await runMagick([
    ...MAGICK_LIMIT_ARGS,
    request.reference,
    ...outputMetadataArgs(request.format, request.options.colorPolicy, request.sourceMetadata),
    ...encoderArgs(request.format, request.content),
    `${CODER[request.format]}:${request.internalName}`,
  ], { temporaryDirectory: request.temporaryDirectory, signal: request.signal });
  const candidate = `${CODER[request.format]}:${request.internalName}`;
  const quality = await measureQuality(
    request.reference,
    candidate,
    request.temporaryDirectory,
    request.signal,
  );
  if (!quality.passed) return { variant: null, reason: "quality-gate" };
  const encoded = await readMagickOutputFile(outputPath);
  const data = request.format === "png"
    ? stripPngPrivateChunks(encoded, request.sourcePng)
    : encoded;
  if (data !== encoded) await writeFile(outputPath, data);
  const metadata = outputMetadata(data, request.format);
  const profilePreserved = request.options.colorPolicy === "srgb"
    || ((!request.sourceMetadata.icc || metadata.icc)
      && (!request.sourceMetadata.cicp || metadata.cicp));
  if (!profilePreserved) return { variant: null, reason: "color-profile" };
  request.signal?.throwIfAborted();
  return {
    variant: {
      filePath: outputPath,
      output: {
        path: request.zipPath,
        purpose: request.purpose,
        format: request.format,
        mime: MIME[request.format],
        width: request.width,
        height: request.height,
        bytes: data.byteLength,
        sha256: createHash("sha256").update(data).digest("hex"),
        ...(request.scale ? { scale: request.scale } : {}),
        quality,
        metadata,
      },
    },
  };
}

async function createReference(
  source: WebAssetSource,
  sourceFormat: RasterFormat,
  width: number,
  internalName: string,
  temporaryDirectory: string,
  signal?: AbortSignal,
) {
  const coder = CODER[sourceFormat];
  await runMagick([
    ...MAGICK_LIMIT_ARGS,
    `${coder}:-[0]`,
    "-auto-orient",
    "+repage",
    "-resize", `${width}x>`,
    "-alpha", "set",
    `miff:${internalName}`,
  ], { input: source.data, temporaryDirectory, signal });
  return `miff:${internalName}`;
}

function selectedContent(options: WebAssetOptions, detected: ResolvedContentHint) {
  return options.contentHint === "auto" ? detected : options.contentHint;
}

function preferredFallback(content: ResolvedContentHint, hasAlpha: boolean): WebAssetFormat {
  return hasAlpha || content !== "photo" ? "png" : "jpeg";
}

function dimensionsForWidth(sourceWidth: number, sourceHeight: number, width: number) {
  return { width, height: Math.max(1, Math.round((sourceHeight * width) / sourceWidth)) };
}

function pruneAutomaticWidths(
  variants: readonly GeneratedVariant[],
  widths: readonly ResolvedWidth[],
): { kept: GeneratedVariant[]; keptWidths: ResolvedWidth[]; pruned: PrunedCandidate[] } {
  if (variants.length <= 2) return { kept: [...variants], keptWidths: [...widths], pruned: [] };
  const kept: GeneratedVariant[] = [variants[0]];
  const keptWidths: ResolvedWidth[] = [widths[0]];
  const pruned: PrunedCandidate[] = [];
  for (let index = 1; index < variants.length - 1; index += 1) {
    const candidate = variants[index];
    const previous = kept.at(-1)!;
    const minimumDelta = Math.max(4 * 1024, previous.output.bytes * 0.08);
    if (candidate.output.bytes - previous.output.bytes < minimumDelta) {
      pruned.push({
        format: candidate.output.format,
        width: candidate.output.width,
        reason: "no-byte-benefit",
        bytes: candidate.output.bytes,
      });
    } else {
      kept.push(candidate);
      keptWidths.push(widths[index]);
    }
  }
  kept.push(variants.at(-1)!);
  keptWidths.push(widths.at(-1)!);
  return { kept, keptWidths, pruned };
}

async function removeVariant(variant: GeneratedVariant | null) {
  if (variant) await unlink(variant.filePath).catch(() => undefined);
}

async function createPlaceholder(
  source: WebAssetSource,
  sourceFormat: RasterFormat,
  temporaryDirectory: string,
  signal?: AbortSignal,
) {
  const result = await runMagick([
    ...MAGICK_LIMIT_ARGS,
    `${CODER[sourceFormat]}:-[0]`,
    "-auto-orient",
    "-thumbnail", "16x16>",
    "-colorspace", "sRGB",
    "+profile", "*",
    "-quality", "35",
    "webp:-",
  ], { input: source.data, temporaryDirectory, signal, stdoutLimit: 16 * 1024 });
  return `data:image/webp;base64,${result.stdout.toString("base64")}`;
}

async function generateOne(
  source: WebAssetSource,
  index: number,
  directory: string,
  options: WebAssetOptions,
  temporaryDirectory: string,
  signal?: AbortSignal,
): Promise<{ item: WebAssetManifestItem; entries: ZipEntry[] }> {
  const facts = await inspectRasterAsset(source.data, source.name, source.mime, signal);
  const content = selectedContent(options, facts.detectedContent);
  const widths = resolveWebAssetWidths(facts.width, options);
  const stem = safeAssetStem(source.name);
  const references = new Map<number, string>();
  const referenceFor = async (width: number) => {
    const existing = references.get(width);
    if (existing) return existing;
    const name = `reference-${index}-${width}.miff`;
    const reference = await createReference(source, facts.format, width, name, temporaryDirectory, signal);
    references.set(width, reference);
    return reference;
  };
  const warnings = [...facts.warnings];
  const pruned: PrunedCandidate[] = [];
  const fallbackFormat = preferredFallback(content, facts.hasAlpha);
  const requestedWidths = options.profile === "html"
    ? options.customWidths ?? WEB_ASSET_WIDTH_PRESETS[options.layout]
    : options.profile === "design"
      ? [1, 2, 3].map((scale) => options.designBaseWidth * scale)
      : [];
  for (const requestedWidth of requestedWidths) {
    if (requestedWidth > facts.width) {
      pruned.push({ format: fallbackFormat, width: requestedWidth, reason: "no-upscale" });
    }
  }

  const createForWidths = async (format: WebAssetFormat, requested: readonly ResolvedWidth[], purpose: WebAssetOutput["purpose"]) => {
    const variants: GeneratedVariant[] = [];
    if (options.colorPolicy === "preserve" && facts.metadata.cicp && format !== "png") {
      // ponytail: enable these formats only after their encoder can prove equivalent CICP signaling.
      for (const { width } of requested) pruned.push({ format, width, reason: "color-profile" });
      return variants;
    }
    for (const [variantIndex, width] of requested.entries()) {
      signal?.throwIfAborted();
      const dimensions = dimensionsForWidth(facts.width, facts.height, width.width);
      const generated = await generateVariant({
        sourceMetadata: facts.metadata,
        ...(facts.format === "png" && options.colorPolicy === "preserve"
          ? { sourcePng: source.data }
          : {}),
        reference: await referenceFor(width.width),
        format,
        ...dimensions,
        purpose,
        content,
        options,
        temporaryDirectory,
        internalName: `output-${index}-${format}-${width.width}-${variantIndex}.${format === "jpeg" ? "jpg" : format}`,
        zipPath: webAssetPath(directory, stem, width.width, format, width.scale),
        ...(width.scale ? { scale: width.scale } : {}),
        signal,
      });
      if (!generated.variant) {
        pruned.push({ format, width: width.width, reason: generated.reason ?? "quality-gate" });
        await unlink(join(temporaryDirectory, `output-${index}-${format}-${width.width}-${variantIndex}.${format === "jpeg" ? "jpg" : format}`)).catch(() => undefined);
        continue;
      }
      variants.push(generated.variant);
    }
    return variants;
  };

  let fallback = await createForWidths(fallbackFormat, widths, options.profile === "next" ? "next-source" : options.profile === "design" ? "design-scale" : "fallback");
  if (fallback.length !== widths.length && fallbackFormat !== "png") {
    await Promise.all(fallback.map(removeVariant));
    warnings.push("JPEG fallback이 품질 기준을 통과하지 못해 무손실 PNG fallback으로 바꿨습니다.");
    fallback = await createForWidths("png", widths, options.profile === "next" ? "next-source" : options.profile === "design" ? "design-scale" : "fallback");
  }
  if (fallback.length !== widths.length) {
    throw new Error(`No quality-safe fallback could be generated: ${JSON.stringify(pruned)}`);
  }

  let keptFallback = fallback;
  let keptWidths = widths;
  if (options.profile === "html" && !isManualWidthSelection(options)) {
    const result = pruneAutomaticWidths(fallback, widths);
    keptFallback = result.kept;
    keptWidths = result.keptWidths;
    pruned.push(...result.pruned);
    const keptPaths = new Set(keptFallback.map(({ filePath }) => filePath));
    await Promise.all(fallback.filter(({ filePath }) => !keptPaths.has(filePath)).map(removeVariant));
  }

  const variants = [...keptFallback];
  if (options.profile === "html") {
    for (const [format, enabled] of [["webp", options.includeWebp], ["avif", options.includeAvif]] as const) {
      if (!enabled) continue;
      try {
        const modern = await createForWidths(format, keptWidths, "modern");
        for (const candidate of modern) {
          const sameWidthFallback = keptFallback.find(({ output }) => output.width === candidate.output.width)!;
          if (candidate.output.bytes >= sameWidthFallback.output.bytes) {
            pruned.push({
              format,
              width: candidate.output.width,
              reason: "larger-than-fallback",
              bytes: candidate.output.bytes,
            });
            await removeVariant(candidate);
          } else {
            variants.push(candidate);
          }
        }
      } catch {
        warnings.push(`${format.toUpperCase()} 후보를 안전한 시간·품질 한도 안에서 만들지 못해 제외했습니다.`);
      }
    }
  }

  let placeholder: string | undefined;
  if (options.profile === "next" && options.includePlaceholder) {
    placeholder = await createPlaceholder(source, facts.format, temporaryDirectory, signal);
  }
  const outputs = variants.map(({ output }) => output);
  const snippet = options.profile === "html"
    ? htmlPictureSnippet(outputs, options)
    : options.profile === "next"
      ? nextImageSnippet(outputs[0], options, placeholder)
      : designHandoffSnippet(facts, outputs, options);
  const snippetExtension = options.profile === "html" ? "html" : options.profile === "next" ? "tsx" : "json";
  const snippetPath = `code-${directory}.${snippetExtension}`;
  const entries: ZipEntry[] = [
    ...variants.map(({ output, filePath }) => ({ name: output.path, path: filePath } as const)),
    { name: snippetPath, data: Buffer.from(snippet, "utf8") },
  ];
  return {
    entries,
    item: {
      index,
      status: "succeeded",
      sourceName: source.name,
      directory,
      input: facts,
      resolvedContent: content,
      outputs,
      pruned,
      snippetPath,
      placeholderIncluded: placeholder !== undefined,
      accessibility: { kind: options.altKind, text: options.altText },
      warnings,
    },
  };
}

export async function generateWebAssetPack(
  sources: readonly WebAssetSource[],
  options: WebAssetOptions,
  temporaryDirectory: string,
  signal?: AbortSignal,
): Promise<GeneratedWebAssetPack> {
  const entries: ZipEntry[] = [];
  const items: WebAssetManifestItem[] = [];
  const directoryOccurrences = new Map<string, number>();
  for (const [index, source] of sources.entries()) {
    signal?.throwIfAborted();
    try {
      const sha256 = createHash("sha256").update(source.data).digest("hex");
      const base = assetDirectory(source.name, sha256);
      const occurrence = (directoryOccurrences.get(base) ?? 0) + 1;
      directoryOccurrences.set(base, occurrence);
      const directory = assetDirectory(source.name, sha256, occurrence);
      const accessibility = options.accessibility?.[index] ?? {
        kind: options.altKind,
        text: options.altText,
      };
      const itemOptions = {
        ...options,
        altKind: accessibility.kind,
        altText: accessibility.text,
      };
      const generated = await generateOne(source, index, directory, itemOptions, temporaryDirectory, signal);
      items.push(generated.item);
      entries.push(...generated.entries);
    } catch (error) {
      if (signal?.aborted) signal.throwIfAborted();
      const expectedError = error instanceof Error && [
        "Unsupported image",
        "File is too large",
        "Animated images are not supported",
      ].includes(error.message);
      if (!expectedError) console.error("[web-assets:item]", { index, error });
      items.push({
        index,
        status: "failed",
        sourceName: source.name,
        error: expectedError ? error.message : "Image processing failed.",
      });
    }
  }

  const succeeded = items.filter((item) => item.status === "succeeded");
  const outputFiles = succeeded.reduce((sum, item) => sum + (item.outputs?.length ?? 0), 0);
  const outputBytes = succeeded.reduce(
    (sum, item) => sum + (item.outputs?.reduce((itemSum, output) => itemSum + output.bytes, 0) ?? 0),
    0,
  );
  const manifest: WebAssetManifest = {
    schemaVersion: WEB_ASSET_MANIFEST_VERSION,
    recipe: {
      id: WEB_ASSET_RECIPE_ID,
      profile: options.profile,
      layout: options.layout,
      customWidths: options.customWidths ?? null,
      designBaseWidth: options.designBaseWidth,
      sizes: options.sizes,
      contentHint: options.contentHint,
      colorPolicy: options.colorPolicy,
      accessibility: "per-asset",
      loading: options.loading,
      formats: { webp: options.includeWebp, avif: options.includeAvif },
      includePlaceholder: options.includePlaceholder,
      qualityGate: {
        id: AUTO_QUALITY_GATE.version,
        minimumSsim: AUTO_QUALITY_GATE.minimumSsim,
        maximumMae: AUTO_QUALITY_GATE.maximumMae,
        maximumEdgeMae: AUTO_QUALITY_GATE.maximumEdgeMae,
        maximumAlphaMae: AUTO_QUALITY_GATE.maximumAlphaMae,
      },
    },
    summary: {
      requested: sources.length,
      succeeded: succeeded.length,
      failed: sources.length - succeeded.length,
      outputFiles,
      outputBytes,
    },
    items,
  };
  entries.push({ name: "manifest.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8") });
  return { entries, manifest };
}
