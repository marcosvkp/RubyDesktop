import { X, Bot, GitBranch, Globe, Plug, Waypoints } from "lucide-react";
import { BrowserPanel } from "./BrowserPanel";
import { GitPanel } from "./GitPanel";
import { McpPanel } from "./McpPanel";
import { WorktreePanel } from "./WorktreePanel";
import { SubAgentsPanel } from "./SubAgentsPanel";
import { cn } from "../lib/utils";

export type RightToolTab = "browser" | "git" | "worktrees" | "mcp" | "subagents";

const tabs: Array<{ id: RightToolTab; label: string; icon: typeof Globe }> = [
  { id: "browser", label: "Navegador", icon: Globe },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "worktrees", label: "Worktrees", icon: Waypoints },
  { id: "mcp", label: "MCP", icon: Plug },
  { id: "subagents", label: "Subagentes", icon: Bot },
];

/** Shared right-side tool surface; switching tabs keeps the chat workspace intact. */
export function RightToolsPanel({
  activeTab,
  onSelect,
  onClose,
  onCloseBrowser,
  style,
}: {
  activeTab: RightToolTab;
  onSelect: (tab: RightToolTab) => void;
  onClose: () => void;
  onCloseBrowser: () => void;
  style?: React.CSSProperties;
}): React.JSX.Element {
  return (
    <aside data-testid="right-tools-panel" style={style} className="flex min-h-0 w-[46%] min-w-[280px] shrink-0 flex-col border-l border-sidebar-border bg-sidebar max-[1000px]:w-[40%] max-[1000px]:min-w-[250px]">
      <div role="tablist" aria-label="Ferramentas do workspace" className="flex h-11 shrink-0 items-end gap-1 overflow-x-auto border-b border-sidebar-border px-2 pt-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls="workspace-tool-panel"
            onClick={() => onSelect(id)}
            className={cn(
              "flex h-9 shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-[11px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              activeTab === id
                ? "border-line bg-page text-foreground"
                : "border-transparent text-muted-foreground hover:bg-white/[0.035] hover:text-foreground",
            )}
          >
            <Icon className={cn("h-3.5 w-3.5", id === "mcp" && "text-chart-1", id === "browser" && "text-chart-4")} />
            {label}
          </button>
        ))}
        <span className="min-w-0 flex-1" />
        <button type="button" onClick={onClose} title="Fechar painel" aria-label="Fechar painel de ferramentas" className="mb-1 rounded p-1.5 text-muted-foreground transition hover:bg-white/5 hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div id="workspace-tool-panel" role="tabpanel" className="flex min-h-0 flex-1 flex-col">
        {activeTab === "browser" ? <BrowserPanel onClose={onClose} onCloseBrowser={onCloseBrowser} /> : null}
        {activeTab === "git" ? <GitPanel /> : null}
        {activeTab === "worktrees" ? <WorktreePanel /> : null}
        {activeTab === "mcp" ? <McpPanel onClose={onClose} /> : null}
        {activeTab === "subagents" ? <SubAgentsPanel /> : null}
      </div>
    </aside>
  );
}
