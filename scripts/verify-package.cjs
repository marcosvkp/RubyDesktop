/** Checks the packaged desktop shell and external engine for every platform. */
const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");

const packageRoot = path.resolve(process.argv[2] || "release/win-unpacked");
const updatesEnabled = process.env.RUBY_DESKTOP_UPDATES_ENABLED === "true";

function findResourceDirectories(directory, depth = 0, found = []) {
  if (depth > 7 || !fs.existsSync(directory)) return found;
  const archive = path.join(directory, "app.asar");
  if (fs.existsSync(archive)) {
    found.push(directory);
    return found;
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    findResourceDirectories(path.join(directory, entry.name), depth + 1, found);
  }
  return found;
}

function countSkillFiles(directory) {
  if (!fs.existsSync(directory)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) total += countSkillFiles(file);
    else if (entry.isFile() && entry.name.toLowerCase() === "skill.md") total++;
  }
  return total;
}

const resourceDirectories = findResourceDirectories(packageRoot);
if (resourceDirectories.length === 0) {
  throw new Error(`No packaged app.asar found below ${packageRoot}`);
}

for (const resourcesDirectory of resourceDirectories) {
  const archive = path.join(resourcesDirectory, "app.asar");
  const engineEntry = path.join(resourcesDirectory, "engine", "index.mjs");
  if (!fs.existsSync(engineEntry)) {
    throw new Error(`Packaged engine is missing: ${engineEntry}`);
  }
  const files = new Set(
    asar.listPackage(archive).map((file) => file.replace(/\\/g, "/").replace(/^\/+/, "")),
  );
  for (const required of [
    "out/main/index.js",
    "out/preload/index.js",
    "out/renderer/index.html",
    "package.json",
    "node_modules/electron-updater/package.json",
  ]) {
    if (!files.has(required)) {
      throw new Error(`Required file is missing from ${archive}: ${required}`);
    }
  }
  const skillDirectory = path.join(resourcesDirectory, "engine", "skills", "builtin");
  const skillCount = countSkillFiles(skillDirectory);
  if (skillCount === 0) {
    throw new Error(`Packaged engine has no builtin skills: ${skillDirectory}`);
  }
  if (updatesEnabled && !fs.existsSync(path.join(resourcesDirectory, "app-update.yml"))) {
    throw new Error(`Updater metadata is missing: ${path.join(resourcesDirectory, "app-update.yml")}`);
  }

  console.log(`Package verified: ${resourcesDirectory}`);
  console.log("  engine: engine/index.mjs");
  console.log(`  builtin skills: ${skillCount}`);
  console.log("  updater: node_modules/electron-updater");
}
