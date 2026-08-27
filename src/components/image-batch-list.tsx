"use client";

import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Circle,
  Eye,
  LoaderCircle,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type BatchItemStatus, formatImageBytes } from "@/lib/image/batch";
import { cn } from "@/lib/utils";

export interface ImageBatchListItem {
  id: string;
  name: string;
  bytes: number;
  status: BatchItemStatus;
  outputBytes?: number;
  error?: string;
  requestId?: string;
}

interface ImageBatchListProps {
  items: readonly ImageBatchListItem[];
  activeId: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}

const STATUS = {
  queued: { label: "대기", icon: Circle, className: "text-muted-foreground" },
  processing: { label: "처리 중", icon: LoaderCircle, className: "text-primary" },
  succeeded: { label: "완료", icon: CheckCircle2, className: "text-emerald-500" },
  failed: { label: "실패", icon: AlertCircle, className: "text-destructive" },
  cancelled: { label: "취소", icon: Ban, className: "text-muted-foreground" },
} as const;

export function ImageBatchList({
  items,
  activeId,
  disabled,
  onSelect,
  onRemove,
  onRetry,
}: ImageBatchListProps) {
  const summary = items.reduce<Record<BatchItemStatus, number>>((counts, item) => {
    counts[item.status] += 1;
    return counts;
  }, { queued: 0, processing: 0, succeeded: 0, failed: 0, cancelled: 0 });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <CardTitle>파일 목록</CardTitle>
        <p className="font-mono text-xs text-muted-foreground" aria-live="polite">
          완료 {summary.succeeded} · 실패 {summary.failed} · 취소 {summary.cancelled} · 대기 {summary.queued}
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((item) => {
            const status = STATUS[item.status];
            const StatusIcon = status.icon;
            const canRetry = item.status === "failed" || item.status === "cancelled";
            return (
              <li
                key={item.id}
                className={cn(
                  "rounded-lg border p-3 transition-colors",
                  activeId === item.id && "border-primary/60 bg-primary/5",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <StatusIcon
                    className={cn("size-4 shrink-0", status.className, item.status === "processing" && "animate-spin")}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {status.label} · {formatImageBytes(item.bytes)}
                      {item.outputBytes !== undefined ? ` → ${formatImageBytes(item.outputBytes)}` : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => onSelect(item.id)}
                    aria-label={`${item.name} 보기`}
                  >
                    <Eye aria-hidden="true" />
                  </Button>
                  {canRetry ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={disabled}
                      onClick={() => onRetry(item.id)}
                      aria-label={`${item.name} 다시 처리`}
                    >
                      <RotateCcw aria-hidden="true" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    onClick={() => onRemove(item.id)}
                    aria-label={`${item.name} 제거`}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                {item.error ? (
                  <p className="mt-2 text-xs text-destructive">
                    {item.error}
                    {item.requestId ? <span className="mt-0.5 block font-mono">요청 ID: {item.requestId}</span> : null}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
