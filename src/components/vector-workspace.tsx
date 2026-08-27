"use client";

import { AlertCircle, LoaderCircle, Sparkles, Square, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ImageBatchList } from "@/components/image-batch-list";
import { ImageDropzone } from "@/components/image-dropzone";
import { ImagePreview } from "@/components/image-preview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VectorResult } from "@/components/vector-result";
import { VectorSettings } from "@/components/vector-settings";
import { useObjectUrl } from "@/hooks/use-object-url";
import { authenticatedApiFetch, koreanApiError } from "@/lib/api/client";
import type { BatchItemStatus } from "@/lib/image/batch";
import { DEFAULT_VECTOR_CLEANUP, type VectorCleanupOptionsV1 } from "@/lib/vector/cleanup-types";
import type { ApiError, VectorizeApiResult, VectorizeMode } from "@/lib/vector/types";

interface VectorWorkspaceProps {
  apiKey: string;
  onUnauthorized: () => void;
}

interface VectorBatchItem {
  id: string;
  file: File;
  status: BatchItemStatus;
  result?: VectorizeApiResult;
  error?: string;
  requestId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function hasFiniteNumbers(value: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
}

function isApiError(value: unknown): value is ApiError {
  return isRecord(value)
    && typeof value.error === "string"
    && (value.requestId === undefined || typeof value.requestId === "string");
}

function isVectorizeResult(value: unknown): value is VectorizeApiResult {
  if (!isRecord(value)) return false;
  const input = value.input;
  const output = value.output;
  const timing = value.timing;
  const selection = value.selection;
  const stats = value.stats;
  return typeof value.svg === "string"
    && typeof value.downloadName === "string"
    && isRecord(input)
    && typeof input.format === "string"
    && hasFiniteNumbers(input, ["width", "height", "bytes"])
    && isRecord(output)
    && hasFiniteNumbers(output, ["rawBytes", "optimizedBytes", "optimizationPercent"])
    && isRecord(timing)
    && hasFiniteNumbers(timing, ["preprocessingMs", "vectorizationMs", "optimizationMs", "rasterizationMs", "measurementMs"])
    && isRecord(selection)
    && typeof selection.candidate === "string"
    && hasFiniteNumbers(selection, ["candidates"])
    && isRecord(stats)
    && hasFiniteNumbers(stats, ["paths", "commands", "elements", "colors"]);
}

export function VectorWorkspace({ apiKey, onUnauthorized }: VectorWorkspaceProps) {
  const [items, setItemsState] = useState<VectorBatchItem[]>([]);
  const itemsRef = useRef<VectorBatchItem[]>([]);
  const [activeId, setActiveId] = useState("");
  const [preset, setPreset] = useState<VectorizeMode>("balanced");
  const [cleanup, setCleanup] = useState<VectorCleanupOptionsV1>(DEFAULT_VECTOR_CLEANUP);
  const [queueError, setQueueError] = useState("");
  const [loading, setLoading] = useState(false);
  const runningRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);
  const [originalUrl, setOriginalBlob] = useObjectUrl();
  const [svgUrl, setSvgBlob] = useObjectUrl();

  const updateItems = useCallback((updater: (current: VectorBatchItem[]) => VectorBatchItem[]) => {
    const next = updater(itemsRef.current);
    itemsRef.current = next;
    setItemsState(next);
  }, []);

  const activeItem = items.find((item) => item.id === activeId) ?? items[0];
  const remaining = items.filter((item) => item.status !== "succeeded").length;

  useEffect(() => {
    setOriginalBlob(activeItem?.file ?? null);
    setSvgBlob(activeItem?.result
      ? new Blob([activeItem.result.svg], { type: "image/svg+xml" })
      : null);
  }, [activeItem?.file, activeItem?.result, setOriginalBlob, setSvgBlob]);

  useEffect(() => () => {
    runRef.current += 1;
    requestRef.current?.abort();
  }, []);

  function invalidateResults() {
    updateItems((current) => current.map((item) => ({
      id: item.id,
      file: item.file,
      status: "queued",
    })));
    setQueueError("");
  }

  function changePreset(nextPreset: VectorizeMode) {
    setPreset(nextPreset);
    invalidateResults();
  }

  function changeCleanup(nextCleanup: VectorCleanupOptionsV1) {
    setCleanup(nextCleanup);
    invalidateResults();
  }

  function addFiles(files: File[]) {
    const additions = files.map<VectorBatchItem>((file) => ({
      id: crypto.randomUUID(),
      file,
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

    const targets = onlyIds ?? itemsRef.current
      .filter((item) => item.status !== "succeeded")
      .map((item) => item.id);
    if (targets.length === 0) return;

    const runId = ++runRef.current;
    const presetSnapshot = preset;
    const cleanupSnapshot = cleanup;
    runningRef.current = true;
    setLoading(true);
    setQueueError("");

    try {
      for (const id of targets) {
        if (runRef.current !== runId) break;
        const item = itemsRef.current.find((candidate) => candidate.id === id);
        if (!item || item.status === "succeeded") continue;

        updateItems((current) => current.map((candidate) => candidate.id === id
          ? { ...candidate, status: "processing", error: undefined, requestId: undefined, result: undefined }
          : candidate));

        const controller = new AbortController();
        requestRef.current = controller;
        let requestId = "";
        try {
          const body = new FormData();
          body.set("image", item.file);
          body.set("preset", presetSnapshot);
          if (presetSnapshot !== "auto") body.set("cleanup", JSON.stringify(cleanupSnapshot));
          const response = await authenticatedApiFetch(
            "/api/v1/vectorize",
            apiKey,
            { method: "POST", body, signal: controller.signal },
          );
          if (controller.signal.aborted || runRef.current !== runId) break;

          requestId = response.headers.get("x-request-id") ?? "";
          const data: unknown = await response.json().catch(() => null);
          if (controller.signal.aborted || runRef.current !== runId) break;

          if (response.status === 401) {
            updateItems((current) => current.map((candidate) => candidate.id === id
              ? { ...candidate, status: "failed", error: "API 키가 올바르지 않습니다.", requestId }
              : candidate));
            setQueueError("API 키가 올바르지 않습니다.");
            onUnauthorized();
            break;
          }
          if (response.status === 429) {
            updateItems((current) => current.map((candidate) => candidate.id === id
              ? { ...candidate, status: "queued", error: undefined, requestId: undefined }
              : candidate));
            setQueueError(koreanApiError(isApiError(data) ? data.error : undefined, "서버가 처리 중입니다. 잠시 후 다시 시도하세요."));
            break;
          }
          if (response.status === 503) {
            const error = koreanApiError(isApiError(data) ? data.error : undefined, "현재 서비스를 사용할 수 없습니다.");
            updateItems((current) => current.map((candidate) => candidate.id === id
              ? { ...candidate, status: "failed", error, requestId }
              : candidate));
            setQueueError(error);
            break;
          }
          if (!response.ok || !isVectorizeResult(data)) {
            const error = !response.ok && isApiError(data)
              ? koreanApiError(data.error, "변환 중 오류가 발생했습니다.")
              : "변환 중 오류가 발생했습니다.";
            const payloadRequestId = isApiError(data) ? data.requestId : undefined;
            updateItems((current) => current.map((candidate) => candidate.id === id
              ? { ...candidate, status: "failed", error, requestId: requestId || payloadRequestId }
              : candidate));
            continue;
          }

          updateItems((current) => current.map((candidate) => candidate.id === id
            ? { ...candidate, status: "succeeded", result: data, error: undefined, requestId: undefined }
            : candidate));
        } catch (caught) {
          if (controller.signal.aborted || runRef.current !== runId) break;
          updateItems((current) => current.map((candidate) => candidate.id === id
            ? {
                ...candidate,
                status: "failed",
                error: caught instanceof Error ? caught.message : "변환 중 오류가 발생했습니다.",
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
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-6">
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
              outputBytes: item.result?.output.optimizedBytes,
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

        {queueError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>일괄 처리를 계속할 수 없습니다</AlertTitle>
            <AlertDescription>{queueError}</AlertDescription>
          </Alert>
        ) : null}

        {activeItem && originalUrl ? (
          <section aria-labelledby="preview-heading">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-widest text-primary">미리보기</p>
                <h2 id="preview-heading" className="mt-1 text-xl font-medium">{activeItem.file.name}</h2>
              </div>
              {activeItem.result ? <p className="text-sm text-muted-foreground">브라우저 렌더링 결과</p> : null}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <ImagePreview title="원본" src={originalUrl} badge="래스터" alt={`${activeItem.file.name} 원본 이미지`} />
              {activeItem.result && svgUrl ? (
                <ImagePreview title="벡터 변환 결과" src={svgUrl} badge="SVG" alt={`${activeItem.file.name} 벡터 변환 결과`} />
              ) : (
                <Card className="min-h-80 border-dashed bg-card/40">
                  <CardContent className="flex h-full min-h-72 flex-col items-center justify-center text-center text-muted-foreground">
                    <WandSparkles className="mb-3 size-6" aria-hidden="true" />
                    <p className="text-sm">이 파일의 SVG 결과가 여기에 표시됩니다.</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </section>
        ) : null}

        {activeItem?.result && svgUrl ? (
          <section aria-label={`${activeItem.file.name} 벡터 변환 결과 정보`}>
            <VectorResult result={activeItem.result} downloadUrl={svgUrl} />
          </section>
        ) : null}
      </div>

      <aside className="lg:sticky lg:top-6 lg:z-20" aria-label="벡터 변환 설정">
        <Card className="border-primary/20 bg-card/95 shadow-xl shadow-black/20 backdrop-blur supports-[backdrop-filter]:bg-card/85 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
          <CardHeader>
            <CardTitle>변환 설정</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <VectorSettings
              value={preset}
              onChange={changePreset}
              cleanup={cleanup}
              onCleanup={changeCleanup}
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
                disabled={items.length === 0 || remaining === 0}
                onClick={() => void processItems()}
              >
                {remaining > 0 ? (
                  <><Sparkles aria-hidden="true" />{remaining}개 이미지 벡터화</>
                ) : (
                  <><LoaderCircle aria-hidden="true" />모두 완료</>
                )}
              </Button>
            )}
            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              한 번에 한 파일씩 처리하며 이미지와 SVG는 서버에 저장되지 않습니다.
            </p>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
