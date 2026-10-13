import {
  FolderClosed,
  FolderTree,
  Wrench,
  Sparkles,
  ShieldCheck,
  Plug,
  Globe,
  Plus,
  MessageSquare,
} from "lucide-react";
import { useStore } from "../store";
import { cn, shortenPath } from "../lib/utils";

/**
 * Workspace and conversation navigation.
 *
 * Recent conversations belong to the active workspace; switching workspaces
 * restarts the engine, which also switches the session catalog and permissions.
 */
export function Sidebar({
  workspace,
  onToggleMcp,
  mcpOpen,
  onToggleBrowser,
  browserOpen,
}: {
  workspace: string;
  onToggleMcp: () => void;
  mcpOpen: boolean;
  onToggleBrowser: () => void;
  browserOpen: boolean;
}): React.JSX.Element {
  const engine = useStore((s) => s.engine);
  const busy = useStore((s) => s.busy);
  const sessions = useStore((s) => s.sessions);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const newSession = useStore((s) => s.newSession);
  const resumeSession = useStore((s) => s.resumeSession);
  const pickWorkspace = useStore((s) => s.pickWorkspace);
  const grants = useStore((s) => s.grants);
  const mcpServers = useStore((s) => s.mcpServers);

  const grantCount = grants.project.length + grants.global.length;
  const mcpTools = mcpServers.reduce((n, server) => n + server.tools.length, 0);
  const visibleSessions = sessions.filter((session) => session.firstUserMessage.trim());

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="eyebrow">Projeto</div>
        <button
          type="button"
          onClick={pickWorkspace}
          title="Abrir outra pasta"
          aria-label="Abrir outro workspace"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <FolderTree className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-2">
        <button
          type="button"
          onClick={pickWorkspace}
          title={`${workspace}\n\nClique para trocar de workspace`}
          className="flex w-full items-start gap-2 rounded-lg bg-sidebar-accent px-3 py-2 text-left transition-colors hover:bg-white/5"
        >
          <FolderClosed className="mt-0.5 h-4 w-4 shrink-0 text-sidebar-primary" />
          <div className="min-w-0">
            <div className="truncate font-mono text-xs text-sidebar-accent-foreground">
              {workspace ? shortenPath(workspace, 2) : "Carregando…"}
            </div>
            {workspace ? (
              <div className="truncate text-[10px] text-muted-foreground" title={workspace}>
                {workspace}
              </div>
            ) : null}
          </div>
        </button>
      </div>

      <div className="px-3 pt-4">
        <button
          type="button"
          onClick={newSession}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-white/25 hover:bg-white/[0.03] disabled:opacity-45"
        >
          <Plus className="h-3.5 w-3.5 text-primary" />
          Nova conversa
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-2 pt-4">
        <div className="flex items-center justify-between px-2 pb-2">
          <div className="eyebrow">Recentes</div>
          <span className="font-mono text-[10px] text-muted-foreground">{visibleSessions.length}</span>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {visibleSessions.length === 0 ? (
            <p className="px-2 py-3 text-[11px] leading-relaxed text-muted-foreground">
              Suas conversas deste projeto aparecerão aqui.
            </p>
          ) : (
            visibleSessions.map((session) => {
              const active = session.id === currentSessionId;
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => resumeSession(session.id)}
                  disabled={busy || active}
                  title={session.firstUserMessage}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
                    active
                      ? "bg-sidebar-accent text-foreground"
                      : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                    (busy || active) && "disabled:cursor-default",
                  )}
                >
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs leading-5">
                      {session.firstUserMessage}
                    </span>
                    <span className="block font-mono text-[10px] text-muted-foreground">
                      {formatSessionDate(session.id)}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="border-t border-sidebar-border px-3 py-2">
        <button
          type="button"
          onClick={onToggleMcp}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors",
            mcpOpen
              ? "bg-sidebar-accent text-foreground"
              : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
          )}
        >
          <Plug className="h-3.5 w-3.5 text-chart-1" />
          <span>MCP</span>
          <span className="flex-1" />
          <span className="font-mono">
            {mcpServers.length > 0 ? `${mcpServers.length} · ${mcpTools} tools` : "nenhum"}
          </span>
        </button>

        <button
          type="button"
          onClick={onToggleBrowser}
          className={cn(
            "mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors",
            browserOpen
              ? "bg-sidebar-accent text-foreground"
              : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
          )}
        >
          <Globe className="h-3.5 w-3.5 text-chart-4" />
          <span>Navegador</span>
          <span className="flex-1" />
          <span className="font-mono">{browserOpen ? "aberto" : "fechado"}</span>
        </button>
      </div>

      {engine ? (
        <details className="group border-t border-sidebar-border px-4 py-2 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer list-none select-none py-1 transition-colors hover:text-foreground">
            Detalhes do agente
            <span className="float-right font-mono text-[10px] group-open:hidden">+</span>
            <span className="float-right hidden font-mono text-[10px] group-open:inline">−</span>
          </summary>
          <div className="space-y-1.5 pb-1 pt-2">
            <div className="flex items-center gap-2">
              <Wrench className="h-3.5 w-3.5 text-chart-5" />
              <span><span className="font-mono text-foreground/80">{engine.toolCount}</span> ferramentas</span>
            </div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-chart-4" />
              <span><span className="font-mono text-foreground/80">{engine.skillCount}</span> skills</span>
            </div>
            <div className="flex items-center gap-2" title={`${grants.project.length} permissões deste projeto, ${grants.global.length} globais`}>
              <ShieldCheck className="h-3.5 w-3.5 text-chart-1" />
              <span><span className="font-mono text-foreground/80">{grantCount}</span> permissões salvas</span>
            </div>
            <div className="truncate pt-1 text-[10px]" title={engine.keySource}>
              Chave carregada de: {engine.keySource}
            </div>
          </div>
        </details>
      ) : null}
    </aside>
  );
}

function formatSessionDate(id: string): string {
  const match = id.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})$/);
  if (!match) return id.slice(0, 10);
  const date = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date);
}
