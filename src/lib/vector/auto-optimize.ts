import { withMagickTempDirectory } from "@/lib/raster/image-magick";
import type { RasterFormat } from "@/lib/raster/types";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { analyzeSvg } from "./analyze-svg";
import { VECTOR_AUTO_CANDIDATES } from "./presets";
import {
  createVectorReference,
  evaluateVectorCandidate,
  passesVectorQuality,
  vectorEvaluationDimensions,
  type VectorQuality,
} from "./similarity";
import { optimizeSvg } from "./svgo";
import type { OptimizeSvgResult, SvgStats, VectorizeResult } from "./types";
import { vectorizeWithOptions } from "./vtracer";

export const SVG_AUTO_COMPLEXITY_LIMITS = {
  paths: 100_000,
  commands: 1_000_000,
  elements: 150_000,
} as const;

export const SVG_AUTO_SEARCH_BUDGET_MS = 90_000;

function assertSearchActive(signal: AbortSignal, deadlineAt: number) {
  signal.throwIfAborted();
  if (performance.now() >= deadlineAt) throw new Error("SVG Auto Optimize timed out");
}

async function yieldAndAssertSearchActive(signal: AbortSignal, deadlineAt: number) {
  await yieldToEventLoop();
  assertSearchActive(signal, deadlineAt);
}

interface AcceptedCandidate {
  key: string;
  label: string;
  vectorized: VectorizeResult;
  optimized: OptimizeSvgResult;
  stats: SvgStats;
  quality: VectorQuality;
}

function withinComplexityLimits(stats: SvgStats) {
  return stats.paths <= SVG_AUTO_COMPLEXITY_LIMITS.paths
    && stats.commands <= SVG_AUTO_COMPLEXITY_LIMITS.commands
    && stats.elements <= SVG_AUTO_COMPLEXITY_LIMITS.elements;
}

function preferCandidate(candidate: AcceptedCandidate, selected: AcceptedCandidate | undefined) {
  if (!selected) return true;
  if (candidate.optimized.afterBytes !== selected.optimized.afterBytes) {
    return candidate.optimized.afterBytes < selected.optimized.afterBytes;
  }
  if (candidate.stats.commands !== selected.stats.commands) {
    return candidate.stats.commands < selected.stats.commands;
  }
  return candidate.stats.elements < selected.stats.elements;
}

export async function autoOptimizeVector(
  image: Buffer,
  input: { format: RasterFormat; width: number; height: number },
  signal?: AbortSignal,
) {
  const searchStartedAt = performance.now();
  const deadlineAt = searchStartedAt + SVG_AUTO_SEARCH_BUDGET_MS;
  const searchSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(SVG_AUTO_SEARCH_BUDGET_MS)])
    : AbortSignal.timeout(SVG_AUTO_SEARCH_BUDGET_MS);
  const evaluation = vectorEvaluationDimensions(input.width, input.height);

  const result = await withMagickTempDirectory(async (temporaryDirectory) => {
    assertSearchActive(searchSignal, deadlineAt);
    const referenceStartedAt = performance.now();
    const reference = await createVectorReference(
      image,
      input.format,
      evaluation,
      temporaryDirectory,
      searchSignal,
    );
    const timing = {
      vectorizationMs: 0,
      optimizationMs: 0,
      rasterizationMs: performance.now() - referenceStartedAt,
      measurementMs: 0,
    };
    let selected: AcceptedCandidate | undefined;
    let evaluatedCandidates = 0;

    for (const [index, candidate] of VECTOR_AUTO_CANDIDATES.entries()) {
      if (index > 0 && performance.now() - searchStartedAt >= SVG_AUTO_SEARCH_BUDGET_MS) break;
      assertSearchActive(searchSignal, deadlineAt);
      evaluatedCandidates += 1;
      try {
        const vectorized = vectorizeWithOptions(image, candidate.options);
        await yieldAndAssertSearchActive(searchSignal, deadlineAt);
        timing.vectorizationMs += vectorized.durationMs;
        const optimized = optimizeSvg(vectorized.svg, candidate.floatPrecision);
        await yieldAndAssertSearchActive(searchSignal, deadlineAt);
        timing.optimizationMs += optimized.durationMs;
        const stats = analyzeSvg(optimized.svg);
        await yieldAndAssertSearchActive(searchSignal, deadlineAt);
        if (!withinComplexityLimits(stats)) continue;

        const quality = await evaluateVectorCandidate(
          optimized.svg,
          reference,
          evaluation,
          index,
          temporaryDirectory,
          searchSignal,
        );
        timing.rasterizationMs += quality.rasterizationMs;
        timing.measurementMs += quality.measurementMs;
        if (!passesVectorQuality(quality)) continue;

        const accepted = {
          key: candidate.key,
          label: candidate.label,
          vectorized,
          optimized,
          stats,
          quality,
        };
        if (preferCandidate(accepted, selected)) selected = accepted;
      } catch (error) {
        if (searchSignal.aborted || performance.now() >= deadlineAt) throw error;
        console.warn("[vectorize:auto-candidate]", { candidate: candidate.key, error });
      }
    }

    if (!selected) throw new Error("SVG Auto Optimize found no acceptable result");
    assertSearchActive(searchSignal, deadlineAt);

    return {
      ...selected,
      evaluation,
      candidates: evaluatedCandidates,
      timing,
    };
  });
  assertSearchActive(searchSignal, deadlineAt);
  return result;
}
