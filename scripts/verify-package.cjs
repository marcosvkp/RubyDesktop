/** Checks the parts of a packaged Windows app that cannot be caught by typecheck. */
const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");

const appDirectory = path.resolve(process.argv[2] || "release/win-unpacked");
const resourcesDirectory = path.join(appDirectory, "resources");
const engineEntry = path.join(resourcesDirectory, "engine", "index.mjs");
const archive = path.join(resourcesDirectory, "app.asar");

if (!fs.existsSync(engineEntry)) {
  throw new Error(`Packaged engine is missing: ${engineEntry}`);
}
if (!fs.existsSync(archive)) {
  throw new Error(`Packaged app archive is missing: ${archive}`);
}

const files = new Set(
  asar.listPackage(archive).map((file) => file.replace(/\\/g, "/").replace(/^\/+/, "")),
);
for (const required of [
  "out/main/index.js",
  "package.json",
  "node_modules/electron-updater/package.json",
]) {
  if (!files.has(required)) {
    throw new Error(`Required file is missing from app.asar: ${required}`);
  }
}

console.log(`Package verified: ${appDirectory}`);
console.log("  engine: resources/engine/index.mjs");
console.log("  updater: node_modules/electron-updater");
