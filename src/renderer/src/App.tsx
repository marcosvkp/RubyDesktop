import { useEffect, useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { StatusBar } from "./components/StatusBar";
import { GoalBanner } from "./components/GoalBanner";
import { ApprovalModal } from "./components/ApprovalModal";
import { OutputPanel } from "./components/OutputPanel";
import { McpPanel } from "./components/McpPanel";
import { BrowserPanel, BrowserHiddenNotice } from "./components/BrowserPanel";
import { SettingsModal } from "./components/SettingsModal";
import { useStore } from "./store";

export function App(): React.JSX.Element {
  const fatal = useStore((s) => s.fatal);
  const dismissFatal = useStore((s) => s.dismissFatal);
  const workspace = useStore((s) => s.workspace);
  const browserOpen = useStore((s) => s.browser.open);
  const [showOutput, setShowOutput] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  // The panel starts hidden; it is revealed when the agent opens the browser, or
  // when the user asks for it. Kept separate from the engine's own state so
  // hiding the panel does not close the page the agent is working with.
  const [showBrowser, setShowBrowser] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Read the workspace once for the initial paint; the engine's `ready` message
  // confirms it a moment later.
  useEffect(() => {
    void window.ruby.getWorkspace().then((dir) => {
      if (dir && !useStore.getState().workspace) {
        useStore.setState({ workspace: dir });
      }
    });
  }, []);

  // Reveal the browser as soon as the engine opens one: an agent driving a page
  // the user cannot see is the one outcome worth preventing outright.
  useEffect(() => {
    if (browserOpen) setShowBrowser(true);
  }, [browserOpen]);

  const closeBrowserPanel = (): void => {
    setShowBrowser(false);
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
      <TitleBar onOpenSettings={() => setShowSettings(true)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          workspace={workspace}
          onToggleMcp={() => setShowMcp((v) => !v)}
          mcpOpen={showMcp}
          onToggleBrowser={() => {
            if (showBrowser) closeBrowserPanel();
            else window.ruby.openBrowser();
          }}
          browserOpen={showBrowser}
        />
        <main className="flex min-w-0 flex-1 flex-col bg-page">
          {fatal ? <FatalBanner message={fatal} onDismiss={dismissFatal} /> : null}
          <GoalBanner />
          {!showBrowser ? <BrowserHiddenNotice onShow={() => setShowBrowser(true)} /> : null}
          <ChatView />
          {showOutput ? <OutputPanel onClose={() => setShowOutput(false)} /> : null}
          <Composer />
        </main>
        {showMcp ? <McpPanel onClose={() => setShowMcp(false)} /> : null}
        {showBrowser ? <BrowserPanel onClose={closeBrowserPanel} /> : null}
      {showSettings ? <SettingsModal onClose={() => setShowSettings(false)} /> : null}
      </div>
      <StatusBar
        outputOpen={showOutput}
        onToggleOutput={() => setShowOutput((v) => !v)}
      />
      {/* Last in the tree so it paints above everything and captures the keyboard. */}
      <ApprovalModal />
    </div>
  );
}

/**
 * A fatal engine failure (missing key, engine crash) is shown as a banner rather
 * than a modal: the app stays usable for reading the transcript, and the message
 * names the exact thing to fix.
 */
function FatalBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 border-b border-destructive/40 bg-destructive/10 px-5 py-3">
        <span className="mt-0.5 text-xs font-semibold tracking-wide text-destructive uppercase">
          Agente
      </span>
      <p className="flex-1 text-sm text-foreground/90">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-md px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
      >
        Fechar aviso
      </button>
    </div>
  );
}
