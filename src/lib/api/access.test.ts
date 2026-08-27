import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { POST as docsToPdf } from "@/app/api/v1/docs-to-pdf/route";
import { POST as optimizeRaster } from "@/app/api/v1/optimize-raster/route";
import { POST as vectorize } from "@/app/api/v1/vectorize/route";
import { getApiKeyConfiguration, requireApiAccess } from "./access";
import { authenticatedApiFetch } from "./client";
import { tryAcquireJobPermit } from "./job-gate";

const TEST_API_KEY = "test-api-key-0123456789abcdefghijklmnop";

afterEach(() => {
  delete process.env.OHMYIMG_API_KEY;
  delete process.env.OHMYIMG_MAX_CONCURRENT_JOBS;
  vi.restoreAllMocks();
});

describe("single API key access", () => {
  it("accepts exactly the configured Bearer credential", async () => {
    process.env.OHMYIMG_API_KEY = TEST_API_KEY;
    const requestId = crypto.randomUUID();
    const request = new Request("http://localhost/api/v1/vectorize", {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });

    expect(getApiKeyConfiguration()).toEqual({ ok: true, key: TEST_API_KEY });
    expect(requireApiAccess(request, requestId)).toBeNull();
  });

  it.each([
    undefined,
    "",
    "short-key",
    "invalid key with spaces invalid key",
  ])("fails closed for an invalid server key configuration", async (configured) => {
    if (configured === undefined) delete process.env.OHMYIMG_API_KEY;
    else process.env.OHMYIMG_API_KEY = configured;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = requireApiAccess(
      new Request("http://localhost/api/v1/vectorize"),
      crypto.randomUUID(),
    );

    expect(response?.status).toBe(503);
    expect(await response?.json()).toMatchObject({ error: "Service unavailable." });
  });

  it.each([
    null,
    "Basic dGVzdA==",
    "Bearer wrong-api-key-0123456789abcdefghijkl",
    "Bearer first-key-0123456789abcdefghijklmnop, Bearer second",
  ])("returns the same 401 response for a missing or invalid request key", async (authorization) => {
    process.env.OHMYIMG_API_KEY = TEST_API_KEY;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const headers = authorization ? { Authorization: authorization } : undefined;
    const response = requireApiAccess(
      new Request("http://localhost/api/v1/vectorize", { headers }),
      crypto.randomUUID(),
    );

    expect(response?.status).toBe(401);
    expect(response?.headers.get("www-authenticate")).toBe('Bearer realm="ohmyimg-api"');
    expect(await response?.json()).toMatchObject({ error: "Unauthorized." });
  });

  it("does not leak either key through the response", async () => {
    process.env.OHMYIMG_API_KEY = TEST_API_KEY;
    const presented = "wrong-api-key-0123456789abcdefghijkl";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = requireApiAccess(
      new Request("http://localhost/api/v1/vectorize", {
        headers: { Authorization: `Bearer ${presented}` },
      }),
      crypto.randomUUID(),
    );
    const serialized = await response?.text();

    expect(serialized).not.toContain(TEST_API_KEY);
    expect(serialized).not.toContain(presented);
  });

  it("attaches the browser key to every API request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());

    await authenticatedApiFetch("/api/v1/vectorize", TEST_API_KEY, { method: "POST" });
    await authenticatedApiFetch("/api/v1/optimize-raster", TEST_API_KEY, { method: "POST" });
    await authenticatedApiFetch("/api/v1/docs-to-pdf", TEST_API_KEY, { method: "POST" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const headers = new Headers(call[1]?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${TEST_API_KEY}`);
    }
    expect(() => authenticatedApiFetch("/api/v1/vectorize", "", { method: "POST" }))
      .toThrow("API 키가 필요합니다.");
  });
});

describe("protected route and health boundaries", () => {
  it("rejects conversion before parsing a body when the request key is missing", async () => {
    process.env.OHMYIMG_API_KEY = TEST_API_KEY;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const rasterResponse = await optimizeRaster(new Request(
      "http://localhost/api/v1/optimize-raster",
      { method: "POST" },
    ));
    const vectorResponse = await vectorize(new Request(
      "http://localhost/api/v1/vectorize",
      { method: "POST" },
    ));
    const documentResponse = await docsToPdf(new Request(
      "http://localhost/api/v1/docs-to-pdf",
      { method: "POST" },
    ));

    expect(rasterResponse.status).toBe(401);
    expect(vectorResponse.status).toBe(401);
    expect(documentResponse.status).toBe(401);
  });

  it("bounds complete multipart bodies on both image routes without Content-Length", async () => {
    process.env.OHMYIMG_API_KEY = TEST_API_KEY;
    const request = (path: string) => new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
        "Content-Type": "multipart/form-data; boundary=oversized",
      },
      body: new Uint8Array(11 * 1024 * 1024 + 1),
    });

    const rasterResponse = await optimizeRaster(request("/api/v1/optimize-raster"));
    const vectorResponse = await vectorize(request("/api/v1/vectorize"));

    expect(rasterResponse.status).toBe(413);
    expect(vectorResponse.status).toBe(413);
  });

  it("does not carry authentication into a later request", async () => {
    process.env.OHMYIMG_API_KEY = TEST_API_KEY;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const authorized = requireApiAccess(new Request("http://localhost", {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    }), crypto.randomUUID());
    const later = requireApiAccess(new Request("http://localhost"), crypto.randomUUID());

    expect(authorized).toBeNull();
    expect(later?.status).toBe(401);
  });

  it("keeps health public but reports mandatory configuration readiness", async () => {
    process.env.OHMYIMG_API_KEY = TEST_API_KEY;
    const ready = health();
    delete process.env.OHMYIMG_API_KEY;
    const unavailable = health();

    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "healthy" });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ status: "unhealthy" });
  });
});

describe("conversion job admission", () => {
  it("allows one job by default and releases its permit idempotently", () => {
    const releaseFirst = tryAcquireJobPermit();
    expect(releaseFirst).toBeTypeOf("function");
    expect(tryAcquireJobPermit()).toBeNull();

    releaseFirst?.();
    releaseFirst?.();
    const releaseSecond = tryAcquireJobPermit();
    expect(releaseSecond).toBeTypeOf("function");
    releaseSecond?.();
  });

  it("falls back to one job for an invalid concurrency setting", () => {
    process.env.OHMYIMG_MAX_CONCURRENT_JOBS = "unlimited";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const release = tryAcquireJobPermit();

    expect(release).toBeTypeOf("function");
    expect(tryAcquireJobPermit()).toBeNull();
    release?.();
  });

  it("rejects an authenticated route before body parsing when capacity is busy", async () => {
    process.env.OHMYIMG_API_KEY = TEST_API_KEY;
    const release = tryAcquireJobPermit();
    try {
      const response = await vectorize(new Request("http://localhost/api/v1/vectorize", {
        method: "POST",
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      }));

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("1");
      expect(await response.json()).toMatchObject({ error: "Server is busy. Try again later." });
    } finally {
      release?.();
    }
  });
});
