"use client";

import { FileImage, UploadCloud, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  batchSelectionMessage,
  formatImageBytes,
  MAX_BATCH_FILES,
  selectBatchFiles,
} from "@/lib/image/batch";
import { cn } from "@/lib/utils";

interface ImageDropzoneProps {
  files: readonly File[];
  onFiles: (files: File[]) => void;
  onClear: () => void;
  disabled?: boolean;
}

export function ImageDropzone({ files, onFiles, onClear, disabled }: ImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");

  function choose(fileList: FileList | null) {
    if (disabled || !fileList?.length) return;
    const selection = selectBatchFiles(files, Array.from(fileList));
    if (selection.accepted.length > 0) onFiles(selection.accepted);
    setNotice(batchSelectionMessage(selection));
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        choose(event.dataTransfer.files);
      }}
      className={cn(
        "relative flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
        dragging ? "border-primary bg-primary/8" : "border-border bg-card/50 hover:bg-card",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          choose(event.target.files);
          event.currentTarget.value = "";
        }}
        aria-label="PNG, JPEG 또는 WebP 이미지 여러 개 선택"
      />

      {files.length > 0 ? (
        <>
          <div className="mb-4 rounded-lg bg-primary/12 p-3 text-primary">
            <FileImage className="size-6" aria-hidden="true" />
          </div>
          <p className="font-medium">이미지 {files.length}개</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {formatImageBytes(totalBytes)} · 최대 {MAX_BATCH_FILES}개
          </p>
          <div className="mt-5 flex gap-2">
            <Button type="button" variant="outline" disabled={disabled} onClick={() => inputRef.current?.click()}>
              더 추가
            </Button>
            <Button type="button" variant="ghost" disabled={disabled} onClick={onClear} aria-label="모든 이미지 제거">
              <X aria-hidden="true" />
              전체 제거
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="mb-4 rounded-lg bg-primary/12 p-3 text-primary">
            <UploadCloud className="size-6" aria-hidden="true" />
          </div>
          <p className="font-medium">이미지를 여기에 놓으세요</p>
          <p className="mt-1 text-sm text-muted-foreground">PNG, JPEG 또는 WebP · 파일당 10MB · 최대 10개</p>
          <Button type="button" className="mt-5" variant="outline" disabled={disabled} onClick={() => inputRef.current?.click()}>
            이미지 선택
          </Button>
        </>
      )}
      <p className="sr-only" aria-live="polite">{notice}</p>
    </div>
  );
}
