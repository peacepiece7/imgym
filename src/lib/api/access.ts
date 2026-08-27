import { createHash, timingSafeEqual } from "node:crypto";

const API_KEY_PATTERN = /^[A-Za-z0-9\-._~+/]+={0,2}$/;
const AUTHORIZATION_PATTERN = /^Bearer ([A-Za-z0-9\-._~+/]+={0,2})$/i;
const MIN_API_KEY_LENGTH = 32;
const MAX_API_KEY_LENGTH = 256;

interface ValidApiKeyConfiguration {
  ok: true;
  key: string;
}

interface InvalidApiKeyConfiguration {
  ok: false;
}

export type ApiKeyConfiguration = ValidApiKeyConfiguration | InvalidApiKeyConfiguration;

function isValidApiKey(value: string) {
  return value.length >= MIN_API_KEY_LENGTH
    && value.length <= MAX_API_KEY_LENGTH
    && API_KEY_PATTERN.test(value);
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function getApiKeyConfiguration(): ApiKeyConfiguration {
  const key = process.env.OHMYIMG_API_KEY;
  return key !== undefined && isValidApiKey(key) ? { ok: true, key } : { ok: false };
}

export function requireApiAccess(request: Request, requestId: string): Response | null {
  const configuration = getApiKeyConfiguration();
  if (!configuration.ok) {
    console.error("[api-access]", { requestId, error: "invalid-api-key-configuration" });
    return Response.json(
      { error: "Service unavailable.", requestId },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
        },
      },
    );
  }

  const match = AUTHORIZATION_PATTERN.exec(request.headers.get("authorization") ?? "");
  const authorized = match !== null
    && match[1].length <= MAX_API_KEY_LENGTH
    && timingSafeEqual(digest(match[1]), digest(configuration.key));

  if (authorized) return null;

  console.warn("[api-access]", { requestId, error: "unauthorized" });
  return Response.json(
    { error: "Unauthorized.", requestId },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Bearer realm="ohmyimg-api"',
        "X-Request-Id": requestId,
      },
    },
  );
}
