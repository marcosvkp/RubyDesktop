/** Deterministic smoke for signed updates and GitHub download fallbacks. */
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { startAutoUpdates } = require("../out/main/update-manager.js");

function createScenario(overrides = {}) {
  const timers = [];
  const errors = [];
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdatesCalls: 0,
    quitAndInstallCalls: 0,
    checkForUpdates() {
      this.checkForUpdatesCalls += 1;
      return Promise.resolve();
    },
    quitAndInstall() {
      this.quitAndInstallCalls += 1;
    },
  });
  const calls = { github: 0, confirm: 0 };
  const options = {
    isPackaged: true,
    platform: "win32",
    resourcesPath: "/resources",
    macAutoUpdatesEnabled: true,
    hasFile: () => true,
    autoUpdater: updater,
    checkGithubRelease: async () => {
      calls.github += 1;
    },
    confirmInstall: async () => {
      calls.confirm += 1;
      return true;
    },
    schedule(callback, delayMs) {
      timers.push({ callback, delayMs });
      return timers.length;
    },
    onUpdaterError: (error) => errors.push(error),
    onFallbackError: (error) => errors.push(error),
    ...overrides,
  };
  startAutoUpdates(options);
  return { calls, errors, options, timers, updater };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

async function main() {
  const unpackaged = createScenario({ isPackaged: false });
  assert.equal(unpackaged.timers.length, 0, "development must not start updates");

  const unsigned = createScenario({ hasFile: () => false });
  assert.equal(unsigned.timers.length, 1, "unsigned builds should schedule GitHub fallback");
  assert.equal(unsigned.timers[0].delayMs, 15_000);
  unsigned.timers[0].callback();
  await flushPromises();
  assert.equal(unsigned.calls.github, 1, "unsigned fallback should check GitHub");
  assert.equal(unsigned.updater.checkForUpdatesCalls, 0);

  const unsignedMac = createScenario({
    platform: "darwin",
    hasFile: () => true,
    macAutoUpdatesEnabled: false,
  });
  assert.equal(unsignedMac.timers.length, 1, "unsigned macOS should use GitHub fallback");
  assert.equal(unsignedMac.updater.checkForUpdatesCalls, 0);

  const signed = createScenario();
  assert.equal(signed.updater.autoDownload, true);
  assert.equal(signed.updater.autoInstallOnAppQuit, true);
  assert.equal(signed.timers.length, 1, "signed builds should schedule feed check");
  signed.timers[0].callback();
  await flushPromises();
  assert.equal(signed.updater.checkForUpdatesCalls, 1);

  signed.updater.emit("error", new Error("feed unavailable"));
  signed.updater.emit("error", new Error("repeated error"));
  assert.equal(signed.timers.length, 2, "updater errors should queue one fallback");
  signed.timers[1].callback();
  await flushPromises();
  assert.equal(signed.calls.github, 1);

  signed.updater.emit("update-downloaded", { version: "0.1.4" });
  await flushPromises();
  assert.equal(signed.calls.confirm, 1);
  assert.equal(signed.updater.quitAndInstallCalls, 1);

  const rejected = createScenario();
  rejected.options.autoUpdater.checkForUpdates = () =>
    Promise.reject(new Error("feed request rejected"));
  rejected.timers[0].callback();
  await flushPromises();
  assert.equal(rejected.errors.length, 1, "feed rejection should be reported");
  assert.equal(rejected.timers.length, 2, "feed rejection should schedule fallback");

  console.log("RESULT PASS: update feed, install prompt, and GitHub fallbacks verified");
}

main().catch((error) => {
  console.error("RESULT FAIL:", error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
