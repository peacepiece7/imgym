"use client";

import { Check, KeyRound, WandSparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { setLocalApiKey } from "@/hooks/use-local-api-key";
import { TOOLS, type Tool } from "@/lib/tools";
import { cn } from "@/lib/utils";

interface AppSidebarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  apiKey: string;
  /** Controlled by the shell so an unauthorized request can open the editor. */
  editingKey: boolean;
  onEditingKeyChange: (editing: boolean) => void;
}

export function AppSidebar({ tool, onToolChange, apiKey, editingKey, onEditingKeyChange }: AppSidebarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingKey) inputRef.current?.focus();
  }, [editingKey]);

  return (
    <nav
      className="flex flex-col gap-1 border-b border-border bg-card/40 px-3 py-5 lg:h-dvh lg:sticky lg:top-0 lg:border-r lg:border-b-0"
      aria-label="도구"
    >
      <div className="flex items-center gap-2.5 px-2 pb-5">
        <div className="rounded-lg bg-primary p-[7px] text-primary-foreground">
          <WandSparkles className="size-[18px]" aria-hidden="true" />
        </div>
        <div>
          <div className="text-[15px] font-semibold tracking-tight">Oh My Img!</div>
          <div className="text-[11px] text-muted-foreground">이미지 정리 도구</div>
        </div>
      </div>

      <div className="px-2 pb-2 text-[11px] font-medium tracking-wide text-muted-foreground/80">
        무엇을 하시겠어요?
      </div>

      {TOOLS.map(({ id, label, summary, icon: Icon }) => {
        const selected = tool === id;
        return (
          <button
            key={id}
            type="button"
            aria-current={selected ? "page" : undefined}
            onClick={() => onToolChange(id)}
            className={cn(
              "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              selected ? "border-primary/50 bg-primary/10" : "border-transparent hover:bg-muted/50",
            )}
          >
            <Icon className={cn("mt-px size-4", selected ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{label}</span>
              <span className="mt-0.5 block text-[11px] leading-[1.45] text-muted-foreground">{summary}</span>
            </span>
          </button>
        );
      })}

      <div className="mt-auto flex flex-col gap-2 border-t border-border px-2 pt-3.5">
        {editingKey ? (
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <KeyRound className="size-3" aria-hidden="true" />
              열쇠
            </span>
            <input
              ref={inputRef}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(event) => setLocalApiKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "Escape") onEditingKeyChange(false);
              }}
              aria-describedby="api-key-note"
              placeholder="모든 변환에 필요합니다"
              className="h-8 w-full rounded-lg border border-input bg-background px-2.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex gap-1.5">
              <Button type="button" size="xs" variant="outline" onClick={() => onEditingKeyChange(false)}>
                완료
              </Button>
              {apiKey ? (
                <Button type="button" size="xs" variant="ghost" onClick={() => setLocalApiKey("")}>
                  지우기
                </Button>
              ) : null}
            </div>
          </label>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  "grid size-5 place-items-center rounded-full",
                  apiKey ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-300",
                )}
              >
                {apiKey ? <Check className="size-3" aria-hidden="true" /> : <KeyRound className="size-3" aria-hidden="true" />}
              </span>
              <span>{apiKey ? "사용 준비 완료" : "열쇠가 필요합니다"}</span>
            </div>
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="self-start text-muted-foreground"
              onClick={() => onEditingKeyChange(true)}
            >
              <KeyRound aria-hidden="true" />
              {apiKey ? "열쇠 바꾸기" : "열쇠 입력하기"}
            </Button>
          </>
        )}
        <p id="api-key-note" className="text-[11px] leading-relaxed text-muted-foreground">
          이 브라우저에만 저장된 열쇠로 연결했습니다. 올린 파일은 작업이 끝나면 지워집니다.
        </p>
      </div>
    </nav>
  );
}
