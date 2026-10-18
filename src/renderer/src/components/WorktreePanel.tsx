import { useEffect, useState } from "react";
import {
  AlertCircle,
  FolderGit2,
  GitBranch,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { GitWorktreeSummary } from "@shared/ipc";
import { useStore } from "../store";

/** Lists and manages repository worktrees without deleting dirty directories. */
export function WorktreePanel(): React.JSX.Element {
  const workspace = useStore((state) => state.workspace);
  const busy = useStore((state) => state.busy);
  const [worktrees, setWorktrees] = useState<GitWorktreeSummary[]>([]);
  const [branch, setBranch] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(undefined);
    void window.ruby.gitOperation({ action: "worktrees" }).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setError(result.error ?? "Não foi possível listar os worktrees.");
        setWorktrees([]);
      } else {
        setWorktrees(result.worktrees ?? []);
      }
    }).catch((cause: unknown) => {
      if (live) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (live) setLoading(false);
    });
    return () => { live = false; };
  }, [workspace, revision]);

  const run = async (request: Parameters<typeof window.ruby.gitOperation>[0]): Promise<void> => {
    setPending(true);
    setError(undefined);
    try {
      const result = await window.ruby.gitOperation(request);
      if (!result.ok) {
        setError(result.error ?? "A operação no worktree falhou.");
      } else {
        if (request.action === "createWorktree") setBranch("");
        if (result.createdPath) {
          setError(`Worktree criado em ${result.createdPath}. Você pode abri-lo pela lista.`);
        }
        setRevision((value) => value + 1);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  const open = (target: GitWorktreeSummary): void => {
    if (busy && !window.confirm("O agente está trabalhando. Trocar de workspace vai interromper o turno atual. Deseja continuar?")) return;
    window.ruby.setWorkspace(target.path);
  };

  const remove = (target: GitWorktreeSummary): void => {
    const label = target.branch ?? target.path;
    if (!window.confirm(`Remover o worktree “${label}”? A remoção só funciona quando ele está limpo.`)) return;
    void run({ action: "removeWorktree", path: target.path });
  };

  return (
    <section data-testid="worktree-panel" className="flex min-h-0 flex-1 flex-col bg-sidebar">
      <header className="flex shrink-0 items-center gap-2 border-b border-sidebar-border px-4 py-3">
        <FolderGit2 className="h-4 w-4 text-chart-4" />
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Worktrees Git</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">{workspace}</p>
        </div>
        <button type="button" onClick={() => setRevision((value) => value + 1)} disabled={loading || pending} title="Atualizar worktrees" aria-label="Atualizar worktrees" className="rounded p-1.5 text-muted-foreground transition hover:bg-white/5 hover:text-foreground disabled:opacity-50">
          {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </header>

      {error ? <div role="status" className="flex gap-2 border-b border-line bg-white/[0.025] px-3 py-2 text-[11px] text-muted-foreground"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-chart-4" /><span className="break-all">{error}</span></div> : null}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {loading && worktrees.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Lendo worktrees…</div>
        ) : worktrees.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <GitBranch className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">Nenhum worktree disponível</p>
            <p className="text-xs text-muted-foreground">Abra um repositório Git para ver e criar worktrees.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {worktrees.map((worktree) => {
              const active = workspaceIsInside(workspace, worktree.path);
              return (
                <article key={worktree.path} className={`rounded-lg border p-3 ${active ? "border-primary/45 bg-primary/5" : "border-line bg-page/40"}`}>
                  <div className="flex items-start gap-2">
                    <GitBranch className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${worktree.dirty ? "text-chart-4" : "text-chart-1"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="max-w-full truncate font-mono text-xs font-medium">{worktree.branch ?? "detached HEAD"}</span>
                        {worktree.main ? <Badge>principal</Badge> : null}
                        {active ? <Badge>aberto</Badge> : null}
                        {worktree.dirty ? <Badge tone="warning">alterado</Badge> : <Badge tone="success">limpo</Badge>}
                      </div>
                      <p className="mt-1 break-all font-mono text-[10px] leading-relaxed text-muted-foreground">{worktree.path}</p>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">{worktree.head.slice(0, 8)}{worktree.detached ? " · detached" : ""}{worktree.locked ? " · bloqueado" : ""}{worktree.prunable ? " · removível" : ""}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    {!active ? <button type="button" onClick={() => open(worktree)} disabled={pending} className="rounded-md border border-line px-2.5 py-1.5 text-[11px] text-foreground transition hover:bg-white/5 disabled:opacity-50">Abrir workspace</button> : null}
                    {!worktree.main ? <button type="button" onClick={() => remove(worktree)} disabled={pending || worktree.dirty || worktree.locked || active} title={worktree.dirty ? "Faça commit ou limpe as alterações antes de remover" : "Remover worktree"} aria-label={`Remover worktree ${worktree.branch ?? worktree.path}`} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-[11px] text-muted-foreground transition hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-3 w-3" />Remover</button> : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <form className="shrink-0 space-y-2 border-t border-sidebar-border p-3" onSubmit={(event) => { event.preventDefault(); void run({ action: "createWorktree", branch }); }}>
        <label htmlFor="worktree-branch" className="eyebrow">Criar worktree isolado</label>
        <div className="flex gap-2">
          <input id="worktree-branch" value={branch} onChange={(event) => setBranch(event.target.value)} maxLength={200} placeholder="feature/minha-tarefa" className="min-w-0 flex-1 rounded-md border border-line bg-page px-2.5 py-2 font-mono text-xs outline-none focus:border-ring" />
          <button type="submit" disabled={pending || loading || !branch.trim()} className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45">
            {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Criar
          </button>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">O Git criará uma branch nova. Depois, escolha a pasta pai onde o worktree será criado.</p>
      </form>
    </section>
  );
}

function workspaceIsInside(workspace: string, worktree: string): boolean {
  const windows = window.navigator.platform.toLowerCase().includes("win");
  const normalize = (path: string): string => {
    const trimmed = path.replace(/[\\/]+$/, "").replaceAll("\\", "/");
    return windows ? trimmed.toLowerCase() : trimmed;
  };
  const current = normalize(workspace);
  const root = normalize(worktree);
  return current === root || current.startsWith(`${root}/`);
}

function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "warning" | "success" }): React.JSX.Element {
  const toneClass = tone === "warning" ? "text-chart-4" : tone === "success" ? "text-chart-1" : "text-muted-foreground";
  return <span className={`rounded border border-line px-1.5 py-0.5 text-[9px] ${toneClass}`}>{children}</span>;
}
