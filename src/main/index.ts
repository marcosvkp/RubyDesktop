/**
 * Electron main process — window lifecycle and the renderer ↔ engine bridge.
 *
 * The main process deliberately holds no agent state. It owns the window, spawns
 * the engine host, and relays messages between the two. Anything that needs the
 * engine goes through the `EngineRequest` protocol, so there is exactly one path
 * to the agent and the renderer cannot reach it any other way.
 */
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
  utilityProcess,
} from "electron";
import { autoUpdater } from "electron-updater";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { BrowserController } from "./browser.js";
import { createBrowserService } from "./browser-service.js";
import { runGitOperation } from "./git-service.js";
import { startAutoUpdates } from "./update-manager.js";
import type {
  ApprovalDecision,
  ApprovalScope,
  EngineRequest,
  EngineResponse,
  GrantKeyKind,
  GoalStatus,
  AgentSettings,
  ChatImageAttachment,
  ChatImageMimeType,
  McpServerDraft,
  ModelSummary,
  PermissionMode,
  RecentWorkspaceSummary,
  ReasoningEffort,
  UserQuestionAnswer,
} from "@shared/ipc";
import { IPC } from "@shared/ipc";

declare const __RUBY_DESKTOP_MAC_AUTO_UPDATES__: boolean;

const RELEASES_API_URL =
  "https://api.github.com/repos/marcosvkp/RubyDesktop/releases/latest";
const RELEASES_PAGE_URL =
  "https://github.com/marcosvkp/RubyDesktop/releases/latest";

/**
 * The workspace the engine operates in.
 *
 * M1 uses a single workspace resolved at startup: the directory the app was
 * launched from when running from source, otherwise the user's home. The
 * workspace switcher lands in M2, which is why this is a function rather than a
 * constant — the call site already expects it to be resolvable per window.
 */
function resolveWorkspace(): string {
  const fromEnv = process.env.RUBY_DESKTOP_WORKSPACE;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  // In development `process.cwd()` is the project root, which is a far more
  // useful default than the home directory.
  if (!app.isPackaged) return process.cwd();
  return homedir();
}

let workspace = "";
let recentWorkspaces: RecentWorkspaceSummary[] = [];
let recentWorkspaceWrite: Promise<void> = Promise.resolve();

function recentWorkspacesPath(): string {
  return join(app.getPath("userData"), "recent-workspaces.json");
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function workspaceKey(path: string): string {
  const absolute = resolve(path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

async function loadRecentWorkspaces(): Promise<RecentWorkspaceSummary[]> {
  try {
    const raw: unknown = JSON.parse(
      await readFile(recentWorkspacesPath(), "utf8"),
    );
    if (!Array.isArray(raw)) return [];
    const entries = raw.filter(
      (entry): entry is RecentWorkspaceSummary =>
        typeof entry === "object" &&
        entry !== null &&
        "path" in entry &&
        typeof entry.path === "string" &&
        isDirectory(entry.path),
    );
    const unique = new Map<string, RecentWorkspaceSummary>();
    for (const entry of entries) {
      const path = resolve(entry.path);
      unique.set(workspaceKey(path), { path, label: basename(path) || path });
    }
    return [...unique.values()].slice(0, 8);
  } catch {
    return [];
  }
}

/** Keep the small history in app-owned storage; the renderer only sees paths. */
function rememberWorkspace(path: string): void {
  if (!isDirectory(path)) return;
  const absolute = resolve(path);
  const key = workspaceKey(absolute);
  recentWorkspaces = [
    { path: absolute, label: basename(absolute) || absolute },
    ...recentWorkspaces.filter((entry) => workspaceKey(entry.path) !== key),
  ].slice(0, 8);
  sendToRenderer({ type: "workspaceRecents", workspaces: recentWorkspaces });

  recentWorkspaceWrite = recentWorkspaceWrite
    .then(async () => {
      const target = recentWorkspacesPath();
      const temporary = `${target}.tmp`;
      await mkdir(app.getPath("userData"), { recursive: true });
      await writeFile(
        temporary,
        JSON.stringify(recentWorkspaces, null, 2),
        "utf8",
      );
      await rename(temporary, target);
    })
    .catch((error: unknown) => {
      console.error(
        `[workspace history] ${error instanceof Error ? error.message : String(error)}`,
      );
    });
}

/** The engine is a normal file in the install; dev builds keep it beside `out/main`. */
function engineEntry(): string {
  if (app.isPackaged) return join(process.resourcesPath, "engine", "index.mjs");
  return join(__dirname, "..", "engine", "index.mjs");
}

interface ReleaseVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: boolean;
}

function parseReleaseVersion(value: string): ReleaseVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    value.trim(),
  );
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: Boolean(match[4]),
  };
}

function isReleaseNewer(candidate: ReleaseVersion, installed: ReleaseVersion): boolean {
  for (const key of ["major", "minor", "patch"] as const) {
    if (candidate[key] !== installed[key]) {
      return candidate[key] > installed[key];
    }
  }
  // A stable release supersedes a prerelease with the same numeric version.
  return installed.prerelease && !candidate.prerelease;
}

/** Checks the public GitHub Releases API and offers a safe manual update path. */
async function checkGithubRelease(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "RubyDesktop",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub respondeu HTTP ${response.status}.`);
    }

    const release: unknown = await response.json();
    if (typeof release !== "object" || release === null) return;
    const data = release as {
      tag_name?: unknown;
      draft?: unknown;
      prerelease?: unknown;
    };
    if (
      typeof data.tag_name !== "string" ||
      data.draft === true ||
      data.prerelease === true
    )
      return;

    const latest = parseReleaseVersion(data.tag_name);
    const installed = parseReleaseVersion(app.getVersion());
    if (!latest || !installed || !isReleaseNewer(latest, installed)) return;

    const options = {
      type: "info" as const,
      title: "Atualização disponível",
      message: `Ruby Desktop ${data.tag_name} está disponível.`,
      detail: `Você está usando a versão ${app.getVersion()}. Abra a página de releases para baixar o instalador mais recente.`,
      buttons: ["Abrir downloads", "Depois"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options);
    if (result.response === 0) await shell.openExternal(RELEASES_PAGE_URL);
  } finally {
    clearTimeout(timeout);
  }
}

/** Starts signed automatic updates, with a manual GitHub fallback on failure. */
function startPackagedUpdates(): void {
  startAutoUpdates({
    isPackaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
    macAutoUpdatesEnabled: __RUBY_DESKTOP_MAC_AUTO_UPDATES__,
    hasFile: existsSync,
    autoUpdater,
    checkGithubRelease,
    confirmInstall: async (info) => {
      const options = {
        type: "info" as const,
        title: "Ruby Desktop atualizado",
        message: `A versão ${info.version} foi baixada e está pronta para instalar.`,
        detail:
          "Escolha Reiniciar agora para aplicar já, ou Depois para instalar ao encerrar o app.",
        buttons: ["Reiniciar agora", "Depois"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      };
      const result =
        mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showMessageBox(mainWindow, options)
          : await dialog.showMessageBox(options);
      return result.response === 0;
    },
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    onUpdaterError: (error) => {
      console.error(
        `[updates] ${error instanceof Error ? error.message : String(error)}`,
      );
    },
    onFallbackError: (error) => {
      console.warn(
        `[updates] GitHub fallback failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  });
}

let mainWindow: BrowserWindow | null = null;
let engine: Electron.UtilityProcess | null = null;
let engineStartPromise: Promise<void> | undefined;
let engineStopPromise: Promise<void> | undefined;
let engineBusy = false;
let engineCompacting = false;
const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  maxIterations: 50,
  autoImageGeneration: false,
};
let agentSettings: AgentSettings = { ...DEFAULT_AGENT_SETTINGS };
let preferredModel: string | undefined;
let preferredReasoningEffort: ReasoningEffort | undefined;
let preferredModelWrite: Promise<void> = Promise.resolve();
let availableModels: Map<string, ModelSummary> | undefined;
const approvalModalIds = new Set<string>();

function apiKeyPath(): string {
  return join(app.getPath("userData"), "ruby-api-key.enc");
}

function agentSettingsPath(): string {
  return join(app.getPath("userData"), "agent-settings.json");
}

function preferredModelPath(): string {
  return join(app.getPath("userData"), "selected-model.json");
}

function isValidModelId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512;
}

async function loadPreferredModel(): Promise<void> {
  try {
    const saved = JSON.parse(await readFile(preferredModelPath(), "utf8")) as {
      model?: unknown;
      reasoningEffort?: unknown;
    };
    if (isValidModelId(saved.model)) preferredModel = saved.model.trim();
    if (isValidReasoningEffort(saved.reasoningEffort)) {
      preferredReasoningEffort = saved.reasoningEffort;
    }
  } catch {
    // A missing or malformed preference falls back to the engine configuration.
  }
}

function isValidReasoningEffort(value: unknown): value is ReasoningEffort {
  return (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

function persistPreferredModel(
  model: string,
  reasoningEffort: ReasoningEffort | undefined,
): Promise<void> {
  preferredModelWrite = preferredModelWrite
    .then(async () => {
      const target = preferredModelPath();
      const temporary = `${target}.tmp`;
      await mkdir(app.getPath("userData"), { recursive: true });
      try {
        await writeFile(
          temporary,
          `${JSON.stringify({ model, ...(reasoningEffort ? { reasoningEffort } : {}) }, null, 2)}\n`,
          {
            encoding: "utf8",
            mode: 0o600,
          },
        );
        await rename(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
    })
    .catch((error: unknown) => {
      console.error(
        `[model preference] ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  return preferredModelWrite;
}

function isValidMaxIterations(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 500;
}

async function loadAgentSettings(): Promise<void> {
  try {
    const saved = JSON.parse(await readFile(agentSettingsPath(), "utf8")) as {
      maxIterations?: unknown;
      autoImageGeneration?: unknown;
    };
    agentSettings = {
      maxIterations: isValidMaxIterations(saved.maxIterations)
        ? saved.maxIterations
        : DEFAULT_AGENT_SETTINGS.maxIterations,
      autoImageGeneration: saved.autoImageGeneration === true,
    };
  } catch {
    // A missing or malformed settings file falls back to the built-in defaults.
  }
}

async function persistAgentSettings(settings: AgentSettings): Promise<void> {
  const target = agentSettingsPath();
  const temporary = `${target}.tmp`;
  await mkdir(app.getPath("userData"), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function readSavedApiKey(): Promise<string | undefined> {
  if (!safeStorage.isEncryptionAvailable()) return undefined;
  try {
    return safeStorage.decryptString(await readFile(apiKeyPath()));
  } catch {
    return undefined;
  }
}

function sendToRenderer(message: EngineResponse): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.engineMessage, message);
  }
}

/**
 * Spawns the engine host with `cwd` set to the workspace.
 *
 * The cwd matters: the file tools resolve paths against `process.cwd()` to decide
 * whether a write stays inside the project, so the engine must actually run *in*
 * the workspace rather than being told about it.
 */
function startEngine(): Promise<void> {
  if (engine) return Promise.resolve();
  if (engineStartPromise) return engineStartPromise;

  const start = doStartEngine();
  let tracked: Promise<void>;
  tracked = start.finally(() => {
    if (engineStartPromise === tracked) engineStartPromise = undefined;
  });
  engineStartPromise = tracked;
  return tracked;
}

async function doStartEngine(): Promise<void> {
  if (engine) return;

  const entry = engineEntry();
  if (!existsSync(entry)) {
    sendToRenderer({
      type: "fatal",
      message: `Engine bundle not found at ${entry}. Run \`npm run build:engine\` first.`,
    });
    return;
  }

  const env = { ...process.env } as Record<string, string>;
  env.RUBY_DESKTOP_MAX_ITERATIONS = String(agentSettings.maxIterations);
  env.RUBY_DESKTOP_AUTO_IMAGE_GENERATION = String(agentSettings.autoImageGeneration);
  availableModels = undefined;
  if (preferredModel) env.RUBY_DESKTOP_PREFERRED_MODEL = preferredModel;
  else delete env.RUBY_DESKTOP_PREFERRED_MODEL;
  if (preferredReasoningEffort) {
    env.RUBY_DESKTOP_PREFERRED_REASONING_EFFORT = preferredReasoningEffort;
  } else {
    delete env.RUBY_DESKTOP_PREFERRED_REASONING_EFFORT;
  }
  const savedApiKey = await readSavedApiKey();
  if (savedApiKey) {
    // A key saved by the desktop takes precedence over inherited environment
    // variables, while legacy environment/config sources remain available.
    env.RUBY_API_KEY = savedApiKey;
    env.RUBY_DESKTOP_KEY_SOURCE = "safeStorage";
  } else {
    delete env.RUBY_DESKTOP_KEY_SOURCE;
  }

  engine = utilityProcess.fork(entry, [], {
    cwd: workspace,
    stdio: "pipe",
    serviceName: "ruby-engine",
    env,
  });

  engine.on("message", (message: EngineResponse) => {
    if (message.type === "status") engineBusy = message.status === "busy";
    if (message.type === "compacting") engineCompacting = message.active;
    if (message.type === "models") {
      availableModels = new Map(message.models.map((entry) => [entry.id, entry]));
    }
    if (
      message.type === "ready" &&
      isValidModelId(message.model) &&
      availableModels?.has(message.model)
    ) {
      preferredModel = message.model;
      preferredReasoningEffort = message.reasoningEffort;
      void persistPreferredModel(message.model, message.reasoningEffort);
    }
    if (
      message.type === "modelSelection" &&
      isValidModelId(message.model) &&
      availableModels?.has(message.model)
    ) {
      preferredModel = message.model;
      preferredReasoningEffort = message.reasoningEffort;
      void persistPreferredModel(message.model, message.reasoningEffort);
    }
    if (message.type === "approvalRequest") {
      approvalModalIds.add(message.request.id);
      applyBrowserBounds();
    } else if (message.type === "approvalResolved") {
      approvalModalIds.delete(message.id);
      applyBrowserBounds();
    }
    // Browser RPCs are handled here rather than relayed: they are addressed to the
    // main process, and the renderer has no business performing them.
    if (message.type === "browserRequest") {
      void browserService.handle(message.id, message.method, message.params);
      return;
    }
    sendToRenderer(message);
  });

  engine.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(`[engine] ${chunk.toString()}`);
  });
  engine.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[engine] ${chunk.toString()}`);
  });

  engine.on("exit", (code: number) => {
    engine = null;
    engineBusy = false;
    engineCompacting = false;
    approvalModalIds.clear();
    applyBrowserBounds();
    sendToRenderer({
      type: "fatal",
      message: `The agent engine stopped unexpectedly (exit code ${code}).`,
    });
  });

  post({ type: "hello" });
}

function post(request: EngineRequest): void {
  engine?.postMessage(request);
}

/**
 * Tears the engine down so it can be started again in a different directory.
 *
 * The `exit` handler is detached first: it reports an unexpected stop to the UI,
 * and a deliberate restart is not that.
 */
function stopEngine(): Promise<void> {
  if (engineStopPromise) return engineStopPromise;
  const stop = async (): Promise<void> => {
    // A start may still be reading credentials. Wait for it to either finish or
    // fail, then shut down the process it created instead of orphaning it.
    await engineStartPromise?.catch(() => undefined);
    const current = engine;
    if (!current) return;
    engine = null;
    engineBusy = false;
    engineCompacting = false;
    current.removeAllListeners("exit");

    let tracked: Promise<void>;
    tracked = new Promise<void>((resolveStop) => {
      const finish = (): void => {
        clearTimeout(timer);
        current.removeListener("exit", onExit);
        resolveStop();
      };
      const onExit = (): void => finish();
      const timer = setTimeout(() => {
        try {
          current.kill();
        } catch {
          // The utility process may already have exited.
        }
        finish();
      }, 2_000);
      current.once("exit", onExit);

      try {
        current.postMessage({ type: "shutdown" } satisfies EngineRequest);
      } catch {
        // Channel already closed — the timed kill remains the backstop.
      }
    });
    await tracked;
  };

  let tracked: Promise<void>;
  tracked = stop().finally(() => {
    if (engineStopPromise === tracked) engineStopPromise = undefined;
  });
  engineStopPromise = tracked;
  return tracked;
}

// --- Embedded browser -------------------------------------------------------

const browser = new BrowserController(() => mainWindow);
/** Where the renderer says the browser placeholder sits, in window coordinates. */
let browserBounds = { x: 0, y: 0, width: 0, height: 0 };

function applyBrowserBounds(): void {
  browserService.setBounds(
    approvalModalIds.size > 0
      ? { x: 0, y: 0, width: 0, height: 0 }
      : browserBounds,
  );
}

function clampBrowserBounds(candidate: unknown): typeof browserBounds | undefined {
  if (!mainWindow || typeof candidate !== "object" || candidate === null) {
    return undefined;
  }
  const raw = candidate as Record<string, unknown>;
  const values = [raw.x, raw.y, raw.width, raw.height];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return undefined;
  }
  const content = mainWindow.getContentBounds();
  const x = Math.min(content.width, Math.max(0, Math.floor(raw.x as number)));
  const y = Math.min(content.height, Math.max(0, Math.floor(raw.y as number)));
  return {
    x,
    y,
    width: Math.min(content.width - x, Math.max(0, Math.floor(raw.width as number))),
    height: Math.min(content.height - y, Math.max(0, Math.floor(raw.height as number))),
  };
}

/** Tells the renderer whether the browser is open, so it can reserve space. */
function reportBrowserState(): void {
  const info = browser.info();
  sendToRenderer({
    type: "browserState",
    open: browser.isOpen,
    url: info?.url,
    title: info?.title,
    activeTabId: browser.activeTab,
    tabs: browser.listTabs(),
  });
}

const browserService = createBrowserService({
  controller: browser,
  get screenshotDir() {
    return join(app.getPath("userData"), "browser-screenshots");
  },
  onState: reportBrowserState,
  reply: (id, ok, result, error) =>
    post({ type: "browserResult", id, ok, result, error }),
  onUserError: (message) => sendToRenderer({ type: "error", message }),
  // The agent can open the browser before the panel has measured itself; a
  // zero-sized view silently swallows clicks, so fall back to the right half.
  defaultBounds: () => {
    const { width, height } = mainWindow?.getContentBounds() ?? {
      width: 1440,
      height: 920,
    };
    const panel = Math.max(360, Math.round(width * 0.46));
    return { x: width - panel, y: 0, width: panel, height };
  },
});

/**
 * Points the engine at a new workspace and restarts it.
 *
 * Isolation is structural rather than bookkeeping: the engine's `cwd` *is* the
 * workspace, so path containment, the project-scoped permission grants, the goal
 * file and the session all key off it. There is no shared state to leak between
 * workspaces because the process that holds it is replaced.
 */
async function switchWorkspace(next: string): Promise<void> {
  if (typeof next !== "string" || !isDirectory(next)) {
    sendToRenderer({
      type: "error",
      message: "A pasta selecionada não está disponível.",
    });
    return;
  }
  const absolute = resolve(next);
  rememberWorkspace(absolute);
  if (workspaceKey(absolute) === workspaceKey(workspace)) return;
  await stopEngine();
  browser.close();
  workspace = absolute;
  reportBrowserState();
  sendToRenderer({ type: "status", status: "starting" });
  await startEngine();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 760,
    minHeight: 520,
    show: false,
    // Matches --background in the theme, so there is no white flash before the
    // renderer paints.
    backgroundColor: "#050304",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      // The renderer is untrusted UI: no Node, isolated context, OS-level sandbox.
      // Everything it can do is enumerated on `window.ruby` by the preload script.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on("ready-to-show", () => mainWindow?.show());

  // Only web links may cross from the untrusted renderer into the OS shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        void shell.openExternal(parsed.toString()).catch(() => undefined);
      }
    } catch {
      // Malformed URLs and OS-specific schemes are ignored.
    }
    return { action: "deny" };
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  const rendererFileUrl = pathToFileURL(
    join(__dirname, "../renderer/index.html"),
  ).toString();
  const isTrustedRendererUrl = (url: string): boolean => {
    try {
      const candidate = new URL(url);
      if (devServerUrl) return candidate.origin === new URL(devServerUrl).origin;
      return candidate.toString() === rendererFileUrl;
    } catch {
      return false;
    }
  };
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.on("will-redirect", (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // The browser view is a child of the window and lives in window coordinates, so
  // it must be destroyed with the window rather than outliving it. Its position is
  // driven by the renderer, which is the only side that knows the layout: it
  // measures its placeholder and reports the rectangle.
  mainWindow.on("closed", () => {
    browser.close();
    mainWindow = null;
  });
}

// --- IPC --------------------------------------------------------------------

ipcMain.handle(IPC.invoke.getWorkspace, () => workspace);
ipcMain.handle(IPC.invoke.getRecentWorkspaces, () => recentWorkspaces);
const CHAT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const CHAT_IMAGE_MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const CHAT_IMAGE_MAX_COUNT = 4;

function detectChatImageMime(bytes: Buffer): ChatImageMimeType | undefined {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) return "image/webp";
  return undefined;
}

function validateChatImages(value: unknown): ChatImageAttachment[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > CHAT_IMAGE_MAX_COUNT) {
    throw new Error(`Anexe entre 1 e ${CHAT_IMAGE_MAX_COUNT} imagens por mensagem.`);
  }
  let totalBytes = 0;
  return value.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error("Anexo de imagem inválido.");
    const candidate = item as Partial<ChatImageAttachment>;
    if (
      typeof candidate.base64 !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(candidate.base64)
    ) throw new Error("O conteúdo de uma imagem anexada está inválido.");
    const bytes = Buffer.from(candidate.base64, "base64");
    if (!bytes.length || bytes.length > CHAT_IMAGE_MAX_BYTES) {
      throw new Error("Cada imagem deve ter no máximo 8 MB.");
    }
    totalBytes += bytes.length;
    if (totalBytes > CHAT_IMAGE_MAX_TOTAL_BYTES) {
      throw new Error("O total de imagens por mensagem deve ser de até 16 MB.");
    }
    const actualMime = detectChatImageMime(bytes);
    if (!actualMime || candidate.mimeType !== actualMime) {
      throw new Error("Formato de imagem inválido. Use PNG, JPEG ou WebP.");
    }
    const name = typeof candidate.name === "string" ? basename(candidate.name).slice(0, 120) : "";
    return {
      id: typeof candidate.id === "string" && /^[\w-]{1,80}$/.test(candidate.id)
        ? candidate.id
        : `image-${index + 1}`,
      name: name || `imagem-${index + 1}.${actualMime === "image/jpeg" ? "jpg" : actualMime.slice(6)}`,
      mimeType: actualMime,
      base64: candidate.base64,
    };
  });
}

ipcMain.handle(IPC.invoke.pickChatImages, async () => {
  const options: Electron.OpenDialogOptions = {
    title: "Adicionar imagens à mensagem",
    buttonLabel: "Anexar imagens",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Imagens", extensions: ["png", "jpg", "jpeg", "webp"] }],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled) return [];
  if (result.filePaths.length > CHAT_IMAGE_MAX_COUNT) {
    throw new Error(`É possível anexar até ${CHAT_IMAGE_MAX_COUNT} imagens por mensagem.`);
  }
  const images = await Promise.all(result.filePaths.map(async (path) => {
    if (statSync(path).size > CHAT_IMAGE_MAX_BYTES) {
      throw new Error(`Cada imagem deve ter no máximo 8 MB ('${basename(path)}').`);
    }
    const bytes = await readFile(path);
    const mimeType = detectChatImageMime(bytes);
    if (!mimeType) throw new Error(`'${basename(path)}' não é PNG, JPEG ou WebP válido.`);
    return {
      id: randomUUID(),
      name: basename(path),
      mimeType,
      base64: bytes.toString("base64"),
    } satisfies ChatImageAttachment;
  }));
  return validateChatImages(images);
});
ipcMain.handle(IPC.invoke.gitOperation, async (_event, request: unknown) =>
  runGitOperation(workspace, request, {
    chooseWorktreeParent: async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return undefined;
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "Escolha onde criar o worktree",
        defaultPath: dirname(resolve(workspace)),
        buttonLabel: "Criar worktree aqui",
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled ? undefined : result.filePaths[0];
    },
  }),
);
ipcMain.handle(IPC.invoke.getAgentSettings, () => ({ ...agentSettings }));

ipcMain.handle(IPC.invoke.pickWorkspace, async () => {
  const options: Electron.OpenDialogOptions = {
    title: "Choose a workspace",
    defaultPath: workspace,
    properties: ["openDirectory", "createDirectory"],
  };
  // The window overload is preferred (it makes the dialog modal to the app), but
  // it is only available once a window exists.
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? undefined : result.filePaths[0];
});

ipcMain.handle(IPC.invoke.saveApiKey, async (_event, key: string) => {
  if (engineBusy || engineCompacting) {
    return { ok: false, error: "Aguarde o turno e a compactação terminarem antes de trocar a chave." };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return {
      ok: false,
      error: "O cofre seguro do sistema não está disponível nesta sessão.",
    };
  }
  const trimmed = typeof key === "string" ? key.trim() : "";
  if (!trimmed) return { ok: false, error: "Informe uma chave de API válida." };

  const target = apiKeyPath();
  const temporary = `${target}.tmp`;
  try {
    await writeFile(temporary, safeStorage.encryptString(trimmed), {
      mode: 0o600,
    });
    await rename(temporary, target);
    await stopEngine();
    await startEngine();
    return { ok: true };
  } catch (err) {
    await rm(temporary, { force: true }).catch(() => {});
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Não foi possível salvar a chave.",
    };
  }
});

ipcMain.handle(
  IPC.invoke.saveAgentSettings,
  async (_event, settings: AgentSettings) => {
    if (engineBusy || engineCompacting) {
      return {
        ok: false,
        error: "Aguarde o turno e a compactação terminarem antes de alterar as configurações do agente.",
      };
    }
    if (!settings || !isValidMaxIterations(settings.maxIterations)) {
      return {
        ok: false,
        error: "Informe um número inteiro entre 1 e 500 ciclos.",
      };
    }
    if (typeof settings.autoImageGeneration !== "boolean") {
      return { ok: false, error: "A opção de geração autônoma de imagens é inválida." };
    }
    const next: AgentSettings = {
      maxIterations: settings.maxIterations,
      autoImageGeneration: settings.autoImageGeneration,
    };
    if (
      next.maxIterations === agentSettings.maxIterations &&
      next.autoImageGeneration === agentSettings.autoImageGeneration
    ) return { ok: true };

    const previous = agentSettings;
    try {
      await persistAgentSettings(next);
      agentSettings = next;
      await stopEngine();
      sendToRenderer({ type: "status", status: "starting" });
      await startEngine();
      return { ok: true };
    } catch (err) {
      agentSettings = previous;
      await persistAgentSettings(previous).catch(() => {});
      await stopEngine().catch(() => {});
      await startEngine().catch(() => {});
      return {
        ok: false,
        error:
          err instanceof Error
            ? `Não foi possível reiniciar o agente: ${err.message}`
            : "Não foi possível reiniciar o agente.",
      };
    }
  },
);

ipcMain.on(IPC.send.prompt, (_event, text: unknown, rawImages?: unknown) => {
  if (typeof text !== "string" || text.length > 100_000) {
    sendToRenderer({ type: "error", message: "A mensagem excede o limite permitido." });
    return;
  }
  try {
    const images = rawImages === undefined ? undefined : validateChatImages(rawImages);
    post({ type: "prompt", text, ...(images ? { images } : {}) });
  } catch (error) {
    sendToRenderer({
      type: "error",
      message: error instanceof Error ? error.message : "Não foi possível validar as imagens.",
    });
  }
});
ipcMain.on(IPC.send.activateSkill, (_event, name: string, args: string) =>
  post({ type: "activateSkill", name, args }),
);
ipcMain.on(IPC.send.abort, () => post({ type: "abort" }));
ipcMain.on(IPC.send.setWorkspace, (_event, path: string) => {
  void switchWorkspace(path).catch((error: unknown) => {
    sendToRenderer({
      type: "error",
      message: `Não foi possível trocar de workspace: ${error instanceof Error ? error.message : String(error)}`,
    });
  });
});
ipcMain.on(
  IPC.send.setModel,
  (_event, model: unknown, effort: unknown) => {
    if (!isValidModelId(model)) return;
    const selected = model.trim();
    const entry = availableModels?.get(selected);
    if (availableModels && !entry) {
      sendToRenderer({ type: "error", message: `O modelo '${selected}' não está disponível.` });
      return;
    }
    if (effort !== undefined && !isValidReasoningEffort(effort)) {
      sendToRenderer({ type: "error", message: "Effort de raciocínio inválido." });
      return;
    }
    if (
      isValidReasoningEffort(effort) &&
      !entry?.reasoningEfforts?.includes(effort)
    ) {
      sendToRenderer({
        type: "error",
        message: `O modelo '${selected}' não aceita o effort '${effort}'.`,
      });
      return;
    }
    post({
      type: "setModel",
      model: selected,
      ...(isValidReasoningEffort(effort) ? { reasoningEffort: effort } : {}),
    });
  },
);
ipcMain.on(IPC.send.setPermissionMode, (_event, mode: PermissionMode) =>
  post({ type: "setPermissionMode", mode }),
);
ipcMain.on(
  IPC.send.approvalResponse,
  (
    _event,
    id: string,
    decision: ApprovalDecision,
    scope: ApprovalScope,
    grantKey?: GrantKeyKind,
  ) => post({ type: "approvalResponse", id, decision, scope, grantKey }),
);
ipcMain.on(
  IPC.send.userQuestionResponse,
  (_event, id: string, answers: Record<string, UserQuestionAnswer> | null) =>
    post({ type: "userQuestionResponse", id, answers }),
);
ipcMain.on(
  IPC.send.subAgentConfigResponse,
  (
    _event,
    id: string,
    action: "start" | "cancel",
    config?: {
      model: string;
      reasoningEffort?: import("@shared/ipc").ReasoningEffort;
      instructions: string;
    },
  ) =>
    post({
      type: "subAgentConfigResponse",
      id,
      action,
      model: config?.model,
      reasoningEffort: config?.reasoningEffort,
      instructions: config?.instructions,
    }),
);
ipcMain.on(
  IPC.send.subAgentReviewResponse,
  (_event, id: string, action: "merge" | "discard" | "cancel") =>
    post({ type: "subAgentReviewResponse", id, action }),
);
ipcMain.on(IPC.send.clearSubAgents, (_event, value: unknown) => {
  const ids = Array.isArray(value)
    ? value
        .filter((id): id is string => typeof id === "string" && id.length > 0)
        .map((id) => id.slice(0, 200))
        .slice(0, 500)
    : [];
  if (ids.length > 0) post({ type: "clearSubAgents", ids });
});
ipcMain.on(IPC.send.compact, () => post({ type: "compact" }));
ipcMain.on(IPC.send.newSession, () => post({ type: "session", action: "new" }));
ipcMain.on(IPC.send.resumeSession, (_event, sessionId: string) =>
  post({ type: "session", action: "resume", sessionId }),
);
ipcMain.on(IPC.send.getGoal, () => post({ type: "goal", action: "get" }));
ipcMain.on(IPC.send.setGoal, (_event, text: string) =>
  post({ type: "goal", action: "set", text }),
);
ipcMain.on(IPC.send.noteGoal, (_event, text: string) =>
  post({ type: "goal", action: "note", text }),
);
ipcMain.on(IPC.send.setGoalStatus, (_event, status: GoalStatus) =>
  post({ type: "goal", action: "status", status }),
);
ipcMain.on(IPC.send.setGoalMaxRounds, (_event, maxRounds: number) =>
  post({ type: "goal", action: "maxRounds", maxRounds }),
);
ipcMain.on(IPC.send.startAutoGoal, (_event, maxRounds?: number) =>
  post({ type: "goal", action: "auto", maxRounds }),
);
ipcMain.on(IPC.send.stopAutoGoal, () =>
  post({ type: "goal", action: "stopAuto" }),
);
ipcMain.on(IPC.send.clearGoal, () => post({ type: "goal", action: "clear" }));
ipcMain.on(IPC.send.refreshMcp, () => post({ type: "mcp", action: "refresh" }));
ipcMain.on(
  IPC.send.addMcpServer,
  (_event, name: string, config: McpServerDraft) =>
    post({ type: "mcp", action: "add", name, config }),
);
ipcMain.on(IPC.send.removeMcpServer, (_event, name: string) =>
  post({ type: "mcp", action: "remove", name }),
);
ipcMain.on(
  IPC.send.testMcpServer,
  (_event, name: string, config: McpServerDraft) =>
    post({ type: "mcp", action: "test", name, config }),
);

ipcMain.on(IPC.send.openBrowser, (_event, url?: string) => {
  if (!browser.isOpen) browser.open(browserBounds);
  browserService.setBounds(browserBounds);
  reportBrowserState();
  if (url) {
    // A user-initiated navigation is not an engine tool call, so a failure here
    // has to be surfaced directly rather than as a tool result.
    void browser.navigate(url).then(reportBrowserState, (err: unknown) => {
      sendToRenderer({
        type: "error",
        message: `Could not open ${url}: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
  }
});

ipcMain.on(IPC.send.newBrowserTab, (_event, url?: string) => {
  browser.newTab(browserBounds);
  browserService.setBounds(browserBounds);
  reportBrowserState();
  if (url) {
    void browser.navigate(url).then(reportBrowserState, (err: unknown) => {
      sendToRenderer({
        type: "error",
        message: `Could not open ${url}: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
  }
});

ipcMain.on(IPC.send.selectBrowserTab, (_event, id: string) => {
  if (typeof id !== "string") return;
  browser.selectTab(id, browserBounds);
  reportBrowserState();
});

ipcMain.on(IPC.send.closeBrowserTab, (_event, id: string) => {
  if (typeof id !== "string") return;
  browser.closeTab(id, browserBounds);
  reportBrowserState();
});

ipcMain.on(IPC.send.closeBrowser, () => {
  browser.close();
  reportBrowserState();
});

ipcMain.on(
  IPC.send.setBrowserBounds,
  (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    const bounded = clampBrowserBounds(bounds);
    if (!bounded) return;
    browserBounds = bounded;
    applyBrowserBounds();
  },
);

ipcMain.on(IPC.send.reset, () => post({ type: "reset" }));
ipcMain.on(IPC.send.refreshModels, () => post({ type: "hello" }));

// --- Lifecycle --------------------------------------------------------------

void app.whenReady().then(() => {
  return Promise.all([
    loadRecentWorkspaces(),
    loadAgentSettings(),
    loadPreferredModel(),
  ]).then(([recent]) => {
    recentWorkspaces = recent;
    workspace = resolveWorkspace();
    rememberWorkspace(workspace);
    createWindow();
    void startEngine();
    startPackagedUpdates();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let quitAfterEngineShutdown = false;
app.on("before-quit", (event) => {
  if (quitAfterEngineShutdown) return;
  event.preventDefault();
  quitAfterEngineShutdown = true;
  void preferredModelWrite
    .then(() => stopEngine())
    .catch((error: unknown) => {
      console.error(`[engine] graceful shutdown failed: ${String(error)}`);
    })
    .finally(() => app.quit());
});
