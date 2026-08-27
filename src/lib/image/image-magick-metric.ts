import { MAGICK_LIMIT_ARGS, runMagick } from "@/lib/raster/image-magick";

function parseDistortion(output: Buffer) {
  const value = Number.parseFloat(output.toString("utf8"));
  if (!Number.isFinite(value)) throw new Error("ImageMagick returned an invalid metric");
  return value;
}

export async function measureAssociatedAlphaDistortion(
  reference: string,
  candidate: string,
  metric: "SSIM" | "MAE",
  temporaryDirectory: string,
  signal?: AbortSignal,
) {
  const result = await runMagick([
    ...MAGICK_LIMIT_ARGS,
    "(", reference,
    "-colorspace", "sRGB",
    "-alpha", "set",
    "-alpha", "associate",
    ")",
    "(", candidate,
    "-colorspace", "sRGB",
    "-alpha", "set",
    "-alpha", "associate",
    ")",
    "-metric", metric,
    "-compare",
    "-format", "%[distortion]",
    "info:",
  ], { signal, temporaryDirectory, stdoutLimit: 1_024 });
  return parseDistortion(result.stdout);
}
