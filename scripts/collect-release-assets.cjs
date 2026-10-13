/** Stages only user-downloadable installers and updater metadata for GitHub Releases. */
const fs = require("node:fs");
const path = require("node:path");

const releaseDirectory = path.resolve(process.argv[2] || "release");
const platform = process.argv[3];
const stagingDirectory = path.join(releaseDirectory, "release-assets");
const assetPattern = /\.(?:exe|appimage|deb|dmg|zip|blockmap)$/i;
const metadataPattern = /^latest(?:-(?:linux|mac|win))?\.ya?ml$/i;

const files = fs.readdirSync(releaseDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && (assetPattern.test(entry.name) || metadataPattern.test(entry.name)))
  .map((entry) => entry.name);

if (files.length === 0) {
  throw new Error(`No release installers or update metadata found in ${releaseDirectory}`);
}

const requiredExtensions = {
  windows: [".exe"],
  linux: [".appimage", ".deb"],
  macos: [".dmg", ".zip"],
}[platform];
if (requiredExtensions) {
  const missing = requiredExtensions.filter(
    (extension) => !files.some((file) => file.toLowerCase().endsWith(extension)),
  );
  if (missing.length > 0) {
    throw new Error(`Missing ${platform} release targets: ${missing.join(", ")}`);
  }
}
if (platform === "linux" && !files.includes("latest-linux.yml")) {
  throw new Error("Linux release is missing latest-linux.yml updater metadata");
}

fs.mkdirSync(stagingDirectory, { recursive: true });
for (const file of files) {
  fs.copyFileSync(path.join(releaseDirectory, file), path.join(stagingDirectory, file));
}

console.log(`Staged ${files.length} release assets:`);
for (const file of files.sort()) console.log(`  ${file}`);
