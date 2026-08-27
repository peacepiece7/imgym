import { getApiKeyConfiguration } from "@/lib/api/access";

export function GET() {
  if (!getApiKeyConfiguration().ok) {
    return Response.json(
      { status: "unhealthy" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { status: "healthy" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
