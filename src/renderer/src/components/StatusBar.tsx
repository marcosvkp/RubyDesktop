import { useStore, PERMISSION_MODE_LABEL } from "../store";
import { cn } from "../lib/utils";
import type { PermissionMode } from "@shared/ipc";

const MODES: PermissionMode[] = ["normal", "acceptEdits", "plan"];

/**
 * Bottom strip for always-on engine and permission controls. Per-conversation
 * statistics now live next to the composer where their details are selectable.
 *
 * The permission mode sits here rather than in a settings dialog because it is a
 * *mode*: it changes what the agent may do without asking, so it should be visible
 * at all times, next to the other always-on state.
 */
export function StatusBar({
  outputOpen,
  onToggleOutput,
}: {
  outputOpen: boolean;
  onToggleOutput: () => void;
}): React.JSX.Element {
  const status = useStore((s) => s.status);
  const used = useStore((s) => s.contextUsed);
  const permissionMode = useStore((s) => s.permissionMode);
  const setPermissionMode = useStore((s) => s.setPermissionMode);
  const compacting = useStore((s) => s.compacting);
  const compact = useStore((s) => s.compact);
  const busy = useStore((s) => s.busy);

  const dotColor =
    status === "ready"
      ? "bg-chart-5"
      : status === "busy"
        ? "bg-chart-3"
        : status === "error"
          ? "bg-destructive"
          : "bg-muted-foreground";
  const statusLabel =
    status === "ready"
      ? "pronto"
      : status === "busy"
        ? "trabalhando"
        : status === "starting"
          ? "iniciando"
          : status === "error"
            ? "erro"
            : "parado";

  return (
    <footer
      aria-label="Status e controles"
      className="flex h-9 min-w-0 shrink-0 items-center gap-3 overflow-x-auto border-t border-line bg-background px-4 text-xs text-muted-foreground max-[820px]:gap-1.5 max-[820px]:px-2"
    >
      <span className="flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", dotColor)} />
        <span className="font-mono max-[820px]:sr-only">{statusLabel}</span>
      </span>

      <span
        className="flex items-center gap-1 rounded-md border border-line bg-card p-0.5"
        title="Modo de permissão — /mode ask | edits | plan"
        aria-label="Modo de permissão"
      >
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setPermissionMode(mode)}
            aria-pressed={permissionMode === mode}
            className={cn(
              "rounded px-2 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 max-[820px]:px-1.5",
              permissionMode === mode
                ? "bg-primary/15 text-foreground"
                : "hover:bg-white/5 hover:text-foreground",
            )}
          >
            {PERMISSION_MODE_LABEL[mode]}
          </button>
        ))}
      </span>

      <button
        type="button"
        onClick={compact}
        disabled={busy || compacting || used === 0}
        title="Resumir mensagens antigas agora (/compact)"
        aria-label={compacting ? "Resumindo contexto" : "Resumir contexto"}
        className="shrink-0 rounded px-1.5 py-0.5 transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {compacting ? "Resumindo…" : "Resumir"}
      </button>

      <button
        type="button"
        onClick={onToggleOutput}
        title="Painel de atividade do agente (Ctrl+`)"
        aria-pressed={outputOpen}
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          outputOpen
            ? "bg-sidebar-accent text-foreground"
            : "hover:bg-white/5 hover:text-foreground",
        )}
      >
        Atividade
      </button>

      <span className="flex-1" />
    </footer>
  );
}
