"use client";

import {
  AlertCircle,
  Check,
  ChevronDown,
  CircleCheck,
  Code2,
  Copy,
  Download,
  Globe,
  Info,
  LoaderCircle,
  Palette,
  Plus,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StepProgress } from "@/components/ui/step-progress";
import { useObjectUrl } from "@/hooks/use-object-url";
import { authenticatedApiFetch, koreanApiError } from "@/lib/api/client";
import { saveZipResponse } from "@/lib/api/download";
import { formatImageBytes, MAX_BATCH_FILES, selectBatchFiles } from "@/lib/image/batch";
import type { Tool } from "@/lib/tools";
import { cn } from "@/lib/utils";
import {
  DEFAULT_WEB_ASSET_OPTIONS,
  WEB_ASSET_DEFAULT_SIZES,
  WEB_ASSET_WIDTH_PRESETS,
  resolveWebAssetWidths,
} from "@/lib/web-assets/options";
import { planWebAssetOutputs } from "@/lib/web-assets/plan";
import {
  designHandoffSnippet,
  htmlPictureSnippet,
  nextImageSnippet,
} from "@/lib/web-assets/snippets";
import type {
  AssetFacts,
  AssetInspectionItem,
  ResolvedContentHint,
  WebAssetColorPolicy,
  WebAssetContentHint,
  WebAssetLayout,
  WebAssetLoadingIntent,
  WebAssetOptions,
  WebAssetProfile,
} from "@/lib/web-assets/types";

interface WebAssetItem {
  id: string;
  file: File;
  /** The UI offers two answers; the pack format keeps its four-way vocabulary. */
  describes: boolean;
  altText: string;
  inspection?: AssetInspectionItem;
}

interface WebAssetWorkspaceProps {
  apiKey: string;
  onUnauthorized: () => void;
  onNavigate?: (tool: Tool) => void;
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

const PURPOSE: Array<{
  value: WebAssetProfile;
  title: string;
  detail: string;
  icon: typeof Globe;
}> = [
  {
    value: "html",
    title: "일반 웹페이지 · 블로그",
    detail: "어느 브라우저에서나 열리는 파일과 붙여넣을 HTML",
    icon: Globe,
  },
  {
    value: "next",
    title: "Next.js 프로젝트",
    detail: "원본 한 장 + <Image> 코드 (중복 파일 없음)",
    icon: Code2,
  },
  {
    value: "design",
    title: "디자이너·동료에게 전달",
    detail: "1배·2배·3배 크기와 내보내기 설명서",
    icon: Palette,
  },
];

const PLACEMENT: Array<{ value: WebAssetLayout; label: string }> = [
  { value: "hero", label: "화면 전체" },
  { value: "content", label: "본문 안" },
  { value: "card", label: "카드·목록" },
];

const CONTENT_HINT: Array<{ value: WebAssetContentHint; label: string }> = [
  { value: "auto", label: "알아서 판단" },
  { value: "photo", label: "사진" },
  { value: "ui", label: "화면 캡처" },
  { value: "logo", label: "로고·평면 그래픽" },
  { value: "transparent", label: "배경이 투명한 그림" },
];

const DETECTED_CONTENT: Record<ResolvedContentHint, string> = {
  photo: "사진",
  ui: "화면 캡처",
  logo: "로고·그래픽",
  transparent: "배경 투명",
};

/** Every failure needs the next move, not just the reason it stopped. */
const FAILURE: Record<string, { message: string; action?: { label: string; tool: Tool } }> = {
  "Unsupported image": {
    message: "여기서 바로 쓸 수 없는 형식이에요. ‘자주 쓰는 변환 모음’에서 PNG로 바꾼 뒤 올려주세요.",
    action: { label: "변환하러 가기", tool: "recipes" },
  },
  "File is too large": {
    message: `한 장에 10MB까지 올릴 수 있어요. ‘사진 자르기 · 용량 줄이기’에서 크기를 줄여 보세요.`,
    action: { label: "용량 줄이러 가기", tool: "raster" },
  },
  "Animated images are not supported": {
    message: "움직이는 이미지는 웹에 올릴 파일로 만들 수 없어요. 한 장짜리 이미지로 올려주세요.",
  },
};

function failureHelp(error: string) {
  return FAILURE[error] ?? { message: koreanApiError(error, "이 파일은 사용할 수 없어요. 다른 파일로 올려주세요.") };
}

function parseWidths(value: string) {
  if (!value.trim()) return undefined;
  const widths = value.split(",").map((part) => Number(part.trim()));
  if (widths.some((width) => !Number.isInteger(width) || width < 16 || width > 8_192)) return null;
  const unique = [...new Set(widths)].sort((left, right) => left - right);
  return unique.length >= 1 && unique.length <= 8 ? unique : null;
}

function headerNumber(headers: Headers, name: string) {
  const value = Number(headers.get(name));
  return Number.isFinite(value) ? value : 0;
}

/** Turns the similarity score into the sentence the number is standing in for. */
function similarityVerdict(ssim: number) {
  if (ssim >= 0.99) return { text: "눈에 차이 없음", tone: "text-emerald-400" };
  if (ssim >= 0.97) return { text: "거의 같음", tone: "text-emerald-400" };
  if (ssim >= 0.94) return { text: "자세히 보면 차이", tone: "text-amber-300" };
  return { text: "차이가 보일 수 있음", tone: "text-amber-300" };
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

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid gap-1 rounded-[9px] bg-secondary p-[3px]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-7 rounded-[7px] text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === option.value
              ? "bg-primary font-medium text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function StatTile({ label, value, note, tone }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <div className="rounded-[10px] bg-muted/40 px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--border)]">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-1.5">
        <span className="text-[19px] font-semibold tracking-tight">{value}</span>
        <span className={cn("text-[11px]", tone ?? "text-muted-foreground")}>{note}</span>
      </div>
    </div>
  );
}

export function WebAssetWorkspace({ apiKey, onUnauthorized, onNavigate }: WebAssetWorkspaceProps) {
  const [items, setItems] = useState<WebAssetItem[]>([]);
  const itemsRef = useRef<WebAssetItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const [generating, setGenerating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [outputPreview, setOutputPreview] = useState<OutputPreview | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [previewMode, setPreviewMode] = useState<"output" | "source">("output");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewUrl, setPreviewBlob] = useObjectUrl();
  const [outputUrl, setOutputBlob] = useObjectUrl();

  const activeItem = items.find((item) => item.id === activeId) ?? items[0];
  const activeAltText = activeItem?.altText ?? "";
  const activeDescribes = activeItem?.describes ?? true;
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
    && items.every((item) => !item.describes || item.altText.trim().length > 0);

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
        if (response.status === 401) {
          onUnauthorized();
          throw new Error("열쇠가 맞지 않습니다. 왼쪽 아래에서 열쇠를 다시 입력해 주세요.");
        }
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(koreanApiError(payload?.error, "이미지를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요."));
        }
        const payload = await response.json() as { items: AssetInspectionItem[] };
        if (controller.signal.aborted) return;
        setItems((current) => current.map((item) => {
          const index = snapshot.findIndex(({ id }) => id === item.id);
          return index >= 0 ? { ...item, inspection: payload.items[index] } : item;
        }));
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "이미지를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
      } finally {
        if (!controller.signal.aborted) setInspecting(false);
      }
    })();
    return () => controller.abort();
  }, [apiKey, fileBatchKey, onUnauthorized]);

  const options = useMemo<WebAssetOptions | null>(() => {
    if (!optionsValid) return null;
    const accessibility = items.map((item) => ({
      kind: item.describes ? ("informative" as const) : ("decorative" as const),
      text: item.describes ? item.altText.trim() : "",
    }));
    return {
      profile,
      layout,
      ...(parsedWidths ? { customWidths: parsedWidths } : {}),
      designBaseWidth: parsedBaseWidth,
      sizes,
      contentHint,
      colorPolicy,
      altKind: accessibility[0]?.kind ?? "informative",
      altText: accessibility[0]?.text ?? "",
      accessibility,
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

  const activeOptions = useMemo<WebAssetOptions | null>(() => {
    if (!options || !activeItem) return null;
    const entry = {
      kind: activeItem.describes ? ("informative" as const) : ("decorative" as const),
      text: activeItem.describes ? activeItem.altText.trim() : "",
    };
    return { ...options, altKind: entry.kind, altText: entry.text, accessibility: [entry] };
  }, [activeItem, options]);

  const activeRecipeKey = activeItem && activeOptions ? `${activeItem.id}:${JSON.stringify(activeOptions)}` : "";
  const visibleOutput = outputPreview?.key === activeRecipeKey ? outputPreview : null;
  const plan = useMemo(
    () => (activeFacts && activeOptions ? planWebAssetOutputs(activeFacts, activeOptions) : null),
    [activeFacts, activeOptions],
  );

  // The old flow made you press "대표 출력 검사"; step 3 now does it for you.
  useEffect(() => {
    if (!apiKey || !activeItem || !activeOptions || !activeRecipeKey) return;
    if (activeItem.inspection?.status !== "ready") return;
    if (outputPreview?.key === activeRecipeKey || generating) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        setPreviewing(true);
        try {
          const body = new FormData();
          body.set("images", activeItem.file);
          body.set("options", JSON.stringify(activeOptions));
          const response = await authenticatedApiFetch("/api/v1/web-assets/preview", apiKey, {
            method: "POST",
            body,
            signal: controller.signal,
          });
          if (response.status === 401) {
            onUnauthorized();
            throw new Error("열쇠가 맞지 않습니다. 왼쪽 아래에서 열쇠를 다시 입력해 주세요.");
          }
          if (!response.ok) {
            const payload = await response.json().catch(() => null) as { error?: string } | null;
            throw new Error(koreanApiError(payload?.error, "결과를 만들지 못했습니다. 설정을 바꿔 다시 시도해 주세요."));
          }
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          setOutputBlob(blob);
          setOutputPreview({
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
          });
          setError("");
        } catch (caught) {
          if (controller.signal.aborted) return;
          setError(caught instanceof Error ? caught.message : "결과를 만들지 못했습니다.");
        } finally {
          if (!controller.signal.aborted) setPreviewing(false);
        }
      })();
    }, 700);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    activeItem,
    activeOptions,
    activeRecipeKey,
    apiKey,
    generating,
    onUnauthorized,
    outputPreview?.key,
    setOutputBlob,
  ]);

  const steps = [
    { label: "이미지 올리기", done: items.length > 0 },
    { label: "쓰임새 고르기", done: items.length > 0 && optionsValid },
    { label: "결과 확인하기", done: items.length > 0 && optionsValid && visibleOutput !== null },
    { label: "내려받기", done: downloaded },
  ];

  const advancedSettings = [
    "이미지 종류",
    "색 처리",
    "첫 화면 여부",
    "화면 크기별 규칙",
    ...(profile === "html" ? ["WebP 함께 만들기", "AVIF 함께 만들기", "직접 정한 가로 크기"] : []),
    ...(profile === "next" ? ["흐릿한 미리보기 넣기"] : []),
    ...(profile === "design" ? ["1배 기준 가로"] : []),
  ];
  const advancedSummary = [
    profile === "html" ? (includeWebp || includeAvif ? "WebP·AVIF 함께 만들기" : "기본 형식만") : null,
    colorPolicy === "preserve" ? "색 그대로 유지" : "웹 표준 색으로 변환",
    loadingIntent === "lcp" ? "첫 화면에 바로 보임" : "첫 화면 아님",
  ].filter(Boolean).join(" · ");

  function addFiles(files: File[]) {
    const selection = selectBatchFiles(itemsRef.current.map(({ file }) => file), files);
    if (selection.accepted.length === 0) {
      setError(selection.rejected.map(({ reason }) => reason).join(" "));
      return;
    }
    const additions = selection.accepted.map<WebAssetItem>((file) => ({
      id: crypto.randomUUID(),
      file,
      describes: true,
      altText: "",
    }));
    setItems((current) => [...current, ...additions]);
    setActiveId((current) => current || additions[0]?.id || "");
    setError("");
    setDownloaded(false);
    setNotice(
      selection.rejected.length > 0
        ? `${selection.rejected.length}개는 올리지 못했어요. 한 번에 ${MAX_BATCH_FILES}개, 한 장에 10MB까지 올릴 수 있습니다.`
        : "",
    );
  }

  function removeItem(id: string) {
    const next = itemsRef.current.filter((item) => item.id !== id);
    setItems(next);
    if (activeId === id) setActiveId(next[0]?.id ?? "");
  }

  function updateActive(update: Partial<Pick<WebAssetItem, "describes" | "altText">>) {
    if (!activeItem) return;
    setItems((current) => current.map((item) => (item.id === activeItem.id ? { ...item, ...update } : item)));
  }

  function changeLayout(next: WebAssetLayout) {
    setLayout(next);
    setSizes(WEB_ASSET_DEFAULT_SIZES[next]);
  }

  async function downloadPack() {
    if (!apiKey) {
      setError("열쇠가 아직 없습니다. 왼쪽 아래 ‘열쇠 입력하기’에서 넣어주세요.");
      onUnauthorized();
      return;
    }
    if (!options) {
      setError("이미지 설명을 아직 채우지 않았어요. 오른쪽에서 한 문장을 적어주세요.");
      return;
    }
    const targets = itemsRef.current.filter((item) => item.inspection?.status === "ready");
    if (targets.length === 0) {
      setError("아직 사용할 수 있는 이미지가 없어요. 지원하는 형식(PNG · JPEG · WebP)으로 올려주세요.");
      return;
    }
    setGenerating(true);
    setError("");
    setNotice("");
    try {
      const scopedOptions: WebAssetOptions = {
        ...options,
        altKind: targets[0].describes ? "informative" : "decorative",
        altText: targets[0].describes ? targets[0].altText.trim() : "",
        accessibility: targets.map((item) => ({
          kind: item.describes ? ("informative" as const) : ("decorative" as const),
          text: item.describes ? item.altText.trim() : "",
        })),
      };
      const body = new FormData();
      targets.forEach(({ file }) => body.append("images", file));
      body.set("options", JSON.stringify(scopedOptions));
      const response = await authenticatedApiFetch("/api/v1/web-assets", apiKey, { method: "POST", body });
      const requestId = response.headers.get("x-request-id") ?? "";
      if (response.status === 401) {
        onUnauthorized();
        throw new Error("열쇠가 맞지 않습니다. 왼쪽 아래에서 열쇠를 다시 입력해 주세요.");
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string; requestId?: string } | null;
        throw new Error(
          `${koreanApiError(payload?.error, "압축 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.")}${
            requestId || payload?.requestId ? ` (요청 번호 ${requestId || payload?.requestId})` : ""
          }`,
        );
      }
      const outputFiles = Number(response.headers.get("x-output-files") ?? 0);
      const failed = Number(response.headers.get("x-asset-failed") ?? 0);
      await saveZipResponse(response, "web-assets.zip");
      setDownloaded(true);
      setNotice(
        `파일 ${outputFiles}개를 압축 파일 하나로 저장했습니다.${failed > 0 ? ` ${failed}개는 만들지 못했습니다.` : ""}`,
      );
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setNotice("저장을 취소했습니다.");
      } else {
        setError(caught instanceof Error ? caught.message : "압축 파일을 만들지 못했습니다.");
      }
    } finally {
      setGenerating(false);
    }
  }

  async function copySnippet() {
    if (!activeFacts || !activeOptions || !plan) return;
    try {
      const code = activeOptions.profile === "next"
        ? nextImageSnippet(plan.outputs[0], activeOptions)
        : activeOptions.profile === "design"
          ? designHandoffSnippet(activeFacts, plan.outputs, activeOptions)
          : htmlPictureSnippet(plan.outputs, activeOptions);
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError("코드를 복사하지 못했습니다. 압축 파일을 내려받으면 같은 코드가 함께 들어 있습니다.");
    }
  }

  const similarity = visibleOutput ? similarityVerdict(visibleOutput.ssim) : null;
  const savedPercent = visibleOutput && activeFacts && activeFacts.encodedBytes > 0
    ? Math.round((1 - visibleOutput.bytes / activeFacts.encodedBytes) * 100)
    : null;
  const showingSource = previewMode === "source" || !visibleOutput;
  const shownUrl = showingSource ? previewUrl : outputUrl;
  // Each ready image is planned separately: widths clamp to its own dimensions.
  const packFileCount = options
    ? items.reduce(
        (total, item) =>
          total
          + (item.inspection?.status === "ready"
            ? planWebAssetOutputs(item.inspection.facts, options).outputs.length
            : 0),
        0,
      )
    : 0;

  return (
    <div className="flex flex-col gap-5">
      <StepProgress steps={steps} label="웹에 올릴 이미지 만들기 단계" />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          event.currentTarget.value = "";
        }}
        aria-label="PNG, JPEG 또는 WebP 이미지 선택"
      />

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20.5rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {activeItem ? (
            <section
              className="flex min-w-0 flex-col gap-3 rounded-xl bg-card p-3.5 shadow-[inset_0_0_0_1px_var(--border)]"
              aria-label="결과 미리보기"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[15px] font-medium">{activeItem.file.name}</span>
                  {previewing ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
                      결과 만드는 중
                    </span>
                  ) : visibleOutput ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/14 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                      <Check className="size-3" aria-hidden="true" />
                      화질 확인 통과
                    </span>
                  ) : null}
                </div>
                {visibleOutput ? (
                  <Segmented
                    label="미리보기 전환"
                    value={previewMode}
                    onChange={setPreviewMode}
                    options={[
                      { value: "output", label: "만든 결과" },
                      { value: "source", label: "올린 원본" },
                    ]}
                  />
                ) : null}
              </div>

              <div className="relative h-[19rem] overflow-hidden rounded-[10px] border bg-[repeating-conic-gradient(oklch(0.25_0_0)_0_25%,oklch(0.2_0_0)_0_50%)] bg-[length:20px_20px]">
                {shownUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={shownUrl}
                    alt={`${activeItem.file.name} ${showingSource ? "원본" : "결과"} 미리보기`}
                    className="size-full object-contain"
                  />
                ) : null}
                <div className="absolute bottom-3.5 left-3.5 flex gap-1.5 font-mono text-[11px]">
                  {showingSource ? (
                    activeFacts ? (
                      <>
                        <span className="rounded-[7px] bg-background/85 px-2 py-1">{activeFacts.width} × {activeFacts.height}</span>
                        <span className="rounded-[7px] bg-background/85 px-2 py-1">{formatImageBytes(activeFacts.encodedBytes)}</span>
                      </>
                    ) : null
                  ) : visibleOutput ? (
                    <>
                      <span className="rounded-[7px] bg-background/85 px-2 py-1">{visibleOutput.width} × {visibleOutput.height}</span>
                      <span className="rounded-[7px] bg-background/85 px-2 py-1 uppercase">
                        {visibleOutput.format.replace("image/", "")} · {formatImageBytes(visibleOutput.bytes)}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-3">
                <StatTile
                  label="원본과 얼마나 같은지"
                  value={visibleOutput ? `${(visibleOutput.ssim * 100).toFixed(1)}%` : "—"}
                  note={similarity?.text ?? "결과를 기다리는 중"}
                  tone={similarity?.tone}
                />
                <StatTile
                  label="용량 변화"
                  value={savedPercent === null ? "—" : `${savedPercent > 0 ? "−" : "+"}${Math.abs(savedPercent)}%`}
                  note={
                    visibleOutput && activeFacts
                      ? `${formatImageBytes(activeFacts.encodedBytes)} → ${formatImageBytes(visibleOutput.bytes)}`
                      : "결과를 기다리는 중"
                  }
                />
                <StatTile
                  label="만들어질 파일"
                  value={plan ? `${plan.outputs.length}개` : "—"}
                  note={plan ? `크기 ${plan.widthCount}종 · 형식 ${plan.formatCount}종` : "쓰임새를 고르면 계산됩니다"}
                />
              </div>
            </section>
          ) : null}

          <section
            className="flex flex-col gap-2.5 rounded-xl bg-card p-3.5 shadow-[inset_0_0_0_1px_var(--border)]"
            aria-label="올린 이미지"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">
                올린 이미지 {items.length}개
                {inspecting ? <span className="ml-2 text-[11px] font-normal text-muted-foreground">확인하는 중…</span> : null}
              </div>
              <Button type="button" size="xs" variant="outline" disabled={generating} onClick={() => fileInputRef.current?.click()}>
                <Plus aria-hidden="true" />
                {items.length > 0 ? "더 올리기" : "이미지 올리기"}
              </Button>
            </div>

            {items.length === 0 ? (
              <p className="rounded-[10px] bg-muted/40 px-3 py-6 text-center text-[13px] text-muted-foreground">
                PNG · JPEG · WebP 이미지를 올려주세요. 한 번에 {MAX_BATCH_FILES}개, 한 장에 10MB까지 가능합니다.
              </p>
            ) : null}

            {items.map((item) => {
              const facts = item.inspection?.status === "ready" ? item.inspection.facts : null;
              const failure = item.inspection?.status === "failed" ? failureHelp(item.inspection.error) : null;
              const selected = activeItem?.id === item.id;
              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[10px] border px-2.5 py-2 transition-colors",
                    failure
                      ? "border-destructive/35 bg-destructive/6"
                      : selected
                        ? "border-primary/50 bg-primary/7"
                        : "border-border hover:bg-muted/40",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActiveId(item.id)}
                    disabled={Boolean(failure)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                  >
                    <span
                      className={cn(
                        "grid h-[26px] w-[34px] shrink-0 place-items-center rounded-[5px]",
                        failure ? "bg-destructive/15 text-destructive" : "bg-secondary",
                      )}
                    >
                      {failure ? <TriangleAlert className="size-3.5" aria-hidden="true" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{item.file.name}</span>
                      <span
                        className={cn(
                          "mt-px block text-[11px] leading-[1.45]",
                          failure ? "text-amber-300" : "text-muted-foreground",
                        )}
                      >
                        {failure
                          ? failure.message
                          : facts
                            ? `${facts.width} × ${facts.height} · ${formatImageBytes(facts.encodedBytes)} · ${DETECTED_CONTENT[facts.detectedContent]}`
                            : "확인하는 중…"}
                      </span>
                    </span>
                  </button>

                  {facts ? (
                    <span className="hidden shrink-0 items-center gap-1 text-[11px] text-emerald-300 sm:inline-flex">
                      <Check className="size-3" aria-hidden="true" />
                      사용할 수 있어요
                    </span>
                  ) : null}

                  {failure?.action && onNavigate ? (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      className="shrink-0 whitespace-nowrap"
                      onClick={() => onNavigate(failure.action!.tool)}
                    >
                      {failure.action.label}
                    </Button>
                  ) : null}

                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground"
                    disabled={generating}
                    onClick={() => removeItem(item.id)}
                    aria-label={`${item.file.name} 빼기`}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              );
            })}

            {activeFacts?.metadata.gps ? (
              <div className="flex items-start gap-2 rounded-[10px] bg-muted/40 px-2.5 py-2.5">
                <Info className="mt-px size-3.5 shrink-0 text-amber-300" aria-hidden="true" />
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  이 사진에는 <strong className="font-medium text-foreground">촬영 위치 정보</strong>가 들어 있습니다.
                  웹에 올릴 파일에서는 자동으로 지워집니다.
                </p>
              </div>
            ) : null}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-3" aria-label="설정">
          <section className="flex flex-col gap-3 rounded-xl bg-card p-3.5 shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-primary),transparent_80%)]">
            <div>
              <div className="text-sm font-medium">어디에 쓸 이미지인가요?</div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                하나만 고르면 나머지 설정은 알아서 맞춰집니다.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              {PURPOSE.map(({ value, title, detail, icon: Icon }) => {
                const selected = profile === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setProfile(value)}
                    className={cn(
                      "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] border p-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40",
                    )}
                  >
                    <Icon className={cn("size-4", selected ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{title}</span>
                      <span className="mt-0.5 block text-[11px] leading-[1.45] text-muted-foreground">{detail}</span>
                    </span>
                    {selected ? <CircleCheck className="size-4 text-primary" aria-hidden="true" /> : <span />}
                  </button>
                );
              })}
            </div>

            {profile === "html" ? (
              <div className="flex flex-col gap-2 border-t pt-3">
                <div className="text-xs font-medium text-muted-foreground">이미지가 놓일 자리</div>
                <Segmented label="이미지가 놓일 자리" value={layout} onChange={changeLayout} options={PLACEMENT} />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  가로{" "}
                  <span className="font-mono">
                    {(parsedWidths ?? WEB_ASSET_WIDTH_PRESETS[layout]).join(" · ")}
                  </span>{" "}
                  크기로 만듭니다.
                </p>
              </div>
            ) : profile === "design" && activeFacts ? (
              <div className="flex flex-col gap-2 border-t pt-3">
                <div className="text-xs font-medium text-muted-foreground">1배 기준 가로</div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  가로{" "}
                  <span className="font-mono">
                    {resolveWebAssetWidths(activeFacts.width, { ...DEFAULT_WEB_ASSET_OPTIONS, profile: "design", designBaseWidth: parsedBaseWidth || 400 })
                      .map(({ width }) => width)
                      .join(" · ")}
                  </span>{" "}
                  크기로 만듭니다.
                </p>
              </div>
            ) : null}
          </section>

          <section className="flex flex-col gap-2.5 rounded-xl bg-card p-3.5 shadow-[inset_0_0_0_1px_var(--border)]">
            <div className="text-sm font-medium">이미지 설명 {activeDescribes ? "(필수)" : ""}</div>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              화면을 못 보는 사람과 검색엔진에 읽히는 문구입니다.
              {activeItem ? (
                <>
                  {" "}지금 선택한 <span className="text-foreground">{activeItem.file.name}</span>에만 적용됩니다.
                </>
              ) : null}
            </p>
            <Segmented
              label="이미지 설명 방식"
              value={activeDescribes ? "describe" : "decorative"}
              onChange={(value) => updateActive({ describes: value === "describe" })}
              options={[
                { value: "describe", label: "내용을 설명" },
                { value: "decorative", label: "그냥 장식" },
              ]}
            />
            {activeDescribes ? (
              <>
                <textarea
                  value={activeAltText}
                  onChange={(event) => updateActive({ altText: event.target.value })}
                  disabled={!activeItem}
                  maxLength={300}
                  rows={2}
                  placeholder="사진에 무엇이 보이는지 한 문장으로"
                  className="w-full resize-none rounded-[10px] border border-input bg-background px-2.5 py-2.5 text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                />
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>사진에 무엇이 보이는지 한 문장으로</span>
                  <span className="font-mono">{activeAltText.length}/300</span>
                </div>
              </>
            ) : (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                장식용 이미지는 설명 없이 <span className="font-mono">alt=&quot;&quot;</span>로 기록해 낭독기가 건너뜁니다.
              </p>
            )}
          </section>

          <section className="rounded-xl bg-card shadow-[inset_0_0_0_1px_var(--border)]">
            <button
              type="button"
              aria-expanded={detailsOpen}
              aria-controls="advanced-settings"
              onClick={() => setDetailsOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-2 rounded-xl p-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">세부 설정 {advancedSettings.length}개</span>
                <span className="mt-0.5 block text-[11px] leading-[1.45] text-muted-foreground">
                  {advancedSummary} — 모두 권장값
                </span>
              </span>
              <ChevronDown
                className={cn("size-4 shrink-0 text-muted-foreground transition-transform", detailsOpen && "rotate-180")}
                aria-hidden="true"
              />
            </button>

            {detailsOpen ? (
              <div id="advanced-settings" className="flex flex-col gap-3.5 border-t p-3.5 text-xs">
                <label className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground">이미지 종류</span>
                  <select
                    value={contentHint}
                    onChange={(event) => setContentHint(event.target.value as WebAssetContentHint)}
                    className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs text-foreground"
                  >
                    {CONTENT_HINT.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground">색 처리</span>
                  <select
                    value={colorPolicy}
                    onChange={(event) => setColorPolicy(event.target.value as WebAssetColorPolicy)}
                    className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs text-foreground"
                  >
                    <option value="preserve">색 그대로 유지</option>
                    <option value="srgb">웹 표준 색(sRGB)으로 변환</option>
                  </select>
                </label>

                <div className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground">첫 화면에 바로 보이나요?</span>
                  <Segmented
                    label="첫 화면에 바로 보이나요?"
                    value={loadingIntent}
                    onChange={setLoadingIntent}
                    options={[
                      { value: "lcp", label: "예" },
                      { value: "lazy", label: "아니오" },
                    ]}
                  />
                </div>

                {profile === "html" ? (
                  <>
                    <div className="flex flex-wrap gap-3">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={includeWebp} onChange={(event) => setIncludeWebp(event.target.checked)} />
                        WebP 함께 만들기
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={includeAvif} onChange={(event) => setIncludeAvif(event.target.checked)} />
                        AVIF 함께 만들기
                      </label>
                    </div>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-muted-foreground">직접 정한 가로 크기 <span className="font-mono">(쉼표로 구분)</span></span>
                      <input
                        value={customWidths}
                        onChange={(event) => setCustomWidths(event.target.value)}
                        placeholder={WEB_ASSET_WIDTH_PRESETS[layout].join(", ")}
                        aria-invalid={parsedWidths === null}
                        className="h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </label>
                  </>
                ) : profile === "next" ? (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={includePlaceholder} onChange={(event) => setIncludePlaceholder(event.target.checked)} />
                    흐릿한 미리보기(blurDataURL) 넣기
                  </label>
                ) : (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-muted-foreground">1배 기준 가로</span>
                    <input
                      type="number"
                      min={16}
                      max={4096}
                      value={designBaseWidth}
                      onChange={(event) => setDesignBaseWidth(event.target.value)}
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                )}

                <label className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground">화면 크기별 규칙 <span className="font-mono">(sizes)</span></span>
                  <input
                    value={sizes}
                    onChange={(event) => setSizes(event.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>

                {visibleOutput ? (
                  <div className="border-t pt-3.5">
                    <div className="mb-2 font-medium text-muted-foreground">화질 지표 자세히</div>
                    <dl className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                      <div><dt className="text-muted-foreground">SSIM</dt><dd>{visibleOutput.ssim.toFixed(4)}</dd></div>
                      <div><dt className="text-muted-foreground">MAE</dt><dd>{visibleOutput.mae.toFixed(4)}</dd></div>
                      <div><dt className="text-muted-foreground">Edge MAE</dt><dd>{visibleOutput.edgeMae.toFixed(4)}</dd></div>
                      <div><dt className="text-muted-foreground">Alpha MAE</dt><dd>{visibleOutput.alphaMae.toFixed(4)}</dd></div>
                    </dl>
                  </div>
                ) : null}

                {activeFacts ? (
                  <div className="border-t pt-3.5">
                    <div className="mb-2 font-medium text-muted-foreground">파일 정보</div>
                    <dl className="grid grid-cols-2 gap-2 text-[11px]">
                      <div><dt className="text-muted-foreground">실제 형식</dt><dd className="font-mono uppercase">{activeFacts.format}</dd></div>
                      <div><dt className="text-muted-foreground">비트 / 픽셀</dt><dd className="font-mono">{activeFacts.bitsPerPixel}</dd></div>
                      <div><dt className="text-muted-foreground">투명 영역</dt><dd>{activeFacts.hasAlpha ? "있음" : "없음"}</dd></div>
                      <div><dt className="text-muted-foreground">색 프로필</dt><dd className="font-mono uppercase">{activeFacts.colorProfile}</dd></div>
                      <div className="col-span-2"><dt className="text-muted-foreground">안에 든 정보</dt><dd>{metadataLabels(activeFacts)}</dd></div>
                    </dl>
                    {activeFacts.warnings.length > 0 ? (
                      <ul className="mt-2 flex flex-col gap-1 text-[11px] leading-relaxed text-amber-300">
                        {activeFacts.warnings.map((warning) => <li key={warning}>— {warning}</li>)}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              className="h-11 w-full text-[15px] font-semibold"
              disabled={!options || readyCount === 0 || generating || inspecting}
              onClick={() => void downloadPack()}
            >
              {generating ? <LoaderCircle className="size-[17px] animate-spin" aria-hidden="true" /> : <Download className="size-[17px]" aria-hidden="true" />}
              압축 파일로 내려받기{packFileCount > 0 ? ` · ${packFileCount}개` : ""}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={!plan || !activeFacts}
              onClick={() => void copySnippet()}
            >
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? "복사했습니다" : "붙여넣을 코드만 복사"}
            </Button>
            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              파일은 내 컴퓨터로 바로 저장되고 서버에는 남지 않습니다.
            </p>
          </div>
        </aside>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>이 부분이 막혔어요</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <Check aria-hidden="true" />
          <AlertTitle>알려드립니다</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
