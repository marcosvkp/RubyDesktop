import { useMemo, useState } from "react";
import { Bot, Pencil, Play, Sparkles, X } from "lucide-react";
import type { ChatItem } from "../store";
import { useStore } from "../store";
import { cn } from "../lib/utils";

export function SubAgentConfigCard({
  item,
}: {
  item: Extract<ChatItem, { kind: "subagent-config" }>;
}): React.JSX.Element {
  const models = useStore((s) => s.models);
  const respond = useStore((s) => s.respondSubAgentConfig);
  const [model, setModel] = useState(item.request.proposedModel);
  const [effort, setEffort] = useState(
    item.request.proposedReasoningEffort ?? "",
  );
  const [instructions, setInstructions] = useState(
    item.request.proposedInstructions,
  );
  const [mode, setMode] = useState<"choose" | "manual">("choose");
  const displayedModel = item.resolved?.model ?? model;
  const displayedEffort = item.resolved?.reasoningEffort ?? effort;
  const displayedInstructions = item.resolved?.instructions ?? instructions;
  const selectedModel = useMemo(
    () => models.find((entry) => entry.id === displayedModel),
    [models, displayedModel],
  );
  const efforts = selectedModel?.reasoningEfforts ?? [];
  const pending = item.status === "pending";

  const startAgent = (
    selectedModel: string,
    selectedEffort: string,
    selectedInstructions: string,
  ): void => {
    respond(item.id, "start", {
      model: selectedModel,
      ...(selectedEffort
        ? { reasoningEffort: selectedEffort as "low" | "medium" | "high" }
        : {}),
      instructions: selectedInstructions,
    });
  };

  return (
    <section
      data-testid="subagent-config-card"
      className="rounded-xl border border-line bg-card p-4 shadow-lg shadow-black/10"
    >
      <header className="mb-3 flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-chart-5/10 text-chart-5">
          <Bot className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">
            Configurar subagente
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {pending
              ? "O orquestrador propôs este agente. Inicie com a recomendação ou revise os parâmetros."
              : item.status === "started"
                ? "O subagente foi iniciado com os parâmetros registrados abaixo."
                : item.status === "interrupted"
                  ? "A solicitação foi interrompida ao fechar o app."
                  : "A solicitação foi cancelada."}
          </p>
        </div>
        <span className="rounded-full border border-line px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
          {item.request.role}
        </span>
      </header>

      <div className="space-y-3 pl-9">
        <div>
          <p className="text-sm font-medium text-foreground">
            {item.request.title}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
            {item.request.prompt}
          </p>
          {item.request.proposalNote ? (
            <p className="mt-2 rounded-lg border border-chart-4/30 bg-chart-4/5 px-3 py-2 text-xs text-muted-foreground">
              {item.request.proposalNote}
            </p>
          ) : null}
        </div>

        {mode === "choose" ? (
          <div className="space-y-3 rounded-lg border border-line bg-background/70 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Configuração sugerida pela IA
            </div>
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Modelo</span>
                <p
                  className="mt-0.5 truncate font-medium text-foreground"
                  title={selectedModel?.label ?? displayedModel}
                >
                  {selectedModel?.label ?? displayedModel}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Nível de raciocínio</span>
                <p className="mt-0.5 font-medium text-foreground">
                  {displayedEffort ? effortLabel(displayedEffort) : "Padrão do modelo"}
                </p>
              </div>
            </div>
            {displayedInstructions.trim() ? (
              <p className="max-h-20 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                {displayedInstructions}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sem orientações adicionais.
              </p>
            )}
            {pending ? (
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => respond(item.id, "cancel")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => setMode("manual")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs text-foreground transition-colors hover:bg-white/5"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Quero configurar
                </button>
                <button
                  type="button"
                  onClick={() =>
                    startAgent(
                      item.request.proposedModel,
                      item.request.proposedReasoningEffort ?? "",
                      item.request.proposedInstructions,
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <Play className="h-3.5 w-3.5" />
                  IA configura e inicia
                </button>
              </div>
            ) : (
              <p className="text-right text-xs text-muted-foreground">
                {item.status === "started"
                  ? "Configuração confirmada."
                  : item.status === "interrupted"
                    ? "Solicitação interrompida ao fechar o app."
                    : "Solicitação cancelada."}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Modelo
                <select
                  value={displayedModel}
                  disabled={!pending || models.length === 0}
                  onChange={(event) => {
                    setModel(event.target.value);
                    setEffort("");
                  }}
                  className="block w-full rounded-lg border border-line bg-background px-2.5 py-2 text-xs font-normal normal-case tracking-normal text-foreground focus:border-ring/60 focus:outline-none disabled:opacity-50"
                >
                  {models.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label} · {entry.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Nível de raciocínio
                <select
                  value={displayedEffort}
                  disabled={!pending || efforts.length === 0}
                  onChange={(event) =>
                    setEffort(event.target.value as typeof effort)
                  }
                  className="block w-full rounded-lg border border-line bg-background px-2.5 py-2 text-xs font-normal normal-case tracking-normal text-foreground focus:border-ring/60 focus:outline-none disabled:opacity-50"
                >
                  <option value="">Padrão do modelo</option>
                  {efforts.map((entry) => (
                    <option key={entry} value={entry}>
                      {effortLabel(entry)}
                    </option>
                  ))}
                </select>
                {selectedModel && efforts.length === 0 ? (
                  <span className="block normal-case tracking-normal">
                    Este modelo não expõe effort.
                  </span>
                ) : null}
              </label>
            </div>

            <label className="block space-y-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Orientações do agente
              <textarea
                value={displayedInstructions}
                disabled={!pending}
                onChange={(event) => setInstructions(event.target.value)}
                rows={3}
                placeholder="Papel, limites, ferramentas e formato da entrega…"
                className="block w-full resize-y rounded-lg border border-line bg-background px-3 py-2 text-xs font-normal normal-case tracking-normal text-foreground placeholder:text-muted-foreground focus:border-ring/60 focus:outline-none disabled:opacity-50"
              />
            </label>

            {pending ? (
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setMode("choose")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Escolher configuração da IA
                </button>
                <button
                  type="button"
                  onClick={() => respond(item.id, "cancel")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!selectedModel}
                  onClick={() => startAgent(model, effort, instructions)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-40",
                  )}
                >
                  <Play className="h-3.5 w-3.5" />
                  Iniciar subagente
                </button>
              </div>
            ) : (
              <p className="text-right text-xs text-muted-foreground">
                {item.status === "started"
                  ? "Configuração confirmada."
                  : item.status === "interrupted"
                    ? "Solicitação interrompida ao fechar o app."
                    : "Solicitação cancelada."}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function effortLabel(effort: string): string {
  return ({ low: "Baixo", medium: "Médio", high: "Alto" } as Record<string, string>)[effort] ?? effort;
}
