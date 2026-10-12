import { useEffect, useRef } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { useStore, type ChatItem } from "../store";
import { ToolCallCard } from "./ToolCallCard";
import { Markdown } from "./Markdown";
import { cn } from "../lib/utils";

export function ChatView(): React.JSX.Element {
  const items = useStore((s) => s.items);
  const status = useStore((s) => s.status);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Follow the tail as output streams in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [items]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
        {items.length === 0 ? <EmptyState status={status} /> : null}
        {items.map((item) => (
          <Item key={item.id} item={item} />
        ))}
        <div ref={bottomRef} />
      </div>
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
        <div className="text-sm text-foreground">
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
  }
}

function EmptyState({ status }: { status: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <div className="eyebrow">{status === "ready" ? "Ready" : status}</div>
      <h1 className="text-2xl font-semibold tracking-tight">
        <span className="text-foreground">Ask anything.</span>{" "}
        <span className="text-muted-foreground">It edits your project.</span>
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The agent reads, writes and runs commands in this workspace, and every tool call is shown
        as it happens.
      </p>
    </div>
  );
}
