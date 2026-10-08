// JSON objects serialized into multipart string fields. These are published
// schemas, not replacement validators; the route parsers remain authoritative.
const text = (maxLength: number, extra = {}) => ({ type: "string", maxLength, ...extra });
const number = (minimum: number, maximum: number, integer = false) => ({
  type: integer ? "integer" : "number", minimum, maximum,
});
const choice = (values: readonly (string | number)[]) => ({ enum: values });
const boolean = { type: "boolean" };
const hex = { type: "string", pattern: "^#[0-9a-fA-F]{6}$" };
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: "object", properties, required,
});
const recipe = (name: string, properties: Record<string, unknown>) => object({
  recipe: { const: name }, ...properties,
});

export const OPTION_SCHEMAS = {
  NormalizedCrop: {
    ...object({ x: number(0, 1), y: number(0, 1), width: { type: "number", exclusiveMinimum: 0, maximum: 1 }, height: { type: "number", exclusiveMinimum: 0, maximum: 1 } }),
    description: "EXIF 방향을 보정한 이미지의 정규화 좌표. width·height는 양수, x+width·y+height는 1 이하입니다. 픽셀 단위가 아닙니다.",
  },
  WebAssetOptions: {
    ...object({
      profile: choice(["devices", "single"]),
      targetSize: choice(["original", "mobile", "tablet", "desktop"]),
      crop: { anyOf: [ref("NormalizedCrop"), { type: "null" }] },
      crops: { type: "array", minItems: 1, maxItems: 10, items: { anyOf: [ref("NormalizedCrop"), { type: "null" }] } },
      customWidths: { type: "array", minItems: 1, maxItems: 8, items: number(16, 8192, true), description: "devices에서 기본 640/1024/1920 너비를 대체합니다. 확대하지 않습니다." },
      sizes: text(256, { pattern: "^[^<>\\r\\n]*$" }),
      contentHint: choice(["auto", "photo", "ui", "logo", "transparent"]),
      colorPolicy: choice(["preserve", "srgb"]),
      altKind: choice(["decorative", "functional", "informative", "complex"]),
      altText: text(300, { description: "decorative 외에는 공백이 아닌 대체 텍스트가 필요합니다." }),
      accessibility: { type: "array", minItems: 1, maxItems: 10, items: object({
        kind: choice(["decorative", "functional", "informative", "complex"]), text: text(300),
      }), description: "입력 파일 순서대로 지정합니다. 파일 수와 같아야 합니다." },
      loading: choice(["lcp", "lazy"]),
      includeWebp: boolean, includeAvif: boolean, includePlaceholder: boolean,
    }, ["profile", "targetSize", "sizes", "contentHint", "colorPolicy", "altKind", "altText", "loading", "includeWebp", "includeAvif", "includePlaceholder"]),
    description: "crop 생략/null은 전체 이미지. crops는 입력 파일 수와 같아야 합니다. 나머지 필수 필드는 예시처럼 모두 전달합니다.",
  },
  AssetRecipeOptions: {
    oneOf: [
      recipe("frame", {
        aspects: { type: "array", minItems: 1, maxItems: 6, items: choice(["1:1", "4:3", "3:2", "16:9", "2:1", "9:16"]) },
        focusX: number(0, 100), focusY: number(0, 100), rotate: choice([0, 90, 180, 270]),
        flipX: boolean, flipY: boolean, trim: boolean, padding: number(0, 256, true), background: hex,
      }),
      recipe("icons", { background: hex, padding: number(0, 40, true), includeNative: boolean }),
      recipe("palette", { colors: number(3, 8, true), background: hex }),
      recipe("social", {
        title: text(90, { minLength: 1 }), subtitle: text(140), alt: text(300, { minLength: 1 }), background: hex, textColor: hex,
      }),
      recipe("heic", {}),
      recipe("background", { color: hex, fuzz: number(0, 20) }),
      recipe("watermark", {
        text: text(80, { minLength: 1 }), position: choice(["northwest", "northeast", "southwest", "southeast", "center"]),
        opacity: number(10, 100), color: hex,
      }),
    ],
    description: "색상은 #rrggbb. focus는 0–100%, frame padding은 px, icons padding은 %. recipe에 해당하는 필수 필드를 모두 전달합니다.",
  },
  MediaRecipeOptions: {
    oneOf: [
      recipe("gif-video", { background: hex }),
      recipe("font", {
        family: text(80, { minLength: 1, description: "문자·숫자·공백·점·밑줄·하이픈만 사용합니다." }),
        text: text(5000, { minLength: 1 }), licenseConfirmed: { const: true },
      }),
    ],
  },
  OptimizeRasterOptions: object({
    crop: ref("NormalizedCrop"),
    resize: object({ maxWidth: number(1, 8192, true), maxHeight: number(1, 8192, true) }, []),
    mode: choice(["high", "balanced", "small", "auto"]),
    optimization: object({ policy: { ...choice(["standard", "smaller"]), default: "standard" } }),
  }, ["crop", "mode"]),
  VectorCleanupOptionsV1: {
    ...object({
      version: { const: 1 }, cleanup: number(0, 4, true), colors: choice([3, 4, 6, 8, 16, 32, 64, 128, "full"]),
      advanced: { ...object({
        speckleSize: number(0, 128, true), alphaCutoff: number(0, 255, true), gradientStep: number(0, 128, true),
        colorPrecision: number(1, 8, true), pathSimplify: number(0, 4),
      }, []), additionalProperties: false },
    }, ["version", "cleanup", "colors"]),
    additionalProperties: false,
    description: "preset=auto와 함께 보내면 400입니다. 생략하면 전처리를 수행하지 않습니다.",
  },
  DocumentPdfOptions: {
    ...object({
      title: text(200, { minLength: 1, default: "Document" }),
      lang: { ...choice(["ko", "en"]), default: "ko" },
      pageSize: { ...choice(["a4", "letter"]), default: "a4" },
      orientation: { ...choice(["portrait", "landscape"]), default: "portrait" },
      template: { ...choice(["document", "resume"]), default: "document" },
      includePageNumbers: { ...boolean, default: true },
    }, []),
    additionalProperties: false,
  },
};
