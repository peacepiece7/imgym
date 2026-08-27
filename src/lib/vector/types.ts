export type VectorizePreset = "accurate" | "balanced" | "tiny";

export type VectorizeMode = VectorizePreset | "auto";

export interface VectorizeOptions {
  preset: VectorizePreset;
}

export interface VectorizeResult {
  svg: string;
  durationMs: number;
}

export interface OptimizeSvgResult {
  svg: string;
  beforeBytes: number;
  afterBytes: number;
  durationMs: number;
}

export interface SvgStats {
  paths: number;
  commands: number;
  elements: number;
  colors: number;
}

export interface VectorizeApiResult {
  svg: string;
  downloadName: string;
  input: {
    format: "png" | "jpeg" | "webp";
    width: number;
    height: number;
    bytes: number;
  };
  output: {
    rawBytes: number;
    optimizedBytes: number;
    optimizationPercent: number;
  };
  timing: {
    preprocessingMs: number;
    vectorizationMs: number;
    optimizationMs: number;
    rasterizationMs: number;
    measurementMs: number;
  };
  cleanup?: {
    colors: number;
  };
  selection: {
    mode: VectorizeMode;
    candidate: string;
    candidates: number;
    evaluationWidth?: number;
    evaluationHeight?: number;
    qualityGate?: string;
    minimumSsim?: number;
    maximumMae?: number;
    maximumEdgeMae?: number;
    ssim?: number;
    mae?: number;
    edgeMae?: number;
  };
  stats: SvgStats;
}

export interface ApiError {
  error: string;
  requestId?: string;
}
