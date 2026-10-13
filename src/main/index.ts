/**
 * Electron main process — window lifecycle and the renderer ↔ engine bridge.
 *
 * The main process deliberately holds no agent state. It owns the window, spawns
 * the engine host, and relays messages between the two. Anything that needs the
 * engine goes through the `EngineRequest` protocol, so there is exactly one path
 * to the agent and the renderer cannot reach it any other way.
 */
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, utilityProcess } from "electron";
import { autoUpdater } from "electron-updater";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { BrowserController } from "./browser.js";
import { createBrowserService } from "./browser-service.js";
import type {
  ApprovalDecision,
  ApprovalScope,
  EngineRequest,
  EngineResponse,
  GrantKeyKind,
  GoalStatus,
  McpServerDraft,
  PermissionMode,
} from "@shared/ipc";
import { IPC } from "@shared/ipc";

declare const __RUBY_DESKTOP_MAC_AUTO_UPDATES__: boolean;

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

/** The engine is a normal file in the install; dev builds keep it beside `out/main`. */
function engineEntry(): string {
  if (app.isPackaged) return join(process.resourcesPath, "engine", "index.mjs");
  return join(__dirname, "..", "engine", "index.mjs");
}

/** Enables updates only for builds that contain a generated GitHub feed config. */
function startAutoUpdates(): void {
  if (!app.isPackaged || !existsSync(join(process.resourcesPath, "app-update.yml"))) return;
  if (process.platform === "darwin" && !__RUBY_DESKTOP_MAC_AUTO_UPDATES__) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("error", (error) => {
    console.error(`[updates] ${error.message}`);
  });
  autoUpdater.on("update-downloaded", (info) => {
    const options = {
      type: "info" as const,
      title: "Ruby Desktop atualizado",
      message: `A versão ${info.version} foi baixada e está pronta para instalar.`,
      detail: "Escolha Reiniciar agora para aplicar já, ou Depois para instalar ao encerrar o app.",
      buttons: ["Reiniciar agora", "Depois"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    const prompt = mainWindow && !mainWindow.isDestroyed()
      ? dialog.showMessageBox(mainWindow, options)
      : dialog.showMessageBox(options);
    void prompt.then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  // A brief delay lets the first window settle before the updater contacts GitHub.
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      console.error(`[updates] ${error instanceof Error ? error.message : String(error)}`);
    });
  }, 15_000);
}

let mainWindow: BrowserWindow | null = null;
let engine: Electron.UtilityProcess | null = null;
/**
 * The last `ready` message, cached so a renderer that mounts after the engine
 * finished starting can still read it. Without this, `getEngineInfo()` would
 * return undefined on every reload and the UI would never learn the model.
 */
let lastReady: Extract<EngineResponse, { type: "ready" }> | undefined;
let engineBusy = false;

function apiKeyPath(): string {
  return join(app.getPath("userData"), "ruby-api-key.enc");
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
async function startEngine(): Promise<void> {
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
    if (message.type === "ready") lastReady = message;
    if (message.type === "status") engineBusy = message.status === "busy";
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
function stopEngine(): void {
  if (!engine) return;
  const current = engine;
  engine = null;
  lastReady = undefined;
  engineBusy = false;
  current.removeAllListeners("exit");
  // Give the engine a moment to close its MCP child processes; killing it outright
  // can orphan them on Windows, where nothing reaps a detached grandchild. The
  // kill below is the backstop if it does not exit promptly.
  try {
    current.postMessage({ type: "shutdown" } satisfies EngineRequest);
  } catch {
    // Channel already closed — nothing to ask.
  }
  current.kill();
}

// --- Embedded browser -------------------------------------------------------

const browser = new BrowserController(() => mainWindow);
/** Where the renderer says the browser placeholder sits, in window coordinates. */
let browserBounds = { x: 0, y: 0, width: 0, height: 0 };

/** Tells the renderer whether the browser is open, so it can reserve space. */
function reportBrowserState(): void {
  const info = browser.info();
  sendToRenderer({
    type: "browserState",
    open: browser.isOpen,
    url: info?.url,
    title: info?.title,
  });
}

const browserService = createBrowserService({
  controller: browser,
  get screenshotDir() {
    return join(app.getPath("userData"), "browser-screenshots");
  },
  onState: reportBrowserState,
  reply: (id, ok, result, error) => post({ type: "browserResult", id, ok, result, error }),
  onUserError: (message) => sendToRenderer({ type: "error", message }),
  // The agent can open the browser before the panel has measured itself; a
  // zero-sized view silently swallows clicks, so fall back to the right half.
  defaultBounds: () => {
    const { width, height } = mainWindow?.getContentBounds() ?? { width: 1440, height: 920 };
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
function switchWorkspace(next: string): void {
  if (!existsSync(next) || next === workspace) return;
  stopEngine();
  workspace = next;
  sendToRenderer({ type: "status", status: "starting" });
  void startEngine();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
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

  // External links open in the user's browser, never inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
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

ipcMain.handle(IPC.invoke.getEngineInfo, () => lastReady);
ipcMain.handle(IPC.invoke.saveApiKey, async (_event, key: string) => {
  if (engineBusy) {
    return { ok: false, error: "Pare o turno atual antes de trocar a chave." };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: "O cofre seguro do sistema não está disponível nesta sessão." };
  }
  const trimmed = typeof key === "string" ? key.trim() : "";
  if (!trimmed) return { ok: false, error: "Informe uma chave de API válida." };

  const target = apiKeyPath();
  const temporary = `${target}.tmp`;
  try {
    await writeFile(temporary, safeStorage.encryptString(trimmed), { mode: 0o600 });
    await rename(temporary, target);
    stopEngine();
    await startEngine();
    return { ok: true };
  } catch (err) {
    await rm(temporary, { force: true }).catch(() => {});
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Não foi possível salvar a chave.",
    };
  }
});

ipcMain.on(IPC.send.prompt, (_event, text: string) => post({ type: "prompt", text }));
ipcMain.on(IPC.send.activateSkill, (_event, name: string, args: string) =>
  post({ type: "activateSkill", name, args }),
);
ipcMain.on(IPC.send.abort, () => post({ type: "abort" }));
ipcMain.on(IPC.send.setWorkspace, (_event, path: string) => switchWorkspace(path));
ipcMain.on(IPC.send.setModel, (_event, model: string) => post({ type: "setModel", model }));
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
ipcMain.on(IPC.send.userQuestionResponse, (_event, id: string, answers: Record<string, string> | null) =>
  post({ type: "userQuestionResponse", id, answers }),
);
ipcMain.on(
  IPC.send.subAgentConfigResponse,
  (_event, id: string, action: "start" | "cancel", config?: {
    model: string;
    reasoningEffort?: import("@shared/ipc").ReasoningEffort;
    instructions: string;
  }) => post({ type: "subAgentConfigResponse", id, action, ...config }),
);
ipcMain.on(IPC.send.subAgentReviewResponse, (_event, id: string, action: "merge" | "discard" | "cancel") =>
  post({ type: "subAgentReviewResponse", id, action }),
);
ipcMain.on(IPC.send.compact, () => post({ type: "compact" }));
ipcMain.on(IPC.send.newSession, () => post({ type: "session", action: "new" }));
ipcMain.on(IPC.send.resumeSession, (_event, sessionId: string) =>
  post({ type: "session", action: "resume", sessionId }),
);
ipcMain.on(IPC.send.getGoal, () => post({ type: "goal", action: "get" }));
ipcMain.on(IPC.send.setGoal, (_event, text: string) => post({ type: "goal", action: "set", text }));
ipcMain.on(IPC.send.noteGoal, (_event, text: string) =>
  post({ type: "goal", action: "note", text }),
);
ipcMain.on(IPC.send.setGoalStatus, (_event, status: GoalStatus) =>
  post({ type: "goal", action: "status", status }),
);
ipcMain.on(IPC.send.clearGoal, () => post({ type: "goal", action: "clear" }));
ipcMain.on(IPC.send.refreshMcp, () => post({ type: "mcp", action: "refresh" }));
ipcMain.on(IPC.send.addMcpServer, (_event, name: string, config: McpServerDraft) =>
  post({ type: "mcp", action: "add", name, config }),
);
ipcMain.on(IPC.send.removeMcpServer, (_event, name: string) =>
  post({ type: "mcp", action: "remove", name }),
);
ipcMain.on(IPC.send.testMcpServer, (_event, name: string, config: McpServerDraft) =>
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

ipcMain.on(IPC.send.closeBrowser, () => {
  browser.close();
  reportBrowserState();
});

ipcMain.on(
  IPC.send.setBrowserBounds,
  (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    browserBounds = bounds;
    browserService.setBounds(browserBounds);
  },
);

ipcMain.on(IPC.send.reset, () => post({ type: "reset" }));
ipcMain.on(IPC.send.refreshModels, () => post({ type: "hello" }));

// --- Lifecycle --------------------------------------------------------------

void app.whenReady().then(() => {
  workspace = resolveWorkspace();
  createWindow();
  void startEngine();
  startAutoUpdates();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopEngine();
});
