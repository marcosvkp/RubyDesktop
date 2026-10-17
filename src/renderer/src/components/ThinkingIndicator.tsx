import { useEffect, useState } from "react";
import { Check, ChevronDown, CircleX, LoaderCircle, Sparkles } from "lucide-react";
import type { ChatItem, TurnProgress } from "../store";
import { cn } from "../lib/utils";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

interface ThinkingIndicatorProps {
  items: ChatItem[];
  approvalPending: boolean;
  progress?: TurnProgress;
}

/** Shows live, user-visible work while the model has not finished its turn. */
export function ThinkingIndicator({
  items,
  approvalPending,
  progress,
}: ThinkingIndicatorProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lastActivityAt, setLastActivityAt] = useState(() => Date.now());

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setLastActivityAt(Date.now());
  }, [items, progress]);

  const tools = items.filter(
    (item): item is ToolItem => item.kind === "tool" && item.name !== "think",
  );
  const activeTool = [...tools].reverse().find((tool) => tool.status === "running");
  const hasStreamingText = items.some(
    (item) => item.kind === "assistant" && item.streaming && item.text.trim(),
  );
  const waitingForQuestion = items.some(
    (item) => item.kind === "question" && item.status === "pending",
  );
  const waitingForSubAgent = items.some(
    (item) => item.kind === "subagent-config" && item.status === "pending",
  );
  const internalAnalysis = progress?.phase === "internal_analysis";
  const modelRequest = progress?.phase === "model_request";
  const publicUpdate = progress?.phase === "public_update";
  const quietSeconds = Math.floor((Date.now() - lastActivityAt) / 1000);
  const waitingOnModel =
    !approvalPending &&
    !waitingForQuestion &&
    !waitingForSubAgent &&
    !internalAnalysis &&
    !activeTool &&
    !hasStreamingText &&
    quietSeconds >= 15;

  const label = progressLabel({
    approvalPending,
    waitingForQuestion,
    waitingForSubAgent,
    activeTool,
    hasStreamingText,
    internalAnalysis,
    publicUpdate,
    modelRequest,
    waitingOnModel,
    quietSeconds,
  });
  const recentTools = tools.slice(-4).reverse();

  return (
    <section
      data-testid="thinking-indicator"
      className="overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.035]"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="turn-progress-details"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Sparkles className="h-3 w-3" />
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
          />
        </span>
        <span role="status" aria-live="polite" className="min-w-0 flex-1 text-xs font-medium text-foreground">
          {label}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {formatElapsed(elapsedSeconds)}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          id="turn-progress-details"
          className="border-t border-line px-3.5 py-3"
        >
          <div className="flex items-center gap-2 text-[11px] text-foreground/90">
            <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
            <span>
              {progressDescription({
                approvalPending,
                activeTool,
                hasStreamingText,
                waitingForQuestion,
                waitingForSubAgent,
                internalAnalysis,
                modelRequest,
                publicUpdate,
                modelName:
                  progress?.phase === "model_request"
                    ? progress.model
                    : undefined,
                waitingOnModel,
                quietSeconds,
              })}
            </span>
          </div>

          {progress?.publicSummary ? (
            <div className="mt-3 rounded-md border border-primary/15 bg-primary/[0.04] px-3 py-2.5">
              <div className="eyebrow">Resumo do progresso</div>
              <p className="mt-1 text-[11px] leading-relaxed text-foreground/90">
                {progress.publicSummary}
              </p>
            </div>
          ) : null}

          {recentTools.length > 0 ? (
            <ol className="mt-3 space-y-2">
              {recentTools.map((tool) => (
                <li key={tool.id} className="flex items-center gap-2 text-[11px]">
                  {tool.status === "running" ? (
                    <LoaderCircle className="h-3 w-3 shrink-0 animate-spin text-chart-3 motion-reduce:animate-none" />
                  ) : tool.status === "ok" ? (
                    <Check className="h-3 w-3 shrink-0 text-chart-5" />
                  ) : (
                    <CircleX className="h-3 w-3 shrink-0 text-destructive" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {toolActivity(tool.name)}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-[10px]",
                      tool.status === "running"
                        ? "text-chart-3"
                        : tool.status === "ok"
                          ? "text-chart-5"
                          : "text-destructive",
                    )}
                  >
                    {toolStatus(tool)}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 pl-[22px] text-[11px] leading-relaxed text-muted-foreground">
              Ainda não há ações de ferramenta nesta etapa. A resposta ou a próxima ação aparecerá aqui assim que chegar.
            </p>
          )}

          <p className="mt-3 border-t border-line pt-2.5 text-[10px] leading-relaxed text-muted-foreground">
            Resumo das ações observáveis do turno · {formatElapsed(elapsedSeconds)}.
            O raciocínio interno do modelo não é exibido.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function progressDescription(input: {
  approvalPending: boolean;
  activeTool?: ToolItem;
  hasStreamingText: boolean;
  waitingForQuestion: boolean;
  waitingForSubAgent: boolean;
  internalAnalysis: boolean;
  modelRequest: boolean;
  publicUpdate: boolean;
  modelName?: string;
  waitingOnModel: boolean;
  quietSeconds: number;
}): string {
  if (input.approvalPending) return "O agente aguarda sua aprovação para continuar.";
  if (input.waitingForQuestion) return "O agente aguarda sua resposta na pergunta acima.";
  if (input.waitingForSubAgent) return "O agente aguarda a configuração do subagente.";
  if (input.activeTool) return `${toolActivity(input.activeTool.name)}.`;
  if (input.hasStreamingText) return "A resposta está sendo gerada e aparecerá acima.";
  if (input.internalAnalysis)
    return "O agente está processando uma etapa interna. O conteúdo privado não é exibido.";
  if (input.publicUpdate)
    return "Resumo público atualizado; o agente segue para a próxima etapa.";
  if (input.modelRequest)
    return `Chamada iniciada para ${input.modelName ?? "o modelo"}; aguardando texto ou uma ação.`;
  if (input.waitingOnModel)
    return `Sem nova saída há ${formatElapsed(input.quietSeconds)}. A solicitação continua ativa.`;
  return "O modelo está preparando a resposta.";
}

function progressLabel(input: {
  approvalPending: boolean;
  waitingForQuestion: boolean;
  waitingForSubAgent: boolean;
  activeTool?: ToolItem;
  hasStreamingText: boolean;
  internalAnalysis: boolean;
  publicUpdate: boolean;
  modelRequest: boolean;
  waitingOnModel: boolean;
  quietSeconds: number;
}): string {
  if (input.approvalPending) return "Aguardando sua aprovação";
  if (input.waitingForQuestion) return "Aguardando sua resposta";
  if (input.waitingForSubAgent) return "Aguardando configuração do subagente";
  if (input.activeTool) return toolActivity(input.activeTool.name);
  if (input.hasStreamingText) return "Escrevendo resposta…";
  if (input.internalAnalysis) return "Organizando a análise…";
  if (input.publicUpdate) return "Atualizando o progresso…";
  if (input.modelRequest)
    return input.quietSeconds >= 15
      ? "Aguardando resposta do modelo…"
      : "Modelo processando…";
  if (input.waitingOnModel) return "Aguardando resposta do modelo…";
  return "Pensando…";
}

function toolActivity(name: string): string {
  const labels: Record<string, string> = {
    activate_skill: "Ativando uma Skill",
    ask_user: "Preparando uma pergunta",
    bash: "Executando um comando",
    edit_file: "Editando um arquivo",
    glob: "Listando arquivos do projeto",
    grep: "Pesquisando no projeto",
    multi_edit_file: "Editando arquivos",
    read_file: "Lendo um arquivo",
    read_skills: "Consultando Skills",
    task: "Trabalhando com um subagente",
    web_fetch: "Lendo uma página da web",
    web_search: "Pesquisando na web",
    write_file: "Escrevendo um arquivo",
  };
  return labels[name] ?? `Executando ${name.replace(/[_-]/g, " ")}`;
}

function toolStatus(item: ToolItem): string {
  if (item.status === "running") return "em andamento";
  if (item.status === "ok") return "concluída";
  if (item.status === "denied") return "negada";
  return "falhou";
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${minutes}m ${remainder}s`;
}
