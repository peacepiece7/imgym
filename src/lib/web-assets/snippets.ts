import type {
  AssetFacts,
  WebAssetOptions,
  WebAssetOutput,
} from "@/lib/web-assets/types";

/**
 * Only the shape a snippet reads, so the client can render the same code from a
 * planned pack it has not generated yet.
 */
export type SnippetOutput = Pick<
  WebAssetOutput,
  "path" | "purpose" | "format" | "width" | "height" | "scale"
>;

function htmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function srcset(outputs: readonly SnippetOutput[]) {
  return [...outputs]
    .sort((left, right) => left.width - right.width)
    .map((output) => `${output.path} ${output.width}w`)
    .join(", ");
}

function largest(outputs: readonly SnippetOutput[]) {
  return [...outputs].sort((left, right) => right.width - left.width)[0];
}

export function htmlPictureSnippet(
  outputs: readonly SnippetOutput[],
  options: WebAssetOptions,
) {
  const fallback = outputs.filter((output) => output.purpose === "fallback");
  const selectedFallback = largest(fallback);
  if (!selectedFallback) throw new Error("A fallback image is required");
  const modern = (["avif", "webp"] as const)
    .map((format) => ({ format, outputs: outputs.filter((output) => output.format === format) }))
    .filter(({ outputs: candidates }) => candidates.length > 0);
  const loading = options.loading === "lcp"
    ? 'loading="eager" fetchpriority="high"'
    : 'loading="lazy"';
  return [
    "<picture>",
    ...modern.map(({ format, outputs: candidates }) =>
      `  <source type="image/${format}" srcset="${htmlAttribute(srcset(candidates))}" sizes="${htmlAttribute(options.sizes)}">`,
    ),
    `  <img src="${htmlAttribute(selectedFallback.path)}"`,
    `       srcset="${htmlAttribute(srcset(fallback))}"`,
    `       sizes="${htmlAttribute(options.sizes)}"`,
    `       width="${selectedFallback.width}" height="${selectedFallback.height}"`,
    `       ${loading} decoding="async"`,
    `       alt="${htmlAttribute(options.altText)}">`,
    "</picture>",
    "",
  ].join("\n");
}

export function nextImageSnippet(
  output: SnippetOutput,
  options: WebAssetOptions,
  placeholder?: string,
) {
  const eager = options.loading === "lcp" ? "\n      preload" : "";
  const blur = placeholder
    ? `\n      placeholder="blur"\n      blurDataURL=${JSON.stringify(placeholder)}`
    : "";
  return [
    'import Image from "next/image";',
    `import source from ${JSON.stringify(`./${output.path}`)};`,
    "",
    "export function Asset() {",
    "  return (",
    "    <Image",
    "      src={source}",
    `      alt=${JSON.stringify(options.altText)}`,
    `      sizes=${JSON.stringify(options.sizes)}`,
    `${eager}${blur}`,
    "    />",
    "  );",
    "}",
    "",
  ].filter((line) => line !== "").join("\n");
}

export function designHandoffSnippet(
  facts: AssetFacts,
  outputs: readonly SnippetOutput[],
  options: WebAssetOptions,
) {
  return `${JSON.stringify({
    source: facts.sourceName,
    colorPolicy: options.colorPolicy,
    resampling: "ImageMagick Lanczos, no upscale",
    exports: outputs.map(({ path, width, height, scale, format }) => ({ path, width, height, scale, format })),
  }, null, 2)}\n`;
}
