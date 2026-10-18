import { useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  CircleDot,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import type { GitFileChange, GitStatus } from "@shared/ipc";
import { cn } from "../lib/utils";
import { useStore } from "../store";

/** A compact workspace view for inspecting, staging and committing Git changes. */
export function GitPanel(): React.JSX.Element {
  const workspace = useStore((state) => state.workspace);
  const [status, setStatus] = useState<GitStatus>();
  const [selectedPath, setSelectedPath] = useState<string>();
  const [diff, setDiff] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(undefined);
    void window.ruby.gitOperation({ action: "status" }).then((result) => {
      if (!live) return;
      if (!result.ok || !result.status) {
        setError(result.error ?? "Não foi possível ler o status do Git.");
        setStatus(undefined);
        return;
      }
      setStatus(result.status);
      setSelectedPath((current) =>
        current && result.status?.files.some((file) => file.path === current)
          ? current
          : result.status?.files[0]?.path,
      );
    }).catch((cause: unknown) => {
      if (live) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (live) setLoading(false);
    });
    return () => { live = false; };
  }, [workspace, revision]);

  useEffect(() => {
    if (!selectedPath) {
      setDiff("");
      return;
    }
    let live = true;
    void window.ruby.gitOperation({ action: "diff", path: selectedPath }).then((result) => {
      if (!live) return;
      setDiff(result.ok ? result.diff ?? "Sem diferenças para exibir." : result.error ?? "Não foi possível carregar o diff.");
    });
    return () => { live = false; };
  }, [selectedPath, revision]);

  const run = async (request: Parameters<typeof window.ruby.gitOperation>[0]): Promise<void> => {
    setPending(true);
    setError(undefined);
    try {
      const result = await window.ruby.gitOperation(request);
      if (!result.ok) {
        setError(result.error ?? "A operação Git falhou.");
        return;
      }
      if (request.action === "commit") setCommitMessage("");
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  const files = status?.files ?? [];
  const stagedCount = files.filter(isStaged).length;
  const unstagedCount = files.filter(isUnstaged).length;

  return (
    <section data-testid="git-panel" className="flex min-h-0 flex-1 flex-col bg-sidebar">
      <header className="flex shrink-0 items-center gap-2 border-b border-sidebar-border px-4 py-3">
        <GitBranch className="h-4 w-4 text-chart-4" />
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Git do workspace</p>
          {status?.branch ? <p className="truncate font-mono text-[10px] text-muted-foreground">{status.branch}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => setRevision((value) => value + 1)}
          disabled={loading || pending}
          title="Atualizar status"
          aria-label="Atualizar status do Git"
          className="rounded p-1.5 text-muted-foreground transition hover:bg-white/5 hover:text-foreground disabled:opacity-50"
        >
          {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </header>

      {error ? <ErrorNotice message={error} /> : null}
      {loading && !status ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Lendo o repositório…</div>
      ) : error && !status ? (
        <EmptyState message="Não foi possível acessar o Git." detail={error} />
      ) : status && !status.available ? (
        <EmptyState message="Git não está disponível neste computador." />
      ) : status && !status.isRepository ? (
        <EmptyState message="Esta pasta ainda não é um repositório Git." detail={workspace} />
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-sidebar-border px-4 py-3">
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-muted-foreground" title={status?.root}>
              <CircleDot className="h-3 w-3 shrink-0 text-chart-1" />
              <span className="truncate">{status?.branch ?? "sem branch"}</span>
            </span>
            <span className="flex-1" />
            {status?.upstream ? <span className="font-mono text-[10px] text-muted-foreground">↑{status.ahead ?? 0} ↓{status.behind ?? 0}</span> : null}
            <span className="font-mono text-[10px] text-muted-foreground">{files.length} arquivo{files.length === 1 ? "" : "s"}</span>
          </div>

          {files.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <Check className="h-6 w-6 text-chart-1" />
              <p className="text-sm font-medium">Workspace limpo</p>
              <p className="text-xs text-muted-foreground">Não há alterações locais para revisar.</p>
            </div>
          ) : (
            <>
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center justify-between px-3 py-2">
                  <span className="eyebrow">Alterações</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{stagedCount} staged · {unstagedCount} locais</span>
                </div>
                <div className="min-h-28 max-h-[38%] shrink-0 overflow-auto px-2 pb-2">
                  {files.map((file) => <FileRow key={file.path} file={file} selected={selectedPath === file.path} pending={pending} onSelect={() => setSelectedPath(file.path)} onStage={() => void run({ action: "stage", path: file.path, staged: true })} onUnstage={() => void run({ action: "stage", path: file.path, staged: false })} />)}
                </div>
                <div className="flex min-h-0 flex-1 flex-col border-t border-sidebar-border">
                  <div className="flex shrink-0 items-center gap-2 px-3 py-2">
                    <FileDiff className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate font-mono text-[10px] text-muted-foreground">{selectedPath ?? "Selecione um arquivo"}</span>
                  </div>
                  <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words border-t border-sidebar-border bg-page/60 p-3 font-mono text-[10px] leading-relaxed text-foreground/80">{diff || (selectedPath ? "Carregando diff…" : "Escolha um arquivo para revisar as alterações.")}</pre>
                </div>
              </div>

              <form
                className="shrink-0 space-y-2 border-t border-sidebar-border p-3"
                onSubmit={(event) => { event.preventDefault(); void run({ action: "commit", message: commitMessage }); }}
              >
                <label htmlFor="git-commit-message" className="eyebrow">Commit · {stagedCount} staged</label>
                <div className="flex gap-2">
                  <input id="git-commit-message" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} maxLength={500} placeholder="Mensagem do commit" className="min-w-0 flex-1 rounded-md border border-line bg-page px-2.5 py-2 text-xs outline-none focus:border-ring" />
                  <button type="submit" disabled={pending || stagedCount === 0 || !commitMessage.trim()} className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45">
                    {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <GitCommitHorizontal className="h-3.5 w-3.5" />}
                    Commit
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground">Só arquivos staged entram no commit.</p>
              </form>
            </>
          )}
        </>
      )}
    </section>
  );
}

function isStaged(file: GitFileChange): boolean {
  return file.indexStatus !== " " && file.indexStatus !== "?";
}

function isUnstaged(file: GitFileChange): boolean {
  return file.indexStatus === "?" || file.worktreeStatus !== " ";
}

function FileRow({
  file,
  selected,
  pending,
  onSelect,
  onStage,
  onUnstage,
}: {
  file: GitFileChange;
  selected: boolean;
  pending: boolean;
  onSelect: () => void;
  onStage: () => void;
  onUnstage: () => void;
}): React.JSX.Element {
  return (
    <div className={cn("group flex items-center gap-1 rounded-md px-1.5 py-1", selected ? "bg-sidebar-accent" : "hover:bg-white/[0.035]")}>
      <button type="button" onClick={onSelect} title={file.path} className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
        <span className="w-5 shrink-0 text-center font-mono text-[10px] text-chart-4">{file.status}</span>
        <span className="truncate font-mono text-[10px] text-foreground/85">{file.path}</span>
      </button>
      {isUnstaged(file) ? <button type="button" disabled={pending} onClick={onStage} title="Adicionar ao stage" aria-label={`Adicionar ${file.path} ao stage`} className="rounded px-1.5 py-1 text-[10px] text-muted-foreground opacity-0 transition hover:bg-white/10 hover:text-foreground focus:opacity-100 group-hover:opacity-100 disabled:opacity-40">Stage</button> : null}
      {isStaged(file) ? <button type="button" disabled={pending} onClick={onUnstage} title="Tirar do stage" aria-label={`Tirar ${file.path} do stage`} className="rounded px-1.5 py-1 text-[10px] text-muted-foreground opacity-0 transition hover:bg-white/10 hover:text-foreground focus:opacity-100 group-hover:opacity-100 disabled:opacity-40">Unstage</button> : null}
    </div>
  );
}

function ErrorNotice({ message }: { message: string }): React.JSX.Element {
  return <div role="alert" className="flex gap-2 border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{message}</span></div>;
}

function EmptyState({ message, detail }: { message: string; detail?: string }): React.JSX.Element {
  return <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center"><GitBranch className="h-6 w-6 text-muted-foreground" /><p className="text-sm font-medium">{message}</p>{detail ? <p className="max-w-full truncate font-mono text-[10px] text-muted-foreground">{detail}</p> : null}</div>;
}
