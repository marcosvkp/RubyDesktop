import { Bot, Check, CircleAlert, GitBranch, LoaderCircle, X } from "lucide-react";
import type { ChatItem } from "../store";
import { useStore } from "../store";

const STATUS_LABEL: Record<string, string> = {
  queued: "Na fila",
  running: "Trabalhando",
  review: "Revisão necessária",
  merging: "Aplicando alterações",
  merged: "Alterações aplicadas",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
};

export function SubAgentCard({ item }: { item: Extract<ChatItem, { kind: "subagent" }> }): React.JSX.Element {
  const review = useStore((s) => s.respondSubAgentReview);
  const agent = item.agent;
  const active = agent.status === "queued" || agent.status === "running" || agent.status === "merging";
  const cancellable = agent.status === "queued" || agent.status === "running";
  const Icon = active ? LoaderCircle : agent.status === "failed" ? CircleAlert : agent.status === "cancelled" ? X : Check;

  return (
    <section className="rounded-xl border border-line bg-card p-4 shadow-lg shadow-black/10">
      <header className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-chart-5/10 text-chart-5">
          <Bot className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{agent.title}</h3>
            <span className="rounded-full border border-line px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
              {agent.role}
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Icon className={`h-3 w-3 ${active ? "animate-spin" : ""}`} />
              {STATUS_LABEL[agent.status] ?? agent.status}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {agent.model}{agent.reasoningEffort ? ` · ${agent.reasoningEffort}` : ""}
          </p>
      {agent.instructions ? <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">Orientação: {agent.instructions}</p> : null}
        </div>
      </header>

      {agent.progress ? <p className="mt-3 pl-9 text-xs text-muted-foreground">{agent.progress}</p> : null}
      {agent.output ? (
        <div className="mt-3 rounded-lg border border-line bg-background p-3 text-xs leading-5 text-foreground whitespace-pre-wrap">
          {agent.output}
        </div>
      ) : null}
      {agent.error ? <p className="mt-3 text-xs text-destructive">{agent.error}</p> : null}
      {agent.usage ? (
        <p className="mt-2 pl-9 text-[10px] text-muted-foreground">
          {agent.usage.llmCalls} chamadas · {agent.usage.inputTokens + agent.usage.outputTokens} tokens
          {agent.usage.cachedTokens ? ` · ${agent.usage.cachedTokens} em cache` : ""} · {agent.usage.toolCalls} tools
        </p>
      ) : null}
      {agent.diff ? (
        <details className="mt-3 rounded-lg border border-line bg-background">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5 text-primary" />
            Revisar diff{agent.changedFiles?.length ? ` · ${agent.changedFiles.length} arquivo(s)` : ""}
          </summary>
          <pre className="max-h-96 overflow-auto border-t border-line p-3 text-[11px] leading-5 text-foreground">
            {agent.diff}
          </pre>
        </details>
      ) : null}
      {agent.status === "review" ? (
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => review(agent.id, "discard")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Descartar
          </button>
          <button
            type="button"
            onClick={() => review(agent.id, "merge")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
          >
            <Check className="h-3.5 w-3.5" />
            Aplicar diff
          </button>
        </div>
      ) : null}
      {cancellable ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => review(agent.id, "cancel")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Cancelar agente
          </button>
        </div>
      ) : null}
    </section>
  );
}
