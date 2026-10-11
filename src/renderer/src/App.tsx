import { useEffect } from "react";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { StatusBar } from "./components/StatusBar";
import { GoalBanner } from "./components/GoalBanner";
import { ApprovalModal } from "./components/ApprovalModal";
import { useStore } from "./store";

export function App(): React.JSX.Element {
  const fatal = useStore((s) => s.fatal);
  const dismissFatal = useStore((s) => s.dismissFatal);
  const workspace = useStore((s) => s.workspace);

  // Read the workspace once for the initial paint; the engine's `ready` message
  // confirms it a moment later.
  useEffect(() => {
    void window.ruby.getWorkspace().then((dir) => {
      if (dir && !useStore.getState().workspace) {
        useStore.setState({ workspace: dir });
      }
    });
  }, []);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar workspace={workspace} />
        <main className="flex min-w-0 flex-1 flex-col bg-page">
          {fatal ? <FatalBanner message={fatal} onDismiss={dismissFatal} /> : null}
          <GoalBanner />
          <ChatView />
          <Composer />
        </main>
      </div>
      <StatusBar />
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
        Engine
      </span>
      <p className="flex-1 text-sm text-foreground/90">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-md px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
      >
        Dismiss
      </button>
    </div>
  );
}
