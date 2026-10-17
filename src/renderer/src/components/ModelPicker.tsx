import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Eye, Search, Sparkles } from "lucide-react";
import { useStore } from "../store";
import { cn, formatTokens } from "../lib/utils";
import type { ModelSummary, ReasoningEffort } from "@shared/ipc";

const REASONING_OPTIONS: {
  value?: ReasoningEffort;
  label: string;
  wireValue: string;
}[] = [
  { label: "Automático", wireValue: "Padrão do modelo" },
  { value: "none", label: "Desligado", wireValue: "none · off" },
  { value: "minimal", label: "Mínimo", wireValue: "minimal · minimum" },
  { value: "low", label: "Baixo", wireValue: "low" },
  { value: "medium", label: "Médio", wireValue: "medium" },
  { value: "high", label: "Alto", wireValue: "high" },
  { value: "xhigh", label: "Extra-alto", wireValue: "xhigh · extra-high" },
  { value: "max", label: "Máximo", wireValue: "max · maximum" },
];

/** Model switcher placed beside the composer send control. */
export function ModelPicker(): React.JSX.Element {
  const models = useStore((s) => s.models);
  const model = useStore((s) => s.model);
  const reasoningEffort = useStore((s) => s.reasoningEffort);
  const selectModel = useStore((s) => s.selectModel);
  const status = useStore((s) => s.status);
  const busy = useStore((s) => s.busy);
  const compacting = useStore((s) => s.compacting);
  const queueCommandPending = useStore((s) => s.queueCommandPending);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = models.find((entry) => entry.id === model);
  const disabled =
    busy || compacting || queueCommandPending || status !== "ready" || models.length === 0;

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return models;
    return models.filter((entry) =>
      `${entry.label} ${entry.id}`.toLocaleLowerCase().includes(needle),
    );
  }, [models, query]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const label = selected?.label || model || "Carregando modelos…";

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setOpen((value) => !value);
        }}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          busy || compacting || queueCommandPending
            ? "Aguarde o fim da ação atual para trocar de modelo"
            : "Trocar modelo ou esforço de raciocínio"
        }
        className={cn(
          "flex max-w-[230px] items-center gap-2 rounded-lg border border-line bg-background/70 px-3 py-2 text-xs transition-colors",
          "hover:border-primary/40 hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="truncate font-medium text-foreground">{label}</span>
        {selected?.reasoningEfforts?.length ? (
          <span
            className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary"
            title="Esforço de raciocínio"
          >
            {reasoningEffort
              ? REASONING_OPTIONS.find((option) => option.value === reasoningEffort)?.label ??
                reasoningEffort
              : "Auto"}
          </span>
        ) : null}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Selecionar modelo"
          className="absolute right-0 bottom-full z-50 mb-3 max-h-[min(80vh,42rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-line bg-popover text-popover-foreground shadow-2xl shadow-black/50 ring-1 ring-white/5"
        >
          <div className="border-b border-line p-3">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Modelo</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Escolha o modelo para as próximas mensagens
                </p>
              </div>
              <span className="rounded-full border border-line bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                {models.length}
              </span>
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-line bg-background px-2.5 py-2 focus-within:border-ring">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar modelos…"
                className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>
          </div>

          <div
            role="listbox"
            aria-label="Modelos disponíveis"
            className="max-h-56 overflow-y-auto p-1.5"
          >
            {filtered.length > 0 ? (
              filtered.map((entry) => (
                <ModelOption
                  key={entry.id}
                  entry={entry}
                  selected={entry.id === model}
                  onSelect={() => {
                    selectModel(entry.id);
                    setOpen(false);
                  }}
                />
              ))
            ) : (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                Nenhum modelo encontrado.
              </p>
            )}
          </div>
          {selected?.reasoningEfforts?.length ? (
            <div className="border-t border-line p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold">Esforço de raciocínio</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Automático usa o padrão do modelo
                  </p>
                </div>
                <span className="rounded-full border border-line px-2 py-0.5 text-[9px] text-muted-foreground">
                  {reasoningEffort
                    ? REASONING_OPTIONS.find((option) => option.value === reasoningEffort)?.label
                    : "Automático"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {REASONING_OPTIONS.map((option) => {
                  const active = option.value === reasoningEffort;
                  const supported =
                    option.value === undefined ||
                    selected.reasoningEfforts?.includes(option.value) === true;
                  return (
                    <button
                      key={option.wireValue}
                      type="button"
                      aria-pressed={active}
                      title={
                        supported
                          ? option.wireValue
                          : `Este modelo não anuncia suporte a ${option.wireValue}`
                      }
                      onClick={() => selectModel(selected.id, option.value)}
                      disabled={disabled || !supported}
                      className={cn(
                        "min-h-9 rounded-md border px-2 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                        !supported
                          ? "cursor-not-allowed border-line/60 bg-background/30 text-muted-foreground/45"
                          : active
                          ? "border-primary/50 bg-primary/10 text-foreground"
                          : "border-line bg-background/60 text-muted-foreground hover:border-primary/30 hover:text-foreground",
                      )}
                    >
                      <span className="block truncate text-[10px] font-medium">{option.label}</span>
                      <span className="block truncate font-mono text-[9px] opacity-70">{option.wireValue}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : selected?.supportsReasoning ? (
            <div className="border-t border-line px-3 py-2 text-[10px] text-muted-foreground">
              Este modelo tem raciocínio nativo, mas não publica níveis ajustáveis.
            </div>
          ) : null}
          <div className="border-t border-line px-3 py-2 text-[10px] text-muted-foreground">
            A troca fica disponível quando o turno terminar.
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModelOption({
  entry,
  selected,
  onSelect,
}: {
  entry: ModelSummary;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors",
        selected ? "bg-primary/10 text-foreground" : "hover:bg-white/[0.045]",
      )}
    >
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
          selected
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-line bg-background text-muted-foreground",
        )}
      >
        {selected ? <Check className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{entry.label}</span>
        <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">{entry.id}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
        {entry.supportsVision ? <Eye className="h-3.5 w-3.5" aria-label="Suporta imagens" /> : null}
        {entry.supportsReasoning ? <span className="rounded border border-line px-1.5 py-0.5">Raciocínio</span> : null}
        {entry.contextWindow ? <span className="font-mono">{formatTokens(entry.contextWindow)}</span> : null}
      </span>
    </button>
  );
}
