import { useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { ChatErrorBoundary } from "./components/ChatErrorBoundary";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { StatusBar } from "./components/StatusBar";
import { GoalBanner } from "./components/GoalBanner";
import { ApprovalModal } from "./components/ApprovalModal";
import { OutputPanel } from "./components/OutputPanel";
import { BrowserHiddenNotice } from "./components/BrowserPanel";
import { RightToolsPanel, type RightToolTab } from "./components/RightToolsPanel";
import { SettingsModal } from "./components/SettingsModal";
import { TodoListPanel } from "./components/TodoListPanel";
import { cn } from "./lib/utils";
import { useStore } from "./store";

const RIGHT_PANEL_WIDTH_KEY = "ruby-desktop:right-panel-width";
const MIN_RIGHT_PANEL_WIDTH = 250;
const MIN_CHAT_WIDTH = 320;
const RESIZE_HANDLE_WIDTH = 8;

function readRightPanelWidth(): number | null {
  try {
    const saved = Number(window.localStorage.getItem(RIGHT_PANEL_WIDTH_KEY));
    return Number.isFinite(saved) && saved >= MIN_RIGHT_PANEL_WIDTH ? saved : null;
  } catch {
    return null;
  }
}

function saveRightPanelWidth(width: number): void {
  try {
    window.localStorage.setItem(RIGHT_PANEL_WIDTH_KEY, String(Math.round(width)));
  } catch {
    // Resizing should still work when browser storage is unavailable.
  }
}

function getRightPanelWidthLimits(
  layout: HTMLDivElement | null,
  chat: HTMLElement | null,
): { min: number; max: number } {
  const layoutRect = layout?.getBoundingClientRect();
  const chatRect = chat?.getBoundingClientRect();
  const max = layoutRect && chatRect
    ? layoutRect.right - chatRect.left - MIN_CHAT_WIDTH - RESIZE_HANDLE_WIDTH
    : 1000;
  return { min: MIN_RIGHT_PANEL_WIDTH, max: Math.max(MIN_RIGHT_PANEL_WIDTH, max) };
}

export function App(): React.JSX.Element {
  const fatal = useStore((s) => s.fatal);
  const dismissFatal = useStore((s) => s.dismissFatal);
  const workspace = useStore((s) => s.workspace);
  const browserOpen = useStore((s) => s.browser.open);
  const approvalOpen = useStore((s) => Boolean(s.approval));
  const [showOutput, setShowOutput] = useState(false);
  const [rightPanel, setRightPanel] = useState<RightToolTab | null>(null);
  const [rightPanelWidth, setRightPanelWidthState] = useState<number | null>(readRightPanelWidth);
  const rightPanelWidthRef = useRef(rightPanelWidth);
  const workspaceLayoutRef = useRef<HTMLDivElement>(null);
  const chatPanelRef = useRef<HTMLElement>(null);
  const [resizingRightPanel, setResizingRightPanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const setRightPanelWidth = (width: number): void => {
    rightPanelWidthRef.current = width;
    setRightPanelWidthState(width);
  };

  const currentRightPanelWidth = (): number => {
    if (rightPanelWidthRef.current !== null) return rightPanelWidthRef.current;
    return workspaceLayoutRef.current
      ?.querySelector<HTMLElement>('[data-testid="right-tools-panel"]')
      ?.getBoundingClientRect().width ?? MIN_RIGHT_PANEL_WIDTH;
  };

  const resizeRightPanel = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const layout = workspaceLayoutRef.current?.getBoundingClientRect();
    if (!layout) return;
    const { min, max } = getRightPanelWidthLimits(workspaceLayoutRef.current, chatPanelRef.current);
    const width = Math.max(min, Math.min(max, layout.right - event.clientX - RESIZE_HANDLE_WIDTH / 2));
    setRightPanelWidth(width);
  };

  const finishRightPanelResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizingRightPanel(false);
    if (rightPanelWidthRef.current !== null) saveRightPanelWidth(rightPanelWidthRef.current);
  };

  const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const { min, max } = getRightPanelWidthLimits(workspaceLayoutRef.current, chatPanelRef.current);
    const current = currentRightPanelWidth();
    const next = event.key === "Home"
      ? min
      : event.key === "End"
        ? max
        : current + (event.key === "ArrowLeft" ? 24 : -24);
    const width = Math.max(min, Math.min(max, next));
    setRightPanelWidth(width);
    saveRightPanelWidth(width);
  };

  useEffect(() => {
    const clampSavedWidth = (): void => {
      const current = rightPanelWidthRef.current;
      if (current === null) return;
      const { min, max } = getRightPanelWidthLimits(workspaceLayoutRef.current, chatPanelRef.current);
      const width = Math.max(min, Math.min(max, current));
      if (width !== current) {
        rightPanelWidthRef.current = width;
        setRightPanelWidthState(width);
        saveRightPanelWidth(width);
      }
    };
    window.addEventListener("resize", clampSavedWidth);
    clampSavedWidth();
    return () => window.removeEventListener("resize", clampSavedWidth);
  }, []);

  // Read the workspace once for the initial paint; the engine's `ready` message
  // confirms it a moment later.
  useEffect(() => {
    void window.ruby.getWorkspace().then((dir) => {
      if (dir && !useStore.getState().workspace) {
        useStore.setState({ workspace: dir });
      }
    });
    void window.ruby.getRecentWorkspaces().then((recentWorkspaces) => {
      useStore.setState({ recentWorkspaces });
    });
  }, []);

  // Bring an agent-opened browser to the foreground so its work is visible.
  useEffect(() => {
    if (browserOpen) setRightPanel("browser");
    else setRightPanel((current) => current === "browser" ? null : current);
  }, [browserOpen]);

  const selectRightPanel = (tab: RightToolTab): void => {
    if (rightPanel === "browser" && tab !== "browser") {
      window.ruby.setBrowserBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
    setRightPanel(tab);
    if (tab === "browser" && !browserOpen) window.ruby.openBrowser();
  };

  const hideRightPanel = (): void => {
    if (rightPanel === "browser") {
      window.ruby.setBrowserBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
    setRightPanel(null);
  };

  const toggleRightPanel = (tab: RightToolTab): void => {
    if (rightPanel === tab) hideRightPanel();
    else selectRightPanel(tab);
  };

  const closeBrowser = (): void => {
    if (useStore.getState().busy && !window.confirm("O agente está usando o navegador. Fechar a página interrompe esse trabalho. Deseja continuar?")) return;
    window.ruby.setBrowserBounds({ x: 0, y: 0, width: 0, height: 0 });
    setRightPanel(null);
    window.ruby.closeBrowser();
  };

  // Ctrl/Cmd+` toggles the output panel, matching the terminal shortcut people
  // already have in their fingers.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === "`") {
        event.preventDefault();
        setShowOutput((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div inert={approvalOpen} aria-hidden={approvalOpen || undefined} className="flex min-h-0 flex-1 flex-col">
        <TitleBar onOpenSettings={() => setShowSettings(true)} />
        <div ref={workspaceLayoutRef} className="flex min-h-0 min-w-0 flex-1">
          <Sidebar
            workspace={workspace}
            onToggleMcp={() => toggleRightPanel("mcp")}
            mcpOpen={rightPanel === "mcp"}
            onToggleBrowser={() => toggleRightPanel("browser")}
            browserOpen={rightPanel === "browser"}
            onToggleGit={() => toggleRightPanel("git")}
            gitOpen={rightPanel === "git"}
            onToggleWorktrees={() => toggleRightPanel("worktrees")}
            worktreesOpen={rightPanel === "worktrees"}
            onToggleSubAgents={() => toggleRightPanel("subagents")}
            subAgentsOpen={rightPanel === "subagents"}
          />
          <main ref={chatPanelRef} className="flex min-h-0 min-w-0 flex-1 flex-col bg-page">
            {fatal ? <FatalBanner message={fatal} onDismiss={dismissFatal} /> : null}
            <GoalBanner />
            {rightPanel !== "browser" ? <BrowserHiddenNotice onShow={() => selectRightPanel("browser")} /> : null}
            <ChatErrorBoundary><ChatView /></ChatErrorBoundary>
            {showOutput ? <OutputPanel onClose={() => setShowOutput(false)} /> : null}
            <TodoListPanel />
            <Composer />
          </main>
          {rightPanel ? (
            <>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Redimensionar painel lateral"
                aria-valuemin={MIN_RIGHT_PANEL_WIDTH}
                aria-valuemax={getRightPanelWidthLimits(workspaceLayoutRef.current, chatPanelRef.current).max}
                aria-valuenow={Math.round(currentRightPanelWidth())}
                tabIndex={0}
                title="Arraste para redimensionar; use as setas do teclado"
                onKeyDown={handleResizeKeyDown}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setResizingRightPanel(true);
                }}
                onPointerMove={resizeRightPanel}
                onPointerUp={finishRightPanelResize}
                onPointerCancel={finishRightPanelResize}
                onLostPointerCapture={() => {
                  setResizingRightPanel(false);
                  if (rightPanelWidthRef.current !== null) saveRightPanelWidth(rightPanelWidthRef.current);
                }}
                className={cn(
                  "group relative z-10 flex w-2 shrink-0 touch-none cursor-col-resize items-center justify-center border-r border-sidebar-border transition-colors hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
                  resizingRightPanel && "bg-primary/10",
                )}
              >
                <GripVertical className="h-4 w-4 text-muted-foreground/50 transition-colors group-hover:text-primary group-focus-visible:text-primary" />
              </div>
              <RightToolsPanel
                activeTab={rightPanel}
                onSelect={selectRightPanel}
                onClose={hideRightPanel}
                onCloseBrowser={closeBrowser}
                style={rightPanelWidth === null ? undefined : { width: rightPanelWidth, minWidth: MIN_RIGHT_PANEL_WIDTH }}
              />
            </>
          ) : null}
          {showSettings ? <SettingsModal onClose={() => setShowSettings(false)} /> : null}
        </div>
        <StatusBar outputOpen={showOutput} onToggleOutput={() => setShowOutput((v) => !v)} />
      </div>
      {/* Last in the tree so it paints above everything and captures the keyboard. */}
      <ApprovalModal />
    </div>
  );
}

/** Keep engine failures visible without blocking the rest of the app. */
function FatalBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 border-b border-destructive/40 bg-destructive/10 px-5 py-3">
      <span className="mt-0.5 text-xs font-semibold tracking-wide text-destructive uppercase">Agente</span>
      <p className="flex-1 text-sm text-foreground/90">{message}</p>
      <button type="button" onClick={onDismiss} className="rounded-md px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground">Fechar aviso</button>
    </div>
  );
}
