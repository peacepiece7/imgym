import { optimize, type CustomPlugin } from "svgo";
import type { OptimizeSvgResult } from "./types";

const ABSOLUTE_SVG_LENGTH = /^\s*(?:\d+(?:\.\d+)?|\.\d+)(?:px)?\s*$/i;

const ensureViewBox: CustomPlugin = {
  name: "ohmyimg-ensure-viewbox",
  fn: () => ({
    element: {
      enter: (node) => {
        if (node.name !== "svg" || node.attributes.viewBox) return;
        const widthValue = node.attributes.width ?? "";
        const heightValue = node.attributes.height ?? "";
        if (!ABSOLUTE_SVG_LENGTH.test(widthValue) || !ABSOLUTE_SVG_LENGTH.test(heightValue)) return;
        const width = Number.parseFloat(widthValue);
        const height = Number.parseFloat(heightValue);
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
          node.attributes.viewBox = `0 0 ${width} ${height}`;
        }
      },
    },
  }),
};

export function hasUnsafeCss(value: string) {
  if (/@import\b|expression\s*\(|javascript\s*:|-moz-binding\s*:|behavior\s*:/i.test(value)) return true;
  for (const match of value.matchAll(/url\s*\(([^)]*)\)/gi)) {
    const target = match[1].trim().replace(/^['"]|['"]$/g, "");
    if (!target.startsWith("#")) return true;
  }
  return false;
}

const removeExternalContent: CustomPlugin = {
  name: "ohmyimg-remove-external-content",
  fn: () => ({
    element: {
      enter: (node, parentNode) => {
        const name = node.name.toLowerCase();
        if (["foreignobject", "image", "script"].includes(name)) {
          const index = parentNode.children.indexOf(node);
          if (index >= 0) parentNode.children.splice(index, 1);
          return;
        }
        if (name === "style") {
          const css = node.children.map((child) => child.type === "text" ? child.value : "").join("");
          if (hasUnsafeCss(css)) {
            const index = parentNode.children.indexOf(node);
            if (index >= 0) parentNode.children.splice(index, 1);
          }
          return;
        }
        for (const [attribute, rawValue] of Object.entries(node.attributes)) {
          const value = rawValue.trim();
          if (attribute.toLowerCase().startsWith("on")) {
            delete node.attributes[attribute];
          } else if ((attribute === "href" || attribute.endsWith(":href")) && !value.startsWith("#")) {
            delete node.attributes[attribute];
          } else if (hasUnsafeCss(value)) {
            delete node.attributes[attribute];
          }
        }
      },
    },
  }),
};

export function optimizeSvg(svg: string, floatPrecision = 3): OptimizeSvgResult {
  const startedAt = performance.now();
  const beforeBytes = Buffer.byteLength(svg);
  const selfContainedSvg = svg.replace(/<\?xml-stylesheet[\s\S]*?\?>/gi, "");
  const result = optimize(selfContainedSvg, {
    multipass: true,
    floatPrecision,
    plugins: [
      ensureViewBox,
      { name: "preset-default", params: { overrides: { removeDesc: false, convertShapeToPath: false } } },
      "removeScripts",
      "removeRasterImages",
      removeExternalContent,
    ],
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
