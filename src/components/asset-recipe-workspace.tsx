"use client";

import Image from "next/image";
import { Archive, Download, Eye, FileUp, LoaderCircle, PackageCheck, ScanLine, ShieldCheck, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useObjectUrl } from "@/hooks/use-object-url";
import { authenticatedApiFetch, koreanApiError } from "@/lib/api/client";
import { saveZipResponse } from "@/lib/api/download";
import type { AssetRecipeOptions, AspectRatio } from "@/lib/asset-recipes/types";
import type { DirectSvgApiResult } from "@/lib/vector/types";
import { cn } from "@/lib/utils";

interface AssetRecipeWorkspaceProps { apiKey: string; onUnauthorized: () => void }
type Recipe = AssetRecipeOptions["recipe"] | "svg" | "gif-video" | "font";

const RECIPE_GROUPS = [
  {
    label: "P1 · 핸드오프",
    options: [
      ["frame", "프레이밍 · 초점"], ["icons", "웹 · 앱 아이콘"], ["palette", "팔레트 · 대비"],
      ["social", "OG · 소셜 카드"], ["svg", "기존 SVG 정리"], ["heic", "HEIC 웹 변환"],
    ],
  },
  {
    label: "P2 · 제한 레시피",
    options: [
      ["gif-video", "GIF → 무음 영상"], ["font", "WOFF2 서브셋"], ["background", "단색 배경 제거"], ["watermark", "텍스트 워터마크"],
    ],
  },
] as const;

const ASPECTS = ["1:1", "4:3", "3:2", "16:9", "2:1", "9:16"] as const;
const CONTROL = "mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function isDirectSvgResult(value: unknown): value is DirectSvgApiResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<DirectSvgApiResult>;
  return typeof result.svg === "string" && typeof result.downloadName === "string" && typeof result.output?.bytes === "number";
}

export function AssetRecipeWorkspace({ apiKey, onUnauthorized }: AssetRecipeWorkspaceProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [recipe, setRecipe] = useState<Recipe>("frame");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"preview" | "pack" | "">("");
  const [resultName, setResultName] = useState("");
  const [resultMeta, setResultMeta] = useState("");
  const [compare, setCompare] = useState(50);
  const [sourceUrl, setSourceBlob] = useObjectUrl();
  const [resultUrl, setResultBlob] = useObjectUrl();
  const [resultBlob, setResultFile] = useState<Blob | null>(null);

  const [aspects, setAspects] = useState<AspectRatio[]>(["1:1", "16:9", "9:16"]);
  const [focusX, setFocusX] = useState(50);
  const [focusY, setFocusY] = useState(50);
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [trim, setTrim] = useState(false);
  const [padding, setPadding] = useState(0);
  const [background, setBackground] = useState("#17130f");
  const [includeNative, setIncludeNative] = useState(false);
  const [paletteColors, setPaletteColors] = useState(6);
  const [title, setTitle] = useState("Ship the asset, not the cleanup");
  const [subtitle, setSubtitle] = useState("검사부터 플랫폼 규격까지 한 번에 전달하세요.");
  const [alt, setAlt] = useState("");
  const [textColor, setTextColor] = useState("#ffffff");
  const [fuzz, setFuzz] = useState(6);
  const [watermark, setWatermark] = useState("DRAFT");
  const [watermarkPosition, setWatermarkPosition] = useState<"northwest" | "northeast" | "southwest" | "southeast" | "center">("southeast");
  const [watermarkOpacity, setWatermarkOpacity] = useState(55);
  const [fontFamily, setFontFamily] = useState("Project Sans");
  const [fontText, setFontText] = useState("가나다라마바사 ABCDEFG 0123456789");
  const [licenseConfirmed, setLicenseConfirmed] = useState(false);

  const accept = recipe === "svg" ? ".svg,image/svg+xml"
    : recipe === "gif-video" ? ".gif,image/gif"
      : recipe === "font" ? ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
        : recipe === "heic" ? ".heic,.heif,image/heic,image/heif"
          : "image/png,image/jpeg,image/webp";
  const canPreview = !["gif-video", "font"].includes(recipe);

  const options = useMemo<AssetRecipeOptions | { recipe: "gif-video"; background: string } | { recipe: "font"; family: string; text: string; licenseConfirmed: boolean } | null>(() => {
    if (recipe === "svg") return null;
    if (recipe === "frame") return aspects.length ? { recipe, aspects, focusX, focusY, rotate, flipX, flipY, trim, padding, background } : null;
    if (recipe === "icons") return { recipe, background, padding: Math.min(40, padding), includeNative };
    if (recipe === "palette") return { recipe, colors: paletteColors, background };
    if (recipe === "social") return title.trim() && alt.trim() ? { recipe, title, subtitle, alt, background, textColor } : null;
    if (recipe === "heic") return { recipe };
    if (recipe === "background") return { recipe, color: background, fuzz };
    if (recipe === "watermark") return watermark.trim() ? { recipe, text: watermark, position: watermarkPosition, opacity: watermarkOpacity, color: textColor } : null;
    if (recipe === "gif-video") return { recipe, background };
    return fontFamily.trim() && fontText.trim() && licenseConfirmed ? { recipe: "font", family: fontFamily, text: fontText, licenseConfirmed } : null;
  }, [alt, aspects, background, flipX, flipY, focusX, focusY, fontFamily, fontText, fuzz, includeNative, licenseConfirmed, padding, paletteColors, recipe, rotate, subtitle, textColor, title, trim, watermark, watermarkOpacity, watermarkPosition]);

  function choose(next: File | null) {
    setFile(next);
    setSourceBlob(next);
    setResultBlob(null);
    setResultFile(null);
    setResultName("");
    setResultMeta("");
    setError("");
    setNotice("");
  }

  function changeRecipe(next: Recipe) {
    setRecipe(next);
    choose(null);
  }

  async function request(kind: "preview" | "pack") {
    if (!apiKey) { setError("위에서 API 키를 입력하세요."); onUnauthorized(); return; }
    if (!file || (recipe !== "svg" && !options)) { setError("입력 파일과 필수 설정을 확인하세요."); return; }
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      if (recipe === "svg") {
        const body = new FormData();
        body.set("image", file);
        body.set("precision", "3");
        const response = await authenticatedApiFetch("/api/v1/optimize-svg", apiKey, { method: "POST", body });
        if (response.status === 401) { onUnauthorized(); throw new Error("API 키가 올바르지 않습니다."); }
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok || !isDirectSvgResult(payload)) throw new Error(koreanApiError(payload && typeof payload === "object" && "error" in payload ? String(payload.error) : undefined, "SVG 정리 중 오류가 발생했습니다."));
        const blob = new Blob([payload.svg], { type: "image/svg+xml" });
        setResultFile(blob);
        setResultBlob(blob);
        setResultName(payload.downloadName);
        setResultMeta(`${bytes(payload.input.bytes)} → ${bytes(payload.output.bytes)} · ${payload.output.optimizationPercent.toFixed(1)}% 감소 · 위험 요소 ${Object.values(payload.safety).reduce((sum, value) => sum + value, 0)}개 제거`);
        setNotice("외부 참조와 실행 가능 콘텐츠를 제거했습니다. SVG는 inline DOM에 삽입하지 않았습니다.");
        return;
      }
      const body = new FormData();
      body.set("asset", file);
      body.set("options", JSON.stringify(options));
      const media = recipe === "gif-video" || recipe === "font";
      const endpoint = media ? "/api/v1/media-recipes" : kind === "preview" ? "/api/v1/asset-recipes/preview" : "/api/v1/asset-recipes";
      const response = await authenticatedApiFetch(endpoint, apiKey, { method: "POST", body });
      if (response.status === 401) { onUnauthorized(); throw new Error("API 키가 올바르지 않습니다."); }
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string; requestId?: string } | null;
        throw new Error(`${koreanApiError(payload?.error, "에셋 레시피 처리 중 오류가 발생했습니다.")}${payload?.requestId ? ` 요청 ID ${payload.requestId}` : ""}`);
      }
      if (kind === "preview" && !media) {
        const blob = await response.blob();
        setResultFile(blob);
        setResultBlob(blob);
        setResultName(response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "preview");
        setResultMeta(`${response.headers.get("x-output-role")} · ${response.headers.get("x-output-width")}×${response.headers.get("x-output-height")} · ${bytes(Number(response.headers.get("x-output-bytes")))}`);
        setNotice("대표 출력을 생성했습니다. 슬라이더로 초점·여백·가독성을 확인하세요.");
      } else {
        const mode = await saveZipResponse(response, `${recipe}-asset-recipe.zip`);
        setNotice(`산출물 ${response.headers.get("x-output-files") ?? "-"}개를 ${mode === "disk" ? "디스크로 스트리밍" : "브라우저 호환 방식으로"} 저장했습니다.`);
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") setNotice("저장을 취소했습니다.");
      else setError(caught instanceof Error ? caught.message : "에셋 레시피 처리 중 오류가 발생했습니다.");
    } finally {
      setBusy("");
    }
  }

  const comparable = sourceUrl && resultUrl && file?.type.startsWith("image/") && resultBlob?.type.startsWith("image/");

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-xl border border-primary/25 bg-[linear-gradient(125deg,oklch(0.215_0.025_55),oklch(0.145_0.012_55))]" aria-labelledby="recipe-heading">
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-primary"><PackageCheck className="size-4" aria-hidden="true" />Asset recipe R1</div>
            <h2 id="recipe-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">규격과 검수 근거까지 한 번에</h2>
            <p className="mt-2 max-w-2xl leading-relaxed text-muted-foreground">초점 크롭, 플랫폼 아이콘, 색상·소셜 카드부터 제한형 GIF·폰트 작업까지 버전이 있는 ZIP으로 만듭니다.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {["frame", "verify", "handoff"].map((step, index) => <div key={step} className="flex flex-col items-center gap-2"><span className="grid size-7 place-items-center rounded-full border border-primary/30 bg-primary/8 text-primary">{index + 1}</span>{step}</div>)}
          </div>
        </div>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardContent className="p-6">
              <input ref={inputRef} type="file" accept={accept} className="sr-only" onChange={(event) => { choose(event.target.files?.[0] ?? null); event.currentTarget.value = ""; }} />
              <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 px-5 text-center">
                <FileUp className="mb-3 size-7 text-primary" aria-hidden="true" />
                {file ? <><p className="font-medium">{file.name}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{bytes(file.size)}</p><div className="mt-4 flex gap-2"><Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>교체</Button><Button type="button" variant="ghost" onClick={() => choose(null)}><X aria-hidden="true" />제거</Button></div></> : <><p className="font-medium">레시피 원본 한 개를 선택하세요</p><p className="mt-1 text-sm text-muted-foreground">선택한 레시피에 맞는 형식만 서버에서 실제 시그니처로 확인합니다.</p><Button type="button" variant="outline" className="mt-4" onClick={() => inputRef.current?.click()}>파일 선택</Button></>}
              </div>
            </CardContent>
          </Card>

          {file && (sourceUrl || resultUrl) ? (
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-4"><div><CardTitle>시각 검수</CardTitle><p className="mt-1 text-xs text-muted-foreground">{resultMeta || "대표 출력을 만든 뒤 전후를 비교할 수 있습니다."}</p></div>{resultUrl ? <Badge variant="outline">OUTPUT</Badge> : <Badge variant="outline">SOURCE</Badge>}</CardHeader>
              <CardContent className="space-y-4">
                <div className="relative aspect-[16/9] overflow-hidden rounded-lg border bg-[repeating-conic-gradient(oklch(0.25_0_0)_0_25%,oklch(0.2_0_0)_0_50%)_0/20px_20px]">
                  {sourceUrl && (file.type.startsWith("image/") || recipe === "svg") ? <Image src={sourceUrl} alt={`${file.name} 원본`} fill unoptimized className="object-contain p-4" /> : <div className="grid h-full place-items-center text-sm text-muted-foreground">브라우저 원본 미리보기를 지원하지 않는 형식입니다.</div>}
                  {resultUrl ? <div className={cn("absolute inset-0 bg-card", comparable && "border-r-2 border-primary")} style={comparable ? { clipPath: `inset(0 ${100 - compare}% 0 0)` } : undefined}><Image src={resultUrl} alt={`${file.name} 처리 결과`} fill unoptimized className="object-contain p-4" /></div> : null}
                </div>
                {comparable ? <label className="block"><span className="flex justify-between text-xs text-muted-foreground"><span>원본</span><span>출력 {compare}%</span></span><input type="range" min="0" max="100" value={compare} onChange={(event) => setCompare(Number(event.target.value))} className="mt-2 w-full accent-primary" aria-label="원본과 출력 비교 위치" /></label> : null}
                {resultBlob ? <Button type="button" variant="outline" onClick={() => downloadBlob(resultBlob, resultName)}><Download aria-hidden="true" />대표 출력 저장</Button> : null}
              </CardContent>
            </Card>
          ) : null}

          {error ? <Alert variant="destructive"><ShieldCheck aria-hidden="true" /><AlertTitle>처리하지 못했습니다</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
          {notice ? <Alert><ScanLine aria-hidden="true" /><AlertTitle>레시피 결과</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert> : null}
        </div>

        <aside className="lg:sticky lg:top-6" aria-label="에셋 레시피 설정">
          <Card className="border-primary/20 bg-card/95 shadow-xl shadow-black/20">
            <CardHeader><CardTitle>레시피 사양</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <label className="block text-sm font-medium">출력 묶음<select value={recipe} onChange={(event) => changeRecipe(event.target.value as Recipe)} className={CONTROL}>{RECIPE_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</optgroup>)}</select></label>
              <RecipeControls recipe={recipe} aspects={aspects} setAspects={setAspects} focusX={focusX} setFocusX={setFocusX} focusY={focusY} setFocusY={setFocusY} rotate={rotate} setRotate={setRotate} flipX={flipX} setFlipX={setFlipX} flipY={flipY} setFlipY={setFlipY} trim={trim} setTrim={setTrim} padding={padding} setPadding={setPadding} background={background} setBackground={setBackground} includeNative={includeNative} setIncludeNative={setIncludeNative} paletteColors={paletteColors} setPaletteColors={setPaletteColors} title={title} setTitle={setTitle} subtitle={subtitle} setSubtitle={setSubtitle} alt={alt} setAlt={setAlt} textColor={textColor} setTextColor={setTextColor} fuzz={fuzz} setFuzz={setFuzz} watermark={watermark} setWatermark={setWatermark} watermarkPosition={watermarkPosition} setWatermarkPosition={setWatermarkPosition} watermarkOpacity={watermarkOpacity} setWatermarkOpacity={setWatermarkOpacity} fontFamily={fontFamily} setFontFamily={setFontFamily} fontText={fontText} setFontText={setFontText} licenseConfirmed={licenseConfirmed} setLicenseConfirmed={setLicenseConfirmed} />
              <div className="grid gap-2">
                {canPreview ? <Button type="button" variant="outline" disabled={!file || busy !== "" || (recipe !== "svg" && !options)} onClick={() => void request("preview")}>{busy === "preview" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Eye aria-hidden="true" />}대표 출력</Button> : null}
                {recipe !== "svg" ? <Button type="button" size="lg" disabled={!file || !options || busy !== ""} onClick={() => void request("pack")}>{busy === "pack" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Archive aria-hidden="true" />}ZIP 만들기</Button> : null}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">원본을 덮어쓰거나 서버에 저장하지 않습니다. manifest에는 입력·출력 SHA-256과 레시피 경계를 기록합니다.</p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

type Controls = {
  recipe: Recipe; aspects: AspectRatio[]; setAspects: (value: AspectRatio[]) => void; focusX: number; setFocusX: (value: number) => void; focusY: number; setFocusY: (value: number) => void; rotate: 0 | 90 | 180 | 270; setRotate: (value: 0 | 90 | 180 | 270) => void; flipX: boolean; setFlipX: (value: boolean) => void; flipY: boolean; setFlipY: (value: boolean) => void; trim: boolean; setTrim: (value: boolean) => void; padding: number; setPadding: (value: number) => void; background: string; setBackground: (value: string) => void; includeNative: boolean; setIncludeNative: (value: boolean) => void; paletteColors: number; setPaletteColors: (value: number) => void; title: string; setTitle: (value: string) => void; subtitle: string; setSubtitle: (value: string) => void; alt: string; setAlt: (value: string) => void; textColor: string; setTextColor: (value: string) => void; fuzz: number; setFuzz: (value: number) => void; watermark: string; setWatermark: (value: string) => void; watermarkPosition: "northwest" | "northeast" | "southwest" | "southeast" | "center"; setWatermarkPosition: (value: Controls["watermarkPosition"]) => void; watermarkOpacity: number; setWatermarkOpacity: (value: number) => void; fontFamily: string; setFontFamily: (value: string) => void; fontText: string; setFontText: (value: string) => void; licenseConfirmed: boolean; setLicenseConfirmed: (value: boolean) => void;
};

function RecipeControls(props: Controls) {
  const color = <label className="block text-sm">배경색<input type="color" value={props.background} onChange={(event) => props.setBackground(event.target.value)} className="ml-3 h-8 w-14 rounded border border-input bg-transparent align-middle" /></label>;
  if (props.recipe === "frame") return <div className="space-y-4"><fieldset><legend className="text-sm font-medium">출력 비율</legend><div className="mt-2 grid grid-cols-3 gap-2">{ASPECTS.map((aspect) => <label key={aspect} className="flex items-center gap-2 rounded-md border p-2 font-mono text-xs"><input type="checkbox" checked={props.aspects.includes(aspect)} onChange={(event) => props.setAspects(event.target.checked ? [...props.aspects, aspect] : props.aspects.filter((value) => value !== aspect))} />{aspect}</label>)}</div></fieldset><Range label="가로 초점" value={props.focusX} onChange={props.setFocusX} suffix="%" /><Range label="세로 초점" value={props.focusY} onChange={props.setFocusY} suffix="%" /><label className="block text-sm">회전<select value={props.rotate} onChange={(event) => props.setRotate(Number(event.target.value) as Controls["rotate"])} className={CONTROL}>{[0, 90, 180, 270].map((value) => <option key={value} value={value}>{value}°</option>)}</select></label><div className="grid grid-cols-2 gap-2"><Check label="좌우 반전" checked={props.flipX} onChange={props.setFlipX} /><Check label="상하 반전" checked={props.flipY} onChange={props.setFlipY} /><Check label="투명 여백 trim" checked={props.trim} onChange={props.setTrim} /></div><Range label="패딩" value={props.padding} onChange={props.setPadding} max={256} suffix="px" />{color}</div>;
  if (props.recipe === "icons") return <div className="space-y-4">{color}<Range label="안쪽 여백" value={Math.min(40, props.padding)} onChange={props.setPadding} max={40} suffix="%" /><Check label="iOS · Android 카탈로그 포함" checked={props.includeNative} onChange={props.setIncludeNative} /><p className="text-xs text-muted-foreground">maskable은 최소 20% 안전 여백을 강제합니다.</p></div>;
  if (props.recipe === "palette") return <div className="space-y-4"><Range label="대표 색상" value={props.paletteColors} onChange={props.setPaletteColors} min={3} max={8} suffix="개" />{color}<p className="text-xs text-muted-foreground">WCAG AA 4.5:1, UI 3:1, AAA 7:1 조합을 JSON에 기록합니다.</p></div>;
  if (props.recipe === "social") return <div className="space-y-4"><Text label="제목" value={props.title} onChange={props.setTitle} maxLength={90} /><Text label="부제" value={props.subtitle} onChange={props.setSubtitle} maxLength={140} /><Text label="og:image:alt (필수)" value={props.alt} onChange={props.setAlt} maxLength={300} />{color}<label className="block text-sm">글자색<input type="color" value={props.textColor} onChange={(event) => props.setTextColor(event.target.value)} className="ml-3 h-8 w-14 rounded border border-input bg-transparent align-middle" /></label></div>;
  if (props.recipe === "background") return <div className="space-y-4">{color}<Range label="색상 허용차" value={props.fuzz} onChange={props.setFuzz} max={20} suffix="%" /><p className="text-xs text-muted-foreground">연결 영역이 아니라 비슷한 색 전체를 제거하는 제한형 도구입니다.</p></div>;
  if (props.recipe === "watermark") return <div className="space-y-4"><Text label="워터마크" value={props.watermark} onChange={props.setWatermark} maxLength={80} /><label className="block text-sm">위치<select value={props.watermarkPosition} onChange={(event) => props.setWatermarkPosition(event.target.value as Controls["watermarkPosition"])} className={CONTROL}><option value="northwest">왼쪽 위</option><option value="northeast">오른쪽 위</option><option value="southwest">왼쪽 아래</option><option value="southeast">오른쪽 아래</option><option value="center">가운데</option></select></label><Range label="불투명도" value={props.watermarkOpacity} onChange={props.setWatermarkOpacity} min={10} suffix="%" /><label className="block text-sm">글자색<input type="color" value={props.textColor} onChange={(event) => props.setTextColor(event.target.value)} className="ml-3 h-8 w-14 rounded border border-input bg-transparent align-middle" /></label></div>;
  if (props.recipe === "font") return <div className="space-y-4"><Text label="CSS font-family" value={props.fontFamily} onChange={props.setFontFamily} maxLength={80} /><label className="block text-sm">포함할 문자<textarea value={props.fontText} onChange={(event) => props.setFontText(event.target.value)} maxLength={5000} rows={5} className={`${CONTROL} h-auto py-2`} /></label><Check label="수정·웹 임베딩 권한을 확인했습니다" checked={props.licenseConfirmed} onChange={props.setLicenseConfirmed} /><p className="text-xs text-muted-foreground">글리프·shaping과 실제 라이선스는 사람이 최종 검수해야 합니다.</p></div>;
  if (props.recipe === "gif-video") return <div className="space-y-3">{color}<p className="text-xs text-muted-foreground">최대 30초·30fps의 무음 반복 WebM/MP4와 poster만 만듭니다. MP4 투명 영역에는 선택 배경색을 합성합니다.</p></div>;
  if (props.recipe === "svg") return <p className="text-xs leading-relaxed text-muted-foreground">title·desc, 안전한 CSS와 내부 ID 참조는 보존하고 script, 외부 style/URL, foreignObject, embedded image를 제거합니다.</p>;
  if (props.recipe === "heic") return <p className="text-xs leading-relaxed text-muted-foreground">SDR 8-bit 첫 프레임을 JPEG·WebP로 변환합니다. HDR gain map과 Live Photo 영상은 제외합니다.</p>;
  return null;
}

function Range({ label, value, onChange, min = 0, max = 100, suffix }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; suffix: string }) {
  return <label className="block text-sm"><span className="flex justify-between"><span>{label}</span><span className="font-mono text-xs text-muted-foreground">{value}{suffix}</span></span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-2 w-full accent-primary" /></label>;
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5" /><span>{label}</span></label>; }
function Text({ label, value, onChange, maxLength }: { label: string; value: string; onChange: (value: string) => void; maxLength: number }) { return <label className="block text-sm">{label}<input value={value} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} className={CONTROL} /></label>; }
