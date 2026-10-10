/**
 * Preload — the only bridge between the sandboxed renderer and the main process.
 *
 * Everything the UI can do is enumerated here. `contextIsolation` is on and
 * `nodeIntegration` is off, so the renderer has no `require`, no `process`, and no
 * filesystem; it gets `window.ruby` and nothing more. Keeping this list short and
 * explicit is the point: every function added here is a capability handed to
 * untrusted UI code.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { EngineResponse, RubyDesktopApi } from "@shared/ipc";
import { IPC } from "@shared/ipc";

const api: RubyDesktopApi = {
  getWorkspace: () => ipcRenderer.invoke(IPC.invoke.getWorkspace),

  getEngineInfo: () => ipcRenderer.invoke(IPC.invoke.getEngineInfo),

  sendPrompt: (text) => ipcRenderer.send(IPC.send.prompt, text),

  abort: () => ipcRenderer.send(IPC.send.abort),

  setModel: (model) => ipcRenderer.send(IPC.send.setModel, model),

  reset: () => ipcRenderer.send(IPC.send.reset),

  refreshModels: () => ipcRenderer.send(IPC.send.refreshModels),

  onEngineMessage: (handler) => {
    // The raw IpcRendererEvent is intentionally not forwarded: it exposes
    // `sender`, which would hand the renderer a channel back into the main
    // process and defeat the point of the bridge.
    const listener = (_event: unknown, message: EngineResponse): void => handler(message);
    ipcRenderer.on(IPC.engineMessage, listener);
    return () => ipcRenderer.removeListener(IPC.engineMessage, listener);
  },
};

contextBridge.exposeInMainWorld("ruby", api);
