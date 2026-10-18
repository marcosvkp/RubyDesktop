/**
 * Narrow Git operations for the workspace tools panel.
 *
 * Git is invoked with argument arrays (never through a shell), and every path
 * accepted for a file operation must first appear in the current repository
 * status. Worktree removal is intentionally clean-only; this UI never force
 * deletes user changes.
 */
import { execFile } from "node:child_process";
import { basename, join, relative, resolve, sep } from "node:path";
import type {
  GitFileChange,
  GitOperationRequest,
  GitOperationResponse,
  GitStatus,
  GitWorktreeSummary,
} from "@shared/ipc";

const COMMAND_TIMEOUT_MS = 15_000;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_DIFF_CHARS = 500_000;

const literalPath = (path: string): string => `:(literal)${path}`;

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

interface GitError extends Error {
  code?: string | number;
  stderr?: string;
}

export interface GitServiceOptions {
  chooseWorktreeParent: () => Promise<string | undefined>;
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
      },
      (error, stdout, stderr) => {
        if (error) {
          (error as GitError).stderr = stderr;
          reject(error);
          return;
        }
        resolveOutput(stdout);
      },
    );
  });
}

function messageFor(error: unknown): string {
  const gitError = error as GitError;
  if (gitError?.code === "ENOENT") {
    return "Git não foi encontrado. Instale o Git e reinicie o Ruby Desktop.";
  }
  const detail = gitError?.stderr?.trim();
  if (detail) return detail.split(/\r?\n/).at(-1) ?? detail;
  return error instanceof Error ? error.message : String(error);
}

function isNotRepository(error: unknown): boolean {
  return /not a git repository|não é um repositório git/i.test(
    (error as GitError)?.stderr ?? (error instanceof Error ? error.message : ""),
  );
}

async function findRepository(cwd: string): Promise<string> {
  return resolve((await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim());
}

function parseStatus(output: string, root: string): GitStatus {
  const records = output.split("\0");
  const header = records.shift()?.replace(/^##\s*/, "") ?? "";
  const ahead = /\[([^\]]*)\]/.exec(header)?.[1] ?? "";
  const branchPart = header.replace(/\s+\[[^\]]*\]$/, "");
  const separator = branchPart.indexOf("...");
  const branch = (separator < 0 ? branchPart : branchPart.slice(0, separator)) || "HEAD";
  const upstream = separator < 0 ? undefined : branchPart.slice(separator + 3);
  const files: GitFileChange[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const indexStatus = record[0] ?? " ";
    const worktreeStatus = record[1] ?? " ";
    const path = record.slice(3);
    if (!path) continue;
    files.push({
      path,
      indexStatus,
      worktreeStatus,
      status: indexStatus === "?" ? "??" : `${indexStatus}${worktreeStatus}`,
    });
    // Porcelain -z emits the old name as a second record for renames/copies.
    if (indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C") {
      index += 1;
    }
  }

  const counts = /ahead (\d+)(?:, behind (\d+))?/.exec(ahead);
  return {
    available: true,
    isRepository: true,
    root,
    branch,
    ...(upstream ? { upstream } : {}),
    ahead: Number(counts?.[1] ?? 0),
    behind: Number(counts?.[2] ?? 0),
    files,
  };
}

async function getStatus(cwd: string): Promise<GitStatus> {
  let root: string;
  try {
    root = await findRepository(cwd);
  } catch (error) {
    if (isNotRepository(error)) {
      return { available: true, isRepository: false, files: [] };
    }
    throw error;
  }
  const output = await runGit(cwd, [
    "status",
    "--porcelain=v1",
    "-z",
    "--branch",
    "--untracked-files=all",
  ]);
  return parseStatus(output, root);
}

async function checkedFile(cwd: string, path: string): Promise<GitFileChange> {
  if (typeof path !== "string" || path.length === 0 || path.length > 4_096) {
    throw new Error("Selecione um arquivo válido do repositório.");
  }
  const status = await getStatus(cwd);
  if (!status.isRepository) throw new Error("Esta pasta não contém um repositório Git.");
  const file = status.files.find((entry) => entry.path === path);
  if (!file) throw new Error("O arquivo mudou desde a última atualização. Atualize o Git.");
  return file;
}

async function diff(cwd: string, path: string): Promise<string> {
  const file = await checkedFile(cwd, path);
  const parts: string[] = [];
  if (file.indexStatus !== " " && file.indexStatus !== "?") {
    parts.push("STAGED", await runGit(cwd, ["diff", "--cached", "--no-ext-diff", "--", literalPath(path)]));
  }
  if (file.worktreeStatus !== " " || file.indexStatus === "?") {
    if (file.indexStatus === "?") {
      parts.push("Arquivo não rastreado. Adicione-o ao stage para visualizar o diff.");
    } else {
      parts.push("NÃO STAGED", await runGit(cwd, ["diff", "--no-ext-diff", "--", literalPath(path)]));
    }
  }
  const result = parts.join("\n\n").trim();
  return result.length > MAX_DIFF_CHARS
    ? `${result.slice(0, MAX_DIFF_CHARS)}\n\n… diff truncado para caber no painel.`
    : result || "Sem diferenças para exibir.";
}

async function listWorktrees(cwd: string): Promise<GitWorktreeSummary[]> {
  const raw = await runGit(cwd, ["worktree", "list", "--porcelain", "-z"]);
  const records = raw.split("\0");
  const entries: Array<{
    path?: string;
    head?: string;
    branch?: string;
    detached?: boolean;
    locked?: boolean;
    prunable?: boolean;
  }> = [];
  let current: (typeof entries)[number] = {};

  const flush = (): void => {
    if (current.path) entries.push(current);
    current = {};
  };

  for (const field of records) {
    if (!field) {
      flush();
    } else if (field.startsWith("worktree ")) {
      if (current.path) flush();
      current.path = field.slice("worktree ".length);
    } else if (field.startsWith("HEAD ")) {
      current.head = field.slice("HEAD ".length);
    } else if (field.startsWith("branch ")) {
      current.branch = field.slice("branch refs/heads/".length);
    } else if (field === "detached") {
      current.detached = true;
    } else if (field.startsWith("locked")) {
      current.locked = true;
    } else if (field.startsWith("prunable")) {
      current.prunable = true;
    }
  }
  flush();

  return Promise.all(entries.map(async (entry, index): Promise<GitWorktreeSummary> => {
    const path = resolve(entry.path ?? "");
    let dirty = false;
    try {
      dirty = (await runGit(path, ["status", "--porcelain", "-z"])).length > 0;
    } catch {
      // A missing/prunable worktree is represented in the list and can be pruned.
    }
    return {
      path,
      head: entry.head ?? "",
      ...(entry.branch ? { branch: entry.branch } : {}),
      detached: Boolean(entry.detached),
      main: index === 0,
      dirty,
      locked: Boolean(entry.locked),
      prunable: Boolean(entry.prunable),
    };
  }));
}

function worktreeDirectoryName(branch: string): string {
  const safe = branch
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.\-]+|[.\- ]+$/g, "")
    .slice(0, 80);
  if (!safe || safe === "." || safe === "..") {
    throw new Error("O nome da branch não pode ser usado como nome de pasta.");
  }
  return safe;
}

function validateRequest(request: unknown): GitOperationRequest {
  if (!request || typeof request !== "object" || !("action" in request)) {
    throw new Error("Operação Git inválida.");
  }
  const action = (request as { action: unknown }).action;
  if (["status", "worktrees"].includes(String(action))) return request as GitOperationRequest;
  if (action === "diff" && "path" in request && typeof request.path === "string") return request as GitOperationRequest;
  if (action === "stage" && "path" in request && typeof request.path === "string" && "staged" in request && typeof request.staged === "boolean") return request as GitOperationRequest;
  if (action === "commit" && "message" in request && typeof request.message === "string") return request as GitOperationRequest;
  if (action === "createWorktree" && "branch" in request && typeof request.branch === "string") return request as GitOperationRequest;
  if (action === "removeWorktree" && "path" in request && typeof request.path === "string") return request as GitOperationRequest;
  throw new Error("Parâmetros da operação Git inválidos.");
}

export async function runGitOperation(
  cwd: string,
  rawRequest: unknown,
  options: GitServiceOptions,
): Promise<GitOperationResponse> {
  try {
    const request = validateRequest(rawRequest);
    switch (request.action) {
      case "status":
        return { ok: true, status: await getStatus(cwd) };
      case "diff":
        return { ok: true, diff: await diff(cwd, request.path) };
      case "stage": {
        await checkedFile(cwd, request.path);
        await runGit(cwd, request.staged
          ? ["add", "--", literalPath(request.path)]
          : ["restore", "--staged", "--", literalPath(request.path)]);
        return { ok: true };
      }
      case "commit": {
        const message = request.message.trim();
        if (!message || message.length > 500) {
          throw new Error("A mensagem do commit deve ter entre 1 e 500 caracteres.");
        }
        const status = await getStatus(cwd);
        if (!status.isRepository) throw new Error("Esta pasta não contém um repositório Git.");
        if (!status.files.some((file) => file.indexStatus !== " " && file.indexStatus !== "?")) {
          throw new Error("Adicione alterações ao stage antes de criar o commit.");
        }
        await runGit(cwd, ["commit", "-m", message]);
        return { ok: true };
      }
      case "worktrees":
        return { ok: true, worktrees: await listWorktrees(cwd) };
      case "createWorktree": {
        const branch = request.branch.trim();
        if (!branch || branch.length > 200 || branch.startsWith("-")) {
          throw new Error("Informe um nome de branch válido.");
        }
        const root = await findRepository(cwd);
        await runGit(root, ["check-ref-format", "--branch", branch]);
        const parent = await options.chooseWorktreeParent();
        if (!parent) return { ok: true, cancelled: true };
        const name = worktreeDirectoryName(branch);
        const path = join(parent, `${basename(root)}-${name}`);
        await runGit(root, ["worktree", "add", "-b", branch, path]);
        return { ok: true, createdPath: path };
      }
      case "removeWorktree": {
        const path = resolve(request.path);
        const worktrees = await listWorktrees(cwd);
        const target = worktrees.find((worktree) => resolve(worktree.path) === path);
        if (!target) throw new Error("Este worktree não pertence ao repositório atual.");
        if (target.main) throw new Error("O worktree principal não pode ser removido daqui.");
        if (isWithin(path, cwd)) throw new Error("Não é possível remover o workspace que está aberto.");
        if (target.dirty) throw new Error("Este worktree tem alterações. Faça commit ou descarte-as antes de remover.");
        if (target.locked) throw new Error("Este worktree está bloqueado e não pode ser removido.");
        await runGit(cwd, ["worktree", "remove", path]);
        return { ok: true };
      }
    }
  } catch (error) {
    return { ok: false, error: messageFor(error) };
  }
}
