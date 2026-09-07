import { optimize, type CustomPlugin } from "svgo";
import type { SvgStats } from "./types";
import { hasUnsafeCss } from "./svgo";

const PATH_COMMAND = /[MmZzLlHhVvCcSsQqTtAa]/g;
const COLOR_ATTRIBUTES = new Set([
  "color",
  "fill",
  "flood-color",
  "stop-color",
  "stroke",
]);
const UNSAFE_ELEMENTS = new Set(["foreignobject", "image", "script"]);

function hasExternalUrl(value: string) {
  const urls = value.matchAll(/url\s*\(([^)]*)\)/gi);
  for (const match of urls) {
    const target = match[1].trim().replace(/^['"]|['"]$/g, "");
    if (!target.startsWith("#")) return true;
  }
  return false;
}

function addColor(colors: Set<string>, value: string) {
  const normalized = value.trim().toLowerCase();
  if (
    normalized &&
    normalized !== "none" &&
    normalized !== "currentcolor" &&
    !normalized.startsWith("url(")
  ) {
    colors.add(normalized);
  }
}

export function analyzeSvg(svg: string): SvgStats {
  const colors = new Set<string>();
  const stats: SvgStats = { paths: 0, commands: 0, elements: 0, colors: 0 };

  const analyzer: CustomPlugin = {
    name: "ohmyimg-analyze",
    fn: () => ({
      element: {
        enter: (node) => {
          stats.elements += 1;

          if (UNSAFE_ELEMENTS.has(node.name.toLowerCase())) {
            throw new Error("Unsafe SVG output");
          }
          if (node.name.toLowerCase() === "style") {
            const css = node.children.map((child) => child.type === "text" ? child.value : "").join("");
            if (hasUnsafeCss(css)) throw new Error("Unsafe SVG output");
          }

          if (node.name === "path") {
            stats.paths += 1;
            stats.commands += node.attributes.d?.match(PATH_COMMAND)?.length ?? 0;
          }

          for (const [name, value] of Object.entries(node.attributes)) {
            if (name.startsWith("on")) {
              throw new Error("Unsafe SVG output");
            }
            if ((name === "href" || name === "xlink:href") && !value.startsWith("#")) {
              throw new Error("Unsafe SVG output");
            }
            if (hasExternalUrl(value)) throw new Error("Unsafe SVG output");
            if (COLOR_ATTRIBUTES.has(name)) {
              addColor(colors, value);
            }
            if (name === "style") {
              for (const declaration of value.split(";")) {
                const [property, propertyValue] = declaration.split(":", 2);
                if (propertyValue && COLOR_ATTRIBUTES.has(property.trim())) {
                  addColor(colors, propertyValue);
                }
              }
            }
          }
        },
      },
    }),
  };

  optimize(svg, { plugins: [analyzer] });
  stats.colors = colors.size;
  return stats;
}
