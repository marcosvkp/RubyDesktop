/** Checks that each packaged Electron executable can run a Node stdio child. */
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const releaseDirectory = path.resolve(process.argv[2] || "release");
const fixture = path.resolve(__dirname, "fixtures", "mcp-stdio-smoke.cjs");

function findPackagedExecutable(directory, platform) {
  if (!fs.existsSync(directory)) return undefined;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (!entry.isDirectory()) continue;

    if (platform === "darwin" && entry.name.endsWith(".app")) {
      const executable = path.join(fullPath, "Contents", "MacOS", "Ruby Desktop");
      if (fs.existsSync(executable)) return executable;
    }

    const nested = findPackagedExecutable(fullPath, platform);
    if (nested) return nested;
  }

  const expectedName = platform === "win32"
    ? "Ruby Desktop.exe"
    : platform === "linux"
      ? "ruby-desktop"
      : undefined;
  if (!expectedName) return undefined;
  const executable = path.join(directory, expectedName);
  return fs.existsSync(executable) && fs.statSync(executable).isFile()
    ? executable
    : undefined;
}

const executable = findPackagedExecutable(releaseDirectory, process.platform);
if (!executable) {
  throw new Error(`Packaged app executable was not found under ${releaseDirectory}`);
}

const result = spawnSync(executable, [fixture], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  input: "stdio probe",
  encoding: "utf8",
  timeout: 20_000,
  windowsHide: true,
});
if (result.error) throw result.error;
assert.equal(result.status, 0, result.stderr || "packaged Electron subprocess failed");
assert.equal(result.stdout, "mcp-stdio:stdio probe");
console.log(`RESULT PASS: packaged ${process.platform} executable supports Node stdio mode`);
