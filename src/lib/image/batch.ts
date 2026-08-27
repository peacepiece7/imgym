export const MAX_BATCH_FILES = 10;
export const MAX_BATCH_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const SUPPORTED_IMAGE_EXTENSION = /\.(?:png|jpe?g|webp)$/i;

export type BatchItemStatus = "queued" | "processing" | "succeeded" | "failed" | "cancelled";

export interface BatchFileLike {
  name: string;
  size: number;
  type: string;
}

export interface BatchSelection<TFile extends BatchFileLike> {
  accepted: TFile[];
  rejected: Array<{ file: TFile; reason: string }>;
}

export function imageRejection(file: BatchFileLike) {
  if (file.size > MAX_IMAGE_BYTES) return "파일당 10MB를 초과했습니다.";

  const type = file.type.toLowerCase();
  const typeSupported = SUPPORTED_IMAGE_TYPES.has(type);
  const extensionFallback = (!type || type === "application/octet-stream")
    && SUPPORTED_IMAGE_EXTENSION.test(file.name);
  return typeSupported || extensionFallback ? "" : "지원하지 않는 이미지 형식입니다.";
}

export function selectBatchFiles<TFile extends BatchFileLike>(
  existing: readonly BatchFileLike[],
  incoming: readonly TFile[],
): BatchSelection<TFile> {
  const accepted: TFile[] = [];
  const rejected: Array<{ file: TFile; reason: string }> = [];
  let count = existing.length;
  let bytes = existing.reduce((sum, file) => sum + file.size, 0);

  for (const file of incoming) {
    const rejection = imageRejection(file);
    if (rejection) {
      rejected.push({ file, reason: rejection });
      continue;
    }
    if (count >= MAX_BATCH_FILES) {
      rejected.push({ file, reason: "최대 10개까지 추가할 수 있습니다." });
      continue;
    }
    if (bytes + file.size > MAX_BATCH_BYTES) {
      rejected.push({ file, reason: "전체 파일 크기 50MB를 초과했습니다." });
      continue;
    }
    accepted.push(file);
    count += 1;
    bytes += file.size;
  }

  return { accepted, rejected };
}

export function batchSelectionMessage(selection: BatchSelection<BatchFileLike>) {
  const parts = [];
  if (selection.accepted.length > 0) parts.push(`${selection.accepted.length}개 추가`);
  if (selection.rejected.length > 0) {
    const reasons = [...new Set(selection.rejected.map(({ reason }) => reason))].join(" ");
    parts.push(`${selection.rejected.length}개 제외 · ${reasons}`);
  }
  return parts.join(" · ");
}

export function formatImageBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 1024 * 100 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

