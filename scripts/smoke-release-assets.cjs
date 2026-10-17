/** Deterministic integration smoke for current-version release asset staging. */
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const script = path.resolve(__dirname, "collect-release-assets.cjs");

function run(scriptArgs, cwd, env = {}) {
  return spawnSync(process.execPath, [script, ...scriptArgs], {
    cwd,
    env: { ...process.env, RUBY_DESKTOP_UPDATES_ENABLED: "true", ...env },
    encoding: "utf8",
    windowsHide: true,
  });
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ruby-release-assets-smoke-"));
  const release = path.join(root, "release");
  const currentInstaller = "ruby-desktop-0.1.3-win-x64.exe";
  const staleInstaller = "ruby-desktop-0.1.2-win-x64.exe";
  try {
    fs.mkdirSync(release, { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.1.3" }));
    fs.writeFileSync(path.join(release, currentInstaller), "current installer");
    fs.writeFileSync(path.join(release, `${currentInstaller}.blockmap`), "current blockmap");
    fs.writeFileSync(path.join(release, staleInstaller), "stale installer");
    fs.writeFileSync(
      path.join(release, "latest.yml"),
      `version: 0.1.3\nfiles:\n  - url: ${currentInstaller}\n    sha512: fixture\n    size: 16\npath: ${currentInstaller}\nsha512: fixture\n`,
    );

    const success = run(["release", "windows"], root);
    assert.equal(success.status, 0, success.stderr || success.stdout);
    const staged = new Set(fs.readdirSync(path.join(release, "release-assets")));
    assert.deepEqual(staged, new Set([currentInstaller, `${currentInstaller}.blockmap`, "latest.yml"]));
    assert.equal(staged.has(staleInstaller), false, "old installer was excluded from staging");

    // A broken feed must fail before assets can be offered for upload.
    fs.writeFileSync(path.join(release, "latest.yml"), "version: 0.1.3\npath: missing.exe\n");
    const failure = run(["release", "windows"], root);
    assert.notEqual(failure.status, 0, "stale metadata was accepted");
    assert.match(failure.stderr, /unstaged or stale asset/);

    // Linux AppImages and debs use full downloads; electron-builder does not
    // emit a blockmap for either target.
    const linuxRelease = path.join(root, "linux-release");
    const appImage = "ruby-desktop-0.1.3-linux-x86_64.AppImage";
    const deb = "ruby-desktop-0.1.3-linux-x64.deb";
    fs.mkdirSync(linuxRelease, { recursive: true });
    fs.writeFileSync(path.join(linuxRelease, appImage), "appimage");
    fs.writeFileSync(path.join(linuxRelease, deb), "deb package");
    fs.writeFileSync(
      path.join(linuxRelease, "latest-linux.yml"),
      `version: 0.1.3\nfiles:\n  - url: ${appImage}\n    sha512: fixture\n    size: 8\n  - url: ${deb}\n    sha512: fixture\n    size: 10\npath: ${appImage}\nsha512: fixture\n`,
    );
    const linuxSuccess = run(["linux-release", "linux"], root);
    assert.equal(linuxSuccess.status, 0, linuxSuccess.stderr || linuxSuccess.stdout);
    const linuxStaged = new Set(fs.readdirSync(path.join(linuxRelease, "release-assets")));
    assert.deepEqual(linuxStaged, new Set([appImage, deb, "latest-linux.yml"]));

    console.log("RESULT PASS: release staging filters stale assets and validates platform updater metadata");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error("RESULT FAIL:", error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
