import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { cn } from "../lib/utils";
import type { ApprovalScope, GrantKeyKind } from "@shared/ipc";

/**
 * The human-in-the-loop gate.
 *
 * The engine blocks a tool call until this modal answers, so the modal is not a
 * notification — it is the only thing that lets the turn continue. Three details
 * follow from that:
 *
 *  - Escape and the backdrop resolve to *deny*, never to "dismiss and forget".
 *    There is no third state the engine could act on.
 *  - The first button is focused on mount, so Enter/arrow keys work without a mouse.
 *  - The command text is shown verbatim and unwrapped. A confirmation the user
 *    cannot read is worse than no confirmation: this is the moment a prompt
 *    injection would try to smuggle something past them.
 */
export function ApprovalModal(): React.JSX.Element | null {
  const approval = useStore((s) => s.approval);
  const respond = useStore((s) => s.respondApproval);
  const [showArgs, setShowArgs] = useState(false);
  const allowRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset the disclosure each time a new request arrives, and focus the primary
  // action so the keyboard flow is immediate.
  useEffect(() => {
    if (!approval) return;
    setShowArgs(false);
    allowRef.current?.focus();
  }, [approval?.id]);

  if (!approval) return null;

  const answer = (decision: "allow" | "deny", scope: ApprovalScope, grantKey?: GrantKeyKind): void =>
    respond(decision, scope, grantKey);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      answer("deny", "once");
      return;
    }
    if (event.key === "Tab") {
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onKeyDown={onKeyDown}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) answer("deny", "once");
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-title"
      aria-describedby="approval-help"
    >
      <div ref={dialogRef} tabIndex={-1} className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-card shadow-2xl shadow-black/60">
        <header className="flex items-center gap-2 border-b border-line px-5 py-3">
          <span className="h-1.5 w-1.5 rounded-full bg-chart-3" />
          <h2 id="approval-title" className="text-sm font-medium text-foreground">
            Ação requer permissão
          </h2>
          <span className="flex-1" />
          <span className="font-mono text-[11px] text-muted-foreground">
            {approval.mcpServer ? `MCP · ${approval.mcpServer}` : "ferramenta local"}
          </span>
        </header>

        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-sm text-muted-foreground">
            O agente quer executar{" "}
            <span className="font-mono text-foreground">{approval.toolName}</span>
          </p>

          {approval.detail ? (
            <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-page px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">
              {approval.detail}
            </pre>
          ) : null}

          <button
            type="button"
            onClick={() => setShowArgs((v) => !v)}
            className="self-start text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {showArgs ? "Ocultar" : "Mostrar"} todos os argumentos
          </button>

          {showArgs ? (
            <pre className="max-h-48 overflow-auto rounded-lg border border-line bg-muted px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {JSON.stringify(approval.args, null, 2)}
            </pre>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-line bg-muted/40 px-5 py-3">
          <button
            ref={allowRef}
            type="button"
            onClick={() => answer("allow", "once")}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus:ring-2 focus:ring-ring focus:outline-none"
          >
            Permitir uma vez
          </button>

          <button
            type="button"
            onClick={() => answer("allow", "project", "exact")}
            className="rounded-md border border-line px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-white/5 focus:ring-2 focus:ring-ring focus:outline-none"
          >
            Permitir sempre esta chamada
          </button>

          <button
            type="button"
            onClick={() => answer("allow", "project", "toolWide")}
            className="rounded-md border border-line px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-white/5 focus:ring-2 focus:ring-ring focus:outline-none"
          >
            Sempre permitir {approval.toolName}
          </button>

          {approval.grantKeys.mcpServerWide ? (
            <button
              type="button"
              onClick={() => answer("allow", "project", "mcpServerWide")}
              className="rounded-md border border-line px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-white/5 focus:ring-2 focus:ring-ring focus:outline-none"
            >
              Sempre permitir {approval.mcpServer}
            </button>
          ) : null}

          <span className="flex-1" />

          <button
            type="button"
            onClick={() => answer("allow", "global", "toolWide")}
            title="Aplica-se a todos os workspaces e fica em ~/.rubycli/config.json"
            className="rounded-md px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            Sempre permitir em todos os projetos
          </button>

          <button
            type="button"
            onClick={() => answer("deny", "once")}
            className={cn(
              "rounded-md border border-destructive/50 px-3 py-1.5 text-xs text-destructive",
              "transition-colors hover:bg-destructive/10 focus:ring-2 focus:ring-ring focus:outline-none",
            )}
          >
            Negar
          </button>
        </footer>

        <p id="approval-help" className="border-t border-line px-5 py-2 text-[10px] text-muted-foreground">
          As permissões ficam fora do repositório, então um projeto não pode autorizá-las por conta própria.
          Ao negar, o agente recebe o bloqueio e pode continuar o turno. Esc nega esta ação.
        </p>
      </div>
    </div>
  );
}
