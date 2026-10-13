import { useState } from "react";
import { KeyRound, X } from "lucide-react";
import { useStore } from "../store";

export function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const keySource = useStore((s) => s.engine?.keySource);
  const busy = useStore((s) => s.busy);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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
