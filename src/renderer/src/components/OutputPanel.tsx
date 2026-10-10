import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { cn, formatTokens } from "../lib/utils";
import type { MetricLine } from "@shared/ipc";

/**
 * The agent output panel.
 *
 * This is the app's "terminal" — a decision recorded in PLANO.md: the CLI's
 * terminal is an interactive PTY, but an agent workspace mostly needs to show what
 * the agent *did*. So this streams telemetry per call rather than pretending to be
 * a shell: token counts and latency per model call, duration and output size per
 * tool call, and any guard the engine tripped.
 *
 * It reads the engine's observability stream, not the transcript. That separation
 * is why the panel can show things the conversation has no place for — and why it
 * stays useful when the model is mid-turn with nothing to say yet.
 */
export function OutputPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const metrics = useStore((s) => s.metrics);
  const busy = useStore((s) => s.busy);
  const endRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow the tail, but only while the user has not scrolled up to read history.
  useEffect(() => {
    if (pinned.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [metrics.length]);

  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-line bg-background">
      <header className="flex items-center gap-2 px-4 py-1.5">
        <span className="eyebrow">Output</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {metrics.length} event{metrics.length === 1 ? "" : "s"}
        </span>
        {busy ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-chart-3" /> : null}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          Hide
        </button>
      </header>

      <div
        className="flex-1 overflow-auto px-4 pb-3 font-mono text-[11px] leading-relaxed"
        onScroll={(event) => {
          const el = event.currentTarget;
          // 24px of slack so a near-bottom scroll still counts as pinned.
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {metrics.length === 0 ? (
          <p className="text-muted-foreground">
            Nothing yet. Model and tool activity appears here as the agent works.
          </p>
        ) : (
          metrics.map((line, index) => <MetricRow key={index} line={line} />)
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function MetricRow({ line }: { line: MetricLine }): React.JSX.Element {
  switch (line.kind) {
    case "llm": {
      const ttft =
        line.firstTokenLatencyMs === undefined
          ? "—"
          : `${formatMs(line.firstTokenLatencyMs)} first token`;
      return (
        <div className="flex gap-3 whitespace-pre">
          <Tag className="text-chart-4">model</Tag>
          <span className="text-foreground/80">{line.model}</span>
          <span className="text-muted-foreground">
            {formatTokens(line.inputTokens)} in · {formatTokens(line.outputTokens)} out ·{" "}
            {formatMs(line.latencyMs)} · {ttft}
          </span>
        </div>
      );
    }

    case "tool":
      return (
        <div className="flex gap-3 whitespace-pre">
          <Tag className={line.success ? "text-chart-5" : "text-destructive"}>
            {line.success ? "tool " : "fail "}
          </Tag>
          <span className="text-foreground/80">{line.name}</span>
          <span className="text-muted-foreground">
            {formatMs(line.latencyMs)} · {formatBytes(line.outputBytes)}
          </span>
        </div>
      );

    case "denied":
      return (
        <div className="flex gap-3 whitespace-pre">
          <Tag className="text-chart-3">deny</Tag>
          <span className="text-foreground/80">{line.name}</span>
          <span className="text-muted-foreground">{line.reason}</span>
        </div>
      );

    case "guard":
      return (
        <div className="flex gap-3 whitespace-pre">
          <Tag className="text-destructive">stop</Tag>
          <span className="text-foreground/80">{line.guard}</span>
          <span className="text-muted-foreground">{line.reason}</span>
        </div>
      );

    case "compact":
      return (
        <div className="flex gap-3 whitespace-pre">
          <Tag className="text-chart-1">ctx </Tag>
          <span className="text-foreground/80">{line.trigger}</span>
          <span className="text-muted-foreground">{line.detail}</span>
        </div>
      );
  }
}

function Tag({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return <span className={cn("shrink-0 tracking-wide uppercase", className)}>{children}</span>;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
