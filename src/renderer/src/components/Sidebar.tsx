import { useState } from "react";
import {
  FolderClosed,
  FolderTree,
  FolderPlus,
  Clock3,
  ChevronDown,
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
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const engine = useStore((s) => s.engine);
  const busy = useStore((s) => s.busy);
  const sessions = useStore((s) => s.sessions);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const newSession = useStore((s) => s.newSession);
  const resumeSession = useStore((s) => s.resumeSession);
  const pickWorkspace = useStore((s) => s.pickWorkspace);
  const recentWorkspaces = useStore((s) => s.recentWorkspaces);
  const switchWorkspace = useStore((s) => s.switchWorkspace);
  const grants = useStore((s) => s.grants);
  const mcpServers = useStore((s) => s.mcpServers);

  const grantCount = grants.project.length + grants.global.length;
  const mcpTools = mcpServers.reduce((n, server) => n + server.tools.length, 0);
  const visibleSessions = sessions.filter((session) =>
    session.firstUserMessage.trim(),
  );

  return (
    <aside className="relative flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar max-[1000px]:w-16">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="eyebrow max-[1000px]:sr-only">Projeto</div>
        <button
          type="button"
          onClick={pickWorkspace}
          title="Abrir outra pasta"
          aria-label="Abrir outro workspace"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 max-[1000px]:mx-auto"
        >
          <FolderTree className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-2">
        <button
          type="button"
          onClick={() => setWorkspaceMenuOpen((open) => !open)}
          title={`${workspace}\n\nMostrar workspaces recentes`}
          aria-label="Workspaces recentes"
          aria-expanded={workspaceMenuOpen}
          aria-controls="workspace-recents-popover"
          className="flex w-full min-w-0 items-start gap-2 rounded-lg bg-sidebar-accent px-3 py-2 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 max-[1000px]:justify-center max-[1000px]:px-1"
        >
          <FolderClosed className="mt-0.5 h-4 w-4 shrink-0 text-sidebar-primary" />
          <div className="min-w-0 flex-1 max-[1000px]:hidden">
            <div className="truncate font-mono text-xs text-sidebar-accent-foreground">
              {workspace ? shortenPath(workspace, 2) : "Carregando…"}
            </div>
            {workspace ? (
              <div
                className="truncate text-[10px] text-muted-foreground"
                title={workspace}
              >
                {workspace}
              </div>
            ) : null}
          </div>
          <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground max-[1000px]:hidden" />
        </button>
        {workspaceMenuOpen ? (
          <div
            id="workspace-recents-popover"
            aria-label="Workspaces recentes"
            onKeyDown={(event) => {
              if (event.key === "Escape") setWorkspaceMenuOpen(false);
            }}
            className="absolute left-2 top-[4.5rem] z-50 w-[min(19rem,calc(100vw-5rem))] rounded-lg border border-line bg-card p-1.5 shadow-xl shadow-black/40"
          >
            <div className="px-2.5 py-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
              Workspaces recentes
            </div>
            <div className="max-h-64 overflow-y-auto">
              {recentWorkspaces.map((recent) => {
                const active =
                  recent.path.toLowerCase() === workspace.toLowerCase();
                return (
                  <button
                    key={recent.path}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    disabled={active}
                    onClick={() => {
                      switchWorkspace(recent.path);
                      setWorkspaceMenuOpen(false);
                    }}
                    title={recent.path}
                    className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:bg-sidebar-accent disabled:opacity-70"
                  >
                    <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-chart-4" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-foreground">
                        {recent.label}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">
                        {recent.path}
                      </span>
                    </span>
                  </button>
                );
              })}
              {recentWorkspaces.length === 0 ? (
                <p className="px-2.5 py-3 text-xs text-muted-foreground">
                  Nenhum workspace recente ainda.
                </p>
              ) : null}
            </div>
            <div className="mt-1 border-t border-line pt-1">
              <button
                type="button"
                onClick={() => {
                  setWorkspaceMenuOpen(false);
                  pickWorkspace();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-foreground transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <FolderPlus className="h-3.5 w-3.5 text-primary" />
                Abrir pasta…
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="px-3 pt-4">
        <button
          type="button"
          onClick={newSession}
          disabled={busy}
          aria-label="Nova conversa"
          className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-white/25 hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-45 max-[1000px]:px-1"
        >
          <Plus className="h-3.5 w-3.5 text-primary" />
          <span className="max-[1000px]:hidden">Nova conversa</span>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-2 pt-4 max-[1000px]:px-1">
        <div className="flex items-center justify-between px-2 pb-2">
          <div className="eyebrow max-[1000px]:sr-only">Recentes</div>
          <span className="font-mono text-[10px] text-muted-foreground max-[1000px]:sr-only">
            {visibleSessions.length}
          </span>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {visibleSessions.length === 0 ? (
            <p className="px-2 py-3 text-[11px] leading-relaxed text-muted-foreground max-[1000px]:sr-only">
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
                  aria-label={`Retomar conversa: ${session.firstUserMessage}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 max-[1000px]:justify-center max-[1000px]:px-1",
                    active
                      ? "bg-sidebar-accent text-foreground"
                      : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                    (busy || active) && "disabled:cursor-default",
                  )}
                >
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 max-[1000px]:hidden">
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

      <div className="border-t border-sidebar-border px-3 py-2 max-[1000px]:px-1">
        <button
          type="button"
          onClick={onToggleMcp}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors",
            mcpOpen
              ? "bg-sidebar-accent text-foreground"
              : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
          )}
          aria-label="Servidores MCP"
          title="Servidores MCP"
        >
          <Plug className="h-3.5 w-3.5 text-chart-1" />
          <span className="max-[1000px]:hidden">MCP</span>
          <span className="flex-1" />
          <span className="font-mono max-[1000px]:hidden">
            {mcpServers.length > 0
              ? `${mcpServers.length} · ${mcpTools} tools`
              : "nenhum"}
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
          aria-label="Navegador"
          title="Navegador"
        >
          <Globe className="h-3.5 w-3.5 text-chart-4" />
          <span className="max-[1000px]:hidden">Navegador</span>
          <span className="flex-1" />
          <span className="font-mono max-[1000px]:hidden">
            {browserOpen ? "aberto" : "fechado"}
          </span>
        </button>
      </div>

      {engine ? (
        <details className="group border-t border-sidebar-border px-4 py-2 text-[11px] text-muted-foreground max-[1000px]:hidden">
          <summary className="cursor-pointer list-none select-none py-1 transition-colors hover:text-foreground">
            Detalhes do agente
            <span className="float-right font-mono text-[10px] group-open:hidden">
              +
            </span>
            <span className="float-right hidden font-mono text-[10px] group-open:inline">
              −
            </span>
          </summary>
          <div className="space-y-1.5 pb-1 pt-2">
            <div className="flex items-center gap-2">
              <Wrench className="h-3.5 w-3.5 text-chart-5" />
              <span>
                <span className="font-mono text-foreground/80">
                  {engine.toolCount}
                </span>{" "}
                ferramentas
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-chart-4" />
              <span>
                <span className="font-mono text-foreground/80">
                  {engine.skillCount}
                </span>{" "}
                skills
              </span>
            </div>
            <div
              className="flex items-center gap-2"
              title={`${grants.project.length} permissões deste projeto, ${grants.global.length} globais`}
            >
              <ShieldCheck className="h-3.5 w-3.5 text-chart-1" />
              <span>
                <span className="font-mono text-foreground/80">
                  {grantCount}
                </span>{" "}
                permissões salvas
              </span>
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
  const match = id.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})$/,
  );
  if (!match) return id.slice(0, 10);
  const date = new Date(
    `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`,
  );
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
  }).format(date);
}
