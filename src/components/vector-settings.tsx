"use client";

import { Button } from "@/components/ui/button";
import { resolveVectorCleanup } from "@/lib/vector/cleanup-presets";
import {
  VECTOR_COLOR_STOPS,
  type VectorCleanupAdvanced,
  type VectorCleanupLevel,
  type VectorCleanupOptionsV1,
} from "@/lib/vector/cleanup-types";
import type { VectorizeMode, VectorizePreset } from "@/lib/vector/types";

const PRESETS: Array<{ value: VectorizeMode; label: string; description: string }> = [
  { value: "accurate", label: "정확", description: "세부 묘사를 최대한 보존" },
  { value: "balanced", label: "균형", description: "품질과 용량의 균형" },
  { value: "tiny", label: "최소 용량", description: "작은 SVG를 우선" },
  { value: "auto", label: "자동", description: "조건을 만족하는 가장 작은 SVG 검색" },
];

interface VectorSettingsProps {
  value: VectorizeMode;
  onChange: (value: VectorizeMode) => void;
  cleanup: VectorCleanupOptionsV1;
  onCleanup: (value: VectorCleanupOptionsV1) => void;
  disabled?: boolean;
}

function numericValue(value: string, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : minimum;
}

function keepIndependentAdvanced(advanced: VectorCleanupAdvanced | undefined) {
  if (!advanced) return undefined;
  const retained: VectorCleanupAdvanced = {
    alphaCutoff: advanced.alphaCutoff,
    gradientStep: advanced.gradientStep,
    colorPrecision: advanced.colorPrecision,
  };
  return Object.values(retained).some((value) => value !== undefined) ? retained : undefined;
}

export function VectorSettings({ value, onChange, cleanup, onCleanup, disabled }: VectorSettingsProps) {
  const auto = value === "auto";
  const resolved = resolveVectorCleanup(auto ? "balanced" : value as VectorizePreset, cleanup);
  const colorIndex = VECTOR_COLOR_STOPS.indexOf(cleanup.colors);

  function updateAdvanced(patch: Partial<VectorCleanupAdvanced>) {
    onCleanup({ ...cleanup, advanced: { ...cleanup.advanced, ...patch } });
  }

  return (
    <div className="space-y-5">
      <fieldset disabled={disabled}>
        <legend className="mb-3 text-sm font-medium">벡터 변환 프리셋</legend>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
          {PRESETS.map((preset) => {
            const selected = value === preset.value;
            return (
              <Button
                key={preset.value}
                type="button"
                variant={selected ? "default" : "outline"}
                aria-pressed={selected}
                onClick={() => onChange(preset.value)}
                className="h-auto min-h-16 flex-col items-start gap-0.5 px-3 py-2.5 text-left"
              >
                <span>{preset.label}</span>
                <span className={selected ? "text-primary-foreground/70" : "text-muted-foreground"}>
                  {preset.description}
                </span>
              </Button>
            );
          })}
        </div>
      </fieldset>

      <fieldset disabled={disabled || auto} className="space-y-4 disabled:opacity-55">
        <legend className="text-sm font-medium">래스터 정리</legend>
        {auto ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            정리된 래스터를 품질 기준으로 사용하는 자동 검색이 준비될 때까지 자동 모드에서는 정리 기능을 사용할 수 없습니다.
          </p>
        ) : null}

        <label className="block text-xs text-muted-foreground">
          <span className="flex justify-between"><span>디테일 정리</span><span>단계 {cleanup.cleanup}</span></span>
          <input
            type="range"
            min="0"
            max="4"
            step="1"
            value={4 - cleanup.cleanup}
            onChange={(event) => onCleanup({
              ...cleanup,
              cleanup: (4 - Number(event.target.value)) as VectorCleanupLevel,
              advanced: keepIndependentAdvanced(cleanup.advanced),
            })}
            aria-label="더 깔끔한 결과부터 더 많은 디테일까지 조절"
            className="mt-2 w-full accent-primary"
          />
          <span className="flex justify-between"><span>깔끔하게</span><span>디테일 유지</span></span>
        </label>

        <label className="block text-xs text-muted-foreground">
          <span className="flex justify-between">
            <span>색상 수</span>
            <span>{cleanup.colors === "full" ? "전체" : `최대 ${cleanup.colors}색`}</span>
          </span>
          <input
            type="range"
            min="0"
            max={VECTOR_COLOR_STOPS.length - 1}
            step="1"
            value={colorIndex}
            onChange={(event) => onCleanup({ ...cleanup, colors: VECTOR_COLOR_STOPS[Number(event.target.value)] })}
            aria-label="벡터 변환 전 래스터의 최대 색상 수"
            className="mt-2 w-full accent-primary"
          />
          <span className="flex justify-between"><span>3색</span><span>전체</span></span>
        </label>

        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">고급 설정</summary>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <NumberField label="작은 영역 제거" value={resolved.vtracer.filterSpeckle ?? 4} min={0} max={128} step={1} onValue={(speckleSize) => updateAdvanced({ speckleSize })} />
            <NumberField label="알파 기준값" value={cleanup.advanced?.alphaCutoff ?? 0} min={0} max={255} step={1} onValue={(alphaCutoff) => updateAdvanced({ alphaCutoff })} />
            <NumberField label="그라디언트 단계" value={resolved.vtracer.layerDifference ?? 16} min={0} max={128} step={1} onValue={(gradientStep) => updateAdvanced({ gradientStep })} />
            <NumberField label="색상 정밀도" value={resolved.vtracer.colorPrecision ?? 8} min={1} max={8} step={1} disabled={cleanup.colors !== "full"} onValue={(colorPrecision) => updateAdvanced({ colorPrecision })} />
            <NumberField label="패스 단순화" value={resolved.vtracer.simplify ?? 0} min={0} max={4} step={0.25} onValue={(pathSimplify) => updateAdvanced({ pathSimplify })} />
            <label className="text-xs text-muted-foreground">
              최소 패스 면적
              <input disabled value="V3 예정" aria-label="최소 패스 면적 기능은 SVG V3에서 제공할 예정입니다" className="mt-1 h-9 w-full rounded-lg border border-input bg-muted px-3 font-mono text-sm" />
            </label>
          </div>
          {cleanup.colors !== "full" ? <p className="mt-3 text-xs text-muted-foreground">래스터 색상 수 제한을 사용할 때 색상 정밀도는 8로 고정됩니다.</p> : null}
          <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={() => onCleanup({ ...cleanup, advanced: undefined })}>고급 설정 초기화</Button>
        </details>
      </fieldset>
    </div>
  );
}

function NumberField({ label, value, min, max, step, disabled, onValue }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onValue: (value: number) => void;
}) {
  return (
    <label className="text-xs text-muted-foreground">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          const next = numericValue(event.target.value, min, max);
          onValue(Number.isInteger(step) ? Math.round(next) : next);
        }}
        className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted"
      />
    </label>
  );
}
