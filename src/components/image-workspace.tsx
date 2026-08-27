"use client";

import { Code2, Crop, FileText, KeyRound, WandSparkles } from "lucide-react";
import { useRef, useState } from "react";
import { DocumentWorkspace } from "@/components/document-workspace";
import { RasterWorkspace } from "@/components/raster-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VectorWorkspace } from "@/components/vector-workspace";
import { setLocalApiKey, useLocalApiKey } from "@/hooks/use-local-api-key";

type Tool = "raster" | "vector" | "document";

export function ImageWorkspace() {
  const [tool, setTool] = useState<Tool>("raster");
  const apiKey = useLocalApiKey();
  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  function focusApiKey() {
    apiKeyInputRef.current?.focus();
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <header className="mb-8 flex items-start justify-between gap-6">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <div className="rounded-lg bg-primary p-2 text-primary-foreground">
              <WandSparkles className="size-5" aria-hidden="true" />
            </div>
            <Badge variant="outline" className="font-mono">개인용 도구</Badge>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Oh My Img!</h1>
          <p className="mt-2 max-w-xl text-base text-muted-foreground sm:text-lg">
            이미지를 최적화하고 SVG를 만들거나 Markdown 문서를 PDF로 변환합니다.
          </p>
        </div>
        <div className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
          <Code2 className="size-4" aria-hidden="true" />
          로컬 이미지 파이프라인
        </div>
      </header>

      <section className="mb-6 rounded-xl border bg-card/60 p-4" aria-labelledby="api-key-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1">
            <span id="api-key-heading" className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="size-4" aria-hidden="true" />
              API 키
            </span>
            <input
              ref={apiKeyInputRef}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(event) => setLocalApiKey(event.target.value)}
              aria-describedby="api-key-description"
              placeholder="모든 변환 요청에 필요합니다"
              className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          {apiKey ? (
            <Button type="button" variant="outline" onClick={() => setLocalApiKey("")}>
              키 지우기
            </Button>
          ) : null}
        </div>
        <p id="api-key-description" className="mt-2 text-xs leading-relaxed text-muted-foreground">
          이 브라우저의 localStorage에 저장되며 각 API 호출마다 Bearer 인증 정보로 전송됩니다.
        </p>
      </section>

      <nav className="mb-6 flex flex-wrap gap-2" aria-label="변환 도구">
        <Button
          type="button"
          variant={tool === "raster" ? "default" : "outline"}
          aria-pressed={tool === "raster"}
          onClick={() => setTool("raster")}
        >
          <Crop aria-hidden="true" />
          래스터 최적화
        </Button>
        <Button
          type="button"
          variant={tool === "vector" ? "default" : "outline"}
          aria-pressed={tool === "vector"}
          onClick={() => setTool("vector")}
        >
          <WandSparkles aria-hidden="true" />
          SVG 만들기
        </Button>
        <Button
          type="button"
          variant={tool === "document" ? "default" : "outline"}
          aria-pressed={tool === "document"}
          onClick={() => setTool("document")}
        >
          <FileText aria-hidden="true" />
          문서를 PDF로
        </Button>
      </nav>

      {tool === "raster" ? (
        <RasterWorkspace apiKey={apiKey} onUnauthorized={focusApiKey} />
      ) : tool === "vector" ? (
        <VectorWorkspace apiKey={apiKey} onUnauthorized={focusApiKey} />
      ) : (
        <DocumentWorkspace apiKey={apiKey} onUnauthorized={focusApiKey} />
      )}
    </main>
  );
}
