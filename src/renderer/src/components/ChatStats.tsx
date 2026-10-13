import { useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, Database, Gauge, Timer } from "lucide-react";
import { useStore, type ChatItem } from "../store";
import { cn, formatTokens } from "../lib/utils";

type StatKey = "session" | "tokens" | "cache" | "context";

/** Clickable chat-footer metrics, with details kept close to the composer. */
export function ChatStats(): React.JSX.Element {
  const items = useStore((s) => s.items);
  const usage = useStore((s) => s.sessionUsage);
  const contextUsed = useStore((s) => s.contextUsed);
  const contextWindow = useStore((s) => s.contextWindow);
  const [openStat, setOpenStat] = useState<StatKey | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openStat) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenStat(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpenStat(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openStat]);

  const turns = items.filter(
    (item): item is Extract<ChatItem, { kind: "user" }> =>
      item.kind === "user" && !item.text.trimStart().startsWith("/"),
  ).length;
  const steps = items.filter((item) => item.kind === "tool").length;
  const totalTokens = usage.inputTokens + usage.outputTokens;
  const hasCache = usage.cacheMeasuredCalls > 0 && usage.cacheMeasuredInputTokens > 0;
  const cacheHit = hasCache
    ? Math.round((usage.cachedInputTokens / usage.cacheMeasuredInputTokens) * 100)
    : undefined;
  const rate = usage.generationTimeMs > 0
    ? Math.round((usage.outputTokens / usage.generationTimeMs) * 1000)
    : undefined;
  const contextRatio = contextWindow > 0 ? Math.min(contextUsed / contextWindow, 1) : 0;
  const contextPercent = Math.round(contextRatio * 100);
  const cacheCoveragePartial = usage.cacheMeasuredCalls > 0 && usage.cacheMeasuredCalls < usage.llmCalls;

  return (
    <div ref={rootRef} className="mt-2 flex flex-wrap items-center justify-center gap-1.5 px-1">
      <StatButton
        id="session"
        open={openStat === "session"}
        onToggle={() => setOpenStat(openStat === "session" ? null : "session")}
        icon={<Gauge className="h-3.5 w-3.5" />}
        summary={`${turns} ${turns === 1 ? "turno" : "turnos"} · ${steps} ${steps === 1 ? "etapa" : "etapas"}${rate === undefined ? "" : ` · ${rate} tok/s`}`}
        align="left"
      >
        <PopoverTitle icon={<Activity className="h-3.5 w-3.5" />}>Estatísticas da conversa</PopoverTitle>
        <DetailRow label="Turnos enviados" value={String(turns)} />
        <DetailRow label="Etapas de ferramenta" value={String(steps)} />
        <DetailRow label="Chamadas ao modelo" value={String(usage.llmCalls)} />
        <DetailRow label="Tempo do modelo" value={formatDuration(usage.llmTimeMs)} />
        <DetailRow label="Tempo das ferramentas" value={formatDuration(usage.toolTimeMs)} />
        <DetailRow
          label="Tempo médio até o primeiro token"
          value={usage.firstTokenSamples ? formatDuration(usage.firstTokenLatencyTotalMs / usage.firstTokenSamples) : "—"}
        />
        <DetailRow label="Velocidade média de geração" value={rate === undefined ? "—" : `${rate} tok/s`} />
        {usage.llmCalls === 0 ? <PopoverHint>As métricas começam a contar nas respostas recebidas nesta execução. O histórico da conversa foi preservado, mas o engine não grava telemetria de uso nas sessões antigas.</PopoverHint> : null}
      </StatButton>

      <StatButton
        id="tokens"
        open={openStat === "tokens"}
        onToggle={() => setOpenStat(openStat === "tokens" ? null : "tokens")}
        icon={<Database className="h-3.5 w-3.5" />}
        summary={usage.llmCalls ? `${formatTokens(totalTokens)} tok` : "tokens —"}
        align="center"
      >
        <PopoverTitle icon={<Database className="h-3.5 w-3.5" />}>Uso de tokens</PopoverTitle>
        <DetailRow label="Total informado pelo provider" value={`${formatNumber(totalTokens)} tok`} strong />
        <DetailRow label="Entrada" value={`${formatNumber(usage.inputTokens)} tok`} />
        <DetailRow label="Saída" value={`${formatNumber(usage.outputTokens)} tok`} />
        <DetailRow label="Chamadas ao modelo" value={String(usage.llmCalls)} />
        <PopoverHint>O total soma os tokens de entrada e saída informados pelo provider durante esta execução.</PopoverHint>
      </StatButton>

      <StatButton
        id="cache"
        open={openStat === "cache"}
        onToggle={() => setOpenStat(openStat === "cache" ? null : "cache")}
        icon={<Database className="h-3.5 w-3.5" />}
        summary={cacheHit === undefined ? "cache —" : `cache ${cacheHit}%`}
        align="center"
      >
        <PopoverTitle icon={<Database className="h-3.5 w-3.5" />}>Cache de entrada</PopoverTitle>
        {hasCache ? (
          <>
            <DetailRow label="Cache hit" value={`${cacheHit}%`} strong />
            <DetailRow label="Tokens em cache" value={`${formatNumber(usage.cachedInputTokens)} tok`} />
            <DetailRow label="Entrada com dado de cache" value={`${formatNumber(usage.cacheMeasuredInputTokens)} tok`} />
            <DetailRow label="Chamadas com dado" value={`${usage.cacheMeasuredCalls} / ${usage.llmCalls}`} />
            {cacheCoveragePartial ? <PopoverHint>O provider não informou cache em todas as chamadas; o percentual considera apenas as chamadas com esse dado.</PopoverHint> : null}
          </>
        ) : (
          <PopoverHint>Este provider ainda não informou tokens em cache para as chamadas desta conversa.</PopoverHint>
        )}
      </StatButton>

      <StatButton
        id="context"
        open={openStat === "context"}
        onToggle={() => setOpenStat(openStat === "context" ? null : "context")}
        icon={<Timer className="h-3.5 w-3.5" />}
        summary={contextWindow > 0 ? `janela ${contextPercent}%` : "janela —"}
        progress={contextWindow > 0 ? contextPercent : undefined}
        align="right"
      >
        <PopoverTitle icon={<Timer className="h-3.5 w-3.5" />}>Uso da janela de contexto</PopoverTitle>
        <DetailRow label="Histórico estimado" value={`${formatNumber(contextUsed)} tok`} strong />
        <DetailRow label="Janela do modelo" value={contextWindow ? `${formatNumber(contextWindow)} tok` : "—"} />
        <DetailRow label="Uso estimado" value={`${contextPercent}%`} />
        <div className="my-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className={cn("h-full rounded-full transition-all", contextPercent >= 75 ? "bg-destructive" : contextPercent >= 60 ? "bg-chart-3" : "bg-chart-5")} style={{ width: `${contextPercent}%` }} />
        </div>
        <PopoverHint>Estimativa das mensagens serializadas. O prompt de sistema e as definições de ferramentas não são discriminados pelo engine nesta versão. A compactação automática começa perto de 75%.</PopoverHint>
      </StatButton>
    </div>
  );
}

function StatButton({
  id,
  open,
  onToggle,
  icon,
  summary,
  align,
  progress,
  children,
}: {
  id: StatKey;
  open: boolean;
  onToggle: () => void;
  icon: ReactNode;
  summary: string;
  align: "left" | "center" | "right";
  progress?: number;
  children: ReactNode;
}): React.JSX.Element {
  const alignClass = align === "right" ? "right-0" : align === "center" ? "left-1/2 -translate-x-1/2" : "left-0";
  return (
    <div className="relative">
      <button
        type="button"
        data-testid={`chat-stat-${id}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          open ? "border-primary/30 bg-primary/10 text-foreground" : "border-transparent text-muted-foreground hover:border-line hover:bg-white/[0.035] hover:text-foreground",
        )}
      >
        <span className={open ? "text-primary" : "text-muted-foreground"}>{icon}</span>
        <span className="whitespace-nowrap">{summary}</span>
        {progress !== undefined ? (
          <span className="h-1 w-7 overflow-hidden rounded-full bg-white/10">
            <span className={cn("block h-full rounded-full", progress >= 75 ? "bg-destructive" : progress >= 60 ? "bg-chart-3" : "bg-chart-5")} style={{ width: `${progress}%` }} />
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={id === "session" ? "Estatísticas da conversa" : id === "tokens" ? "Uso de tokens" : id === "cache" ? "Cache de entrada" : "Uso da janela de contexto"}
          className={cn("absolute bottom-full z-50 mb-3 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-popover p-3.5 text-popover-foreground shadow-2xl shadow-black/50 ring-1 ring-white/5", alignClass)}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function PopoverTitle({ icon, children }: { icon: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <div className="mb-2.5 flex items-center gap-2 border-b border-line pb-2.5 text-xs font-semibold">
      <span className="text-primary">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function DetailRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }): React.JSX.Element {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-1 text-[11px]", strong ? "text-foreground" : "text-muted-foreground")}>
      <span>{label}</span>
      <span className={cn("shrink-0 font-mono tabular-nums", strong && "font-semibold")}>{value}</span>
    </div>
  );
}

function PopoverHint({ children }: { children: ReactNode }): React.JSX.Element {
  return <p className="mt-2 border-t border-line pt-2 text-[10px] leading-relaxed text-muted-foreground">{children}</p>;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(Math.round(value));
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  const seconds = Math.round(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}
