/**
 * The app runtime is fully bundled except for electron-updater. Keeping the engine
 * in extraResources gives utilityProcess a real ESM file path outside app.asar.
 */
const repository = (process.env.RUBY_DESKTOP_GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY || "").trim();
const [owner, repo] = repository.split("/");
const windowsSigningConfigured = Boolean(
  process.env.WIN_CSC_LINK || process.env.WIN_CSC_NAME || process.env.CSC_LINK || process.env.CSC_NAME,
);
const macSigningConfigured = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
const autoUpdatesCanBePublished = process.platform === "win32"
  ? windowsSigningConfigured
  : process.platform === "darwin"
    ? macSigningConfigured
    : true;
const publish = owner && repo && autoUpdatesCanBePublished
  ? [{ provider: "github", owner, repo, releaseType: "draft" }]
  : undefined;

module.exports = {
  appId: "com.rubyclii.ruby-desktop",
  productName: "Ruby Desktop",
  directories: {
    output: "release",
    buildResources: "design",
  },
  files: ["out/main/**/*", "out/preload/**/*", "out/renderer/**/*", "package.json", "!**/*.map"],
  extraResources: [
    {
      from: "out/engine",
      to: "engine",
      filter: ["**/*", "!**/*.map"],
    },
  ],
  asar: true,
  artifactName: "${productName}-${version}-${os}-${arch}.${ext}",
  electronUpdaterCompatibility: ">= 2.16",
  ...(publish ? { publish } : {}),
  win: {
    icon: "design/ruby-favicon.ico",
    target: [{ target: "nsis", arch: ["x64", "arm64"] }],
    // Keep publisher verification enabled. The update feed is omitted until a
    // Windows signing certificate is configured.
    verifyUpdateCodeSignature: true,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Ruby Desktop",
    deleteAppDataOnUninstall: false,
  },
  mac: {
    icon: "design/brand/ruby-mark.png",
    target: [
      { target: "dmg", arch: ["x64", "arm64"] },
      { target: "zip", arch: ["x64", "arm64"] },
    ],
  },
  linux: {
    icon: "design/brand/ruby-mark.png",
    category: "Development",
    target: [
      { target: "AppImage", arch: ["x64"] },
      { target: "deb", arch: ["x64"] },
    ],
  },
};
