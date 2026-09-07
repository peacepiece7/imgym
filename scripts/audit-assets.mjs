import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { imageDimensionsFromData } from "image-dimensions";

const args = process.argv.slice(2).filter((value) => value !== "--");
const changedIndex = args.indexOf("--changed");
const changed = changedIndex >= 0;
if (changed) args.splice(changedIndex, 1);
const maximumBytes = Number(process.env.ASSET_MAX_BYTES ?? 10 * 1024 * 1024);
const maximumPixels = Number(process.env.ASSET_MAX_PIXELS ?? 25_000_000);
const forbidden = new Set((process.env.ASSET_FORBIDDEN_FORMATS ?? "gif,bmp,tiff").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
const failOnMetadata = process.env.ASSET_FAIL_ON_METADATA !== "false";
const failOnDuplicates = process.env.ASSET_FAIL_ON_DUPLICATES !== "false";
if (!Number.isFinite(maximumBytes) || maximumBytes < 1 || !Number.isFinite(maximumPixels) || maximumPixels < 1) {
  process.stderr.write("Invalid asset budget environment.\n");
  process.exit(2);
}

async function filesBelow(path) {
  const info = await stat(path).catch(() => null);
  if (!info) return [];
  if (info.isFile()) return [path];
  if (!info.isDirectory()) return [];
  const children = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(children.filter(({ name }) => !name.startsWith(".") && name !== "node_modules" && name !== ".next").map((entry) => filesBelow(resolve(path, entry.name))));
  return nested.flat();
}

function changedFiles() {
  const result = spawnSync("git", ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"], { encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error("Could not read changed files from git");
  return result.stdout.split("\n").filter(Boolean).map((path) => resolve(path));
}

function formatOf(data) {
  if (data.byteLength < 4) return null;
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (data[0] === 0xff && data[1] === 0xd8) return "jpeg";
  if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (["GIF87a", "GIF89a"].includes(data.toString("ascii", 0, 6))) return "gif";
  if (data.toString("ascii", 0, 2) === "BM") return "bmp";
  if (["II*\0", "MM\0*"].includes(data.toString("ascii", 0, 4))) return "tiff";
  if (data.toString("ascii", 4, 8) === "ftyp") return "heic";
  if (["wOFF", "wOF2", "OTTO", "true", "ttcf"].includes(data.toString("ascii", 0, 4)) || data.readUInt32BE(0) === 0x00010000) return "font";
  const head = data.subarray(0, 1024).toString("utf8").trimStart();
  if (head.startsWith("<svg") || /^<\?xml[^>]*>\s*<svg/.test(head)) return "svg";
  return null;
}

function privateMetadata(data, format) {
  if (!["png", "jpeg", "webp"].includes(format)) return [];
  const markers = [];
  if (data.includes(Buffer.from("Exif\0\0")) || data.includes(Buffer.from("eXIf"))) markers.push("EXIF");
  if (data.includes(Buffer.from("http://ns.adobe.com/xap/1.0/")) || data.includes(Buffer.from("application/rdf+xml"))) markers.push("XMP");
  if (data.includes(Buffer.from("GPSLatitude")) || data.includes(Buffer.from("GPSInfo"))) markers.push("GPS");
  return markers;
}

const inputPaths = changed ? changedFiles() : args.length ? args.map((value) => resolve(value)) : [resolve("public")];
const files = [...new Set((await Promise.all(inputPaths.map(filesBelow))).flat())].sort();
const items = [];
const hashes = new Map();
for (const path of files) {
  const data = await readFile(path);
  const format = formatOf(data);
  if (!format) continue;
  let dimensions = null;
  try {
    const found = imageDimensionsFromData(new Uint8Array(data));
    if (found) dimensions = { width: found.width, height: found.height, pixels: found.width * found.height };
  } catch {
    // Unsupported dimensions remain visible as null in the report.
  }
  const hash = createHash("sha256").update(data).digest("hex");
  const metadata = privateMetadata(data, format);
  const violations = [];
  if (data.byteLength > maximumBytes) violations.push(`bytes>${maximumBytes}`);
  if (dimensions && dimensions.pixels > maximumPixels) violations.push(`pixels>${maximumPixels}`);
  if (forbidden.has(format)) violations.push(`forbidden:${format}`);
  if (failOnMetadata && metadata.length) violations.push(`private-metadata:${metadata.join("+")}`);
  items.push({ path, format, bytes: data.byteLength, ...dimensions, sha256: hash, metadata, violations });
  hashes.set(hash, [...(hashes.get(hash) ?? []), path]);
}
const duplicates = [...hashes.entries()].filter(([, paths]) => paths.length > 1).map(([sha256, paths]) => ({ sha256, paths }));
if (failOnDuplicates) {
  for (const duplicate of duplicates) {
    for (const path of duplicate.paths.slice(1)) {
      items.find((item) => item.path === path)?.violations.push(`exact-duplicate:${duplicate.paths[0]}`);
    }
  }
}
const failed = items.filter(({ violations }) => violations.length > 0).length;
process.stdout.write(`${JSON.stringify({ schemaVersion: "ohmyimg.asset-audit.v1", budgets: { maximumBytes, maximumPixels, forbiddenFormats: [...forbidden], failOnMetadata, failOnDuplicates }, summary: { scanned: items.length, failed, exactDuplicateGroups: duplicates.length }, duplicates, items }, null, 2)}\n`);
process.exitCode = failed > 0 ? 1 : 0;
