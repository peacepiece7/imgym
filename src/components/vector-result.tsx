"use client";

import { Braces, Download, Layers3, Palette, Route } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import type { VectorizeApiResult } from "@/lib/vector/types";

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 1024 * 100 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function milliseconds(value: number) {
  return `${Math.round(value)} ms`;
}

interface VectorResultProps {
  result: VectorizeApiResult;
  downloadUrl: string;
}

export function VectorResult({ result, downloadUrl }: VectorResultProps) {
  const reduction = Math.max(0, Math.min(100, result.output.optimizationPercent));
  const complexity = [
    { label: "패스", value: result.stats.paths, icon: Route },
    { label: "명령", value: result.stats.commands, icon: Braces },
    { label: "요소", value: result.stats.elements, icon: Layers3 },
    { label: "색상", value: result.stats.colors, icon: Palette },
  ];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>결과 정보</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.input.width} × {result.input.height} · {result.input.format.toUpperCase()} · {candidateLabel(result.selection.candidate)}
          </p>
        </div>
        <Button asChild size="lg">
          <a href={downloadUrl} download={result.downloadName}>
            <Download aria-hidden="true" />
            SVG 다운로드
          </a>
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="원본 래스터" value={bytes(result.input.bytes)} />
          <Metric label="원본 SVG" value={bytes(result.output.rawBytes)} />
          <Metric label="최적화된 SVG" value={bytes(result.output.optimizedBytes)} accent />
        </div>

        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">SVGO 용량 감소</span>
            <Badge variant="secondary" className="font-mono">
              {result.output.optimizationPercent.toFixed(1)}%
            </Badge>
          </div>
          <Progress value={reduction} aria-label={`SVGO로 파일 용량을 ${reduction.toFixed(1)}퍼센트 줄였습니다`} />
        </div>

        <Separator />

        {result.selection.ssim !== undefined ? (
          <div className="space-y-2">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="SSIM" value={result.selection.ssim.toFixed(4)} accent />
              <Metric label="픽셀 MAE" value={(result.selection.mae ?? 0).toFixed(4)} />
              <Metric label="경계 MAE" value={(result.selection.edgeMae ?? 0).toFixed(4)} />
            </div>
            {result.selection.qualityGate
              ? <p className="font-mono text-xs text-muted-foreground">실험적 품질 기준: {result.selection.qualityGate}</p>
              : null}
          </div>
        ) : null}

        {result.selection.ssim !== undefined ? <Separator /> : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {complexity.map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex items-center gap-3 rounded-lg border p-3">
              <Icon className="size-4 text-primary" aria-hidden="true" />
              <div>
                <p className="font-mono text-lg leading-none">{value.toLocaleString()}</p>
                <p className="mt-1 text-xs text-muted-foreground">{label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-muted-foreground">
          {result.timing.preprocessingMs > 0
            ? <span>전처리 {milliseconds(result.timing.preprocessingMs)}</span>
            : null}
          <span>벡터화 {milliseconds(result.timing.vectorizationMs)}</span>
          <span>최적화 {milliseconds(result.timing.optimizationMs)}</span>
          {result.timing.rasterizationMs > 0
            ? <span>래스터화 {milliseconds(result.timing.rasterizationMs)}</span>
            : null}
          {result.timing.measurementMs > 0
            ? <span>측정 {milliseconds(result.timing.measurementMs)}</span>
            : null}
          <span>후보 {result.selection.candidates}개</span>
          {result.selection.evaluationWidth && result.selection.evaluationHeight
            ? <span>평가 크기 {result.selection.evaluationWidth} × {result.selection.evaluationHeight}</span>
            : null}
          {result.cleanup ? <span>정리된 팔레트 {result.cleanup.colors}색</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function candidateLabel(value: string) {
  return ({
    accurate: "정확",
    balanced: "균형",
    "balanced-compact": "균형·압축",
    tiny: "최소 용량",
    compact: "압축",
    minimum: "최소",
  } as Record<string, string>)[value] ?? value;
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={accent ? "mt-1 font-mono text-xl text-primary" : "mt-1 font-mono text-xl"}>
        {value}
      </p>
    </div>
  );
}
