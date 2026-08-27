"use client";

import { Button } from "@/components/ui/button";
import type { RasterMode } from "@/lib/raster/types";

const MODES: Array<{ value: RasterMode; label: string; description: string }> = [
  { value: "high", label: "고화질", description: "세부 묘사를 더 보존" },
  { value: "balanced", label: "균형", description: "화질과 용량의 균형" },
  { value: "small", label: "최소 용량", description: "작은 파일을 우선" },
  { value: "auto", label: "자동", description: "조건을 만족하는 가장 작은 결과" },
];

interface RasterSettingsProps {
  mode: RasterMode;
  onMode: (mode: RasterMode) => void;
  maxWidth: string;
  maxHeight: string;
  onMaxWidth: (value: string) => void;
  onMaxHeight: (value: string) => void;
  maxWidthInvalid?: boolean;
  maxHeightInvalid?: boolean;
  disabled?: boolean;
}

export function RasterSettings({
  mode,
  onMode,
  maxWidth,
  maxHeight,
  onMaxWidth,
  onMaxHeight,
  maxWidthInvalid,
  maxHeightInvalid,
  disabled,
}: RasterSettingsProps) {
  const resizeInvalid = maxWidthInvalid || maxHeightInvalid;

  return (
    <div className="space-y-5">
      <fieldset disabled={disabled}>
        <legend className="mb-3 text-sm font-medium">압축 프리셋</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          {MODES.map((item) => {
            const selected = mode === item.value;
            return (
              <Button
                key={item.value}
                type="button"
                variant={selected ? "default" : "outline"}
                aria-pressed={selected}
                onClick={() => onMode(item.value)}
                className="h-auto min-h-16 flex-col items-start gap-0.5 px-3 py-2.5 text-left"
              >
                <span>{item.label}</span>
                <span className={selected ? "text-primary-foreground/70" : "text-muted-foreground"}>
                  {item.description}
                </span>
              </Button>
            );
          })}
        </div>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend className="mb-2 text-sm font-medium">자른 후 크기 조절</legend>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          선택 사항입니다. 입력한 최대 크기보다 작은 이미지는 확대하지 않습니다.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">
            너비
            <input
              type="number"
              min="1"
              max="8192"
              step="1"
              inputMode="numeric"
              value={maxWidth}
              onChange={(event) => onMaxWidth(event.target.value)}
              aria-invalid={maxWidthInvalid}
              aria-describedby={maxWidthInvalid ? "raster-resize-error" : undefined}
              placeholder="원본"
              className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            높이
            <input
              type="number"
              min="1"
              max="8192"
              step="1"
              inputMode="numeric"
              value={maxHeight}
              onChange={(event) => onMaxHeight(event.target.value)}
              aria-invalid={maxHeightInvalid}
              aria-describedby={maxHeightInvalid ? "raster-resize-error" : undefined}
              placeholder="원본"
              className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </div>
        {resizeInvalid ? (
          <p id="raster-resize-error" className="mt-2 text-xs text-destructive">
            1에서 8192 사이의 정수 픽셀을 입력하세요.
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}
