/**
 * Shared bootstrap for the Electron smoke tests.
 *
 * Both smoke scripts need the same four things: the built engine running in a
 * `utilityProcess` with the workspace as its cwd, a `BrowserWindow` loading the
 * built renderer, the full set of IPC channels wired the way `src/main/index.ts`
 * wires them, and a hard timeout so a stall can never hang CI.
 *
 * Keeping that here rather than in each script means a new IPC channel is added in
 * one place, and it keeps the drift risk down: a smoke test that forgets to wire a
 * channel would silently pass while the real app was broken.
 */
const { app, BrowserWindow, ipcMain, utilityProcess } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const OUT = path.join(__dirname, "..", "out");
const CHANNEL = "ruby:engine-message";

/**
 * Boots the engine and the renderer, then hands control to `hooks`.
 *
 * Hooks (all optional):
 *   onMessage(message)  — every engine message, after it reaches the renderer
 *   onEvent(event)      — agent events, unwrapped
 *   onReady(ready)      — the engine's `ready` message
 *   onIdle()            — the turn finished (a `done` event was seen)
 *   screenshot(path)    — capture the window to a PNG; never fatal
 */
function runScenario({ name, prompt, workspace, screenshotPath, timeoutMs = 180_000, hooks = {} }) {
  const log = (...args) => console.log(`[${name}]`, ...args);
  let engine = null;
  let win = null;
  let finished = false;

  const state = {
    sawReady: false,
    sawDone: false,
    text: "",
    eventTypes: new Set(),
    approvals: [],
  };

  function finish(code, reason) {
    if (finished) return;
    finished = true;
    log(`RESULT ${code === 0 ? "PASS" : "FAIL"}: ${reason}`);
    try {
      engine?.kill();
    } catch {
      /* already gone */
    }
    app.exit(code);
  }

  setTimeout(() => finish(1, `timed out after ${timeoutMs}ms`), timeoutMs);

  async function screenshot(target) {
    if (!target || !win || win.isDestroyed()) return;
    // A screenshot is a nice-to-have: it must never hang the run or change its
    // verdict. `capturePage()` has been observed not to settle while the renderer
    // is busy, so it is both time-bounded and non-fatal.
    try {
      // Ask the renderer to paint before asking the compositor for a frame.
      // Without this the capture can return the *previous* frame: the DOM already
      // had the goal banner and the modal, but the PNG showed a state two renders
      // old, which makes a passing test look broken and a broken one look fine.
      await win.webContents.executeJavaScript(
        `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`,
      );
      await new Promise((r) => setTimeout(r, 300));
      const image = await Promise.race([
        win.webContents.capturePage(),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error("capturePage did not settle in 15s")), 15_000),
        ),
      ]);
      fs.writeFileSync(target, image.toPNG());
      log(`screenshot -> ${target} (${image.getSize().width}x${image.getSize().height})`);
    } catch (err) {
      log(`screenshot skipped (non-fatal): ${err.message}`);
    }
  }

  /** Types into the real Composer and presses Enter, as a user would. */
  async function type(text) {
    return win.webContents.executeJavaScript(`(async () => {
      const ta = document.querySelector("textarea");
      if (!ta) return "no-textarea";
      // React tracks the value internally, so assigning .value directly is
      // ignored. Go through the native setter, then fire the event React listens for.
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      ).set;
      setter.call(ta, ${JSON.stringify(text)});
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      // The Enter key must arrive in a LATER task. React batches the state update
      // from the input event, so dispatching both synchronously leaves the keydown
      // handler reading the previous (empty) value from its closure and the submit
      // is a no-op.
      await new Promise((r) => setTimeout(r, 250));
      ta.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
      );
      return "sent";
    })()`);
  }

  /** Clicks a button by its visible label. Returns the label clicked, or null. */
  async function clickButton(label) {
    return win.webContents.executeJavaScript(`(() => {
      const wanted = ${JSON.stringify(label)};
      const buttons = [...document.querySelectorAll("button")];
      const hit = buttons.find((b) => (b.textContent || "").trim() === wanted)
        || buttons.find((b) => (b.textContent || "").includes(wanted));
      if (!hit) return null;
      hit.click();
      return (hit.textContent || "").trim();
    })()`);
  }

  /** Reads a slice of the rendered DOM back out, for assertions. */
  async function readDom(expression) {
    return win.webContents.executeJavaScript(expression);
  }

  function startEngine() {
    const entry = path.join(OUT, "engine", "index.mjs");
    log(`engine: ${entry}`);
    log(`workspace: ${workspace}`);

    engine = utilityProcess.fork(entry, [], {
      cwd: workspace,
      stdio: "pipe",
      serviceName: `ruby-engine-${name}`,
    });

    engine.on("message", async (message) => {
      // Forward to the renderer FIRST. The UI's own state machine is part of what
      // these tests verify, and handling a message before delivering it meant a
      // screenshot could be captured with the stream still marked open.
      if (win && !win.isDestroyed()) win.webContents.send(CHANNEL, message);

      try {
        await hooks.onMessage?.(message, api);

        if (message.type === "ready") {
          state.sawReady = true;
          log(
            `ready: model=${message.model} tools=${message.toolCount} skills=${message.skillCount} ` +
              `mode=${message.permissionMode} key=${message.keySource}`,
          );
          await hooks.onReady?.(message, api);
        } else if (message.type === "models") {
          log(`catalog: ${message.models.length} models`);
        } else if (message.type === "approvalRequest") {
          state.approvals.push(message.request);
          log(`approval requested: ${message.request.toolName} -> ${message.request.detail}`);
        } else if (message.type === "event") {
          const event = message.event;
          state.eventTypes.add(event.type);
          if (event.type === "text") state.text += event.text;
          if (event.type === "tool_call")
            log(`  tool_call: ${event.name} ${JSON.stringify(event.args).slice(0, 100)}`);
          if (event.type === "tool_result")
            log(`  tool_result: ${event.name} -> ${JSON.stringify(event.result.slice(0, 140))}`);
          if (event.type === "error") log(`  engine error: ${event.message}`);
          await hooks.onEvent?.(event, api);
          if (event.type === "done") {
            state.sawDone = true;
            log(`answer: ${JSON.stringify(state.text.trim())}`);
            log(`event types: ${[...state.eventTypes].join(", ")}`);
            await hooks.onIdle?.(state, api);
          }
        } else if (message.type === "fatal") {
          finish(1, `fatal: ${message.message}`);
        } else if (message.type === "error") {
          log(`  error: ${message.message}`);
        }
      } catch (err) {
        finish(1, `hook threw: ${err && err.stack ? err.stack : err}`);
      }
    });

    // `stdio: "pipe"` means these fire during teardown too, after the process is
    // gone. Writing then throws "Object has been destroyed", which surfaces as an
    // unhandled rejection and pollutes the result.
    const forward = (stream, sink) => {
      stream?.on("data", (chunk) => {
        try {
          sink.write(`[engine] ${chunk}`);
        } catch {
          /* engine already gone */
        }
      });
    };
    forward(engine.stdout, process.stdout);
    forward(engine.stderr, process.stderr);

    engine.on("exit", (code) => {
      if (!finished) finish(1, `engine exited early with code ${code}`);
    });

    engine.postMessage({ type: "hello" });
  }

  const api = {
    log,
    finish,
    screenshot,
    type,
    clickButton,
    readDom,
    state,
    post: (request) => engine?.postMessage(request),
    get engine() {
      return engine;
    },
    get window() {
      return win;
    },
  };

  app.whenReady().then(async () => {
    // The two invoke handlers the renderer calls on mount.
    ipcMain.handle("ruby:get-workspace", () => workspace);
    ipcMain.handle("ruby:get-engine-info", () => undefined);
    ipcMain.handle("ruby:pick-workspace", () => undefined);

    // The fire-and-forget channels, mirroring src/main/index.ts. A channel missing
    // here would make the smoke test pass while the real app was broken.
    ipcMain.on("ruby:prompt", (_e, text) => engine?.postMessage({ type: "prompt", text }));
    ipcMain.on("ruby:abort", () => engine?.postMessage({ type: "abort" }));
    ipcMain.on("ruby:set-workspace", () => {});
    ipcMain.on("ruby:set-model", (_e, model) => engine?.postMessage({ type: "setModel", model }));
    ipcMain.on("ruby:set-permission-mode", (_e, mode) =>
      engine?.postMessage({ type: "setPermissionMode", mode }),
    );
    ipcMain.on("ruby:approval-response", (_e, id, decision, scope, grantKey) =>
      engine?.postMessage({ type: "approvalResponse", id, decision, scope, grantKey }),
    );
    ipcMain.on("ruby:compact", () => engine?.postMessage({ type: "compact" }));
    ipcMain.on("ruby:get-goal", () => engine?.postMessage({ type: "goal", action: "get" }));
    ipcMain.on("ruby:set-goal", (_e, text) =>
      engine?.postMessage({ type: "goal", action: "set", text }),
    );
    ipcMain.on("ruby:note-goal", (_e, text) =>
      engine?.postMessage({ type: "goal", action: "note", text }),
    );
    ipcMain.on("ruby:set-goal-status", (_e, status) =>
      engine?.postMessage({ type: "goal", action: "status", status }),
    );
    ipcMain.on("ruby:clear-goal", () => engine?.postMessage({ type: "goal", action: "clear" }));
    ipcMain.on("ruby:reset", () => engine?.postMessage({ type: "reset" }));
    ipcMain.on("ruby:refresh-models", () => engine?.postMessage({ type: "hello" }));

    win = new BrowserWindow({
      width: 1440,
      height: 920,
      show: Boolean(screenshotPath),
      backgroundColor: "#050304",
      webPreferences: {
        preload: path.join(OUT, "preload", "index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    win.webContents.on("console-message", (_e, level, message) => {
      if (level >= 2) log(`renderer console: ${message}`);
    });
    win.webContents.on("render-process-gone", (_e, details) =>
      finish(1, `renderer crashed: ${details.reason}`),
    );

    await win.loadFile(path.join(OUT, "renderer", "index.html"));
    log("renderer loaded");

    if (prompt) log(`initial prompt: ${JSON.stringify(prompt)}`);
    startEngine();
  });
}

module.exports = { runScenario, OUT, CHANNEL };
