import { useEffect, useState } from "react";
import { KeyRound, X } from "lucide-react";
import { useStore } from "../store";

export function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const keySource = useStore((s) => s.engine?.keySource);
  const busy = useStore((s) => s.busy);
  const compacting = useStore((s) => s.compacting);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [maxIterations, setMaxIterations] = useState("50");
  const [settingsError, setSettingsError] = useState("");
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    let mounted = true;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    void window.ruby.getAgentSettings().then((settings) => {
      if (mounted) setMaxIterations(String(settings.maxIterations));
    }).catch(() => {
      if (mounted) setSettingsError("Não foi possível carregar as configurações do agente.");
    });
    return () => {
      mounted = false;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await window.ruby.saveApiKey(key);
      if (!result.ok) {
        setError(result.error ?? "Não foi possível salvar a chave.");
        return;
      }
      setKey("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar a chave.");
    } finally {
      setSaving(false);
    }
  };

  const saveAgentSettings = async (): Promise<void> => {
    if (busy || compacting || savingSettings) return;
    const parsed = Number(maxIterations);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
      setSettingsError("Informe um número inteiro entre 1 e 500.");
      setSettingsSaved(false);
      return;
    }

    setSavingSettings(true);
    setSettingsError("");
    setSettingsSaved(false);
    try {
      const result = await window.ruby.saveAgentSettings(parsed);
      if (!result.ok) {
        setSettingsError(result.error ?? "Não foi possível salvar o limite.");
        return;
      }
      setSettingsSaved(true);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Não foi possível salvar o limite.");
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form onSubmit={(event) => void save(event)} className="w-full max-w-lg rounded-xl border border-line bg-card shadow-2xl shadow-black/50">
        <header className="flex items-center gap-2 border-b border-line px-5 py-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
            <KeyRound className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <h2 id="settings-title" className="text-sm font-semibold">Configurações</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Credenciais do provider Ruby</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar configurações" className="rounded p-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-5">
          {keySource ? (
            <p className="rounded-md border border-line bg-page px-3 py-2 text-xs text-muted-foreground">
              Origem ativa: <span className="font-mono text-foreground/90">{keySource}</span>
            </p>
          ) : null}
          <label className="block space-y-1.5 text-xs font-medium text-foreground">
            Chave de API
            <input
              autoFocus
              type="password"
              autoComplete="new-password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="Cole sua chave Ruby aqui"
              className="w-full rounded-md border border-border bg-page px-3 py-2 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
            />
          </label>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            A chave é criptografada pelo cofre seguro do sistema. Ao salvar, o engine reinicia para usar a nova credencial.
          </p>
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}

          <section className="space-y-3 border-t border-line pt-4" aria-labelledby="agent-limit-title">
            <div>
              <h3 id="agent-limit-title" className="text-xs font-semibold">Limite do agente principal</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Rodadas do modelo que pedem ferramentas por resposta. O padrão é 50; aumentar permite tarefas mais longas e pode elevar o tempo e o uso de tokens. Subagentes têm limite próprio.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label htmlFor="max-agent-iterations" className="text-xs text-muted-foreground">Ciclos máximos</label>
              <input
                id="max-agent-iterations"
                type="number"
                min={1}
                max={500}
                step={1}
                value={maxIterations}
                onChange={(event) => {
                  setMaxIterations(event.target.value);
                  setSettingsSaved(false);
                  setSettingsError("");
                }}
                className="w-24 rounded-md border border-border bg-page px-3 py-2 text-xs text-foreground outline-none transition-colors focus:border-ring"
              />
              <span className="text-[11px] text-muted-foreground">1–500</span>
              <button
                type="button"
                onClick={() => void saveAgentSettings()}
                disabled={busy || compacting || savingSettings}
                className="ml-auto rounded-md border border-line bg-page px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-white/5 disabled:opacity-40"
              >
                {savingSettings ? "Aplicando…" : "Salvar limite"}
              </button>
            </div>
            {settingsError ? <p role="alert" className="text-xs text-destructive">{settingsError}</p> : null}
            {settingsSaved ? <p role="status" className="text-xs text-emerald-400">Limite salvo. O agente foi reiniciado com a nova configuração.</p> : null}
            {(busy || compacting) ? <p className="text-[11px] text-muted-foreground">Finalize o turno atual para alterar o limite.</p> : null}
          </section>
        </div>

        <footer className="flex justify-end gap-2 border-t border-line bg-muted/30 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy || saving || !key.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving ? "Salvando…" : "Salvar chave"}
          </button>
        </footer>
      </form>
    </div>
  );
}
