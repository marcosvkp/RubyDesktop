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

  getRecentWorkspaces: () => ipcRenderer.invoke(IPC.invoke.getRecentWorkspaces),

  pickWorkspace: () => ipcRenderer.invoke(IPC.invoke.pickWorkspace),

  setWorkspace: (path) => ipcRenderer.send(IPC.send.setWorkspace, path),

  saveApiKey: (key) => ipcRenderer.invoke(IPC.invoke.saveApiKey, key),

  getAgentSettings: () => ipcRenderer.invoke(IPC.invoke.getAgentSettings),

  saveAgentSettings: (maxIterations) =>
    ipcRenderer.invoke(IPC.invoke.saveAgentSettings, maxIterations),

  sendPrompt: (text) => ipcRenderer.send(IPC.send.prompt, text),

  activateSkill: (name, args) =>
    ipcRenderer.send(IPC.send.activateSkill, name, args),

  abort: () => ipcRenderer.send(IPC.send.abort),

  setModel: (model, reasoningEffort) =>
    ipcRenderer.send(IPC.send.setModel, model, reasoningEffort),

  setPermissionMode: (mode) =>
    ipcRenderer.send(IPC.send.setPermissionMode, mode),

  respondApproval: (id, decision, scope, grantKey) =>
    ipcRenderer.send(IPC.send.approvalResponse, id, decision, scope, grantKey),

  respondUserQuestion: (id, answers) =>
    ipcRenderer.send(IPC.send.userQuestionResponse, id, answers),

  respondSubAgentConfig: (id, action, config) =>
    ipcRenderer.send(IPC.send.subAgentConfigResponse, id, action, config),

  respondSubAgentReview: (id, action) =>
    ipcRenderer.send(IPC.send.subAgentReviewResponse, id, action),

  compact: () => ipcRenderer.send(IPC.send.compact),

  newSession: () => ipcRenderer.send(IPC.send.newSession),

  resumeSession: (sessionId) =>
    ipcRenderer.send(IPC.send.resumeSession, sessionId),

  getGoal: () => ipcRenderer.send(IPC.send.getGoal),

  setGoal: (text) => ipcRenderer.send(IPC.send.setGoal, text),

  noteGoal: (text) => ipcRenderer.send(IPC.send.noteGoal, text),

  setGoalStatus: (status) => ipcRenderer.send(IPC.send.setGoalStatus, status),

  setGoalMaxRounds: (maxRounds) =>
    ipcRenderer.send(IPC.send.setGoalMaxRounds, maxRounds),

  startAutoGoal: (maxRounds) =>
    ipcRenderer.send(IPC.send.startAutoGoal, maxRounds),

  stopAutoGoal: () => ipcRenderer.send(IPC.send.stopAutoGoal),

  clearGoal: () => ipcRenderer.send(IPC.send.clearGoal),

  refreshMcp: () => ipcRenderer.send(IPC.send.refreshMcp),

  addMcpServer: (name, config) =>
    ipcRenderer.send(IPC.send.addMcpServer, name, config),

  removeMcpServer: (name) => ipcRenderer.send(IPC.send.removeMcpServer, name),

  testMcpServer: (name, config) =>
    ipcRenderer.send(IPC.send.testMcpServer, name, config),

  openBrowser: (url) => ipcRenderer.send(IPC.send.openBrowser, url),

  newBrowserTab: (url) => ipcRenderer.send(IPC.send.newBrowserTab, url),

  selectBrowserTab: (id) => ipcRenderer.send(IPC.send.selectBrowserTab, id),

  closeBrowserTab: (id) => ipcRenderer.send(IPC.send.closeBrowserTab, id),

  closeBrowser: () => ipcRenderer.send(IPC.send.closeBrowser),

  setBrowserBounds: (bounds) =>
    ipcRenderer.send(IPC.send.setBrowserBounds, bounds),

  reset: () => ipcRenderer.send(IPC.send.reset),

  refreshModels: () => ipcRenderer.send(IPC.send.refreshModels),

  onEngineMessage: (handler) => {
    // The raw IpcRendererEvent is intentionally not forwarded: it exposes
    // `sender`, which would hand the renderer a channel back into the main
    // process and defeat the point of the bridge.
    const listener = (_event: unknown, message: EngineResponse): void =>
      handler(message);
    ipcRenderer.on(IPC.engineMessage, listener);
    return () => ipcRenderer.removeListener(IPC.engineMessage, listener);
  },
};

contextBridge.exposeInMainWorld("ruby", api);
