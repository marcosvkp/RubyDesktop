import markUrl from "../assets/ruby-mark.png";
import { useStore } from "../store";
import { formatTokens } from "../lib/utils";

/**
 * App header carrying the Ruby identity.
 *
 * The wordmark is composed from the mark plus live text rather than the shipped
 * horizontal logo, because that file has "CLI" rasterised into it and cannot
 * produce "Desktop". The treatment mirrors the site: "Ruby" in the grey the
 * wordmark uses, the distinguishing word in the brand red.
 */
export function TitleBar(): React.JSX.Element {
  const models = useStore((s) => s.models);
  const model = useStore((s) => s.model);
  const selectModel = useStore((s) => s.selectModel);
  const contextWindow = useStore((s) => s.contextWindow);

  const current = models.find((m) => m.id === model);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-background px-4">
      <div className="flex items-center gap-2">
        <img src={markUrl} alt="" aria-hidden className="h-5 w-5 object-contain" />
        <span className="text-[15px] leading-none font-semibold tracking-tight">
          <span className="text-wordmark">Ruby</span>
          <span className="text-brand">Desktop</span>
        </span>
      </div>

      <div className="mx-1 h-5 w-px bg-line" />

      <label className="flex items-center gap-2">
        <span className="eyebrow">Model</span>
        <select
          value={model}
          onChange={(e) => selectModel(e.target.value)}
          disabled={models.length === 0}
          className="rounded-md border border-border bg-card px-2 py-1 font-mono text-xs text-foreground transition-colors hover:border-white/20 focus:border-ring focus:outline-none disabled:opacity-50"
        >
          {models.length === 0 ? <option value={model}>{model || "loading…"}</option> : null}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      {current?.contextWindow ? (
        <span className="font-mono text-[11px] text-muted-foreground">
          {formatTokens(current.contextWindow)} ctx
        </span>
      ) : null}

      <div className="flex-1" />

      {contextWindow > 0 ? (
        <span className="font-mono text-[11px] text-muted-foreground">
          {formatTokens(contextWindow)} window
        </span>
      ) : null}
    </header>
  );
}
