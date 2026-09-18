import { OPENAPI_DOCUMENT } from "@/lib/api/openapi";

export function GET() {
  return Response.json(OPENAPI_DOCUMENT, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Disposition": 'inline; filename="imgym-openapi.json"',
    },
  });
}
