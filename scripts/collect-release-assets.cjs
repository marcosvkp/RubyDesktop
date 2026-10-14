/** Stages only current-version installers and updater metadata for GitHub Releases. */
const fs = require("node:fs");
const path = require("node:path");

const releaseDirectory = path.resolve(process.argv[2] || "release");
const platform = process.argv[3];
const stagingDirectory = path.join(releaseDirectory, "release-assets");
const assetPattern = /\.(?:exe|appimage|deb|dmg|zip|blockmap)$/i;
const packageVersion = require(path.join(process.cwd(), "package.json")).version;
const metadataByPlatform = {
  windows: "latest.yml",
  linux: "latest-linux.yml",
  macos: "latest-mac.yml",
};
const expectedMetadata = metadataByPlatform[platform];
if (!expectedMetadata) throw new Error(`Unknown release platform: ${platform}`);
if (!fs.existsSync(releaseDirectory)) {
  throw new Error(`Release directory does not exist: ${releaseDirectory}`);
}

const stagingParent = `${releaseDirectory}${path.sep}`;
if (!path.resolve(stagingDirectory).startsWith(stagingParent)) {
  throw new Error(`Unsafe staging directory: ${stagingDirectory}`);
}

const files = fs.readdirSync(releaseDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && assetPattern.test(entry.name))
  .map((entry) => entry.name)
  .filter((name) => name.includes(`-${packageVersion}-`));

const expectedExtensions = {
  windows: [".exe"],
  linux: [".appimage", ".deb"],
  macos: [".dmg", ".zip"],
}[platform];
const missingTargets = expectedExtensions.filter(
  (extension) => !files.some((file) => file.toLowerCase().endsWith(extension)),
);
if (missingTargets.length > 0) {
  throw new Error(`Missing ${platform} ${packageVersion} release targets: ${missingTargets.join(", ")}`);
}

const updatesEnabled = platform === "linux" || process.env.RUBY_DESKTOP_UPDATES_ENABLED === "true";
if (updatesEnabled) {
  const metadataPath = path.join(releaseDirectory, expectedMetadata);
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`${platform} release is missing updater metadata ${expectedMetadata}`);
  }
  const stagedNames = new Set(files);
  const metadata = fs.readFileSync(metadataPath, "utf8");
  const references = [...metadata.matchAll(/^\s*(?:url|path):\s*["']?([^"'\s]+)["']?\s*$/gm)]
    .map((match) => path.basename(match[1]));
  if (references.length === 0) {
    throw new Error(`${expectedMetadata} does not reference any update assets`);
  }
  for (const reference of references) {
    if (!stagedNames.has(reference)) {
      throw new Error(`${expectedMetadata} references unstaged or stale asset '${reference}'`);
    }
    if (/\.(?:exe|zip|appimage)$/i.test(reference) && !stagedNames.has(`${reference}.blockmap`)) {
      throw new Error(`Updater asset '${reference}' is missing its .blockmap file`);
    }
  }
  files.push(expectedMetadata);
}

fs.rmSync(stagingDirectory, { recursive: true, force: true });
fs.mkdirSync(stagingDirectory, { recursive: true });
for (const file of files) {
  fs.copyFileSync(path.join(releaseDirectory, file), path.join(stagingDirectory, file));
}

console.log(`Staged ${files.length} ${packageVersion} release assets:`);
for (const file of files.sort()) console.log(`  ${file}`);
