import { FolderClosed, Wrench, Sparkles } from "lucide-react";
import { useStore } from "../store";
import { shortenPath } from "../lib/utils";

/**
 * Workspace rail.
 *
 * M1 shows the single workspace the engine was started in. The list becomes
 * interactive in M2, which is why the markup is already a list rather than a
 * single label.
 */
export function Sidebar({ workspace }: { workspace: string }): React.JSX.Element {
  const engine = useStore((s) => s.engine);
  const reset = useStore((s) => s.reset);
  const items = useStore((s) => s.items);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="px-4 pt-4 pb-2">
        <div className="eyebrow">Workspace</div>
      </div>

      <div className="px-2">
        <div className="flex items-start gap-2 rounded-lg bg-sidebar-accent px-3 py-2">
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
        </div>
      </div>

      <div className="flex-1" />

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
