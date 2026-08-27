export type RasterAnimationFormat = "png" | "jpeg" | "webp";

function hasPngAnimation(data: Uint8Array) {
  let offset = 8;
  while (offset + 12 <= data.byteLength) {
    const view = new DataView(data.buffer, data.byteOffset + offset, data.byteLength - offset);
    const length = view.getUint32(0, false);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > data.byteLength) throw new Error("Malformed PNG");
    const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
    if (type === "acTL") return true;
    offset = chunkEnd;
    if (type === "IEND") return false;
  }
  throw new Error("Malformed PNG");
}

function hasWebpAnimation(data: Uint8Array) {
  if (data.byteLength < 12) throw new Error("Malformed WebP");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const riffEnd = view.getUint32(4, true) + 8;
  if (riffEnd !== data.byteLength) throw new Error("Malformed WebP");
  let offset = 12;
  while (offset + 8 <= riffEnd) {
    const type = String.fromCharCode(...data.subarray(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    const chunkEnd = offset + 8 + length;
    if (chunkEnd > riffEnd) throw new Error("Malformed WebP");
    if (type === "ANIM" || type === "ANMF") return true;
    if (type === "VP8X" && length >= 1 && (data[offset + 8] & 0x02) !== 0) return true;
    offset = chunkEnd + (length % 2);
  }
  return false;
}

export function hasRasterAnimation(data: Uint8Array, format: RasterAnimationFormat) {
  if (format === "png") return hasPngAnimation(data);
  if (format === "webp") return hasWebpAnimation(data);
  return false;
}
