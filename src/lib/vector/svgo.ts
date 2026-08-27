import { optimize, type CustomPlugin } from "svgo";
import type { OptimizeSvgResult } from "./types";

const ensureViewBox: CustomPlugin = {
  name: "ohmyimg-ensure-viewbox",
  fn: () => ({
    element: {
      enter: (node) => {
        if (node.name !== "svg" || node.attributes.viewBox) return;
        const width = Number.parseFloat(node.attributes.width ?? "");
        const height = Number.parseFloat(node.attributes.height ?? "");
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
          node.attributes.viewBox = `0 0 ${width} ${height}`;
        }
      },
    },
  }),
};

export function optimizeSvg(svg: string, floatPrecision = 3): OptimizeSvgResult {
  const startedAt = performance.now();
  const beforeBytes = Buffer.byteLength(svg);
  const result = optimize(svg, {
    multipass: true,
    floatPrecision,
    plugins: [ensureViewBox, "preset-default", "removeScripts", "removeRasterImages"],
  });

  if (!result.data.includes("<svg")) {
    throw new Error("Invalid optimizer output");
  }

  return {
    svg: result.data,
    beforeBytes,
    afterBytes: Buffer.byteLength(result.data),
    durationMs: performance.now() - startedAt,
  };
}
