import { Component, type ErrorInfo, type ReactNode } from "react";
import { useStore } from "../store";

interface State {
  error?: Error;
}

/** Keeps a malformed render from replacing the user's transcript with a blank window. */
export class ChatErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Chat renderer failed", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <RawTranscriptFallback error={this.state.error} />;
  }
}

function RawTranscriptFallback({ error }: { error: Error }): React.JSX.Element {
  const items = useStore.getState().items;
  return (
    <section className="mx-auto my-8 w-full max-w-3xl space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">A conversa continua disponível em texto</h2>
          <p className="mt-1 text-xs text-muted-foreground">Um componente falhou ao formatar uma mensagem.</p>
        </div>
        <button type="button" onClick={() => window.location.reload()} className="rounded-md border border-line px-3 py-1.5 text-xs hover:bg-white/5">
          Recarregar interface
        </button>
      </div>
      <pre className="max-h-32 overflow-auto rounded-lg bg-background p-3 text-[11px] text-muted-foreground">{error.message}</pre>
      <div className="max-h-[55vh] space-y-2 overflow-auto rounded-lg border border-line bg-background p-3">
        {items.map((item) => {
          const text = item.kind === "user" || item.kind === "assistant" || item.kind === "notice"
            ? item.text
            : item.kind === "tool"
              ? `${item.name}\n${item.result ?? "em andamento"}`
              : item.kind === "subagent" || item.kind === "subagent-config"
                ? item.kind === "subagent" ? `${item.agent.title}: ${item.agent.output ?? item.agent.progress}` : `Sub-agente: ${item.request.title}`
                : `Pergunta: ${item.request.title}`;
          return <pre key={item.id} className="whitespace-pre-wrap break-words text-xs">{text}</pre>;
        })}
      </div>
    </section>
  );
}
