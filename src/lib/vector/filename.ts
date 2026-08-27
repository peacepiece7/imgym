export function toSvgFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `${base.replace(/^[-.]+|[-.]+$/g, "") || "vectorized"}.svg`;
}
