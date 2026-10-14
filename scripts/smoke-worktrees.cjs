/** Deterministic integration smoke for worker snapshot, review and apply. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function git(cwd, ...args) {
  return require("node:child_process").execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function normalizedFile(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

async function main() {
  const { WorktreeManager } = await import("../out/engine/worktrees.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ruby-worktree-smoke-"));
  const manager = new WorktreeManager();
  const workerId = "reviewed-worker";
  let workerPath;

  try {
    git(root, "init", "-q");
    git(root, "config", "user.name", "Ruby Desktop Smoke");
    git(root, "config", "user.email", "smoke@rubycli.cloud");
    fs.writeFileSync(path.join(root, "tracked.txt"), "committed baseline\n");
    git(root, "add", "tracked.txt");
    git(root, "commit", "-q", "-m", "baseline");

    // The worker snapshot must include both unstaged edits and new files, while
    // leaving the user's worktree untouched until apply.
    fs.writeFileSync(path.join(root, "tracked.txt"), "local edit\n");
    fs.writeFileSync(path.join(root, "untracked.txt"), "local untracked\n");
    workerPath = await manager.create(workerId, root);
    assert.equal(normalizedFile(path.join(workerPath, "tracked.txt")), "local edit\n");
    assert.equal(normalizedFile(path.join(workerPath, "untracked.txt")), "local untracked\n");
    assert.equal(normalizedFile(path.join(root, "tracked.txt")), "local edit\n");

    fs.writeFileSync(path.join(workerPath, "tracked.txt"), "approved worker result\n");
    fs.writeFileSync(path.join(workerPath, "worker-output.txt"), "approved new file\n");
    const reviewed = await manager.diff(workerId);
    assert.deepEqual(new Set(reviewed.changedFiles), new Set(["tracked.txt", "worker-output.txt"]));
    assert.match(reviewed.diff, /approved worker result/);

    // A background process may continue editing after review. Applying must use
    // the exact reviewed bytes, not a newly calculated diff.
    fs.writeFileSync(path.join(workerPath, "tracked.txt"), "unreviewed late edit\n");
    await manager.apply(workerId);
    assert.equal(normalizedFile(path.join(root, "tracked.txt")), "approved worker result\n");
    assert.equal(normalizedFile(path.join(root, "worker-output.txt")), "approved new file\n");

    await manager.cleanup(workerId);
    assert.equal(fs.existsSync(workerPath), false, "cleanup removed the worker checkout");
    assert.equal(git(root, "branch", "--list", "ruby-agent/*"), "", "cleanup removed its branch");
    assert.equal(git(root, "worktree", "list", "--porcelain").split("\n").filter((line) => line.startsWith("worktree ")).length, 1);

    console.log("RESULT PASS: worker snapshot, reviewed diff apply, TOCTOU guard and cleanup");
  } finally {
    await manager.cleanupAll();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("RESULT FAIL:", error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
