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
  "path" | "purpose" | "format" | "width" | "height" | "scale"
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

export function planWebAssetOutputs(facts: AssetFacts, options: WebAssetOptions): WebAssetPlan {
  const widths = resolveWebAssetWidths(facts.width, options);
  const stem = safeAssetStem(facts.sourceName);
  const directory = assetDirectory(facts.sourceName, facts.sha256);
  const base = fallbackFormat(resolvedContent(options, facts.detectedContent), facts.hasAlpha);
  const purpose: WebAssetOutput["purpose"] = options.profile === "next"
    ? "next-source"
    : options.profile === "design"
      ? "design-scale"
      : "fallback";

  const build = (format: WebAssetFormat, outputPurpose: WebAssetOutput["purpose"]) =>
    widths.map<PlannedOutput>(({ width, scale }) => ({
      path: webAssetPath(directory, stem, width, format, scale),
      purpose: outputPurpose,
      format,
      width,
      height: Math.max(1, Math.round((facts.height * width) / facts.width)),
      ...(scale ? { scale } : {}),
    }));

  const outputs = build(base, purpose);
  const formats: WebAssetFormat[] = [base];
  if (options.profile === "html") {
    for (const [format, enabled] of [["webp", options.includeWebp], ["avif", options.includeAvif]] as const) {
      if (!enabled) continue;
      outputs.push(...build(format, "modern"));
      formats.push(format);
    }
  }

  return { outputs, widthCount: widths.length, formatCount: formats.length };
}
