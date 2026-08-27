export type RasterFormat = "png" | "jpeg" | "webp";

export type RasterPreset = "high" | "balanced" | "small";

export type RasterMode = RasterPreset | "auto";

export interface NormalizedCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RasterResize {
  maxWidth?: number;
  maxHeight?: number;
}

export interface OptimizeRasterOptions {
  crop: NormalizedCrop;
  resize?: RasterResize;
  mode: RasterMode;
}

export interface RasterSelection {
  mode: RasterMode;
  preset: string;
  candidates: number;
  ssim?: number;
  mae?: number;
}

export interface OptimizeRasterResult {
  image: Buffer;
  format: RasterFormat;
  width: number;
  height: number;
  durationMs: number;
  selection: RasterSelection;
}
