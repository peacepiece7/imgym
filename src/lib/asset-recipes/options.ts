import {
  ASPECT_RATIOS,
  type AssetRecipeOptions,
  type AspectRatio,
} from "@/lib/asset-recipes/types";

const HEX = /^#[0-9a-f]{6}$/i;
const ASPECTS = new Set(Object.keys(ASPECT_RATIOS));
const POSITIONS = new Set(["northwest", "northeast", "southwest", "southeast", "center"]);

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberIn(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function shortText(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string" || value.length > maximum || /[\0\r]/.test(value)) return null;
  const text = value.trim();
  return required && !text ? null : text;
}

export function parseAssetRecipeOptions(value: FormDataEntryValue | null): AssetRecipeOptions | null {
  if (typeof value !== "string" || value.length > 8_192) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return null;
  }
  if (!record(raw) || typeof raw.recipe !== "string") return null;

  if (raw.recipe === "frame") {
    if (
      !Array.isArray(raw.aspects)
      || raw.aspects.length < 1
      || raw.aspects.length > 6
      || raw.aspects.some((aspect) => typeof aspect !== "string" || !ASPECTS.has(aspect))
      || !numberIn(raw.focusX, 0, 100)
      || !numberIn(raw.focusY, 0, 100)
      || ![0, 90, 180, 270].includes(Number(raw.rotate))
      || typeof raw.flipX !== "boolean"
      || typeof raw.flipY !== "boolean"
      || typeof raw.trim !== "boolean"
      || !Number.isInteger(raw.padding)
      || !numberIn(raw.padding, 0, 256)
      || typeof raw.background !== "string"
      || !HEX.test(raw.background)
    ) return null;
    return {
      recipe: "frame",
      aspects: [...new Set(raw.aspects as AspectRatio[])],
      focusX: Number(raw.focusX),
      focusY: Number(raw.focusY),
      rotate: Number(raw.rotate) as 0 | 90 | 180 | 270,
      flipX: raw.flipX,
      flipY: raw.flipY,
      trim: raw.trim,
      padding: raw.padding as number,
      background: raw.background.toLowerCase(),
    };
  }

  if (raw.recipe === "icons") {
    if (typeof raw.background !== "string" || !HEX.test(raw.background) || !Number.isInteger(raw.padding) || !numberIn(raw.padding, 0, 40) || typeof raw.includeNative !== "boolean") return null;
    return { recipe: "icons", background: raw.background.toLowerCase(), padding: raw.padding as number, includeNative: raw.includeNative };
  }

  if (raw.recipe === "palette") {
    if (!Number.isInteger(raw.colors) || !numberIn(raw.colors, 3, 8) || typeof raw.background !== "string" || !HEX.test(raw.background)) return null;
    return { recipe: "palette", colors: raw.colors as number, background: raw.background.toLowerCase() };
  }

  if (raw.recipe === "social") {
    const title = shortText(raw.title, 90, true);
    const subtitle = shortText(raw.subtitle, 140);
    const alt = shortText(raw.alt, 300, true);
    if (title === null || subtitle === null || alt === null || typeof raw.background !== "string" || !HEX.test(raw.background) || typeof raw.textColor !== "string" || !HEX.test(raw.textColor)) return null;
    return { recipe: "social", title, subtitle, alt, background: raw.background.toLowerCase(), textColor: raw.textColor.toLowerCase() };
  }

  if (raw.recipe === "heic") return { recipe: "heic" };

  if (raw.recipe === "background") {
    if (typeof raw.color !== "string" || !HEX.test(raw.color) || !numberIn(raw.fuzz, 0, 20)) return null;
    return { recipe: "background", color: raw.color.toLowerCase(), fuzz: Number(raw.fuzz) };
  }

  if (raw.recipe === "watermark") {
    const text = shortText(raw.text, 80, true);
    if (text === null || typeof raw.position !== "string" || !POSITIONS.has(raw.position) || !numberIn(raw.opacity, 10, 100) || typeof raw.color !== "string" || !HEX.test(raw.color)) return null;
    return { recipe: "watermark", text, position: raw.position as WatermarkRecipeOptions["position"], opacity: Number(raw.opacity), color: raw.color.toLowerCase() };
  }
  return null;
}

type WatermarkRecipeOptions = Extract<AssetRecipeOptions, { recipe: "watermark" }>;
