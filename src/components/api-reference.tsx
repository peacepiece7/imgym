"use client";

import {
  Activity,
  ArrowLeft,
  Braces,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileJson,
  KeyRound,
  Search,
  Server,
  ShieldCheck,
  Terminal,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  API_BASE_PATH,
  API_ENDPOINTS,
  API_REFERENCE_VERSION,
  API_TAGS,
  INTERNAL_API_ROUTES,
  type ApiEndpointDoc,
  type ApiTag,
} from "@/lib/api/docs";
import { cn } from "@/lib/utils";

const TAG_LABELS: Record<ApiTag, string> = {
  System: "시스템",
  Inspect: "검사",
  Build: "팩 생성",
  Optimize: "최적화",
  Convert: "변환",
};

const COMMON_STATUSES = [
  ["200", "완료", "요청 처리 또는 변환이 완료되었습니다."],
  ["400", "잘못된 요청", "multipart 필드, JSON 옵션 또는 입력 형식이 올바르지 않습니다."],
  ["401", "인증 실패", "Bearer 키가 없거나 서버 키와 일치하지 않습니다."],
  ["413", "크기 초과", "파일 또는 전체 요청이 엔드포인트 제한을 넘었습니다."],
  ["422", "처리 불가", "입력은 읽었지만 유효한 산출물을 만들 수 없습니다."],
  ["429", "처리 중", "변환 슬롯이 가득 찼습니다. Retry-After: 1을 따릅니다."],
  ["500", "처리 실패", "서버 처리 중 예상하지 못한 오류가 발생했습니다."],
  ["503", "설정 오류", "서버의 OHMYIMG_API_KEY 설정이 올바르지 않습니다."],
] as const;

function CopyButton({ value, label = "복사" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-[11px] font-medium text-stone-300 transition hover:border-orange-400/40 hover:bg-orange-400/10 hover:text-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60"
      aria-label={`${label} 클립보드에 복사`}
    >
      {copied ? <Check className="size-3 text-emerald-400" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
      {copied ? "복사됨" : label}
    </button>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b0b0a]">
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">{label}</span>
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto p-4 text-[12px] leading-6 text-stone-300 selection:bg-orange-400/30">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function MethodBadge({ method, compact = false }: { method: ApiEndpointDoc["method"]; compact?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border font-mono font-semibold tracking-[0.1em]",
        compact ? "h-5 min-w-10 px-1.5 text-[9px]" : "h-7 min-w-14 px-2 text-[11px]",
        method === "GET"
          ? "border-sky-400/30 bg-sky-400/10 text-sky-300"
          : "border-orange-400/30 bg-orange-400/10 text-orange-300",
      )}
    >
      {method}
    </span>
  );
}

function EndpointCard({ endpoint, baseUrl }: { endpoint: ApiEndpointDoc; baseUrl: string }) {
  const curl = endpoint.curl.replace("${BASE_URL}", baseUrl);

  return (
    <details
      id={endpoint.id}
      className="api-endpoint group scroll-mt-24 overflow-hidden rounded-2xl border border-white/10 bg-[#181714]/90 shadow-[0_24px_80px_rgba(0,0,0,.16)] open:border-orange-300/25"
    >
      <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-4 outline-none transition hover:bg-white/[0.025] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-400/60 sm:p-5 [&::-webkit-details-marker]:hidden">
        <MethodBadge method={endpoint.method} />
        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <code className="break-all font-mono text-[13px] font-medium text-stone-100 sm:text-[14px]">{endpoint.path}</code>
            <span className="text-xs text-stone-500">{TAG_LABELS[endpoint.tag]}</span>
          </span>
          <span className="mt-1.5 block text-sm text-stone-400">{endpoint.summary}</span>
        </span>
        <ChevronDown className="size-4 text-stone-500 transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
      </summary>

      <div className="border-t border-white/8 px-4 py-5 sm:px-5 sm:py-6">
        <div className="mb-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-orange-300">Operation</span>
              <span className="text-[10px] text-stone-600">/</span>
              <span className="text-[11px] text-stone-500">{endpoint.title}</span>
            </div>
            <p className="max-w-3xl text-sm leading-7 text-stone-300">{endpoint.description}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.025] p-3.5">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">Limits</div>
            <ul className="space-y-1.5">
              {endpoint.limits.map((limit) => (
                <li key={limit} className="flex gap-2 text-xs leading-5 text-stone-300">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-orange-400" aria-hidden="true" />
                  {limit}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <section aria-labelledby={`${endpoint.id}-request`}>
            <h3 id={`${endpoint.id}-request`} className="mb-3 flex items-center gap-2 text-sm font-semibold text-stone-100">
              <Braces className="size-4 text-orange-300" aria-hidden="true" />
              요청
            </h3>
            {endpoint.fields.length ? (
              <div className="overflow-hidden rounded-xl border border-white/10">
                <div className="hidden grid-cols-[8rem_7rem_7rem_minmax(0,1fr)] border-b border-white/8 bg-white/[0.025] px-3 py-2 font-mono text-[9px] uppercase tracking-[0.16em] text-stone-500 sm:grid">
                  <span>Field</span><span>Type</span><span>Required</span><span>Description</span>
                </div>
                {endpoint.fields.map((field) => (
                  <div key={field.name} className="grid gap-1 border-b border-white/7 px-3 py-3 last:border-b-0 sm:grid-cols-[8rem_7rem_7rem_minmax(0,1fr)] sm:gap-0">
                    <code className="font-mono text-xs font-medium text-orange-200">{field.name}</code>
                    <span className="font-mono text-[11px] text-stone-400">{field.type}</span>
                    <span className="text-[11px] text-stone-400">{field.required}</span>
                    <span className="text-xs leading-5 text-stone-300">{field.description}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-stone-400">요청 본문과 인증이 필요하지 않습니다.</div>
            )}
            {endpoint.example ? <div className="mt-3"><CodeBlock code={endpoint.example} label="options · JSON before serialization" /></div> : null}
          </section>

          <section aria-labelledby={`${endpoint.id}-response`}>
            <h3 id={`${endpoint.id}-response`} className="mb-3 flex items-center gap-2 text-sm font-semibold text-stone-100">
              <Server className="size-4 text-emerald-300" aria-hidden="true" />
              응답
            </h3>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 font-mono text-[10px] font-semibold text-emerald-300">200</span>
                <code className="font-mono text-[11px] text-stone-300">{endpoint.responseType}</code>
              </div>
              <p className="text-xs leading-6 text-stone-300">{endpoint.responseDescription}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {endpoint.responseHeaders.map((header) => (
                  <code key={header} className="rounded-md border border-white/8 bg-black/20 px-2 py-1 font-mono text-[9px] text-stone-400">{header}</code>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className="mt-6">
          <CodeBlock code={curl} label="curl · ready to adapt" />
        </div>
      </div>
    </details>
  );
}

export function ApiReference() {
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<ApiTag | "All">("All");
  const [baseUrl, setBaseUrl] = useState(`https://dev.margins.cloud${API_BASE_PATH}`);

  const filteredEndpoints = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko");
    return API_ENDPOINTS.filter((endpoint) => {
      if (activeTag !== "All" && endpoint.tag !== activeTag) return false;
      if (!normalized) return true;
      return [endpoint.path, endpoint.title, endpoint.summary, endpoint.description, endpoint.tag]
        .join(" ")
        .toLocaleLowerCase("ko")
        .includes(normalized);
    });
  }, [activeTag, query]);

  return (
    <div className="api-reference-grid min-h-dvh bg-[#11100e] text-stone-100">
      <header className="sticky top-0 z-40 border-b border-white/8 bg-[#11100e]/88 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[94rem] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-orange-400 text-stone-950 transition hover:bg-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#11100e]"
              aria-label="Oh My Img! 도구로 돌아가기"
            >
              <WandSparkles className="size-4" aria-hidden="true" />
            </Link>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold tracking-tight text-stone-100">Oh My Img! <span className="font-normal text-stone-500">/ API Reference</span></div>
              <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-orange-300/80">Field manual · v{API_REFERENCE_VERSION}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`${API_BASE_PATH}/api/openapi`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.035] px-2.5 text-xs font-medium text-stone-300 transition hover:border-orange-400/40 hover:text-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60"
            >
              <FileJson className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">OpenAPI JSON</span>
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
            <Link
              href="/"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-stone-400 transition hover:bg-white/5 hover:text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">도구로 돌아가기</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[94rem] px-4 pb-24 pt-10 sm:px-6 sm:pt-16">
        <section className="relative overflow-hidden border-b border-white/10 pb-12 sm:pb-16">
          <div className="pointer-events-none absolute -right-4 -top-14 hidden font-mono text-[12rem] font-black leading-none tracking-[-0.09em] text-white/[0.018] lg:block" aria-hidden="true">API</div>
          <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-end">
            <div>
              <div className="mb-5 flex items-center gap-3">
                <span className="h-px w-10 bg-orange-400" aria-hidden="true" />
                <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-orange-300">External interface / 01</span>
              </div>
              <h1 className="max-w-4xl text-balance text-4xl font-semibold leading-[1.04] tracking-[-0.045em] text-stone-50 sm:text-6xl">
                이미지 파이프라인을<br className="hidden sm:block" /> 코드에서 호출하세요.
              </h1>
              <p className="mt-6 max-w-2xl text-sm leading-7 text-stone-400 sm:text-base">
                실제 운영 라우트에서 외부 연동 가치가 있는 기능만 추렸습니다. 요청은 동기식이고, 업로드와 결과는 작업이 끝나면 서버에서 제거됩니다.
              </p>
            </div>
            <div className="grid grid-cols-3 divide-x divide-white/8 rounded-2xl border border-white/10 bg-[#181714]/80 p-1">
              {[["8", "변환 API"], ["1", "상태 API"], ["v1", "안정 버전"]].map(([value, label]) => (
                <div key={label} className="px-3 py-4 text-center">
                  <div className="font-mono text-xl font-semibold text-orange-300">{value}</div>
                  <div className="mt-1 text-[10px] text-stone-500">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="quickstart" className="grid scroll-mt-24 gap-5 border-b border-white/10 py-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,.65fr)]">
          <div className="rounded-2xl border border-orange-300/20 bg-[linear-gradient(135deg,rgba(251,146,60,.10),rgba(255,255,255,.015)_52%)] p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-orange-300/25 bg-orange-400/10 text-orange-300">
                <KeyRound className="size-4" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-semibold">하나의 Bearer 키로 인증합니다</h2>
                <p className="mt-1.5 text-xs leading-6 text-stone-400">헬스 체크를 제외한 모든 API에 서버의 <code className="font-mono text-orange-200">OHMYIMG_API_KEY</code>와 같은 키를 보냅니다. URL이나 multipart 필드에는 키를 넣지 마세요.</p>
              </div>
            </div>
            <div className="mt-5 rounded-xl border border-white/10 bg-black/25 p-1.5">
              <label htmlFor="api-base-url" className="block px-2 pb-1.5 pt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-stone-500">Base URL</label>
              <div className="flex items-center gap-2">
                <input
                  id="api-base-url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value.replace(/\/$/, ""))}
                  spellCheck={false}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-white/8 bg-[#0c0c0b] px-3 font-mono text-xs text-stone-200 outline-none focus:border-orange-400/50 focus:ring-2 focus:ring-orange-400/15"
                />
                <CopyButton value={baseUrl} label="URL" />
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="flex gap-3 rounded-2xl border border-white/10 bg-[#181714]/80 p-4">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden="true" />
              <div><div className="text-xs font-medium text-stone-200">저장하지 않음</div><p className="mt-1 text-[11px] leading-5 text-stone-500">입력과 결과는 요청별 임시 공간에서 처리 후 제거됩니다.</p></div>
            </div>
            <div className="flex gap-3 rounded-2xl border border-white/10 bg-[#181714]/80 p-4">
              <Activity className="mt-0.5 size-4 shrink-0 text-sky-300" aria-hidden="true" />
              <div><div className="text-xs font-medium text-stone-200">동기식 처리</div><p className="mt-1 text-[11px] leading-5 text-stone-500">기본 동시 작업은 프로세스당 1개이며 바쁠 때 429를 반환합니다.</p></div>
            </div>
          </div>
        </section>

        <div className="grid gap-10 pt-10 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pr-4">
              <div className="mb-4 font-mono text-[9px] uppercase tracking-[0.22em] text-stone-600">Index</div>
              <nav aria-label="API 문서 목차" className="space-y-1">
                <a href="#operations" className="block rounded-md px-2 py-1.5 text-xs text-stone-400 transition hover:bg-white/5 hover:text-stone-100">엔드포인트</a>
                {API_ENDPOINTS.map((endpoint) => (
                  <a key={endpoint.id} href={`#${endpoint.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-stone-500 transition hover:bg-white/5 hover:text-stone-200">
                    <MethodBadge method={endpoint.method} compact />
                    <span className="truncate font-mono">{endpoint.path.replace("/api/v1/", "")}</span>
                  </a>
                ))}
                <a href="#status-codes" className="mt-2 block rounded-md px-2 py-1.5 text-xs text-stone-400 transition hover:bg-white/5 hover:text-stone-100">상태 코드</a>
                <a href="#internal-routes" className="block rounded-md px-2 py-1.5 text-xs text-stone-400 transition hover:bg-white/5 hover:text-stone-100">내부 전용 라우트</a>
              </nav>
            </div>
          </aside>

          <div className="min-w-0">
            <section id="operations" className="scroll-mt-24">
              <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-orange-300">02 / Operations</div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight">엔드포인트</h2>
                  <p className="mt-1.5 text-xs leading-6 text-stone-500">경로를 펼치면 요청 필드, 제한, 응답과 실행 예시를 볼 수 있습니다.</p>
                </div>
                <div className="relative w-full xl:w-72">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-stone-600" aria-hidden="true" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="경로 또는 기능 검색"
                    className="h-10 w-full rounded-xl border border-white/10 bg-[#181714] pl-9 pr-3 text-xs text-stone-200 outline-none placeholder:text-stone-600 focus:border-orange-400/45 focus:ring-2 focus:ring-orange-400/10"
                    aria-label="API 엔드포인트 검색"
                  />
                </div>
              </div>

              <div className="mb-5 flex flex-wrap gap-2" aria-label="API 분류 필터">
                <button type="button" onClick={() => setActiveTag("All")} className={cn("rounded-full border px-3 py-1.5 text-[11px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60", activeTag === "All" ? "border-orange-300/35 bg-orange-400/12 text-orange-200" : "border-white/10 text-stone-500 hover:text-stone-200")}>전체 <span className="ml-1 font-mono opacity-60">{API_ENDPOINTS.length}</span></button>
                {API_TAGS.map((tag) => {
                  const count = API_ENDPOINTS.filter((endpoint) => endpoint.tag === tag).length;
                  return <button key={tag} type="button" onClick={() => setActiveTag(tag)} className={cn("rounded-full border px-3 py-1.5 text-[11px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60", activeTag === tag ? "border-orange-300/35 bg-orange-400/12 text-orange-200" : "border-white/10 text-stone-500 hover:text-stone-200")}>{TAG_LABELS[tag]} <span className="ml-1 font-mono opacity-60">{count}</span></button>;
                })}
              </div>

              <div className="space-y-3">
                {filteredEndpoints.map((endpoint) => <EndpointCard key={endpoint.id} endpoint={endpoint} baseUrl={baseUrl} />)}
                {filteredEndpoints.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/12 px-5 py-16 text-center">
                    <Search className="mx-auto size-5 text-stone-600" aria-hidden="true" />
                    <p className="mt-3 text-sm text-stone-400">조건에 맞는 엔드포인트가 없습니다.</p>
                    <button type="button" onClick={() => { setQuery(""); setActiveTag("All"); }} className="mt-3 text-xs text-orange-300 hover:underline">필터 초기화</button>
                  </div>
                ) : null}
              </div>
            </section>

            <section id="status-codes" className="scroll-mt-24 border-t border-white/10 pt-12 mt-14">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-orange-300">03 / Responses</div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">공통 상태 코드</h2>
              <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-[#181714]/85">
                {COMMON_STATUSES.map(([status, title, description]) => (
                  <div key={status} className="grid gap-2 border-b border-white/7 px-4 py-3.5 last:border-b-0 sm:grid-cols-[4rem_7rem_minmax(0,1fr)] sm:items-center">
                    <code className={cn("font-mono text-xs font-semibold", status === "200" ? "text-emerald-300" : status.startsWith("4") ? "text-amber-300" : "text-rose-300")}>{status}</code>
                    <span className="text-xs font-medium text-stone-300">{title}</span>
                    <span className="text-xs leading-5 text-stone-500">{description}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-5 text-stone-600">모든 변환 응답에는 <code className="font-mono">Cache-Control: no-store</code>와 <code className="font-mono">X-Request-Id</code>가 포함됩니다.</p>
            </section>

            <section id="internal-routes" className="scroll-mt-24 border-t border-white/10 pt-12 mt-14">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-orange-300">04 / Boundary</div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">내부 UI 전용 라우트</h2>
              <div className="mt-5 rounded-2xl border border-white/10 bg-[#181714]/85 p-5">
                <p className="text-sm leading-7 text-stone-400">아래 미리보기 라우트는 브라우저 UI가 최종 ZIP 생성 전에 대표 결과를 보여주기 위해 사용합니다. 호출은 가능하지만 외부 연동용 안정 계약에는 포함하지 않습니다.</p>
                <div className="mt-4 flex flex-col gap-2">
                  {INTERNAL_API_ROUTES.map((route) => (
                    <div key={route} className="flex items-center gap-3 rounded-lg border border-white/8 bg-black/20 px-3 py-2.5">
                      <MethodBadge method="POST" compact />
                      <code className="break-all font-mono text-xs text-stone-400">{route}</code>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <footer className="mt-16 flex flex-col gap-3 border-t border-white/10 pt-7 text-[11px] text-stone-600 sm:flex-row sm:items-center sm:justify-between">
              <span>Oh My Img! API · OpenAPI 3.1 · v{API_REFERENCE_VERSION}</span>
              <span className="flex items-center gap-1.5"><Terminal className="size-3" aria-hidden="true" /> 요청 본문은 multipart/form-data</span>
            </footer>
          </div>
        </div>
      </main>
    </div>
  );
}
