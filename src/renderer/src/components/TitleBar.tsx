import markUrl from "../assets/ruby-mark.png";
import { Settings2 } from "lucide-react";

/** App identity and global settings; conversation controls live beside the composer. */
export function TitleBar({ onOpenSettings }: { onOpenSettings: () => void }): React.JSX.Element {
  return (
    <header className="flex h-12 shrink-0 items-center border-b border-line bg-background px-4">
      <div className="flex items-center gap-2">
        <img src={markUrl} alt="" aria-hidden className="h-5 w-5 object-contain" />
        <span className="text-[15px] leading-none font-semibold tracking-tight">
          <span className="text-wordmark">Ruby</span>
          <span className="text-brand">Desktop</span>
        </span>
      </div>

      <div className="flex-1" />

      <button
        type="button"
        onClick={onOpenSettings}
        title="Abrir configurações"
        aria-label="Abrir configurações"
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <Settings2 className="h-4 w-4" />
      </button>
    </header>
  );
}
