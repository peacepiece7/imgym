"use client";

import { AlertCircle, Crop, ImageDown, LoaderCircle, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactCrop, { type PercentCrop } from "react-image-crop";
import { ImageBatchList } from "@/components/image-batch-list";
import { ImageDropzone } from "@/components/image-dropzone";
import { ImagePreview } from "@/components/image-preview";
import { RasterResult, rasterPresetLabel, type RasterResultData } from "@/components/raster-result";
import { RasterSettings } from "@/components/raster-settings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useObjectUrl } from "@/hooks/use-object-url";
import { authenticatedApiFetch, koreanApiError } from "@/lib/api/client";
import type { BatchItemStatus } from "@/lib/image/batch";
import { normalizedCropToPixels, percentCropToNormalized } from "@/lib/raster/crop";
import type { RasterMode, RasterOptimizationPolicy } from "@/lib/raster/types";

const FULL_CROP: PercentCrop = { unit: "%", x: 0, y: 0, width: 100, height: 100 };
const FULL_CROP_EPSILON = 1e-6;

interface RasterBatchItem {
  id: string;
  file: File;
  crop: PercentCrop;
  dimensions: { width: number; height: number } | null;
  status: BatchItemStatus;
  result?: RasterResultData;
  output?: Blob;
  error?: string;
  requestId?: string;
}

interface RasterWorkspaceProps {
  apiKey: string;
  onUnauthorized: () => void;
}

function isFullCrop(crop: PercentCrop) {
  return crop.unit === "%"
    && Math.abs(crop.x) <= FULL_CROP_EPSILON
    && Math.abs(crop.y) <= FULL_CROP_EPSILON
    && Math.abs(crop.width - 100) <= FULL_CROP_EPSILON
    && Math.abs(crop.height - 100) <= FULL_CROP_EPSILON;
}

function parseResizeDimension(value: string): number | undefined | null {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 8192 ? parsed : null;
}

function headerNumber(headers: Headers, name: string) {
  const value = Number(headers.get(name));
  return Number.isFinite(value) ? value : 0;
}

function downloadName(headers: Headers) {
  return headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "image-optimized";
}

export function RasterWorkspace({ apiKey, onUnauthorized }: RasterWorkspaceProps) {
  const [items, setItemsState] = useState<RasterBatchItem[]>([]);
  const itemsRef = useRef<RasterBatchItem[]>([]);
  const [activeId, setActiveId] = useState("");
  const [mode, setMode] = useState<RasterMode>("balanced");
  const [policy, setPolicy] = useState<RasterOptimizationPolicy>("standard");
  const [maxWidth, setMaxWidth] = useState("");
  const [maxHeight, setMaxHeight] = useState("");
  const [queueError, setQueueError] = useState("");
  const [loading, setLoading] = useState(false);
  const runningRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);
  const [originalUrl, setOriginalBlob] = useObjectUrl();
  const [outputUrl, setOutputBlob] = useObjectUrl();

  const updateItems = useCallback((updater: (current: RasterBatchItem[]) => RasterBatchItem[]) => {
    const next = updater(itemsRef.current);
    itemsRef.current = next;
    setItemsState(next);
  }, []);

  const activeItem = items.find((item) => item.id === activeId) ?? items[0];
  const parsedMaxWidth = parseResizeDimension(maxWidth);
  const parsedMaxHeight = parseResizeDimension(maxHeight);
  const maxWidthInvalid = parsedMaxWidth === null;
  const maxHeightInvalid = parsedMaxHeight === null;
  const resizeValid = !maxWidthInvalid && !maxHeightInvalid;
  const normalizedCrop = activeItem ? percentCropToNormalized(activeItem.crop) : null;
  const selectedDimensions = normalizedCrop && activeItem?.dimensions
    ? normalizedCropToPixels(normalizedCrop, activeItem.dimensions.width, activeItem.dimensions.height)
    : null;
  const remaining = items.filter((item) => item.status !== "succeeded").length;

  useEffect(() => {
    setOriginalBlob(activeItem?.file ?? null);
    setOutputBlob(activeItem?.output ?? null);
  }, [activeItem?.file, activeItem?.output, setOriginalBlob, setOutputBlob]);

  useEffect(() => () => {
    runRef.current += 1;
    requestRef.current?.abort();
  }, []);

  function invalidateAllResults() {
    updateItems((current) => current.map((item) => ({
      ...item,
      status: "queued",
      result: undefined,
      output: undefined,
      error: undefined,
      requestId: undefined,
    })));
    setQueueError("");
  }

  function changeMode(nextMode: RasterMode) {
    setMode(nextMode);
    invalidateAllResults();
  }

  function changePolicy(nextPolicy: RasterOptimizationPolicy) {
    setPolicy(nextPolicy);
    invalidateAllResults();
  }

  function changeMaxWidth(value: string) {
    setMaxWidth(value);
    invalidateAllResults();
  }

  function changeMaxHeight(value: string) {
    setMaxHeight(value);
    invalidateAllResults();
  }

  function addFiles(files: File[]) {
    const additions = files.map<RasterBatchItem>((file) => ({
      id: crypto.randomUUID(),
      file,
      crop: { ...FULL_CROP },
      dimensions: null,
      status: "queued",
    }));
    updateItems((current) => [...current, ...additions]);
    setActiveId((current) => current || additions[0]?.id || "");
    setQueueError("");
  }

  function removeItem(id: string) {
    const next = itemsRef.current.filter((item) => item.id !== id);
    updateItems(() => next);
    if (activeId === id) setActiveId(next[0]?.id ?? "");
  }

  function clearItems() {
    updateItems(() => []);
    setActiveId("");
    setQueueError("");
  }

  function changeCrop(nextCrop: PercentCrop) {
    if (!activeItem) return;
    updateItems((current) => current.map((item) => item.id === activeItem.id
      ? {
          ...item,
          crop: nextCrop,
          status: "queued",
          result: undefined,
          output: undefined,
          error: undefined,
          requestId: undefined,
        }
      : item));
  }

  function updateActiveDimensions(dimensions: { width: number; height: number }) {
    if (!activeItem) return;
    updateItems((current) => current.map((item) => item.id === activeItem.id
      ? { ...item, dimensions }
      : item));
  }

  function resetAllCrops() {
    updateItems((current) => current.map((item) => ({
      ...item,
      crop: { ...FULL_CROP },
      status: "queued",
      result: undefined,
      output: undefined,
      error: undefined,
      requestId: undefined,
    })));
  }

  function stopQueue() {
    runRef.current += 1;
    runningRef.current = false;
    requestRef.current?.abort();
    requestRef.current = null;
    updateItems((current) => current.map((item) => item.status === "processing"
      ? { ...item, status: "cancelled", error: "처리를 취소했습니다." }
      : item));
    setLoading(false);
  }

  async function processItems(onlyIds?: readonly string[]) {
    if (runningRef.current) return;
    if (!apiKey) {
      setQueueError("위에서 API 키를 입력하세요.");
      onUnauthorized();
      return;
    }
    const requestedMaxWidth = parseResizeDimension(maxWidth);
    const requestedMaxHeight = parseResizeDimension(maxHeight);
    if (requestedMaxWidth === null || requestedMaxHeight === null) {
      setQueueError("크기는 1에서 8192 사이의 정수 픽셀로 입력하세요.");
      return;
    }

    const targets = onlyIds ?? itemsRef.current
      .filter((item) => item.status !== "succeeded")
      .map((item) => item.id);
    if (targets.length === 0) return;

    const runId = ++runRef.current;
    const modeSnapshot = mode;
    const policySnapshot = policy;
    const resize = {
      ...(requestedMaxWidth !== undefined ? { maxWidth: requestedMaxWidth } : {}),
      ...(requestedMaxHeight !== undefined ? { maxHeight: requestedMaxHeight } : {}),
    };
    runningRef.current = true;
    setLoading(true);
    setQueueError("");

    try {
      for (const id of targets) {
        if (runRef.current !== runId) break;
        const item = itemsRef.current.find((candidate) => candidate.id === id);
        if (!item || item.status === "succeeded") continue;
        const requestedCrop = percentCropToNormalized(item.crop);
        if (!requestedCrop) {
          updateItems((current) => current.map((candidate) => candidate.id === id
            ? { ...candidate, status: "failed", error: "올바른 자르기 영역을 선택하세요." }
            : candidate));
          continue;
        }

        updateItems((current) => current.map((candidate) => candidate.id === id
          ? {
              ...candidate,
              status: "processing",
              result: undefined,
              output: undefined,
              error: undefined,
              requestId: undefined,
            }
          : candidate));

        const controller = new AbortController();
        requestRef.current = controller;
        let requestId = "";
        try {
          const body = new FormData();
          body.set("image", item.file);
          body.set("options", JSON.stringify({
            crop: requestedCrop,
            resize,
            mode: modeSnapshot,
            ...(modeSnapshot === "auto" ? { optimization: { policy: policySnapshot } } : {}),
          }));
          const response = await authenticatedApiFetch(
            "/api/v1/optimize-raster",
            apiKey,
            { method: "POST", body, signal: controller.signal },
          );
          if (controller.signal.aborted || runRef.current !== runId) break;

          requestId = response.headers.get("x-request-id") ?? "";
          if (response.status === 401) {
            updateItems((current) => current.map((candidate) => candidate.id === id
              ? { ...candidate, status: "failed", error: "API 키가 올바르지 않습니다.", requestId }
              : candidate));
            setQueueError("API 키가 올바르지 않습니다.");
            onUnauthorized();
            break;
          }
          if (response.status === 429) {
            const payload = await response.json().catch(() => null) as { error?: string } | null;
            updateItems((current) => current.map((candidate) => candidate.id === id
              ? { ...candidate, status: "queued", error: undefined, requestId: undefined }
              : candidate));
            setQueueError(koreanApiError(payload?.error, "서버가 처리 중입니다. 잠시 후 다시 시도하세요."));
            break;
          }
          if (response.status === 503) {
            const payload = await response.json().catch(() => null) as { error?: string; requestId?: string } | null;
            const error = koreanApiError(payload?.error, "현재 서비스를 사용할 수 없습니다.");
            updateItems((current) => current.map((candidate) => candidate.id === id
              ? { ...candidate, status: "failed", error, requestId: requestId || payload?.requestId }
              : candidate));
            setQueueError(error);
            break;
          }
          if (!response.ok) {
            const payload = await response.json().catch(() => null) as { error?: string; requestId?: string } | null;
            updateItems((current) => current.map((candidate) => candidate.id === id
              ? {
                  ...candidate,
                  status: "failed",
                  error: koreanApiError(payload?.error, "이미지 처리 중 오류가 발생했습니다."),
                  requestId: requestId || payload?.requestId,
                }
              : candidate));
            continue;
          }

          const output = await response.blob();
          if (controller.signal.aborted || runRef.current !== runId) break;
          const result: RasterResultData = {
            downloadName: downloadName(response.headers),
            originalBytes: headerNumber(response.headers, "x-original-bytes"),
            outputBytes: headerNumber(response.headers, "x-output-bytes"),
            width: headerNumber(response.headers, "x-output-width"),
            height: headerNumber(response.headers, "x-output-height"),
            processingMs: headerNumber(response.headers, "x-processing-ms"),
            preset: response.headers.get("x-selected-preset") ?? modeSnapshot,
            candidates: headerNumber(response.headers, "x-candidate-count"),
            policy: response.headers.get("x-optimization-policy") === "smaller" ? "smaller" : "standard",
            ...(response.headers.has("x-ssim") ? { ssim: headerNumber(response.headers, "x-ssim") } : {}),
            ...(response.headers.has("x-mae") ? { mae: headerNumber(response.headers, "x-mae") } : {}),
            ...(response.headers.has("x-edge-mae") ? { edgeMae: headerNumber(response.headers, "x-edge-mae") } : {}),
            ...(response.headers.has("x-alpha-mae") ? { alphaMae: headerNumber(response.headers, "x-alpha-mae") } : {}),
          };
          updateItems((current) => current.map((candidate) => candidate.id === id
            ? { ...candidate, status: "succeeded", result, output, error: undefined, requestId: undefined }
            : candidate));
        } catch (caught) {
          if (controller.signal.aborted || runRef.current !== runId) break;
          updateItems((current) => current.map((candidate) => candidate.id === id
            ? {
                ...candidate,
                status: "failed",
                error: caught instanceof Error ? caught.message : "이미지 처리 중 오류가 발생했습니다.",
                requestId,
              }
            : candidate));
        } finally {
          if (requestRef.current === controller) requestRef.current = null;
        }
      }
    } finally {
      if (runRef.current === runId) {
        runningRef.current = false;
        setLoading(false);
      }
    }
  }

  return (
    <div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <ImageDropzone
            files={items.map((item) => item.file)}
            onFiles={addFiles}
            onClear={clearItems}
            disabled={loading}
          />

          {items.length > 0 ? (
            <ImageBatchList
              items={items.map((item) => ({
                id: item.id,
                name: item.file.name,
                bytes: item.file.size,
                status: item.status,
                outputBytes: item.result?.outputBytes,
                error: item.error,
                requestId: item.requestId,
              }))}
              activeId={activeItem?.id ?? ""}
              disabled={loading}
              onSelect={setActiveId}
              onRemove={removeItem}
              onRetry={(id) => void processItems([id])}
            />
          ) : null}

          {activeItem && originalUrl ? (
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>이미지 자르기</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{activeItem.file.name}의 출력 영역을 선택하세요.</p>
                </div>
                <Button type="button" variant="outline" size="sm" disabled={loading} onClick={resetAllCrops}>
                  모두 전체 이미지
                </Button>
              </CardHeader>
              <CardContent className="min-w-0">
                <div className="grid place-items-center overflow-hidden rounded-lg border bg-black/20 p-3">
                  <ReactCrop
                    key={activeItem.id}
                    crop={activeItem.crop}
                    onChange={(_, percentCrop) => changeCrop(percentCrop)}
                    disabled={loading}
                    minWidth={1}
                    minHeight={1}
                    keepSelection
                    className="max-h-[30rem] max-w-full"
                  >
                    {/* Browser decoding supplies the same EXIF-corrected orientation used by the server. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={originalUrl}
                      alt={`${activeItem.file.name} 자르기`}
                      className="block max-h-[30rem] max-w-full object-contain"
                      onLoad={(event) => updateActiveDimensions({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })}
                    />
                  </ReactCrop>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <p aria-live="polite">
                    {selectedDimensions
                      ? `선택 영역: ${selectedDimensions.width} × ${selectedDimensions.height}px`
                      : "자르기 영역을 선택하세요."}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading || isFullCrop(activeItem.crop)}
                    onClick={() => changeCrop({ ...FULL_CROP })}
                  >
                    이 파일 전체 이미지
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <aside className="lg:sticky lg:top-6 lg:z-20" aria-label="래스터 최적화 설정">
          <Card className="border-primary/20 bg-card/95 shadow-xl shadow-black/20 backdrop-blur supports-[backdrop-filter]:bg-card/85 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
            <CardHeader><CardTitle>최적화</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <RasterSettings
                mode={mode}
                onMode={changeMode}
                policy={policy}
                onPolicy={changePolicy}
                maxWidth={maxWidth}
                maxHeight={maxHeight}
                onMaxWidth={changeMaxWidth}
                onMaxHeight={changeMaxHeight}
                maxWidthInvalid={maxWidthInvalid}
                maxHeightInvalid={maxHeightInvalid}
                disabled={loading}
              />
              {loading ? (
                <Button size="lg" className="w-full" variant="outline" onClick={stopQueue}>
                  <Square aria-hidden="true" />
                  처리 중지
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="w-full"
                  disabled={items.length === 0 || remaining === 0 || !resizeValid}
                  onClick={() => void processItems()}
                >
                  {remaining > 0 ? (
                    <><ImageDown aria-hidden="true" />{remaining}개 자르고 최적화</>
                  ) : (
                    <><LoaderCircle aria-hidden="true" />모두 완료</>
                  )}
                </Button>
              )}
              <p className="text-center text-xs leading-relaxed text-muted-foreground">
                한 번에 한 파일씩 처리하며 이미지는 서버에 저장되지 않습니다.
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>

      {queueError ? (
        <Alert variant="destructive" className="mt-6">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>일괄 처리를 계속할 수 없습니다</AlertTitle>
          <AlertDescription>{queueError}</AlertDescription>
        </Alert>
      ) : null}

      {activeItem && originalUrl ? (
        <section className="mt-8" aria-labelledby="raster-preview-heading">
          <div className="mb-4">
            <p className="font-mono text-xs uppercase tracking-widest text-primary">미리보기</p>
            <h2 id="raster-preview-heading" className="mt-1 text-xl font-medium">{activeItem.file.name}</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <ImagePreview title="원본" src={originalUrl} badge="래스터" alt={`${activeItem.file.name} 원본 이미지`} />
            {activeItem.result && outputUrl ? (
              <ImagePreview title="최적화 결과" src={outputUrl} badge={rasterPresetLabel(activeItem.result.preset)} alt={`${activeItem.file.name} 최적화 결과`} />
            ) : (
              <Card className="min-h-80 border-dashed bg-card/40">
                <CardContent className="flex h-full min-h-72 flex-col items-center justify-center text-center text-muted-foreground">
                  <Crop className="mb-3 size-6" aria-hidden="true" />
                  <p className="text-sm">이 파일의 결과가 여기에 표시됩니다.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      ) : null}

      {activeItem?.result && outputUrl ? (
        <section className="mt-6" aria-label={`${activeItem.file.name} 래스터 최적화 결과 정보`}>
          <RasterResult
            result={activeItem.result}
            downloadUrl={outputUrl}
            originalDimensions={activeItem.dimensions}
          />
        </section>
      ) : null}
    </div>
  );
}
