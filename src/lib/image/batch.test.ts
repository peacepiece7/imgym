import { describe, expect, it } from "vitest";
import {
  batchSelectionMessage,
  MAX_BATCH_BYTES,
  MAX_BATCH_FILES,
  MAX_IMAGE_BYTES,
  selectBatchFiles,
} from "./batch";

function file(name: string, size = 1024, type = "image/png") {
  return { name, size, type };
}

describe("multi-image batch selection", () => {
  it("accepts supported files in supplied order and keeps duplicate names", () => {
    const incoming = [
      file("same.png"),
      file("same.png", 2048, "application/octet-stream"),
      file("photo.jpg", 4096, "image/jpeg"),
    ];

    const result = selectBatchFiles([], incoming);

    expect(result.accepted).toEqual(incoming);
    expect(result.rejected).toEqual([]);
  });

  it("accepts valid files while rejecting invalid and oversized files independently", () => {
    const valid = file("valid.webp", 2048, "image/webp");
    const result = selectBatchFiles([], [
      file("notes.txt", 100, "text/plain"),
      valid,
      file("huge.png", MAX_IMAGE_BYTES + 1),
    ]);

    expect(result.accepted).toEqual([valid]);
    expect(result.rejected.map(({ file: rejected }) => rejected.name)).toEqual(["notes.txt", "huge.png"]);
    expect(batchSelectionMessage(result)).toContain("1개 추가");
    expect(batchSelectionMessage(result)).toContain("2개 제외");
  });

  it("enforces the file-count limit without rejecting earlier accepted files", () => {
    const existing = Array.from({ length: MAX_BATCH_FILES - 1 }, (_, index) => file(`${index}.png`));
    const first = file("accepted.png");
    const second = file("rejected.png");

    const result = selectBatchFiles(existing, [first, second]);

    expect(result.accepted).toEqual([first]);
    expect(result.rejected).toEqual([{ file: second, reason: "최대 10개까지 추가할 수 있습니다." }]);
  });

  it("enforces the aggregate byte limit in supplied order", () => {
    const existing = [file("existing.png", MAX_BATCH_BYTES - 2048)];
    const first = file("accepted.png", 1024);
    const second = file("rejected.png", 2048);

    const result = selectBatchFiles(existing, [first, second]);

    expect(result.accepted).toEqual([first]);
    expect(result.rejected).toEqual([{ file: second, reason: "전체 파일 크기 50MB를 초과했습니다." }]);
  });
});

