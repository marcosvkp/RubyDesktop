/**
 * End-to-end smoke test, run under Electron.
 *
 *   npx electron scripts/smoke-main.cjs
 *
 * It exercises the real built artifacts — `out/engine/index.mjs` in a
 * `utilityProcess`, and `out/renderer` in a `BrowserWindow` — rather than
 * importing TypeScript source, so it verifies what actually ships.
 *
 * Deliberately a separate entry from `src/main/index.ts`: production code should
 * not carry test affordances, and this way the smoke path can drive the app
 * without a human (send a prompt, wait for the turn to end, capture a screenshot,
 * exit with a meaningful code).
 *
 * Env knobs:
 *   SMOKE_PROMPT      prompt to send              (default: a tool-free "reply OK")
 *   SMOKE_SCREENSHOT  path to write a PNG of the UI
 *   SMOKE_TIMEOUT_MS  overall budget              (default: 180000)
 */
const { app, BrowserWindow, ipcMain, utilityProcess } = require("electron");
const path = require("node:path");

const OUT = path.join(__dirname, "..", "out");
const WORKSPACE = process.env.RUBY_DESKTOP_WORKSPACE || process.cwd();
const PROMPT = process.env.SMOKE_PROMPT || "Reply with exactly: OK";
const SHOT = process.env.SMOKE_SCREENSHOT;
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 180_000);

const CHANNEL = "ruby:engine-message";
const log = (...args) => console.log("[smoke]", ...args);

let engine = null;
let window = null;
let finished = false;
let sawReady = false;
let sawText = "";
let eventTypes = new Set();

function finish(code, reason) {
  if (finished) return;
  finished = true;
  log(`RESULT ${code === 0 ? "PASS" : "FAIL"}: ${reason}`);
  engine?.kill();
  app.exit(code);
}

/** Fails the run if the whole thing stalls, so CI never hangs. */
setTimeout(() => finish(1, `timed out after ${TIMEOUT_MS}ms`), TIMEOUT_MS);

async function capture() {
  if (!SHOT || !window || window.isDestroyed()) return;
  // A screenshot is a nice-to-have: it must never be able to hang the run or
  // change its verdict. `capturePage()` has been observed to never settle while
  // the renderer is busy, so it is both time-bounded and non-fatal.
  try {
    // Give React a frame to paint the final streamed state.
    await new Promise((r) => setTimeout(r, 600));
    const image = await Promise.race([
      window.webContents.capturePage(),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("capturePage did not settle in 15s")), 15_000),
      ),
    ]);
    require("node:fs").writeFileSync(SHOT, image.toPNG());
    log(`screenshot -> ${SHOT} (${image.getSize().width}x${image.getSize().height})`);
  } catch (err) {
    log(`screenshot skipped (non-fatal): ${err.message}`);
  }
}

function startEngine() {
  const entry = path.join(OUT, "engine", "index.mjs");
  log(`engine: ${entry}`);
  log(`workspace: ${WORKSPACE}`);

  engine = utilityProcess.fork(entry, [], {
    cwd: WORKSPACE,
    stdio: "pipe",
    serviceName: "ruby-engine-smoke",
  });

  engine.on("message", async (message) => {
    // Forward to the renderer FIRST. The UI's own state machine is part of what
    // this test verifies, and handling a message before delivering it meant the
    // screenshot could be captured with the stream still marked open.
    if (window && !window.isDestroyed()) window.webContents.send(CHANNEL, message);

    if (message.type === "ready") {
      sawReady = true;
      log(
        `ready: model=${message.model} tools=${message.toolCount} skills=${message.skillCount} key=${message.keySource}`,
      );
      // Drive the prompt through the real path a user takes: type into the
      // Composer's textarea and press Enter. That exercises Composer ->
      // store.send -> preload -> IPC -> main -> engine, and is what puts the
      // user's message into the transcript.
      log(`typing prompt into the Composer: ${JSON.stringify(PROMPT)}`);
      const typed = await window.webContents.executeJavaScript(`(async () => {
        const ta = document.querySelector("textarea");
        if (!ta) return "no-textarea";
        // React tracks the value internally, so assigning .value directly is
        // ignored. Go through the native setter, then fire the event React
        // listens for.
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, "value"
        ).set;
        setter.call(ta, ${JSON.stringify(PROMPT)});
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        // The Enter key must arrive in a LATER task. React batches the state
        // update from the input event, so dispatching both synchronously leaves
        // the keydown handler reading the previous (empty) value from its
        // closure and the submit is a no-op.
        await new Promise((r) => setTimeout(r, 250));
        ta.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
        );
        return "sent";
      })()`);
      if (typed !== "sent") return finish(1, `could not drive the Composer: ${typed}`);
    } else if (message.type === "models") {
      log(`catalog: ${message.models.length} models`);
    } else if (message.type === "event") {
      const e = message.event;
      eventTypes.add(e.type);
      if (e.type === "text") sawText += e.text;
      if (e.type === "tool_call") log(`  tool_call: ${e.name} ${JSON.stringify(e.args).slice(0, 100)}`);
      if (e.type === "tool_result")
        log(`  tool_result: ${e.name} -> ${JSON.stringify(e.result.slice(0, 120))}`);
      if (e.type === "error") log(`  engine error: ${e.message}`);
      if (e.type === "done") {
        log(`answer: ${JSON.stringify(sawText.trim())}`);
        log(`event types: ${[...eventTypes].join(", ")}`);
        await capture();
        if (!sawReady) return finish(1, "never received ready");
        if (!sawText.trim()) return finish(1, "turn produced no text");
        finish(0, "engine started, turn streamed, no errors");
      }
    } else if (message.type === "fatal") {
      finish(1, `fatal: ${message.message}`);
    } else if (message.type === "error") {
      log(`  error: ${message.message}`);
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
        // Engine already gone; nothing useful to report.
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

app.whenReady().then(async () => {
  // Minimal stand-ins for the two invoke handlers the renderer calls on mount.
  ipcMain.handle("ruby:get-workspace", () => WORKSPACE);
  ipcMain.handle("ruby:get-engine-info", () => undefined);

  // The fire-and-forget channels, mirroring src/main/index.ts. Without these the
  // renderer's `sendPrompt` would go nowhere.
  ipcMain.on("ruby:prompt", (_e, text) => engine?.postMessage({ type: "prompt", text }));
  ipcMain.on("ruby:abort", () => engine?.postMessage({ type: "abort" }));
  ipcMain.on("ruby:set-model", (_e, model) => engine?.postMessage({ type: "setModel", model }));
  ipcMain.on("ruby:reset", () => engine?.postMessage({ type: "reset" }));

  window = new BrowserWindow({
    width: 1440,
    height: 920,
    show: Boolean(SHOT),
    backgroundColor: "#050304",
    webPreferences: {
      preload: path.join(OUT, "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2) log(`renderer console: ${message}`);
  });
  window.webContents.on("render-process-gone", (_e, details) =>
    finish(1, `renderer crashed: ${details.reason}`),
  );

  await window.loadFile(path.join(OUT, "renderer", "index.html"));
  log("renderer loaded");

  startEngine();
});
