import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  CircleAlert,
  Clock3,
  LoaderCircle,
  MessageSquareText,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import type {
  SubAgentConfigRequest,
  SubAgentSummary,
  SubAgentTranscriptEntry,
} from "@shared/ipc";
import { useStore, type ChatItem } from "../store";
import { Markdown } from "./Markdown";
import { cn } from "../lib/utils";

const STATUS_LABEL: Record<string, string> = {
  configuring: "Aguardando configuração",
  queued: "Na fila",
  running: "Trabalhando",
  review: "Revisão necessária",
  merging: "Aplicando alterações",
  merged: "Alterações aplicadas",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
  interrupted: "Interrompido ao fechar o app",
};

const ROLE_LABEL: Record<string, string> = {
  explorer: "Pesquisa",
  worker: "Implementação",
};

const EFFORT_LABEL: Record<string, string> = {
  none: "desativado",
  minimal: "mínimo",
  low: "baixo",
  medium: "médio",
  high: "alto",
  xhigh: "extra alto",
  max: "máximo",
};

type AgentRow = {
  id: string;
  agent?: SubAgentSummary;
  request?: SubAgentConfigRequest;
  status: string;
};

function makeAgentRows(items: ChatItem[]): AgentRow[] {
  const rows = new Map<string, AgentRow>();
  for (const item of items) {
    if (item.kind === "subagent-config") {
      rows.set(item.id, {
        id: item.id,
        request: item.request,
        status:
          item.status === "pending"
            ? "configuring"
            : item.status === "started"
              ? "queued"
              : item.status,
      });
    } else if (item.kind === "subagent") {
      rows.set(item.id, {
        id: item.id,
        agent: item.agent,
        status: item.agent.status,
      });
    }
  }
  return Array.from(rows.values());
}

function rowTitle(row: AgentRow): string {
  return row.agent?.title ?? row.request?.title ?? "Subagente";
}

function rowPrompt(row: AgentRow): string {
  return row.agent?.prompt ?? row.request?.prompt ?? "";
}

function isRunning(row: AgentRow): boolean {
  return ["queued", "running", "merging", "configuring"].includes(row.status);
}

function StatusIcon({ status }: { status: string }): React.JSX.Element {
  if (isRunning({ id: "", status })) {
    return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-chart-4" />;
  }
  if (status === "review" || status === "failed" || status === "interrupted") {
    return <CircleAlert className="h-3.5 w-3.5 text-chart-1" />;
  }
  if (status === "cancelled") {
    return <CircleAlert className="h-3.5 w-3.5 text-muted-foreground" />;
  }
  return <Check className="h-3.5 w-3.5 text-chart-2" />;
}

function TranscriptEntry({
  entry,
}: {
  entry: SubAgentTranscriptEntry;
}): React.JSX.Element {
  if (entry.kind === "assistant") {
    return (
      <article className="rounded-lg border border-line bg-page p-3 text-xs leading-5">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
          <MessageSquareText className="h-3 w-3" /> Resposta do agente
        </div>
        <Markdown text={entry.text} />
      </article>
    );
  }
  if (entry.kind === "tool") {
    return (
      <details className="rounded-lg border border-line bg-page">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs">
          <Wrench className="h-3.5 w-3.5 shrink-0 text-chart-4" />
          <span className="min-w-0 flex-1 truncate font-mono">{entry.name}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {entry.status === "running" ? "em andamento" : "concluída"}
          </span>
        </summary>
        {entry.result ? (
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-line px-3 py-2.5 font-mono text-[10px] leading-4 text-muted-foreground">
            {entry.result}
          </pre>
        ) : null}
      </details>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-lg border border-chart-4/20 bg-chart-4/5 px-3 py-2.5 text-xs text-muted-foreground">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-chart-4" />
      <span className="whitespace-pre-wrap">{entry.text}</span>
    </div>
  );
}

function AgentDetails({
  row,
  onBack,
}: {
  row: AgentRow;
  onBack: () => void;
}): React.JSX.Element {
  const agent = row.agent;
  const request = row.request;
  const transcript = agent?.transcript ?? [];
  const model = agent?.model ?? request?.proposedModel;
  const effort = agent?.reasoningEffort ?? request?.proposedReasoningEffort;
  const instructions = agent?.instructions ?? request?.proposedInstructions ?? "";
  const prompt = agent?.prompt ?? request?.prompt ?? "";
  const role = agent?.role ?? request?.role;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Voltar à lista de subagentes"
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-chart-5/10 text-chart-5">
            <Bot className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">{rowTitle(row)}</h2>
            <p className="truncate text-[10px] text-muted-foreground">
              {[role ? ROLE_LABEL[role] ?? role : "", model, effort ? `raciocínio ${EFFORT_LABEL[effort] ?? effort}` : ""]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground">
            <StatusIcon status={row.status} />
            {STATUS_LABEL[row.status] ?? row.status}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {agent?.progress ? (
          <div className="rounded-lg border border-line bg-card px-3 py-2 text-xs text-muted-foreground">
            {agent.progress}
          </div>
        ) : null}
        {agent?.usage ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <span>{agent.usage.llmCalls} chamadas</span>
            <span>{agent.usage.inputTokens + agent.usage.outputTokens} tokens</span>
            {agent.usage.cachedTokens ? <span>{agent.usage.cachedTokens} em cache</span> : null}
            <span>{agent.usage.toolCalls} tools</span>
          </div>
        ) : null}
        {prompt ? (
          <details open className="rounded-lg border border-line bg-card">
            <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium">
              Tarefa recebida
            </summary>
            <p className="whitespace-pre-wrap border-t border-line px-3 py-2.5 text-xs leading-5 text-muted-foreground">
              {prompt}
            </p>
          </details>
        ) : null}
        {request?.proposalNote ? (
          <div className="rounded-lg border border-chart-4/20 bg-chart-4/5 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
            {request.proposalNote}
          </div>
        ) : null}
        {instructions ? (
          <details className="rounded-lg border border-line bg-card">
            <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium">
              Orientações
            </summary>
            <p className="whitespace-pre-wrap border-t border-line px-3 py-2.5 text-xs leading-5 text-muted-foreground">
              {instructions}
            </p>
          </details>
        ) : null}
        {agent?.error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            {agent.error}
          </div>
        ) : null}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
              Chat e atividade
            </h3>
            {transcript.length ? (
              <span className="text-[10px] text-muted-foreground">
                {transcript.length} registros
              </span>
            ) : null}
          </div>
          {transcript.length ? (
            <div className="space-y-2">
              {transcript.map((entry) => (
                <TranscriptEntry key={entry.id} entry={entry} />
              ))}
            </div>
          ) : agent?.output ? (
            <article className="rounded-lg border border-line bg-page p-3 text-xs leading-5">
              <div className="mb-2 text-[10px] font-medium text-muted-foreground">
                Resposta registrada
              </div>
              <Markdown text={agent.output} />
              <p className="mt-3 border-t border-line pt-2 text-[10px] text-muted-foreground">
                Este registro antigo não contém a sequência detalhada de ferramentas.
              </p>
            </article>
          ) : (
            <p className="rounded-lg border border-dashed border-line px-3 py-4 text-xs text-muted-foreground">
              O agente ainda não produziu mensagens.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

export function SubAgentsPanel(): React.JSX.Element {
  const items = useStore((state) => state.items);
  const clearedSubAgentIds = useStore((state) => state.clearedSubAgentIds);
  const clearCompletedSubAgents = useStore((state) => state.clearCompletedSubAgents);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAllCompleted, setShowAllCompleted] = useState(false);
  const rows = useMemo(
    () =>
      makeAgentRows(items).filter((row) => !clearedSubAgentIds.includes(row.id)),
    [items, clearedSubAgentIds],
  );
  const selected = rows.find((row) => row.id === selectedId);
  const active = rows.filter((row) => isRunning(row));
  const review = rows.filter((row) => row.status === "review");
  const completed = rows.filter((row) => !isRunning(row) && row.status !== "review");
  const visibleCompleted = showAllCompleted ? completed : completed.slice(-10);

  if (selected) {
    return <AgentDetails row={selected} onBack={() => setSelectedId(null)} />;
  }

  const groups = [
    { title: "Ativos", rows: active, empty: "Nenhum subagente ativo" },
    { title: "Revisão necessária", rows: review, empty: "Nenhum diff aguardando revisão" },
    { title: "Concluídos", rows: visibleCompleted, empty: "Nenhum subagente concluído nesta conversa" },
  ];

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Subagentes desta conversa</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Selecione um agente para abrir sua tarefa, orientações e atividade.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="rounded-full border border-line px-2 py-1 text-[10px] text-muted-foreground">
            {rows.length} total
          </span>
          {completed.length > 0 ? (
            <button
              type="button"
              onClick={() => clearCompletedSubAgents(completed.map((row) => row.id))}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              title="Limpar os subagentes finalizados desta lista"
            >
              <Trash2 className="h-3 w-3" />
              Limpar concluídos
            </button>
          ) : null}
        </div>
      </div>

      {groups.map((group) => (
        <section key={group.title} className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
              {group.title}
            </h3>
            <span className="font-mono text-[10px] text-muted-foreground">
              {group.title === "Concluídos" ? completed.length : group.rows.length}
            </span>
          </div>
          {group.rows.length ? (
            <div className="space-y-1">
              {group.rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelectedId(row.id)}
                  className="flex w-full items-start gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left transition hover:border-line hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-chart-5/10 text-chart-5">
                    <Bot className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-foreground">
                        {rowTitle(row)}
                      </span>
                      <span className="shrink-0"><StatusIcon status={row.status} /></span>
                    </span>
                    <span className="mt-0.5 block line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                      {rowPrompt(row) || STATUS_LABEL[row.status] || row.status}
                    </span>
                    {row.agent?.model ? (
                      <span className="mt-1 block truncate text-[9px] text-muted-foreground">
                        {row.agent.model}
                        {row.agent.reasoningEffort
                          ? ` · ${EFFORT_LABEL[row.agent.reasoningEffort] ?? row.agent.reasoningEffort}`
                          : ""}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-lg px-2.5 py-2 text-xs text-muted-foreground">
              {group.empty}
            </p>
          )}
          {group.title === "Concluídos" && completed.length > 10 ? (
            <button
              type="button"
              onClick={() => setShowAllCompleted((shown) => !shown)}
              className={cn(
                "ml-10 mt-1 rounded px-2 py-1 text-[11px] text-muted-foreground transition hover:text-foreground",
              )}
            >
              {showAllCompleted
                ? "Mostrar menos"
                : `Mostrar mais ${completed.length - visibleCompleted.length}`}
            </button>
          ) : null}
        </section>
      ))}

      {rows.length === 0 ? (
        <div className="mx-auto mt-10 max-w-xs text-center">
          <Clock3 className="mx-auto h-7 w-7 text-muted-foreground/60" />
          <p className="mt-3 text-xs font-medium">Ainda não há subagentes</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            Quando esta conversa iniciar um subagente, o nome e o andamento dele aparecerão aqui.
          </p>
        </div>
      ) : null}
    </div>
  );
}
