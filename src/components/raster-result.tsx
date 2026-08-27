"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface RasterResultData {
  downloadName: string;
  originalBytes: number;
  outputBytes: number;
  width: number;
  height: number;
  processingMs: number;
  preset: string;
  candidates: number;
  ssim?: number;
  mae?: number;
}

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 1024 * 100 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

export function RasterResult({
  result,
  downloadUrl,
  originalDimensions,
}: {
  result: RasterResultData;
  downloadUrl: string;
  originalDimensions: { width: number; height: number } | null;
}) {
  const reduction = result.originalBytes > 0
    ? ((result.originalBytes - result.outputBytes) / result.originalBytes) * 100
    : 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>결과 정보</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {originalDimensions
              ? `${originalDimensions.width} × ${originalDimensions.height} → `
              : ""}
            {result.width} × {result.height} · {rasterPresetLabel(result.preset)}
          </p>
        </div>
        <Button asChild size="lg">
          <a href={downloadUrl} download={result.downloadName}>
            <Download aria-hidden="true" />
            이미지 다운로드
          </a>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric
            label="원본"
            value={bytes(result.originalBytes)}
            detail={originalDimensions ? `${originalDimensions.width} × ${originalDimensions.height}` : undefined}
          />
          <Metric label="최적화 결과" value={bytes(result.outputBytes)} detail={`${result.width} × ${result.height}`} accent />
          <Metric label="용량 변화" value={`${reduction >= 0 ? "−" : "+"}${Math.abs(reduction).toFixed(1)}%`} />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-muted-foreground">
          <span>처리 {Math.round(result.processingMs)} ms</span>
          <span>후보 {result.candidates}개</span>
          {result.ssim !== undefined ? <span>SSIM {result.ssim.toFixed(4)}</span> : null}
          {result.mae !== undefined ? <span>MAE {result.mae.toFixed(4)}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function rasterPresetLabel(value: string) {
  const fixed = ({ high: "고화질", balanced: "균형", small: "최소 용량", auto: "자동" } as Record<string, string>)[value];
  if (fixed) return fixed;
  return value
    .replace(/^PNG compression (\d+)$/, "PNG 압축 $1")
    .replace(/^JPEG quality (\d+)$/, "JPEG 품질 $1")
    .replace(/^WebP quality (\d+)$/, "WebP 품질 $1");
}

function Metric({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={accent ? "mt-1 font-mono text-xl text-primary" : "mt-1 font-mono text-xl"}>{value}</p>
      {detail ? <p className="mt-1 font-mono text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}
