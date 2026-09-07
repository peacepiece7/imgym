import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Step {
  label: string;
  done: boolean;
}

/**
 * Answers "what do I do next?" — the first step that is not done is the
 * current one, everything after it is still out of reach.
 */
export function StepProgress({ steps, label }: { steps: readonly Step[]; label: string }) {
  const current = steps.findIndex((step) => !step.done);

  return (
    <ol
      className="grid gap-1 rounded-xl bg-muted/40 p-1.5 shadow-[inset_0_0_0_1px_var(--border)] sm:grid-cols-2 lg:grid-cols-4"
      aria-label={label}
    >
      {steps.map((step, index) => {
        const active = index === current;
        const upcoming = current !== -1 && index > current;
        return (
          <li
            key={step.label}
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2.5 py-2",
              active && "bg-primary/12 shadow-[inset_0_0_0_1px_var(--color-primary)]",
            )}
          >
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                step.done && "bg-emerald-500/16 text-emerald-400",
                active && "bg-primary text-primary-foreground",
                upcoming && "text-muted-foreground/70 shadow-[inset_0_0_0_1px_var(--border)]",
              )}
            >
              {step.done ? <Check className="size-3" aria-hidden="true" /> : index + 1}
            </span>
            <span
              className={cn(
                "text-[13px]",
                active ? "font-medium text-foreground" : upcoming ? "text-muted-foreground/70" : "text-muted-foreground",
              )}
            >
              {index + 1} · {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
