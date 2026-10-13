import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, Info } from "lucide-react";
import { useStore, type ChatItem } from "../store";
import { ToolCallCard } from "./ToolCallCard";
import { Markdown } from "./Markdown";
import { cn } from "../lib/utils";
import { UserQuestionCard } from "./UserQuestionCard";
import { SubAgentConfigCard } from "./SubAgentConfigCard";
import { SubAgentCard } from "./SubAgentCard";

export function ChatView(): React.JSX.Element {
  const items = useStore((s) => s.items);
  const status = useStore((s) => s.status);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  // Follow streamed output only while the reader has not scrolled away from it.
  useEffect(() => {
    if (pinnedRef.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
      setShowJumpToLatest(false);
    } else {
      setShowJumpToLatest(true);
    }
  }, [items]);

  const updateScrollPosition = (): void => {
    const element = scrollRef.current;
    if (!element) return;
    const atBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    pinnedRef.current = atBottom;
    if (atBottom) setShowJumpToLatest(false);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={updateScrollPosition}
        data-testid="chat-scroll"
        className="h-full overflow-y-auto"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
          {items.length === 0 ? <EmptyState status={status} /> : null}
          {items.map((item) => (
            <Item key={item.id} item={item} />
          ))}
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

function Item({ item }: { item: ChatItem }): React.JSX.Element {
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
}

function EmptyState({ status }: { status: string }): React.JSX.Element {
  const label =
    status === "ready" ? "Pronto" : status === "busy" ? "Trabalhando" : status;
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
