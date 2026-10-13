import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

interface WorkerWorktree {
  id: string;
  branch: string;
  path: string;
  root: string;
  baseCommit: string;
  snapshotDir: string;
}

export interface WorktreeDiff {
  diff: string;
  changedFiles: string[];
}

/**
 * Creates isolated worker branches from a snapshot of the current working tree.
 * The snapshot is built with a temporary Git index so the user's real index and
 * branch are never changed. Applying a worker result uses `git apply` without
 * touching the index and is always preceded by an explicit renderer decision.
 */
export class WorktreeManager {
  private workers = new Map<string, WorkerWorktree>();

  async create(id: string, workspace: string): Promise<string> {
    const root = await this.git(workspace, ["rev-parse", "--show-toplevel"]);
    const head = await this.git(root, ["rev-parse", "HEAD"]);
    const snapshotDir = await mkdtemp(join(tmpdir(), "ruby-agent-snapshot-"));
    const indexPath = join(snapshotDir, "index");
    const env = {
      ...process.env,
      GIT_INDEX_FILE: indexPath,
      GIT_AUTHOR_NAME: "Ruby Desktop Agent",
      GIT_AUTHOR_EMAIL: "ruby-agent@localhost",
      GIT_COMMITTER_NAME: "Ruby Desktop Agent",
      GIT_COMMITTER_EMAIL: "ruby-agent@localhost",
    };

    try {
      await this.git(root, ["read-tree", head], env);
      await this.git(root, ["add", "-A", "--", "."], env);
      const tree = await this.git(root, ["write-tree"], env);
      const baseCommit = await this.git(root, ["commit-tree", tree, "-p", head, "-m", "Ruby Desktop worker baseline"], env);
      const safeId = id.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 24);
      const branch = `ruby-agent/${safeId}`;
      const workerPath = join(snapshotDir, "worktree");
      await this.git(root, ["worktree", "add", "-b", branch, workerPath, baseCommit]);
      this.workers.set(id, { id, branch, path: workerPath, root, baseCommit, snapshotDir });
      return workerPath;
    } catch (error) {
      await rm(snapshotDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async diff(id: string): Promise<WorktreeDiff> {
    const worker = this.requireWorker(id);
    await this.git(worker.path, ["add", "-A", "--", "."]);
    const [diff, files] = await Promise.all([
      this.gitRaw(worker.path, ["diff", "--cached", "--binary", "--full-index", worker.baseCommit]),
      this.git(worker.path, ["diff", "--cached", "--name-only", "-z", worker.baseCommit]),
    ]);
    return { diff, changedFiles: files.split("\0").filter(Boolean) };
  }

  async apply(id: string): Promise<void> {
    const worker = this.requireWorker(id);
    const { diff } = await this.diff(id);
    if (!diff.trim()) return;
    const patchPath = join(worker.snapshotDir, "worker.patch");
    await writeFile(patchPath, diff, "utf8");
    try {
      await this.git(worker.root, ["apply", "--check", "--binary", patchPath]);
      await this.git(worker.root, ["apply", "--binary", patchPath]);
    } finally {
      await rm(patchPath, { force: true }).catch(() => {});
    }
  }

  async cleanup(id: string): Promise<void> {
    const worker = this.workers.get(id);
    if (!worker) return;
    this.workers.delete(id);
    await this.git(worker.root, ["worktree", "remove", "--force", worker.path]).catch(() => {});
    await this.git(worker.root, ["branch", "-D", worker.branch]).catch(() => {});
    await rm(worker.snapshotDir, { recursive: true, force: true }).catch(() => {});
  }

  async cleanupAll(): Promise<void> {
    await Promise.all([...this.workers.keys()].map((id) => this.cleanup(id)));
  }

  private requireWorker(id: string): WorkerWorktree {
    const worker = this.workers.get(id);
    if (!worker) throw new Error(`Worker worktree '${id}' no longer exists.`);
    return worker;
  }

  private async git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
    return (await this.gitRaw(cwd, args, env)).trimEnd();
  }

  private async gitRaw(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
    const result = await execFile("git", args, {
      cwd,
      env: env ?? process.env,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      timeout: 60_000,
    });
    return result.stdout;
  }
}
