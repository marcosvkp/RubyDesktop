import { useEffect, useRef, useState } from "react";
import { Globe, X, RotateCw, Plus, SquareX } from "lucide-react";
import { useStore } from "../store";
import { cn } from "../lib/utils";

/**
 * The embedded browser panel.
 *
 * The page itself is NOT rendered here. It lives in a `WebContentsView` owned by
 * the main process, which is a separate renderer process — so untrusted page code
 * can never reach the app's own DOM, and the page gets no preload and no Node.
 *
 * What this component does is reserve the rectangle and tell the main process where
 * it is. A `WebContentsView` is positioned in window coordinates, not in CSS, so the
 * placeholder below and the real view have to agree exactly or the page appears
 * offset. The measurement is therefore driven by a `ResizeObserver` on the
 * placeholder, which fires on layout, resize and panel toggles alike.
 */
export function BrowserPanel({
  onClose,
  onCloseBrowser,
}: {
  onClose: () => void;
  onCloseBrowser: () => void;
}): React.JSX.Element {
  const browser = useStore((s) => s.browser);
  const placeholder = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState("");

  // Report the placeholder's position whenever it changes, so the native view
  // tracks the CSS layout through resizes and panel toggles.
  useEffect(() => {
    const el = placeholder.current;
    if (!el) return;

    const report = (): void => {
      const rect = el.getBoundingClientRect();
      window.ruby.setBrowserBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [browser.open]);

  useEffect(() => {
    setAddress(browser.url && browser.url !== "about:blank" ? browser.url : "");
  }, [browser.activeTabId, browser.url]);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const raw = address.trim();
    if (!raw) return;
    // Typing "example.com" should work; assume https when no scheme is given.
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    window.ruby.openBrowser(url);
  };

  return (
    <div
      data-testid="browser-panel"
      className="flex w-[46%] min-w-[280px] shrink-0 flex-col border-l border-sidebar-border bg-sidebar max-[1000px]:w-[40%] max-[1000px]:min-w-[250px]"
    >
      <div
        role="tablist"
        aria-label="Abas do navegador"
        aria-orientation="horizontal"
        className="flex h-10 shrink-0 items-end gap-1 overflow-x-auto border-b border-sidebar-border px-2 pt-1"
      >
        {browser.tabs.map((tab, index) => {
          const active = tab.id === browser.activeTabId;
          return (
            <div
              key={tab.id}
              role="presentation"
              className={cn(
                "group flex h-8 min-w-0 max-w-44 shrink-0 items-center rounded-t-md border border-b-0",
                active
                  ? "border-line bg-page"
                  : "border-transparent text-muted-foreground hover:bg-white/[0.035]",
              )}
            >
              <button
                type="button"
                role="tab"
                id={`browser-tab-${tab.id}`}
                aria-selected={active}
                aria-controls="browser-tab-panel"
                aria-label={`Aba ${index + 1}: ${tab.title || tab.url || "Nova aba"}`}
                onClick={() => window.ruby.selectBrowserTab(tab.id)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                    return;
                  event.preventDefault();
                  const delta = event.key === "ArrowRight" ? 1 : -1;
                  const next =
                    browser.tabs[
                      (index + delta + browser.tabs.length) %
                        browser.tabs.length
                    ];
                  if (!next) return;
                  window.ruby.selectBrowserTab(next.id);
                  document.getElementById(`browser-tab-${next.id}`)?.focus();
                }}
                className="min-w-0 flex-1 truncate px-2.5 py-1 text-left text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                {tab.title || tab.url || "Nova aba"}
              </button>
              <button
                type="button"
                aria-label={`Fechar aba ${tab.title || tab.url || index + 1}`}
                title="Fechar aba"
                onClick={() => window.ruby.closeBrowserTab(tab.id)}
                className="mr-1 rounded p-0.5 text-muted-foreground opacity-70 transition hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          aria-label="Nova aba do navegador"
          title="Nova aba"
          onClick={() => window.ruby.newBrowserTab()}
          className="mb-1 rounded p-1 text-muted-foreground transition hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <header className="flex shrink-0 items-center gap-2 border-b border-sidebar-border px-3 py-2">
        <Globe className="h-3.5 w-3.5 shrink-0 text-chart-4" />
        <form onSubmit={submit} className="min-w-0 flex-1">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={
              browser.url && browser.url !== "about:blank"
                ? browser.url
                : "Digite uma URL"
            }
            aria-label="Endereço da página"
            className="w-full rounded border border-line bg-page px-2 py-1 font-mono text-[11px] text-foreground outline-none focus:border-ring"
          />
        </form>
        <button
          type="button"
          onClick={() => browser.url && window.ruby.openBrowser(browser.url)}
          title="Recarregar"
          aria-label="Recarregar página"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <RotateCw className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Ocultar painel do navegador"
          aria-label="Ocultar painel do navegador"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onCloseBrowser}
          title="Encerrar navegador"
          aria-label="Encerrar navegador"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <SquareX className="h-3.5 w-3.5" />
        </button>
      </header>

      {browser.title ? (
        <div className="shrink-0 truncate border-b border-sidebar-border px-3 py-1 text-[10px] text-muted-foreground">
          {browser.title}
        </div>
      ) : null}

      {/*
        The live page is composited over this element by the main process. It must
        stay in the layout (not `display:none`) or there would be no rectangle to
        measure.
      */}
      <div
        ref={placeholder}
        id="browser-tab-panel"
        role="tabpanel"
        aria-labelledby={
          browser.activeTabId ? `browser-tab-${browser.activeTabId}` : undefined
        }
        className="min-h-0 flex-1 bg-page"
      />
    </div>
  );
}

/**
 * Shown when the agent has opened the browser but the panel is hidden.
 *
 * Without this the agent could be driving a page the user cannot see, which is
 * exactly the situation a browser-controlling agent should never create silently.
 */
export function BrowserHiddenNotice({
  onShow,
}: {
  onShow: () => void;
}): React.JSX.Element | null {
  const browser = useStore((s) => s.browser);
  if (!browser.open) return null;

  return (
    <div className="flex items-center gap-3 border-b border-chart-4/40 bg-chart-4/5 px-5 py-2">
      <Globe className="h-3.5 w-3.5 shrink-0 text-chart-4" />
      <p className="flex-1 truncate text-xs text-foreground/90">
        O agente está usando o navegador
        {browser.url && browser.url !== "about:blank" ? `: ${browser.url}` : ""}
      </p>
      <button
        type="button"
        onClick={onShow}
        className={cn(
          "rounded-md border border-line px-2 py-0.5 text-[11px] text-foreground",
          "transition-colors hover:bg-white/5",
        )}
      >
        Mostrar
      </button>
    </div>
  );
}
