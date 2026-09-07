"use client";

import {
  AlertCircle,
  Check,
  CircleGauge,
  ClipboardCheck,
  Download,
  FileArchive,
  FileWarning,
  LoaderCircle,
  PackageCheck,
  ScanSearch,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ImageDropzone } from "@/components/image-dropzone";
import { ImagePreview } from "@/components/image-preview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useObjectUrl } from "@/hooks/use-object-url";
import { authenticatedApiFetch, koreanApiError } from "@/lib/api/client";
import { saveZipResponse } from "@/lib/api/download";
import { formatImageBytes, selectBatchFiles } from "@/lib/image/batch";
import {
  DEFAULT_WEB_ASSET_OPTIONS,
  WEB_ASSET_DEFAULT_SIZES,
  WEB_ASSET_WIDTH_PRESETS,
} from "@/lib/web-assets/options";
import type {
  AssetFacts,
  AssetInspectionItem,
  WebAssetAltKind,
  WebAssetColorPolicy,
  WebAssetContentHint,
  WebAssetLayout,
  WebAssetLoadingIntent,
  WebAssetOptions,
  WebAssetProfile,
} from "@/lib/web-assets/types";
import { cn } from "@/lib/utils";

interface WebAssetItem {
  id: string;
  file: File;
  altKind: WebAssetAltKind;
  altText: string;
  inspection?: AssetInspectionItem;
}

interface WebAssetWorkspaceProps {
  apiKey: string;
  onUnauthorized: () => void;
}

interface OutputPreview {
  key: string;
  blob: Blob;
  name: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
  ssim: number;
  mae: number;
  edgeMae: number;
  alphaMae: number;
}

const PROFILE: Array<{ value: WebAssetProfile; title: string; detail: string }> = [
  { value: "html", title: "HTML / CMS", detail: "fallback + WebP/AVIF + picture 코드" },
  { value: "next", title: "Next.js 16", detail: "중복 파생본 없이 source + Image 코드" },
  { value: "design", title: "디자인 핸드오프", detail: "1x/2x/3x와 내보내기 명세" },
];

const ALT_KIND: Array<{ value: WebAssetAltKind; label: string; hint: string }> = [
  { value: "decorative", label: "장식", hint: "alt는 비웁니다" },
  { value: "functional", label: "기능", hint: "버튼·링크의 동작을 설명" },
  { value: "informative", label: "정보", hint: "본문에 필요한 핵심 의미" },
  { value: "complex", label: "복합", hint: "짧은 alt + 별도 긴 설명" },
];

const CONTENT_HINT: Array<{ value: WebAssetContentHint; label: string }> = [
  { value: "auto", label: "자동 판별" },
  { value: "photo", label: "사진" },
  { value: "ui", label: "스크린샷 / UI" },
  { value: "logo", label: "로고 / 평면 그래픽" },
  { value: "transparent", label: "투명 에셋" },
];

function parseWidths(value: string) {
  if (!value.trim()) return undefined;
  const widths = value.split(",").map((part) => Number(part.trim()));
  if (widths.some((width) => !Number.isInteger(width) || width < 16 || width > 8_192)) return null;
  const unique = [...new Set(widths)].sort((left, right) => left - right);
  return unique.length >= 1 && unique.length <= 8 ? unique : null;
}

function inspectionLabel(item: WebAssetItem) {
  if (!item.inspection) return "검사 중";
  return item.inspection.status === "ready" ? "준비됨" : "제외됨";
}

function headerNumber(headers: Headers, name: string) {
  const value = Number(headers.get(name));
  return Number.isFinite(value) ? value : 0;
}

function metadataLabels(facts: AssetFacts) {
  const labels = [];
  if (facts.metadata.gps) labels.push("GPS");
  if (facts.metadata.exif) labels.push("EXIF");
  if (facts.metadata.iptc) labels.push("IPTC");
  if (facts.metadata.xmp) labels.push("XMP");
  if (facts.metadata.icc) labels.push("ICC");
  if (facts.metadata.cicp) labels.push("CICP");
  return labels.length > 0 ? labels.join(" · ") : "없음";
}

export function WebAssetWorkspace({ apiKey, onUnauthorized }: WebAssetWorkspaceProps) {
  const [items, setItems] = useState<WebAssetItem[]>([]);
  const itemsRef = useRef<WebAssetItem[]>([]);
  const [activeId, setActiveId] = useState("");
  const [profile, setProfile] = useState<WebAssetProfile>(DEFAULT_WEB_ASSET_OPTIONS.profile);
  const [layout, setLayout] = useState<WebAssetLayout>(DEFAULT_WEB_ASSET_OPTIONS.layout);
  const [customWidths, setCustomWidths] = useState("");
  const [designBaseWidth, setDesignBaseWidth] = useState(String(DEFAULT_WEB_ASSET_OPTIONS.designBaseWidth));
  const [sizes, setSizes] = useState(DEFAULT_WEB_ASSET_OPTIONS.sizes);
  const [contentHint, setContentHint] = useState<WebAssetContentHint>(DEFAULT_WEB_ASSET_OPTIONS.contentHint);
  const [colorPolicy, setColorPolicy] = useState<WebAssetColorPolicy>(DEFAULT_WEB_ASSET_OPTIONS.colorPolicy);
  const [loadingIntent, setLoadingIntent] = useState<WebAssetLoadingIntent>(DEFAULT_WEB_ASSET_OPTIONS.loading);
  const [includeWebp, setIncludeWebp] = useState(DEFAULT_WEB_ASSET_OPTIONS.includeWebp);
  const [includeAvif, setIncludeAvif] = useState(DEFAULT_WEB_ASSET_OPTIONS.includeAvif);
  const [includePlaceholder, setIncludePlaceholder] = useState(DEFAULT_WEB_ASSET_OPTIONS.includePlaceholder);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [generating, setGenerating] = useState<"all" | "selected" | "">("");
  const [previewing, setPreviewing] = useState(false);
  const [outputPreview, setOutputPreview] = useState<OutputPreview | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [previewUrl, setPreviewBlob] = useObjectUrl();
  const [outputUrl, setOutputBlob] = useObjectUrl();

  const activeItem = items.find((item) => item.id === activeId) ?? items[0];
  const activeAltKind = activeItem?.altKind ?? DEFAULT_WEB_ASSET_OPTIONS.altKind;
  const activeAltText = activeItem?.altText ?? DEFAULT_WEB_ASSET_OPTIONS.altText;
  const activeFacts = activeItem?.inspection?.status === "ready" ? activeItem.inspection.facts : null;
  const fileBatchKey = items.map(({ id, file }) => `${id}:${file.size}`).join("|");
  const readyCount = items.filter((item) => item.inspection?.status === "ready").length;
  const parsedWidths = parseWidths(customWidths);
  const parsedBaseWidth = Number(designBaseWidth);
  const optionsValid = parsedWidths !== null
    && Number.isInteger(parsedBaseWidth)
    && parsedBaseWidth >= 16
    && parsedBaseWidth <= 4_096
    && sizes.length <= 256
    && !/[<>\r\n]/.test(sizes)
    && items.every((item) => item.altKind === "decorative" || item.altText.trim().length > 0);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    setPreviewBlob(activeItem?.file ?? null);
  }, [activeItem?.file, setPreviewBlob]);

  useEffect(() => {
    if (!apiKey || !fileBatchKey) return;
    const controller = new AbortController();
    const snapshot = itemsRef.current;
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setInspecting(true);
        setError("");
      }
    });
    void (async () => {
      try {
        const body = new FormData();
        snapshot.forEach(({ file }) => body.append("images", file));
        const response = await authenticatedApiFetch("/api/v1/inspect-assets", apiKey, {
          method: "POST",
          body,
          signal: controller.signal,
        });
        const requestId = response.headers.get("x-request-id") ?? "";
        if (response.status === 401) {
          onUnauthorized();
          throw new Error("API 키가 올바르지 않습니다.");
        }
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(koreanApiError(payload?.error, "이미지 검사 중 오류가 발생했습니다."));
        }
        const payload = await response.json() as { items: AssetInspectionItem[] };
        if (controller.signal.aborted) return;
        setItems((current) => current.map((item) => {
          const index = snapshot.findIndex(({ id }) => id === item.id);
          return index >= 0 ? { ...item, inspection: payload.items[index] } : item;
        }));
        if (payload.items.some((item) => item.status === "failed")) {
          setNotice(`일부 파일은 안전 검사에서 제외됐습니다.${requestId ? ` 요청 ID ${requestId}` : ""}`);
        }
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "이미지 검사 중 오류가 발생했습니다.");
      } finally {
        if (!controller.signal.aborted) setInspecting(false);
      }
    })();
    return () => controller.abort();
  }, [apiKey, fileBatchKey, onUnauthorized]);

  const options = useMemo<WebAssetOptions | null>(() => {
    if (!optionsValid) return null;
    return {
      profile,
      layout,
      ...(parsedWidths ? { customWidths: parsedWidths } : {}),
      designBaseWidth: parsedBaseWidth,
      sizes,
      contentHint,
      colorPolicy,
      altKind: items[0]?.altKind ?? DEFAULT_WEB_ASSET_OPTIONS.altKind,
      altText: items[0]?.altKind === "decorative" ? "" : items[0]?.altText.trim() ?? "",
      accessibility: items.map((item) => ({
        kind: item.altKind,
        text: item.altKind === "decorative" ? "" : item.altText.trim(),
      })),
      loading: loadingIntent,
      includeWebp: profile === "html" && includeWebp,
      includeAvif: profile === "html" && includeAvif,
      includePlaceholder: profile === "next" && includePlaceholder,
    };
  }, [
    colorPolicy,
    contentHint,
    includeAvif,
    includePlaceholder,
    includeWebp,
    items,
    layout,
    loadingIntent,
    optionsValid,
    parsedBaseWidth,
    parsedWidths,
    profile,
    sizes,
  ]);
  const activeRecipeKey = activeItem && options
    ? `${activeItem.id}:${JSON.stringify({
        ...options,
        altKind: activeItem.altKind,
        altText: activeItem.altKind === "decorative" ? "" : activeItem.altText.trim(),
        accessibility: [{
          kind: activeItem.altKind,
          text: activeItem.altKind === "decorative" ? "" : activeItem.altText.trim(),
        }],
      })}`
    : "";
  const visibleOutput = outputPreview?.key === activeRecipeKey ? outputPreview : null;

  function addFiles(files: File[]) {
    const selection = selectBatchFiles(itemsRef.current.map(({ file }) => file), files);
    if (selection.accepted.length === 0) {
      setError(selection.rejected.map(({ reason }) => reason).join(" "));
      return;
    }
    const additions = selection.accepted.map<WebAssetItem>((file) => ({
      id: crypto.randomUUID(),
      file,
      altKind: DEFAULT_WEB_ASSET_OPTIONS.altKind,
      altText: "",
    }));
    setItems((current) => [...current, ...additions]);
    setActiveId((current) => current || additions[0]?.id || "");
    setError("");
    setNotice(selection.rejected.length > 0 ? `${selection.rejected.length}개 파일을 제한에 따라 제외했습니다.` : "");
  }

  function removeItem(id: string) {
    const next = itemsRef.current.filter((item) => item.id !== id);
    setItems(next);
    if (activeId === id) setActiveId(next[0]?.id ?? "");
  }

  function clearItems() {
    setItems([]);
    setActiveId("");
    setError("");
    setNotice("");
  }

  function changeLayout(next: WebAssetLayout) {
    setLayout(next);
    setSizes(WEB_ASSET_DEFAULT_SIZES[next]);
  }

  function updateActiveAccessibility(update: Partial<Pick<WebAssetItem, "altKind" | "altText">>) {
    if (!activeItem) return;
    setItems((current) => current.map((item) => item.id === activeItem.id ? { ...item, ...update } : item));
  }

  async function downloadPack(scope: "all" | "selected") {
    if (!apiKey) {
      setError("위에서 API 키를 입력하세요.");
      onUnauthorized();
      return;
    }
    if (!options) {
      setError("출력 설정과 대체 텍스트 문맥을 확인하세요.");
      return;
    }
    const targets = scope === "selected" && activeItem ? [activeItem] : itemsRef.current;
    if (targets.length === 0) return;
    setGenerating(scope);
    setError("");
    setNotice("");
    try {
      const scopedOptions: WebAssetOptions = {
        ...options,
        altKind: targets[0].altKind,
        altText: targets[0].altKind === "decorative" ? "" : targets[0].altText.trim(),
        accessibility: targets.map((item) => ({
          kind: item.altKind,
          text: item.altKind === "decorative" ? "" : item.altText.trim(),
        })),
      };
      const body = new FormData();
      targets.forEach(({ file }) => body.append("images", file));
      body.set("options", JSON.stringify(scopedOptions));
      const response = await authenticatedApiFetch("/api/v1/web-assets", apiKey, { method: "POST", body });
      const requestId = response.headers.get("x-request-id") ?? "";
      if (response.status === 401) {
        onUnauthorized();
        throw new Error("API 키가 올바르지 않습니다.");
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string; requestId?: string } | null;
        throw new Error(`${koreanApiError(payload?.error, "웹 에셋 팩 생성 중 오류가 발생했습니다.")}${requestId || payload?.requestId ? ` 요청 ID: ${requestId || payload?.requestId}` : ""}`);
      }
      const succeeded = Number(response.headers.get("x-asset-succeeded") ?? 0);
      const failed = Number(response.headers.get("x-asset-failed") ?? 0);
      const outputFiles = Number(response.headers.get("x-output-files") ?? 0);
      const saveMode = await saveZipResponse(
        response,
        scope === "selected" && activeItem ? `${activeItem.file.name.replace(/\.[^.]*$/, "")}-web-assets.zip` : "web-assets.zip",
      );
      setNotice(
        `성공 ${succeeded} · 실패 ${failed} · 산출물 ${outputFiles}개 · ${saveMode === "disk" ? "디스크로 스트리밍 저장" : "메모리 호환 저장"}`,
      );
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setNotice("저장을 취소했습니다.");
      } else {
        setError(caught instanceof Error ? caught.message : "웹 에셋 팩 생성 중 오류가 발생했습니다.");
      }
    } finally {
      setGenerating("");
    }
  }

  async function createOutputPreview() {
    if (!apiKey || !activeItem || !options || !activeRecipeKey) {
      setError("선택 파일과 출력 설정을 확인하세요.");
      return;
    }
    setPreviewing(true);
    setError("");
    try {
      const selectedOptions: WebAssetOptions = {
        ...options,
        altKind: activeItem.altKind,
        altText: activeItem.altKind === "decorative" ? "" : activeItem.altText.trim(),
        accessibility: [{
          kind: activeItem.altKind,
          text: activeItem.altKind === "decorative" ? "" : activeItem.altText.trim(),
        }],
      };
      const body = new FormData();
      body.set("images", activeItem.file);
      body.set("options", JSON.stringify(selectedOptions));
      const response = await authenticatedApiFetch("/api/v1/web-assets/preview", apiKey, { method: "POST", body });
      const requestId = response.headers.get("x-request-id") ?? "";
      if (response.status === 401) {
        onUnauthorized();
        throw new Error("API 키가 올바르지 않습니다.");
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string; requestId?: string } | null;
        throw new Error(`${koreanApiError(payload?.error, "대표 출력 생성 중 오류가 발생했습니다.")}${requestId || payload?.requestId ? ` 요청 ID: ${requestId || payload?.requestId}` : ""}`);
      }
      const blob = await response.blob();
      const preview: OutputPreview = {
        key: activeRecipeKey,
        blob,
        name: response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "web-asset",
        format: response.headers.get("x-output-format") ?? blob.type,
        width: headerNumber(response.headers, "x-output-width"),
        height: headerNumber(response.headers, "x-output-height"),
        bytes: headerNumber(response.headers, "x-output-bytes"),
        ssim: headerNumber(response.headers, "x-ssim"),
        mae: headerNumber(response.headers, "x-mae"),
        edgeMae: headerNumber(response.headers, "x-edge-mae"),
        alphaMae: headerNumber(response.headers, "x-alpha-mae"),
      };
      setOutputBlob(blob);
      setOutputPreview(preview);
      setNotice("대표 fallback이 품질 기준을 통과했습니다. 전체 팩은 같은 레시피로 생성됩니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "대표 출력 생성 중 오류가 발생했습니다.");
    } finally {
      setPreviewing(false);
    }
  }

  function downloadOutputPreview() {
    if (!visibleOutput) return;
    const url = URL.createObjectURL(visibleOutput.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = visibleOutput.name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-xl border border-primary/25 bg-[linear-gradient(120deg,oklch(0.22_0.02_55),oklch(0.16_0.01_55))]" aria-labelledby="web-pack-heading">
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-primary">
              <PackageCheck className="size-4" aria-hidden="true" />
              Web asset pack R1
            </div>
            <h2 id="web-pack-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">디자인 파일을 배포 가능한 묶음으로</h2>
            <p className="mt-2 max-w-2xl leading-relaxed text-muted-foreground">
              실제 형식과 메타데이터를 검사하고, 품질 기준을 통과한 파일·코드·manifest만 ZIP에 담습니다.
            </p>
          </div>
          <ol className="grid grid-cols-4 gap-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground" aria-label="처리 단계">
            {["inspect", "encode", "verify", "ship"].map((step, index) => (
              <li key={step} className="flex flex-col items-center gap-2">
                <span className="grid size-7 place-items-center rounded-full border border-primary/30 bg-primary/8 text-primary">{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="space-y-6">
          <ImageDropzone files={items.map(({ file }) => file)} onFiles={addFiles} onClear={clearItems} disabled={Boolean(generating)} />

          {items.length > 0 ? (
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-4 border-b">
                <div>
                  <CardTitle>Preflight manifest</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">민감한 메타데이터는 값이 아니라 존재 여부만 표시합니다.</p>
                </div>
                <Badge variant="outline" className="font-mono">{inspecting ? "SCANNING" : `${readyCount}/${items.length} READY`}</Badge>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {items.map((item) => {
                    const ready = item.inspection?.status === "ready" ? item.inspection.facts : null;
                    const failed = item.inspection?.status === "failed" ? item.inspection : null;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setActiveId(item.id)}
                          className={cn(
                            "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                            activeItem?.id === item.id ? "border-primary/60 bg-primary/6" : "hover:bg-muted/40",
                          )}
                        >
                          <span className={cn(
                            "grid size-8 place-items-center rounded-md",
                            failed ? "bg-destructive/10 text-destructive" : ready ? "bg-emerald-500/10 text-emerald-400" : "bg-primary/10 text-primary",
                          )}>
                            {failed ? <FileWarning className="size-4" aria-hidden="true" /> : ready ? <Check className="size-4" aria-hidden="true" /> : <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{item.file.name}</span>
                            <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                              {ready ? `${ready.actualMime} · ${ready.width}×${ready.height} · ${formatImageBytes(ready.encodedBytes)}` : failed ? koreanApiError(failed.error, "검사 실패") : "실제 형식 확인 중"}
                            </span>
                          </span>
                          <span className="font-mono text-[10px] uppercase text-muted-foreground">{inspectionLabel(item)}</span>
                        </button>
                        <Button type="button" variant="ghost" size="xs" className="ml-auto mt-1" disabled={Boolean(generating)} onClick={() => removeItem(item.id)}>
                          <Trash2 aria-hidden="true" /> 제거
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {activeItem && previewUrl ? (
            <div className="grid gap-6 md:grid-cols-2">
              <ImagePreview title="원본 미리보기" src={previewUrl} badge={activeItem.file.type || "binary"} alt={`${activeItem.file.name} 원본 미리보기`} />
              <Card>
                <CardHeader className="border-b">
                  <CardTitle>배포 준비도</CardTitle>
                </CardHeader>
                <CardContent>
                  {activeFacts ? (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
                      <div><dt className="text-xs text-muted-foreground">실제 형식</dt><dd className="mt-1 font-mono uppercase">{activeFacts.format}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">콘텐츠 힌트</dt><dd className="mt-1 font-mono uppercase">{activeFacts.detectedContent}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">크기</dt><dd className="mt-1 font-mono">{activeFacts.width} × {activeFacts.height}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">비트 / 픽셀</dt><dd className="mt-1 font-mono">{activeFacts.bitsPerPixel}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">알파</dt><dd className="mt-1">{activeFacts.hasAlpha ? "있음" : "없음"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">색상 정보</dt><dd className="mt-1 font-mono uppercase">{activeFacts.colorProfile}</dd></div>
                      <div className="col-span-2"><dt className="text-xs text-muted-foreground">메타데이터</dt><dd className="mt-1">{metadataLabels(activeFacts)}</dd></div>
                      <div className="col-span-2 border-t pt-4">
                        <dt className="sr-only">경고</dt>
                        {activeFacts.warnings.length > 0 ? (
                          <ul className="space-y-2 text-xs leading-relaxed text-amber-300">
                            {activeFacts.warnings.map((warning) => <li key={warning}>— {warning}</li>)}
                          </ul>
                        ) : <dd className="flex items-center gap-2 text-emerald-400"><ClipboardCheck className="size-4" aria-hidden="true" /> 즉시 확인할 경고가 없습니다.</dd>}
                      </div>
                    </dl>
                  ) : (
                    <div className="grid min-h-52 place-items-center text-center text-sm text-muted-foreground">
                      <div><ScanSearch className="mx-auto mb-3 size-6 text-primary" aria-hidden="true" />서버 안전 검사를 기다리는 중입니다.</div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}

          {visibleOutput && outputUrl ? (
            <div className="grid gap-6 md:grid-cols-2">
              <ImagePreview title="대표 출력 미리보기" src={outputUrl} badge={visibleOutput.format} alt={`${activeItem?.file.name ?? "이미지"} 대표 출력 미리보기`} />
              <Card className="border-emerald-500/20">
                <CardHeader className="border-b"><CardTitle className="flex items-center gap-2"><ClipboardCheck className="size-4 text-emerald-400" aria-hidden="true" /> 품질 게이트 통과</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-xs text-muted-foreground">출력</dt><dd className="mt-1 font-mono">{visibleOutput.width} × {visibleOutput.height}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">용량</dt><dd className="mt-1 font-mono">{formatImageBytes(visibleOutput.bytes)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">SSIM</dt><dd className="mt-1 font-mono">{visibleOutput.ssim.toFixed(4)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">MAE</dt><dd className="mt-1 font-mono">{visibleOutput.mae.toFixed(4)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Edge MAE</dt><dd className="mt-1 font-mono">{visibleOutput.edgeMae.toFixed(4)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Alpha MAE</dt><dd className="mt-1 font-mono">{visibleOutput.alphaMae.toFixed(4)}</dd></div>
                  </dl>
                  <Button type="button" variant="outline" className="w-full" onClick={downloadOutputPreview}><Download aria-hidden="true" /> 대표 파일 개별 다운로드</Button>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6" aria-label="웹 에셋 팩 설정">
          <Card className="border-primary/20 bg-card/95 shadow-xl shadow-black/20">
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2"><CircleGauge className="size-4 text-primary" aria-hidden="true" /> 출력 계약</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <fieldset>
                <legend className="mb-2 text-xs font-medium text-muted-foreground">대상</legend>
                <div className="grid gap-2">
                  {PROFILE.map((item) => (
                    <button key={item.value} type="button" aria-pressed={profile === item.value} onClick={() => setProfile(item.value)} className={cn("rounded-lg border p-3 text-left transition-colors", profile === item.value ? "border-primary bg-primary/8" : "hover:bg-muted/50")}>
                      <span className="block text-sm font-medium">{item.title}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{item.detail}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              {profile === "html" ? (
                <fieldset>
                  <legend className="mb-2 text-xs font-medium text-muted-foreground">레이아웃과 폭</legend>
                  <div className="grid grid-cols-3 gap-1">
                    {(["hero", "content", "card"] as const).map((value) => (
                      <Button key={value} type="button" size="sm" variant={layout === value ? "default" : "outline"} onClick={() => changeLayout(value)} className="capitalize">{value}</Button>
                    ))}
                  </div>
                  <label className="mt-3 block text-xs text-muted-foreground">
                    직접 폭 <span className="font-mono">(선택 · 쉼표 구분)</span>
                    <input value={customWidths} onChange={(event) => setCustomWidths(event.target.value)} placeholder={WEB_ASSET_WIDTH_PRESETS[layout].join(", ")} aria-invalid={parsedWidths === null} className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  </label>
                </fieldset>
              ) : profile === "design" ? (
                <label className="block text-xs text-muted-foreground">
                  1x 기준 폭
                  <input type="number" min={16} max={4096} value={designBaseWidth} onChange={(event) => setDesignBaseWidth(event.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </label>
              ) : null}

              <label className="block text-xs text-muted-foreground">
                <span className="font-mono">sizes</span>
                <input value={sizes} onChange={(event) => setSizes(event.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-muted-foreground">콘텐츠
                  <select value={contentHint} onChange={(event) => setContentHint(event.target.value as WebAssetContentHint)} className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-xs text-foreground">
                    {CONTENT_HINT.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="text-xs text-muted-foreground">색상
                  <select value={colorPolicy} onChange={(event) => setColorPolicy(event.target.value as WebAssetColorPolicy)} className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-xs text-foreground">
                    <option value="preserve">프로필 보존</option>
                    <option value="srgb">Web sRGB</option>
                  </select>
                </label>
              </div>

              {profile === "html" ? (
                <div className="flex flex-wrap gap-3 text-xs">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={includeWebp} onChange={(event) => setIncludeWebp(event.target.checked)} /> WebP</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={includeAvif} onChange={(event) => setIncludeAvif(event.target.checked)} /> AVIF</label>
                </div>
              ) : profile === "next" ? (
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={includePlaceholder} onChange={(event) => setIncludePlaceholder(event.target.checked)} /> blurDataURL 포함</label>
              ) : null}

              <fieldset>
                <legend className="mb-2 text-xs font-medium text-muted-foreground">접근성 문맥</legend>
                <div className="grid grid-cols-2 gap-1">
                  {ALT_KIND.map((item) => (
                    <button key={item.value} type="button" aria-pressed={activeAltKind === item.value} title={item.hint} onClick={() => updateActiveAccessibility({ altKind: item.value })} disabled={!activeItem} className={cn("rounded-md border px-2 py-2 text-xs disabled:opacity-50", activeAltKind === item.value ? "border-primary bg-primary/8 text-primary" : "text-muted-foreground")}>{item.label}</button>
                  ))}
                </div>
                {activeAltKind !== "decorative" ? (
                  <textarea value={activeAltText} onChange={(event) => updateActiveAccessibility({ altText: event.target.value })} disabled={!activeItem} maxLength={300} rows={3} placeholder={ALT_KIND.find(({ value }) => value === activeAltKind)?.hint} className="mt-2 w-full resize-none rounded-lg border border-input bg-background p-2.5 text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" />
                ) : <p className="mt-2 text-xs text-muted-foreground">장식 이미지는 코드에 <span className="font-mono">alt=&quot;&quot;</span>로 기록합니다.</p>}
                {items.length > 1 ? <p className="mt-2 text-[11px] text-muted-foreground">현재 선택한 파일에만 적용됩니다. 파일을 바꿔 각각 확인하세요.</p> : null}
              </fieldset>

              <fieldset>
                <legend className="mb-2 text-xs font-medium text-muted-foreground">로딩 문맥</legend>
                <div className="grid grid-cols-2 gap-1">
                  {(["lazy", "lcp"] as const).map((value) => (
                    <Button key={value} type="button" size="sm" variant={loadingIntent === value ? "default" : "outline"} onClick={() => setLoadingIntent(value)}>{value === "lazy" ? "아래 영역" : "첫 화면 LCP"}</Button>
                  ))}
                </div>
              </fieldset>

              <div className="space-y-2 border-t pt-4">
                <Button type="button" variant="secondary" className="w-full" disabled={!options || !activeItem || Boolean(generating) || previewing || inspecting} onClick={() => void createOutputPreview()}>
                  {previewing ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ScanSearch aria-hidden="true" />}
                  대표 출력 검사
                </Button>
                <Button type="button" size="lg" className="w-full" disabled={!options || items.length === 0 || Boolean(generating) || previewing || inspecting} onClick={() => void downloadPack("all")}>
                  {generating === "all" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <FileArchive aria-hidden="true" />}
                  전체 ZIP 만들기
                </Button>
                <Button type="button" variant="outline" className="w-full" disabled={!options || !activeItem || Boolean(generating) || previewing || inspecting} onClick={() => void downloadPack("selected")}>
                  {generating === "selected" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
                  선택 파일 팩
                </Button>
                <p className="text-center text-[11px] leading-relaxed text-muted-foreground">지원 브라우저는 ZIP을 디스크로 바로 스트리밍합니다. 결과는 서버에 저장되지 않습니다.</p>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>

      {error ? (
        <Alert variant="destructive"><AlertCircle aria-hidden="true" /><AlertTitle>작업을 계속할 수 없습니다</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
      ) : null}
      {notice ? (
        <Alert><PackageCheck aria-hidden="true" /><AlertTitle>웹 에셋 팩</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert>
      ) : null}
    </div>
  );
}
