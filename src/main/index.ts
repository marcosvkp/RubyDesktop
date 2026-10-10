/**
 * Electron main process — window lifecycle and the renderer ↔ engine bridge.
 *
 * The main process deliberately holds no agent state. It owns the window, spawns
 * the engine host, and relays messages between the two. Anything that needs the
 * engine goes through the `EngineRequest` protocol, so there is exactly one path
 * to the agent and the renderer cannot reach it any other way.
 */
import { app, BrowserWindow, ipcMain, shell, utilityProcess } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { EngineRequest, EngineResponse } from "@shared/ipc";
import { IPC } from "@shared/ipc";

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

/** Path to the built engine host. `__dirname` is `out/main` at runtime. */
function engineEntry(): string {
  return join(__dirname, "..", "engine", "index.mjs");
}

let mainWindow: BrowserWindow | null = null;
let engine: Electron.UtilityProcess | null = null;
/**
 * The last `ready` message, cached so a renderer that mounts after the engine
 * finished starting can still read it. Without this, `getEngineInfo()` would
 * return undefined on every reload and the UI would never learn the model.
 */
let lastReady: Extract<EngineResponse, { type: "ready" }> | undefined;

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
function startEngine(): void {
  if (engine) return;

  const entry = engineEntry();
  if (!existsSync(entry)) {
    sendToRenderer({
      type: "fatal",
      message: `Engine bundle not found at ${entry}. Run \`npm run build:engine\` first.`,
    });
    return;
  }

  engine = utilityProcess.fork(entry, [], {
    cwd: workspace,
    stdio: "pipe",
    serviceName: "ruby-engine",
  });

  engine.on("message", (message: EngineResponse) => {
    if (message.type === "ready") lastReady = message;
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

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// --- IPC --------------------------------------------------------------------

ipcMain.handle(IPC.invoke.getWorkspace, () => workspace);

ipcMain.handle(IPC.invoke.getEngineInfo, () => lastReady);

ipcMain.on(IPC.send.prompt, (_event, text: string) => post({ type: "prompt", text }));
ipcMain.on(IPC.send.abort, () => post({ type: "abort" }));
ipcMain.on(IPC.send.setModel, (_event, model: string) => post({ type: "setModel", model }));
ipcMain.on(IPC.send.reset, () => post({ type: "reset" }));
ipcMain.on(IPC.send.refreshModels, () => post({ type: "hello" }));

// --- Lifecycle --------------------------------------------------------------

void app.whenReady().then(() => {
  workspace = resolveWorkspace();
  createWindow();
  startEngine();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  engine?.kill();
  engine = null;
});
