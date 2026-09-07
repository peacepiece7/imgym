import { analyzeSvg } from "@/lib/vector/analyze-svg";
import { toSvgFilename } from "@/lib/vector/filename";
import { hasUnsafeCss, optimizeSvg } from "@/lib/vector/svgo";
import type { DirectSvgApiResult } from "@/lib/vector/types";

export const DIRECT_SVG_MAX_BYTES = 2 * 1024 * 1024;
const MAX_SVG_ELEMENTS = 50_000;

function count(source: string, pattern: RegExp) {
  return source.match(pattern)?.length ?? 0;
}

function unsafeStyles(source: string) {
  return [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)]
    .filter((match) => hasUnsafeCss(match[1]))
    .length;
}

export function optimizeDirectSvg(
  source: string,
  sourceName: string,
  floatPrecision = 3,
): DirectSvgApiResult {
  const inputBytes = Buffer.byteLength(source);
  if (
    inputBytes < 1
    || inputBytes > DIRECT_SVG_MAX_BYTES
    || source.includes("\0")
    || source.includes("\uFFFD")
    || /<!DOCTYPE|<!ENTITY/i.test(source)
  ) {
    throw new Error("Unsupported SVG");
  }
  const optimized = optimizeSvg(source, floatPrecision);
  const stats = analyzeSvg(optimized.svg);
  if (stats.elements > MAX_SVG_ELEMENTS) throw new Error("SVG is too complex");
  const externalReferences = count(source, /(?:href|xlink:href)\s*=\s*["'](?!#)/gi)
    + count(source, /url\s*\(\s*["']?(?!#)/gi);
  return {
    svg: optimized.svg,
    downloadName: toSvgFilename(sourceName),
    input: { bytes: inputBytes },
    output: {
      bytes: optimized.afterBytes,
      savedBytes: Math.max(0, inputBytes - optimized.afterBytes),
      optimizationPercent: inputBytes === 0
        ? 0
        : ((inputBytes - optimized.afterBytes) / inputBytes) * 100,
    },
    safety: {
      scriptsRemoved: count(source, /<script\b/gi),
      eventHandlersRemoved: count(source, /\son[a-z]+\s*=/gi),
      embeddedImagesRemoved: count(source, /<image\b/gi),
      foreignObjectsRemoved: count(source, /<foreignObject\b/gi),
      stylesRemoved: unsafeStyles(source),
      externalReferencesRemoved: externalReferences,
    },
    stats,
  };
}
