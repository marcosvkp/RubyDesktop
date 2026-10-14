import { useState } from "react";
import { ChevronRight, CircleCheck, CircleX, LoaderCircle, Terminal } from "lucide-react";
import type { ChatItem } from "../store";
import { cn } from "../lib/utils";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

/**
 * One tool call, collapsed by default.
 *
 * Status is carried by an icon *and* a colour, never colour alone — the pink/green
 * distinction is not reliable for everyone, and the palette's muted tones make it
 * less so.
 */
export function ToolCallCard({ item }: { item: ToolItem }): React.JSX.Element {
  const [open, setOpen] = useState(false);

  const StatusIcon =
    item.status === "running" ? LoaderCircle : item.status === "ok" ? CircleCheck : CircleX;
  const statusColor =
    item.status === "running"
      ? "text-chart-3"
      : item.status === "ok"
        ? "text-chart-5"
        : "text-destructive";
  const statusLabel =
    item.status === "running"
      ? "em andamento"
      : item.status === "ok"
        ? "concluído"
        : item.status === "denied"
          ? "negado"
          : "falhou";

  const args = formatArgs(item.args, 120);
  const expandedArgs = formatArgs(item.args, 16_000);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[0.03]"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/15">
          <Terminal className="h-3 w-3 text-primary" />
        </span>
        <span className="font-mono text-xs font-medium text-foreground">{item.name}</span>
        {args && !open ? (
          <span className="truncate font-mono text-[11px] text-muted-foreground">{args}</span>
        ) : null}
        <span className="flex-1" />
        <StatusIcon
          className={cn("h-3.5 w-3.5 shrink-0", statusColor, item.status === "running" && "animate-spin")}
        />
        <span className={cn("text-[10px] tracking-wide", statusColor)}>{statusLabel}</span>
      </button>

      {open ? (
        <div className="border-t border-line">
          {args ? (
            <pre className="overflow-x-auto border-b border-line px-3 py-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
              {expandedArgs}
            </pre>
          ) : null}
          {item.result ? (
            <pre className="max-h-80 overflow-auto px-3 py-2 font-mono text-[11px] whitespace-pre-wrap text-copy-muted">
              {item.result}
            </pre>
          ) : (
            <div className="px-3 py-2 font-mono text-[11px] text-muted-foreground">em andamento…</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Renders tool arguments as a single compact line. */
function formatArgs(args: unknown, maxValueChars: number): string {
  if (args === null || args === undefined) return "";
  const clip = (value: string): string => value.length > maxValueChars
    ? `${value.slice(0, maxValueChars)}… (${value.length - maxValueChars} caracteres omitidos)`
    : value;
  if (typeof args === "string") return clip(args);
  if (typeof args !== "object") return clip(String(args));
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return "";
  return entries
    .map(([key, value]) => {
      const rendered =
        typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
      const clipped = clip(rendered);
      return `${key}: ${clipped}`;
    })
    .join("  ");
}
