import { useStore, PERMISSION_MODE_LABEL } from "../store";
import { cn, formatTokens } from "../lib/utils";
import type { PermissionMode } from "@shared/ipc";

const MODES: PermissionMode[] = ["normal", "acceptEdits", "plan"];

/**
 * Bottom status strip: engine state, permission mode, compaction and the context meter.
 *
 * The meter exists from M1 because it is the visible half of compaction: the
 * engine auto-compacts at 75% of the window, so the user needs to see that
 * threshold approaching rather than be surprised by it.
 *
 * The permission mode sits here rather than in a settings dialog because it is a
 * *mode*: it changes what the agent may do without asking, so it should be visible
 * at all times, next to the other always-on state.
 */
export function StatusBar(): React.JSX.Element {
  const status = useStore((s) => s.status);
  const used = useStore((s) => s.contextUsed);
  const window_ = useStore((s) => s.contextWindow);
  const permissionMode = useStore((s) => s.permissionMode);
  const setPermissionMode = useStore((s) => s.setPermissionMode);
  const compacting = useStore((s) => s.compacting);
  const compact = useStore((s) => s.compact);
  const busy = useStore((s) => s.busy);

  const ratio = window_ > 0 ? Math.min(used / window_, 1) : 0;
  const percent = Math.round(ratio * 100);

  // Green -> amber -> red as the window fills, matching the chart palette.
  const barColor = ratio >= 0.75 ? "bg-destructive" : ratio >= 0.6 ? "bg-chart-3" : "bg-chart-5";

  const dotColor =
    status === "ready"
      ? "bg-chart-5"
      : status === "busy"
        ? "bg-chart-3"
        : status === "error"
          ? "bg-destructive"
          : "bg-muted-foreground";

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-background px-4 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", dotColor)} />
        <span className="font-mono">{status}</span>
      </span>

      <span className="flex items-center gap-1" title="Permission mode — /mode ask | edits | plan">
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setPermissionMode(mode)}
            className={cn(
              "rounded px-1.5 py-0.5 transition-colors",
              permissionMode === mode
                ? "bg-sidebar-accent text-foreground"
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
        title="Summarize older messages now (/compact)"
        className="rounded px-1.5 py-0.5 transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {compacting ? "compacting…" : "compact"}
      </button>

      <span className="flex-1" />

      {window_ > 0 ? (
        <span className="flex items-center gap-2" title="Context window usage">
          <span className="font-mono">
            {formatTokens(used)} / {formatTokens(window_)}
          </span>
          <span className="h-1 w-24 overflow-hidden rounded-full bg-white/10">
            <span
              className={cn("block h-full rounded-full transition-all", barColor)}
              style={{ width: `${percent}%` }}
            />
          </span>
          <span className="w-8 text-right font-mono">{percent}%</span>
        </span>
      ) : null}
    </footer>
  );
}
