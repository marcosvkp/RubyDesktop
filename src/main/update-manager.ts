/**
 * Coordinates automatic updates and the GitHub download-page fallback.
 *
 * Keeping the decision and event wiring independent from Electron makes the
 * signed-feed and unsigned-fallback paths deterministic to verify in smoke tests.
 */
export interface UpdateInfo {
  version: string;
}

export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(
    event: "update-downloaded",
    listener: (info: UpdateInfo) => void,
  ): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface UpdateManagerOptions {
  isPackaged: boolean;
  platform: string;
  resourcesPath: string;
  macAutoUpdatesEnabled: boolean;
  hasFile(path: string): boolean;
  autoUpdater: AutoUpdaterLike;
  checkGithubRelease(): Promise<void>;
  confirmInstall(info: UpdateInfo): Promise<boolean>;
  schedule(callback: () => void, delayMs: number): unknown;
  onUpdaterError(error: unknown): void;
  onFallbackError(error: unknown): void;
}

const UPDATE_FEED_DELAY_MS = 15_000;

export function startAutoUpdates(options: UpdateManagerOptions): void {
  if (!options.isPackaged) return;

  const hasUpdateFeed = options.hasFile(
    `${options.resourcesPath}/app-update.yml`,
  );
  const macUpdatesAreSigned =
    options.platform !== "darwin" || options.macAutoUpdatesEnabled;
  if (!hasUpdateFeed || !macUpdatesAreSigned) {
    scheduleGithubFallback(options);
    return;
  }

  const { autoUpdater } = options;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let fallbackScheduled = false;
  const scheduleFallbackOnce = (): void => {
    if (fallbackScheduled) return;
    fallbackScheduled = true;
    scheduleGithubFallback(options);
  };

  autoUpdater.on("error", (error) => {
    options.onUpdaterError(error);
    scheduleFallbackOnce();
  });
  autoUpdater.on("update-downloaded", (info) => {
    void options
      .confirmInstall(info)
      .then((shouldInstall) => {
        if (shouldInstall) autoUpdater.quitAndInstall();
      })
      .catch(options.onUpdaterError);
  });

  options.schedule(() => {
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      options.onUpdaterError(error);
      scheduleFallbackOnce();
    });
  }, UPDATE_FEED_DELAY_MS);
}

function scheduleGithubFallback(options: UpdateManagerOptions): void {
  options.schedule(() => {
    void options.checkGithubRelease().catch(options.onFallbackError);
  }, UPDATE_FEED_DELAY_MS);
}
