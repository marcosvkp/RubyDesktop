import { memo, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Clock3, Info, X } from "lucide-react";
import { useStore, type ChatItem } from "../store";
import { ToolCallCard } from "./ToolCallCard";
import { Markdown } from "./Markdown";
import { cn } from "../lib/utils";
import { UserQuestionCard } from "./UserQuestionCard";
import { SubAgentConfigCard } from "./SubAgentConfigCard";
import { SubAgentCard } from "./SubAgentCard";
import { ThinkingIndicator } from "./ThinkingIndicator";

export function ChatView(): React.JSX.Element {
  const items = useStore((s) => s.items);
  const status = useStore((s) => s.status);
  const approval = useStore((s) => s.approval);
  const turnProgress = useStore((s) => s.turnProgress);
  const busy = useStore((s) => s.busy);
  const compacting = useStore((s) => s.compacting);
  const queueCommandPending = useStore((s) => s.queueCommandPending);
  const queuedMessages = useStore((s) => s.queuedMessages);
  const removeQueuedMessage = useStore((s) => s.removeQueuedMessage);
  const moveQueuedMessage = useStore((s) => s.moveQueuedMessage);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const latestUserIdRef = useRef<string | undefined>(undefined);
  const pinnedRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  // Follow new turns and streamed output while the reader stays at the bottom.
  useEffect(() => {
    let latestUserId: string | undefined;
    for (const item of items) {
      if (item.kind === "user") latestUserId = item.id;
    }
    if (latestUserId && latestUserId !== latestUserIdRef.current) {
      // Sending a new message should bring its response into view even if the
      // previous conversation was scrolled up.
      pinnedRef.current = true;
    }
    latestUserIdRef.current = latestUserId;

    let frame = 0;
    if (pinnedRef.current) {
      frame = requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: "end" }));
      setShowJumpToLatest(false);
    } else {
      setShowJumpToLatest(true);
    }
    return () => cancelAnimationFrame(frame);
  }, [items, queuedMessages, status, turnProgress]);

  // The thinking panel can expand without changing the transcript array. Watch
  // the content height so an open panel remains visible when the reader is pinned.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (!pinnedRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        bottomRef.current?.scrollIntoView({ block: "end" }),
      );
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  const updateScrollPosition = (): void => {
    const element = scrollRef.current;
    if (!element) return;
    const atBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    pinnedRef.current = atBottom;
    if (atBottom) setShowJumpToLatest(false);
  };

  const lastUserIndex = items.reduce(
    (latest, item, index) => (item.kind === "user" ? index : latest),
    -1,
  );
  const currentTurnItems = lastUserIndex >= 0 ? items.slice(lastUserIndex) : items;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={updateScrollPosition}
        data-testid="chat-scroll"
        className="h-full overflow-y-auto"
      >
        <div
          ref={contentRef}
          className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6"
        >
          {items.length === 0 ? <EmptyState status={status} /> : null}
          {items.map((item) => (
            <Item key={item.id} item={item} />
          ))}
          {status === "busy" ? (
            <ThinkingIndicator
              items={currentTurnItems}
              approvalPending={Boolean(approval)}
              progress={turnProgress}
            />
          ) : null}
          {queuedMessages.length > 0 ? (
            <section
              aria-label="Fila de mensagens"
              className="rounded-xl border border-primary/25 bg-primary/[0.035] p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <Clock3 className="h-3.5 w-3.5 text-primary" />
                  Fila de mensagens
                  <span className="rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                    {queuedMessages.length}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {busy
                    ? "Envio automático após o turno atual"
                    : compacting
                      ? "Envio automático após a compactação"
                      : queueCommandPending
                        ? "Aguardando a ação anterior"
                        : "Envio automático em ordem"}
                </span>
              </div>
              <ol className="flex flex-col gap-1.5">
                {queuedMessages.map((message, index) => (
                  <li
                    key={message.id}
                    className="flex min-w-0 items-start gap-2 rounded-lg border border-line/80 bg-card/80 px-2.5 py-2"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background font-mono text-[10px] text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pt-0.5 text-xs text-foreground">
                      {message.text}
                    </span>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveQueuedMessage(message.id, -1)}
                        disabled={index === 0}
                        aria-label={`Mover mensagem ${index + 1} para cima`}
                        title="Enviar antes"
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveQueuedMessage(message.id, 1)}
                        disabled={index === queuedMessages.length - 1}
                        aria-label={`Mover mensagem ${index + 1} para baixo`}
                        title="Enviar depois"
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeQueuedMessage(message.id)}
                        aria-label={`Remover mensagem ${index + 1} da fila`}
                        title="Remover da fila"
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </div>
      {showJumpToLatest ? (
        <button
          type="button"
          onClick={() => {
            pinnedRef.current = true;
            bottomRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "end",
            });
            setShowJumpToLatest(false);
          }}
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground shadow-lg shadow-black/30 transition-colors hover:border-white/30"
        >
          <ArrowDown className="h-3.5 w-3.5 text-primary" />
          Ir para o fim
        </button>
      ) : null}
    </div>
  );
}

const Item = memo(function Item({ item }: { item: ChatItem }): React.JSX.Element {
  switch (item.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap text-secondary-foreground">
            {item.text}
          </div>
        </div>
      );

    case "assistant":
      return (
        <div
          data-testid="assistant-message"
          className="text-sm text-foreground"
        >
          <Markdown text={item.text} streaming={item.streaming} />
        </div>
      );

    case "tool":
      return <ToolCallCard item={item} />;

    case "notice":
      return (
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
            item.tone === "error"
              ? "border-destructive/40 bg-destructive/10 text-foreground/90"
              : "border-line bg-card text-muted-foreground",
          )}
        >
          {item.tone === "error" ? (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          ) : (
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-chart-5" />
          )}
          <span className="whitespace-pre-wrap">{item.text}</span>
        </div>
      );

    case "question":
      return <UserQuestionCard item={item} />;

    case "subagent-config":
      return <SubAgentConfigCard item={item} />;

    case "subagent":
      return <SubAgentCard item={item} />;
  }
});

function EmptyState({ status }: { status: string }): React.JSX.Element {
  const label = status === "ready"
    ? "Pronto"
    : status === "busy"
      ? "Trabalhando"
      : status === "starting"
        ? "Iniciando"
        : status === "error"
          ? "Erro"
          : "Parado";
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <div className="eyebrow">{label}</div>
      <h1 className="text-2xl font-semibold tracking-tight">
        <span className="text-foreground">Peça o que precisar.</span>{" "}
        <span className="text-muted-foreground">
          O agente trabalha no projeto.
        </span>
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        O agente pode ler e editar arquivos e executar comandos. As ações são
        exibidas enquanto acontecem.
      </p>
    </div>
  );
}
