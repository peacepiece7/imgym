import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { API_ENDPOINTS } from "@/lib/api/docs";
import { OPENAPI_DOCUMENT } from "@/lib/api/openapi";

describe("OpenAPI document", () => {
  it("documents every deployed API route, including previews and the specification", () => {
    expect(Object.keys(OPENAPI_DOCUMENT.paths).sort()).toEqual(
      API_ENDPOINTS.map(({ path }) => path).sort(),
    );
    const routes = readdirSync("src/app/api", { recursive: true })
      .filter((path) => typeof path === "string" && path.endsWith("/route.ts"))
      .map((path) => `/api/${String(path).replace(/\/route\.ts$/, "")}`);
    expect(Object.keys(OPENAPI_DOCUMENT.paths).sort()).toEqual(routes.sort());
  });

  it("keeps health public and protects every conversion operation", () => {
    expect(OPENAPI_DOCUMENT.paths["/api/health"].get.security).toEqual([]);

    for (const endpoint of API_ENDPOINTS.filter(({ method }) => method === "POST")) {
      const path = endpoint.path as Exclude<keyof typeof OPENAPI_DOCUMENT.paths, "/api/health" | "/api/openapi">;
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
