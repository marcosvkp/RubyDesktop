import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { useStore } from "../store";
import { cn } from "../lib/utils";

/**
 * Prompt input.
 *
 * Enter sends, Shift+Enter inserts a newline — the convention every other agent
 * UI uses, so it needs no explanation in the interface. The textarea grows with
 * its content up to a cap, then scrolls.
 */
export function Composer(): React.JSX.Element {
  const send = useStore((s) => s.send);
  const abort = useStore((s) => s.abort);
  const busy = useStore((s) => s.busy);
  const status = useStore((s) => s.status);
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const disabled = status !== "ready" && status !== "busy";

  // Auto-grow: reset to auto first so the box can shrink again after sending.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  function submit(): void {
    if (busy || disabled || !text.trim()) return;
    send(text);
    setText("");
  }

  return (
    <div className="shrink-0 border-t border-line bg-page px-6 py-4">
      <div className="mx-auto max-w-3xl">
        <div
          className={cn(
            "flex items-end gap-2 rounded-lg border bg-card px-3 py-2 transition-colors",
            disabled ? "border-border opacity-60" : "border-border focus-within:border-ring",
          )}
        >
          <textarea
            ref={ref}
            rows={1}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              disabled ? "Waiting for the engine…" : "Describe what you want done in this project…"
            }
            className="max-h-[200px] flex-1 resize-none bg-transparent py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />

          {busy ? (
            <button
              type="button"
              onClick={abort}
              title="Stop"
              className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={disabled || !text.trim()}
              title="Send"
              className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-muted-foreground">
          <span>Enter to send · Shift+Enter for a new line</span>
          <span className="font-mono">{status}</span>
        </div>
      </div>
    </div>
  );
}
