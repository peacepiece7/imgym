"use client";

import { AlertCircle, Download, FileText, LoaderCircle, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useObjectUrl } from "@/hooks/use-object-url";
import { authenticatedApiFetch, koreanApiError } from "@/lib/api/client";
import { DOCUMENT_PDF_LIMITS } from "@/lib/document/types";

const MAX_DOCUMENT_BYTES = DOCUMENT_PDF_LIMITS.maxMarkdownBytes;
const UTF8_ENCODER = new TextEncoder();

interface DocumentResult {
  downloadName: string;
  inputCharacters: number;
  outputBytes: number;
  pages: number;
  processingMs: number;
  renderer: string;
}

function headerNumber(headers: Headers, name: string) {
  const value = Number(headers.get(name));
  return Number.isFinite(value) ? value : 0;
}

function downloadName(headers: Headers) {
  return headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "document.pdf";
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / 1024).toFixed(value < 100 * 1024 ? 1 : 0)} KB`;
}

interface DocumentWorkspaceProps {
  apiKey: string;
  onUnauthorized: () => void;
}

export function DocumentWorkspace({ apiKey, onUnauthorized }: DocumentWorkspaceProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const fileLoadIdRef = useRef(0);
  const titleEditedRef = useRef(false);
  const [markdown, setMarkdown] = useState("");
  const [sourceName, setSourceName] = useState("document.md");
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<"ko" | "en">("ko");
  const [pageSize, setPageSize] = useState<"a4" | "letter">("a4");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [template, setTemplate] = useState<"document" | "resume">("document");
  const [includePageNumbers, setIncludePageNumbers] = useState(true);
  const [result, setResult] = useState<DocumentResult | null>(null);
  const [error, setError] = useState("");
  const [errorRequestId, setErrorRequestId] = useState("");
  const [loading, setLoading] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [pdfUrl, setPdfBlob] = useObjectUrl();
  const markdownBytes = useMemo(() => UTF8_ENCODER.encode(markdown).byteLength, [markdown]);

  useEffect(() => () => requestRef.current?.abort(), []);

  function clearResult() {
    setResult(null);
    setPdfBlob(null);
    setError("");
    setErrorRequestId("");
  }

  function changeMarkdown(value: string) {
    setMarkdown(value);
    clearResult();
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    const loadId = fileLoadIdRef.current + 1;
    fileLoadIdRef.current = loadId;
    clearResult();
    if (file.size > MAX_DOCUMENT_BYTES) {
      setError("Markdown 파일은 1MB 이하여야 합니다.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setReadingFile(true);
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (fileLoadIdRef.current !== loadId) return;
      setMarkdown(text);
      setSourceName(file.name);
      if (!titleEditedRef.current) setTitle(file.name.replace(/\.(?:md|markdown|txt)$/i, ""));
    } catch {
      if (fileLoadIdRef.current === loadId) setError("문서를 읽지 못했습니다.");
    } finally {
      if (fileLoadIdRef.current === loadId) {
        setReadingFile(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    }
  }

  async function createPdf() {
    if (!markdown.trim()) return;
    if (!apiKey) {
      setError("위에서 API 키를 입력하세요.");
      setErrorRequestId("");
      onUnauthorized();
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    let failedRequestId = "";
    setLoading(true);
    setError("");
    try {
      const sourceFile = new File([markdown], sourceName, { type: "text/markdown" });
      if (sourceFile.size > MAX_DOCUMENT_BYTES) {
        throw new Error("Markdown 내용은 UTF-8 기준 1MB 이하여야 합니다.");
      }
      const body = new FormData();
      body.set("document", sourceFile);
      body.set("options", JSON.stringify({
        title: title.trim() || sourceName.replace(/\.[^.]+$/, "") || "문서",
        lang: language,
        pageSize,
        orientation,
        template,
        includePageNumbers,
      }));
      const response = await authenticatedApiFetch(
        "/api/v1/docs-to-pdf",
        apiKey,
        { method: "POST", body, signal: controller.signal },
      );
      failedRequestId = response.headers.get("x-request-id") ?? "";
      if (response.status === 401) {
        onUnauthorized();
        throw new Error("API 키가 올바르지 않습니다.");
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(koreanApiError(payload?.error, "PDF 생성 중 오류가 발생했습니다."));
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      setPdfBlob(blob);
      setResult({
        downloadName: downloadName(response.headers),
        inputCharacters: headerNumber(response.headers, "x-input-characters"),
        outputBytes: headerNumber(response.headers, "x-output-bytes"),
        pages: headerNumber(response.headers, "x-output-pages"),
        processingMs: headerNumber(response.headers, "x-processing-ms"),
        renderer: response.headers.get("x-pdf-renderer") ?? "WeasyPrint",
      });
      setErrorRequestId("");
    } catch (caught) {
      if (controller.signal.aborted) return;
      setPdfBlob(null);
      setResult(null);
      setError(caught instanceof Error ? caught.message : "PDF 생성 중 오류가 발생했습니다.");
      setErrorRequestId(failedRequestId);
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  const fieldClassName = "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader className="gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <CardTitle>Markdown 문서</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                제목, 목록, 표, 링크, 인용문과 코드를 선택 가능한 실제 텍스트로 유지합니다.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={loading || readingFile}>
              <Upload aria-hidden="true" />
              파일 열기
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              className="sr-only"
              tabIndex={-1}
              aria-label="Markdown 파일 선택"
              onChange={(event) => void loadFile(event.target.files?.[0])}
            />
          </CardHeader>
          <CardContent>
            <label>
              <span className="sr-only">Markdown 내용</span>
              <textarea
                value={markdown}
                onChange={(event) => changeMarkdown(event.target.value)}
                disabled={loading || readingFile}
                spellCheck={false}
                aria-describedby="document-size"
                aria-invalid={markdownBytes > MAX_DOCUMENT_BYTES}
                placeholder={"# 이력서\n\n## 경력\n\n| 기간 | 역할 |\n| --- | --- |\n| 2024–현재 | 프런트엔드 개발자 |"}
                className="min-h-[34rem] w-full resize-y rounded-lg border border-input bg-background px-4 py-3 font-mono text-sm leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <div id="document-size" className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>{sourceName}</span>
              <span>{formatBytes(markdownBytes)} / 1.0 MB UTF-8</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>PDF 설정</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <label className="block text-sm font-medium">
              문서 제목
              <input
                value={title}
                onChange={(event) => {
                  titleEditedRef.current = event.target.value.trim().length > 0;
                  setTitle(event.target.value);
                  clearResult();
                }}
                maxLength={160}
                disabled={loading}
                placeholder="PDF 메타데이터에 사용됩니다"
                className={`${fieldClassName} mt-2`}
              />
            </label>
            <label className="block text-sm font-medium">
              템플릿
              <select
                value={template}
                onChange={(event) => { setTemplate(event.target.value as "document" | "resume"); clearResult(); }}
                disabled={loading}
                className={`${fieldClassName} mt-2`}
              >
                <option value="document">일반 문서</option>
                <option value="resume">이력서</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">
                용지
                <select
                  value={pageSize}
                  onChange={(event) => { setPageSize(event.target.value as "a4" | "letter"); clearResult(); }}
                  disabled={loading}
                  className={`${fieldClassName} mt-2`}
                >
                  <option value="a4">A4</option>
                  <option value="letter">레터</option>
                </select>
              </label>
              <label className="block text-sm font-medium">
                방향
                <select
                  value={orientation}
                  onChange={(event) => { setOrientation(event.target.value as "portrait" | "landscape"); clearResult(); }}
                  disabled={loading}
                  className={`${fieldClassName} mt-2`}
                >
                  <option value="portrait">세로</option>
                  <option value="landscape">가로</option>
                </select>
              </label>
            </div>
            <label className="block text-sm font-medium">
              문서 언어
              <select
                value={language}
                onChange={(event) => { setLanguage(event.target.value as "ko" | "en"); clearResult(); }}
                disabled={loading}
                className={`${fieldClassName} mt-2`}
              >
                <option value="ko">한국어</option>
                <option value="en">영어</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includePageNumbers}
                onChange={(event) => { setIncludePageNumbers(event.target.checked); clearResult(); }}
                disabled={loading}
                className="size-4 accent-primary"
              />
              페이지 번호 포함
            </label>
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={!markdown.trim() || markdownBytes > MAX_DOCUMENT_BYTES || loading || readingFile}
              onClick={createPdf}
            >
              {loading ? (
                <><LoaderCircle className="animate-spin" aria-hidden="true" />PDF 생성 중…</>
              ) : (
                <><FileText aria-hidden="true" />태그된 PDF 만들기</>
              )}
            </Button>
            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              원시 HTML, 사용자 CSS, 스크립트와 원격 이미지는 사용할 수 없습니다.
            </p>
          </CardContent>
        </Card>
      </div>

      {error ? (
        <Alert variant="destructive" className="mt-6">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>PDF를 만들지 못했습니다</AlertTitle>
          <AlertDescription>
            {error}
            {errorRequestId ? <span className="mt-1 block font-mono text-xs">요청 ID: {errorRequestId}</span> : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {result && pdfUrl ? (
        <section className="mt-8 space-y-4" aria-labelledby="pdf-preview-heading">
          <Card>
            <CardHeader className="gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div>
                <p className="font-mono text-xs uppercase tracking-widest text-primary">PDF/UA-1</p>
                <CardTitle id="pdf-preview-heading" className="mt-1">문서 미리보기</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {result.pages}페이지 · {formatBytes(result.outputBytes)} · {Math.round(result.processingMs)}ms
                </p>
              </div>
              <Button asChild size="lg" className="w-full sm:w-auto">
                <a href={pdfUrl} download={result.downloadName}>
                  <Download aria-hidden="true" />
                  PDF 다운로드
                </a>
              </Button>
            </CardHeader>
            <CardContent>
              <iframe
                src={pdfUrl}
                title="생성된 PDF 미리보기"
                className="h-[48rem] w-full rounded-lg border bg-white"
              />
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-muted-foreground">
                <span>원문 {result.inputCharacters.toLocaleString()}자</span>
                <span>{result.renderer}</span>
                <span>선택 가능한 텍스트 · 태그 구조</span>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
