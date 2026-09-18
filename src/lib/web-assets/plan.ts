import { assetDirectory, safeAssetStem, webAssetPath } from "@/lib/web-assets/filename";
import { resolveWebAssetWidths } from "@/lib/web-assets/options";
import type {
  AssetFacts,
  ResolvedContentHint,
  WebAssetFormat,
  WebAssetOptions,
  WebAssetOutput,
} from "@/lib/web-assets/types";

/**
 * The pack is only assembled on the server, but the sidebar has to answer
 * "how many files will this make?" and "what code do I paste?" before anything
 * is generated. These mirror the choices generateWebAssetPack makes so the
 * projection stays in step with it; the server may still prune widths or
 * formats that do not pay for themselves, so treat the count as a plan.
 */
export type PlannedOutput = Pick<
  WebAssetOutput,
  "path" | "purpose" | "format" | "width" | "height"
>;

export interface WebAssetPlan {
  outputs: PlannedOutput[];
  widthCount: number;
  formatCount: number;
}

function resolvedContent(options: WebAssetOptions, detected: ResolvedContentHint) {
  return options.contentHint === "auto" ? detected : options.contentHint;
}

function fallbackFormat(content: ResolvedContentHint, hasAlpha: boolean): WebAssetFormat {
  return hasAlpha || content !== "photo" ? "png" : "jpeg";
}

/** The pixels the pack is built from: what the crop kept, not what was uploaded. */
export function croppedDimensions(facts: AssetFacts, options: WebAssetOptions) {
  if (!options.crop) return { width: facts.width, height: facts.height };
  return {
    width: Math.max(1, Math.round(options.crop.width * facts.width)),
    height: Math.max(1, Math.round(options.crop.height * facts.height)),
  };
}

export function planWebAssetOutputs(facts: AssetFacts, options: WebAssetOptions): WebAssetPlan {
  const source = croppedDimensions(facts, options);
  const widths = resolveWebAssetWidths(source.width, options);
  const stem = safeAssetStem(facts.sourceName);
  const directory = assetDirectory(facts.sourceName, facts.sha256);
  const base = fallbackFormat(resolvedContent(options, facts.detectedContent), facts.hasAlpha);
  const purpose: WebAssetOutput["purpose"] = options.profile === "single" ? "single" : "fallback";

  const build = (format: WebAssetFormat, outputPurpose: WebAssetOutput["purpose"]) =>
    widths.map<PlannedOutput>(({ width }) => ({
      path: webAssetPath(directory, stem, width, format),
      purpose: outputPurpose,
      format,
      width,
      height: Math.max(1, Math.round((source.height * width) / source.width)),
    }));

  const outputs = build(base, purpose);
  const formats: WebAssetFormat[] = [base];
  if (options.profile === "devices") {
    for (const [format, enabled] of [["webp", options.includeWebp], ["avif", options.includeAvif]] as const) {
      if (!enabled) continue;
      outputs.push(...build(format, "modern"));
      formats.push(format);
    }
  }

  return { outputs, widthCount: widths.length, formatCount: formats.length };
}
