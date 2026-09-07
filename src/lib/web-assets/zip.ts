import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

export const WEB_ASSET_ZIP_LIMITS = {
  maxEntries: 260,
  maxUncompressedBytes: 128 * 1024 * 1024,
} as const;

export type ZipEntry =
  | { name: string; data: Buffer }
  | { name: string; path: string };

type PreparedEntry = ZipEntry & {
  nameBytes: Buffer;
  size: number;
  crc32: number;
};

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function updateCrc32(state: number, chunk: Uint8Array) {
  let crc = state;
  for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc >>> 0;
}

export function crc32(data: Uint8Array) {
  return (updateCrc32(0xffffffff, data) ^ 0xffffffff) >>> 0;
}

export function assertSafeZipPath(name: string) {
  if (
    name.length < 1
    || name.length > 240
    || name.includes("\0")
    || name.includes("\\")
    || name.startsWith("/")
    || /^[A-Za-z]:/.test(name)
    || name.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("Unsafe ZIP entry path");
  }
}

async function fileCrc32(path: string) {
  let state = 0xffffffff;
  for await (const chunk of createReadStream(path)) state = updateCrc32(state, chunk as Buffer);
  return (state ^ 0xffffffff) >>> 0;
}

async function prepareEntries(entries: readonly ZipEntry[]) {
  if (entries.length < 1 || entries.length > WEB_ASSET_ZIP_LIMITS.maxEntries) {
    throw new Error("ZIP entry limit exceeded");
  }
  const names = new Set<string>();
  const prepared: PreparedEntry[] = [];
  let total = 0;
  for (const entry of entries) {
    assertSafeZipPath(entry.name);
    if (names.has(entry.name)) throw new Error("Duplicate ZIP entry path");
    names.add(entry.name);
    const nameBytes = Buffer.from(entry.name, "utf8");
    if (nameBytes.byteLength > 0xffff) throw new Error("ZIP entry name is too long");
    const size = "data" in entry ? entry.data.byteLength : (await stat(entry.path)).size;
    if (size > 0xffffffff) throw new Error("ZIP64 entries are not supported");
    total += size;
    if (total > WEB_ASSET_ZIP_LIMITS.maxUncompressedBytes) throw new Error("ZIP output limit exceeded");
    prepared.push({
      ...entry,
      nameBytes,
      size,
      crc32: "data" in entry ? crc32(entry.data) : await fileCrc32(entry.path),
    });
  }
  return prepared;
}

function localHeader(entry: PreparedEntry) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0x21, 12);
  header.writeUInt32LE(entry.crc32, 14);
  header.writeUInt32LE(entry.size, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(entry.nameBytes.byteLength, 26);
  return header;
}

function centralHeader(entry: PreparedEntry, offset: number) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0x21, 14);
  header.writeUInt32LE(entry.crc32, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.nameBytes.byteLength, 28);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

function endOfCentralDirectory(entries: number, centralBytes: number, centralOffset: number) {
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(entries, 8);
  footer.writeUInt16LE(entries, 10);
  footer.writeUInt32LE(centralBytes, 12);
  footer.writeUInt32LE(centralOffset, 16);
  return footer;
}

export async function createZipStream(entries: readonly ZipEntry[], cleanup: () => Promise<void>) {
  const prepared = await prepareEntries(entries);
  const localOffsets: number[] = [];
  let localBytes = 0;
  for (const entry of prepared) {
    localOffsets.push(localBytes);
    localBytes += 30 + entry.nameBytes.byteLength + entry.size;
  }
  const centralBytes = prepared.reduce((sum, entry) => sum + 46 + entry.nameBytes.byteLength, 0);
  const contentLength = localBytes + centralBytes + 22;

  async function* generate() {
    try {
      for (const entry of prepared) {
        yield localHeader(entry);
        yield entry.nameBytes;
        if ("data" in entry) {
          yield entry.data;
        } else {
          for await (const chunk of createReadStream(entry.path)) yield chunk as Buffer;
        }
      }
      for (const [index, entry] of prepared.entries()) {
        yield centralHeader(entry, localOffsets[index]);
        yield entry.nameBytes;
      }
      yield endOfCentralDirectory(prepared.length, centralBytes, localBytes);
    } finally {
      await cleanup();
    }
  }

  const nodeStream = Readable.from(generate());
  return {
    stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
    contentLength,
    entries: prepared.length,
    uncompressedBytes: prepared.reduce((sum, entry) => sum + entry.size, 0),
  };
}
