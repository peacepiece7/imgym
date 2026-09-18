import { describe, expect, it } from "vitest";
import { API_ENDPOINTS, INTERNAL_API_ROUTES } from "@/lib/api/docs";
import { OPENAPI_DOCUMENT } from "@/lib/api/openapi";

describe("OpenAPI document", () => {
  it("documents every curated endpoint and excludes UI-only previews", () => {
    expect(Object.keys(OPENAPI_DOCUMENT.paths).sort()).toEqual(
      API_ENDPOINTS.map(({ path }) => path).sort(),
    );
    for (const route of INTERNAL_API_ROUTES) {
      expect(OPENAPI_DOCUMENT.paths).not.toHaveProperty(route);
    }
  });

  it("keeps health public and protects every conversion operation", () => {
    expect(OPENAPI_DOCUMENT.paths["/api/health"].get.security).toEqual([]);

    for (const endpoint of API_ENDPOINTS.filter(({ method }) => method === "POST")) {
      const path = endpoint.path as Exclude<keyof typeof OPENAPI_DOCUMENT.paths, "/api/health">;
      const operation = OPENAPI_DOCUMENT.paths[path].post;
      expect(operation.security).toEqual([{ bearerAuth: [] }]);
      expect(operation.requestBody.content).toHaveProperty("multipart/form-data");
    }
  });

  it("uses unique operation IDs", () => {
    const operationIds = API_ENDPOINTS.map((endpoint) => {
      const path = endpoint.path as keyof typeof OPENAPI_DOCUMENT.paths;
      const pathItem = OPENAPI_DOCUMENT.paths[path];
      return "get" in pathItem ? pathItem.get.operationId : pathItem.post.operationId;
    });

    expect(new Set(operationIds).size).toBe(operationIds.length);
  });
});
