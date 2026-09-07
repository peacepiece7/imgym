export const ASSET_RECIPE_ID = "ohmyimg-asset-recipes-r1";
export const ASSET_RECIPE_MANIFEST_VERSION = "ohmyimg.asset-recipe-manifest.v1";

export const ASPECT_RATIOS = {
  "1:1": [1, 1],
  "4:3": [4, 3],
  "3:2": [3, 2],
  "16:9": [16, 9],
  "2:1": [2, 1],
  "9:16": [9, 16],
} as const;

export type AspectRatio = keyof typeof ASPECT_RATIOS;
export type AssetRecipeKind = "frame" | "icons" | "palette" | "social" | "heic" | "background" | "watermark";

export interface FrameRecipeOptions {
  recipe: "frame";
  aspects: AspectRatio[];
  focusX: number;
  focusY: number;
  rotate: 0 | 90 | 180 | 270;
  flipX: boolean;
  flipY: boolean;
  trim: boolean;
  padding: number;
  background: string;
}
export interface IconRecipeOptions {
  recipe: "icons";
  background: string;
  padding: number;
  includeNative: boolean;
}

export interface PaletteRecipeOptions {
  recipe: "palette";
  colors: number;
  background: string;
}

export interface SocialRecipeOptions {
  recipe: "social";
  title: string;
  subtitle: string;
  alt: string;
  background: string;
  textColor: string;
}

export interface HeicRecipeOptions {
  recipe: "heic";
}

export interface BackgroundRecipeOptions {
  recipe: "background";
  color: string;
  fuzz: number;
}

export interface WatermarkRecipeOptions {
  recipe: "watermark";
  text: string;
  position: "northwest" | "northeast" | "southwest" | "southeast" | "center";
  opacity: number;
  color: string;
}

export type AssetRecipeOptions =
  | FrameRecipeOptions
  | IconRecipeOptions
  | PaletteRecipeOptions
  | SocialRecipeOptions
  | HeicRecipeOptions
  | BackgroundRecipeOptions
  | WatermarkRecipeOptions;

export interface AssetRecipeOutput {
  path: string;
  role: string;
  mime: string;
  bytes: number;
  sha256: string;
  width?: number;
  height?: number;
}

export interface AssetRecipeManifest {
  schemaVersion: typeof ASSET_RECIPE_MANIFEST_VERSION;
  recipe: { id: typeof ASSET_RECIPE_ID; options: AssetRecipeOptions };
  input: { name: string; mime: string | null; bytes: number; sha256: string };
  outputs: AssetRecipeOutput[];
  warnings: string[];
}
