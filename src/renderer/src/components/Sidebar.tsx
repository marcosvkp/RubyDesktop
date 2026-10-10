import { FolderClosed, FolderTree, Wrench, Sparkles, ShieldCheck, Plug, Globe } from "lucide-react";
import { useStore } from "../store";
import { cn, shortenPath } from "../lib/utils";

/**
 * Workspace rail.
 *
 * The workspace is not a label but the engine's `cwd`: switching it restarts the
 * engine in the new directory, which is what isolates sessions, permission grants,
 * goals and path containment from each other.
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
  const reset = useStore((s) => s.reset);
  const items = useStore((s) => s.items);
  const pickWorkspace = useStore((s) => s.pickWorkspace);
  const grants = useStore((s) => s.grants);
  const mcpServers = useStore((s) => s.mcpServers);

  const grantCount = grants.project.length + grants.global.length;
  const mcpTools = mcpServers.reduce((n, s) => n + s.tools.length, 0);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="eyebrow">Workspace</div>
        <button
          type="button"
          onClick={pickWorkspace}
          title="Open a different folder"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <FolderTree className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-2">
        <button
          type="button"
          onClick={pickWorkspace}
          title={`${workspace}\n\nClick to switch workspace`}
          className="flex w-full items-start gap-2 rounded-lg bg-sidebar-accent px-3 py-2 text-left transition-colors hover:bg-white/5"
        >
          <FolderClosed className="mt-0.5 h-4 w-4 shrink-0 text-sidebar-primary" />
          <div className="min-w-0">
            <div className="truncate font-mono text-xs text-sidebar-accent-foreground">
              {workspace ? shortenPath(workspace, 2) : "…"}
            </div>
            {workspace ? (
              <div className="truncate text-[10px] text-muted-foreground" title={workspace}>
                {workspace}
              </div>
            ) : null}
          </div>
        </button>
      </div>

      <div className="flex-1" />

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
            {mcpServers.length > 0 ? `${mcpServers.length}s · ${mcpTools}t` : "none"}
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
          <span>Browser</span>
          <span className="flex-1" />
          <span className="font-mono">{browserOpen ? "open" : "closed"}</span>
        </button>
      </div>

      {engine ? (
        <div className="space-y-1.5 border-t border-sidebar-border px-4 py-3 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <Wrench className="h-3.5 w-3.5 text-chart-5" />
            <span>
              <span className="font-mono text-foreground/80">{engine.toolCount}</span> tools
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-chart-4" />
            <span>
              <span className="font-mono text-foreground/80">{engine.skillCount}</span> skills
            </span>
          </div>
          <div
            className="flex items-center gap-2"
            title={`${grants.project.length} grant(s) for this workspace, ${grants.global.length} global`}
          >
            <ShieldCheck className="h-3.5 w-3.5 text-chart-1" />
            <span>
              <span className="font-mono text-foreground/80">{grantCount}</span> pre-approved
            </span>
          </div>
          <div className="truncate pt-1 text-[10px]" title={engine.keySource}>
            key: {engine.keySource}
          </div>
        </div>
      ) : null}

      <div className="border-t border-sidebar-border p-3">
        <button
          type="button"
          onClick={reset}
          disabled={items.length === 0}
          className="w-full rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground disabled:opacity-40"
        >
          New session
        </button>
      </div>
    </aside>
  );
}
