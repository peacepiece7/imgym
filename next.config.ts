import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/imgym",
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/v1/docs-to-pdf": ["./scripts/render-document-pdf.py"],
  },
  // VTracer resolves its adjacent WASM binary at runtime. Keeping the package
  // external preserves that filesystem relationship in production builds.
  serverExternalPackages: ["@visioncortex/vtracer"],
};

export default nextConfig;
