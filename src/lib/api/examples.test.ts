import { describe, expect, it } from "vitest";
import { API_ENDPOINTS } from "@/lib/api/docs";
import { OPENAPI_DOCUMENT } from "@/lib/api/openapi";
import { parseAssetRecipeOptions } from "@/lib/asset-recipes/options";
import { parseMediaRecipeOptions } from "@/lib/asset-recipes/media";
import { parseDocumentPdfOptions } from "@/lib/document/input";
import { parseOptimizeRasterOptions } from "@/lib/raster/options";
import { parseVectorCleanupOptions } from "@/lib/vector/cleanup-types";
import { parseWebAssetOptions } from "@/lib/web-assets/options";

/**
 * The published examples are what people paste, so an example the real parser
 * rejects is a documentation bug that reads as a broken API. Every documented
 * options object is fed to the parser that endpoint actually runs; the `curl`
 * snippets carry the same JSON inline and are checked the same way.
 */
const PARSERS: Record<string, (value: string) => unknown> = {
  "/api/v1/web-assets": parseWebAssetOptions,
  "/api/v1/asset-recipes": parseAssetRecipeOptions,
  "/api/v1/media-recipes": parseMediaRecipeOptions,
  "/api/v1/optimize-raster": parseOptimizeRasterOptions,
  "/api/v1/vectorize": parseVectorCleanupOptions,
  "/api/v1/docs-to-pdf": parseDocumentPdfOptions,
};

/** Pulls the JSON out of `-F 'options={...}'` / `-F 'cleanup={...}'`. */
function inlineJson(curl: string) {
  return [...curl.matchAll(/-F '(?:options|cleanup)=(\{.*?\})'/g)].map(([, json]) => json);
}

const documented = API_ENDPOINTS.filter((endpoint) => endpoint.examples?.length);

/**
 * The OpenAPI document carries its own copies of these examples, so it can
 * drift on its own; collect them by path and hold them to the same parser.
 */
function openApiExamples(): Array<readonly [string, string]> {
  const found: Array<readonly [string, string]> = [];
  for (const [path, item] of Object.entries(OPENAPI_DOCUMENT.paths)) {
    const operation = (item as Record<string, unknown>).post as Record<string, unknown> | undefined;
    const content = (operation?.requestBody as { content?: Record<string, { schema?: { properties?: Record<string, { examples?: unknown }> } }> } | undefined)?.content;
    const properties = content?.["multipart/form-data"]?.schema?.properties ?? {};
    for (const field of ["options", "cleanup"]) {
      for (const example of (properties[field]?.examples as string[] | undefined) ?? []) {
        found.push([path, example] as const);
      }
    }
  }
  return found;
}

describe("documented API examples", () => {
  it("covers every endpoint that takes a JSON options field", () => {
    const takesOptions = API_ENDPOINTS.filter((endpoint) =>
      endpoint.fields.some((field) => field.type === "JSON string" && field.required !== "선택"));
    for (const endpoint of takesOptions) {
      expect(endpoint.examples?.length, `${endpoint.path} has no documented example`)
        .toBeGreaterThan(0);
    }
  });

  it.each(documented.flatMap((endpoint) =>
    endpoint.examples!.map((example) => [endpoint.path, example.label, example.options] as const)))(
    "%s — %s parses",
    (path, _label, options) => {
      const parse = PARSERS[path];
      expect(parse, `no parser wired for ${path}`).toBeTypeOf("function");
      expect(() => JSON.parse(options)).not.toThrow();
      expect(parse(options)).not.toBeNull();
    },
  );

  it.each(API_ENDPOINTS.flatMap((endpoint) =>
    inlineJson(endpoint.curl).map((json) => [endpoint.path, json] as const)))(
    "%s — curl snippet parses",
    (path, json) => {
      const parse = PARSERS[path];
      expect(parse, `no parser wired for ${path}`).toBeTypeOf("function");
      expect(parse(json)).not.toBeNull();
    },
  );

  it.each(openApiExamples())("%s — OpenAPI example parses", (path, json) => {
    const parse = PARSERS[path];
    expect(parse, `no parser wired for ${path}`).toBeTypeOf("function");
    expect(parse(json)).not.toBeNull();
  });

  it("names each example on an endpoint distinctly", () => {
    for (const endpoint of documented) {
      const labels = endpoint.examples!.map(({ label }) => label);
      expect(new Set(labels).size, `${endpoint.path} repeats an example label`).toBe(labels.length);
    }
  });
});
