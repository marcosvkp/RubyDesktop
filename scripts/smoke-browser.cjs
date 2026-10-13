/**
 * Smoke test: the embedded browser, driven over CDP.
 *
 *   npx electron scripts/smoke-browser.cjs
 *
 * The interesting claim here is not "the page loaded" — it is that the agent's
 * tools produce *real* page effects through real input events. So the assertions
 * are on page state, not on tool output:
 *
 *   1. navigate to a local fixture page and find its interactive elements
 *   2. type into a text field via CDP `Input.insertText`
 *   3. click a button via CDP `Input.dispatchMouseEvent` and read back the text the
 *      page's own DOM listener wrote — proof the click was a trusted event
 *   4. follow a link to a second page
 *   5. capture a screenshot file
 *
 * The fixture is served over HTTP rather than opened as `file://`, because the
 * browser deliberately refuses anything but http(s): `file://` would let a page
 * read the local disk through the browser.
 *
 * Env knobs:
 *   SMOKE_SCREENSHOT  path for a PNG of the browser panel
 *   SMOKE_TIMEOUT_MS  overall budget (default: 240000)
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
console.log("[browser] module loading");
const { runScenario } = require("./smoke-harness.cjs");
const { createBrowserService } = require("../out/main/browser-service.js");
const { BrowserController } = require("../out/main/browser.js");
console.log("[browser] modules loaded");

const FIXTURE_DIR = path.join(__dirname, "fixtures", "browser");
const SHOT = process.env.SMOKE_SCREENSHOT;
const SHOT_DIR = path.join(
  require("node:os").tmpdir(),
  `ruby-browser-shots-${Date.now()}`,
);

/** Serves the fixture directory on an ephemeral port. */
function startFixtureServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const name = (req.url || "/").split("?")[0];
      const file = path.join(
        FIXTURE_DIR,
        name === "/" ? "index.html" : name.slice(1),
      );
      // Contain the path: a request for ../../etc/passwd must not escape the fixture.
      if (!file.startsWith(FIXTURE_DIR)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404).end("not found");
          return;
        }
        res
          .writeHead(200, { "content-type": "text/html; charset=utf-8" })
          .end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

let fixtureServer = null;
let baseUrl = "";

/** The browser service, wired exactly as src/main/index.ts wires it. */
let service = null;
let controller = null;
let reportBrowserState = () => {};
/** Engine replies, captured so the test can await them. */
const replies = new Map();
let replySeq = 0;

/** Calls a browser method the way the engine would, and returns its result. */
function callBrowser(method, params) {
  const id = `t${++replySeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${method} never answered`)),
      30_000,
    );
    replies.set(id, { resolve, reject, timer });
    void service.handle(id, method, params);
  });
}

runScenario({
  name: "browser",
  workspace: process.env.RUBY_DESKTOP_WORKSPACE || process.cwd(),
  timeoutMs: Number(process.env.SMOKE_TIMEOUT_MS || 240_000),
  // Shown so the compositor produces frames — `Page.captureScreenshot` waits for
  // one, and a hidden view may never render any. Note that input does NOT depend on
  // this: focus emulation is what makes clicks work, which is why the test does not
  // need to steal OS focus.
  showWindow: true,
  hooks: {
    async onReady(_ready, api) {
      try {
        await runBrowserChecks(api);
      } catch (err) {
        api.finish(
          1,
          `browser checks failed: ${err && err.stack ? err.stack : err}`,
        );
      }
    },
  },
});

async function runBrowserChecks(api) {
  api.log(`fixture server: ${baseUrl}`);

  // 1. Open the page.
  const opened = await callBrowser("open", { url: baseUrl });
  api.log(`opened: ${opened.url} — "${opened.title}"`);
  if (!opened.url.startsWith(baseUrl)) {
    throw new Error(`navigate did not land on the fixture: ${opened.url}`);
  }
  if (!opened.text.includes("Greet me")) {
    throw new Error(
      `snapshot did not expose the button:\n${opened.text.slice(0, 600)}`,
    );
  }

  // Let the renderer mount the panel and report the real rectangle. The service has
  // a fallback region, but the page is laid out for whatever size the view actually
  // has, so waiting keeps the geometry under test identical to the app's.
  for (let i = 0; i < 40; i++) {
    const mounted = await api.readDom(
      `Boolean(document.querySelector('[data-testid="browser-panel"]'))`,
    );
    if (mounted) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  api.log("browser panel mounted and bounds reported");

  // The snapshot must hand out refs for interactive elements, or click/type are
  // unusable. Pull them out of the rendered tree.
  const refFor = (label) => {
    const line = opened.text
      .split("\n")
      .find((l) => l.includes(`"${label}"`) && l.includes("[ref="));
    return line?.match(/\[ref=(e\d+)\]/)?.[1];
  };
  const nameRef = refFor("Your name");
  const greetRef = refFor("Greet me");
  api.log(`refs: name=${nameRef} greet=${greetRef}`);
  if (!nameRef) throw new Error("no ref for the text input");
  if (!greetRef) throw new Error("no ref for the Greet button");

  // 2. Type into the field with real input events.
  const typed = await callBrowser("type", { ref: nameRef, text: "Ada" });
  api.log("typed 'Ada' into the text field");
  // The typed value must be visible in the tree, which is how the agent knows the
  // field actually took the text.
  if (!typed.text.includes("Ada")) {
    throw new Error(
      `the field did not receive the text:\n${typed.text.slice(0, 600)}`,
    );
  }

  // 3. Click the button. The page's own listener writes the result, so this only
  //    passes if the click was a genuine, trusted mouse event.
  const clicked = await callBrowser("click", { ref: greetRef });
  api.log("clicked 'Greet me'");
  if (!clicked.text.includes("FIXTURE-GREETING:Ada")) {
    throw new Error(
      `the page's click handler did not run with the typed value; tree was:\n${clicked.text.slice(0, 800)}`,
    );
  }
  api.log("page handler ran with the typed value: FIXTURE-GREETING:Ada");

  // 4. A stale ref must be rejected rather than resolving to a different element.
  let staleRejected = false;
  try {
    await callBrowser("click", { ref: "e9999" });
  } catch (err) {
    staleRejected = /unknown ref/.test(err.message);
  }
  if (!staleRejected) throw new Error("an unknown ref was not rejected");
  api.log("unknown ref rejected with a useful error");

  // 5. Navigate to the second page, then go back.
  const second = await callBrowser("navigate", {
    url: `${baseUrl}fixture-second.html`,
  });
  if (!second.text.includes("FIXTURE-SECOND-PAGE")) {
    throw new Error(`second page did not load:\n${second.text.slice(0, 400)}`);
  }
  api.log("navigated to the second page");
  const back = await callBrowser("back", {});
  if (!back.url.startsWith(baseUrl) || back.url.includes("fixture-second")) {
    throw new Error(
      `browser_back did not return to the first page: ${back.url}`,
    );
  }
  api.log("browser_back returned to the first page");

  // 6. Scroll, then screenshot.
  await callBrowser("scroll", { direction: "bottom" });
  api.log("scrolled to the bottom");
  const shot = await callBrowser("screenshot", {});
  const shotPath = shot.text.match(/saved to (.+?) \(/)?.[1];
  if (!shotPath || !fs.existsSync(shotPath)) {
    throw new Error(`screenshot file was not written: ${shot.text}`);
  }
  const shotBytes = fs.statSync(shotPath).size;
  api.log(`screenshot written: ${shotPath} (${shotBytes} bytes)`);
  // A PNG of a real page is far larger than an empty one; this catches a capture
  // that "succeeds" while producing a blank image.
  if (shotBytes < 2000) {
    throw new Error(`the screenshot looks empty (${shotBytes} bytes)`);
  }

  // 7. Tabs are independent pages. Selecting another tab must change what the
  // controller exposes to the agent, and closing it must leave the first tab live.
  const firstTabId = controller.activeTab;
  if (!firstTabId) throw new Error("the first browser tab has no id");
  const bounds = await api.readDom(`(() => {
    const r = document.querySelector('[data-testid="browser-panel"]')?.getBoundingClientRect();
    return r ? { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } : null;
  })()`);
  if (!bounds || bounds.width < 1 || bounds.height < 1)
    throw new Error("browser tab panel has no visible bounds");
  service.setBounds(bounds);
  const secondTabId = controller.newTab(bounds);
  const secondPage = await controller.navigate(`${baseUrl}fixture-second.html`);
  reportBrowserState();
  if (!secondPage.text.includes("FIXTURE-SECOND-PAGE")) {
    throw new Error(
      `the second tab did not load its own page: ${secondPage.url}`,
    );
  }
  if (
    controller.listTabs().length !== 2 ||
    controller.activeTab !== secondTabId
  ) {
    throw new Error("creating a browser tab did not make it active");
  }
  const visibleTabs = await api.readDom(
    `document.querySelectorAll('[role="tab"]').length`,
  );
  let renderedTabCount = visibleTabs;
  for (let i = 0; i < 30 && renderedTabCount !== 2; i++) {
    await new Promise((r) => setTimeout(r, 100));
    renderedTabCount = await api.readDom(
      `document.querySelectorAll('[role="tab"]').length`,
    );
  }
  if (renderedTabCount !== 2)
    throw new Error(`renderer showed ${renderedTabCount} tabs instead of 2`);
  controller.selectTab(firstTabId, bounds);
  reportBrowserState();
  if (!controller.info()?.url.startsWith(baseUrl)) {
    throw new Error("selecting the first tab did not restore its page");
  }
  let selectedTab = await api.readDom(
    `document.querySelector('[role="tab"][aria-selected="true"]')?.id`,
  );
  for (let i = 0; i < 30 && selectedTab !== `browser-tab-${firstTabId}`; i++) {
    await new Promise((r) => setTimeout(r, 100));
    selectedTab = await api.readDom(
      `document.querySelector('[role="tab"][aria-selected="true"]')?.id`,
    );
  }
  if (selectedTab !== `browser-tab-${firstTabId}`)
    throw new Error("renderer did not mark the selected tab as active");
  controller.closeTab(secondTabId, bounds);
  reportBrowserState();
  if (
    controller.listTabs().length !== 1 ||
    controller.activeTab !== firstTabId
  ) {
    throw new Error("closing the second tab did not preserve the first tab");
  }
  let remainingTabs = await api.readDom(
    `document.querySelectorAll('[role="tab"]').length`,
  );
  for (let i = 0; i < 30 && remainingTabs !== 1; i++) {
    await new Promise((r) => setTimeout(r, 100));
    remainingTabs = await api.readDom(
      `document.querySelectorAll('[role="tab"]').length`,
    );
  }
  if (remainingTabs !== 1)
    throw new Error(`renderer showed ${remainingTabs} tabs after close`);
  api.log(
    "two tabs opened independently, selected, and closed without losing the first page",
  );

  // 8. The renderer must have been told the browser is open — that is what makes
  //    the panel appear, so an agent cannot drive a page the user cannot see.
  if (SHOT) {
    const panel = await api.readDom(
      `Boolean(document.querySelector('[data-testid="browser-panel"]'))`,
    );
    api.log(`browser panel present in the renderer: ${panel}`);
    if (!panel)
      throw new Error("the renderer never revealed the browser panel");
    await api.screenshot(SHOT);

    // NOTE: `capturePage()` on the window does NOT composite a `WebContentsView` —
    // it is a separate native layer, so the page area comes out black in that PNG.
    // Capture the page through CDP as well, which is the only way to show what the
    // browser actually rendered. Scroll back to the top first, so the artifact shows
    // the page rather than the empty space the scroll test landed on.
    await callBrowser("scroll", { direction: "top" });
    const pagePng = path.join(path.dirname(SHOT), "smoke-m3-browser-page.png");
    const captured = await callBrowser("screenshot", {});
    const capturedPath = captured.text.match(/saved to (.+?) \(/)?.[1];
    if (capturedPath && fs.existsSync(capturedPath)) {
      fs.copyFileSync(capturedPath, pagePng);
      api.log(`page content captured via CDP -> ${pagePng}`);
    }
  }

  api.finish(
    0,
    "navigate, type, click, back, scroll and screenshot all verified",
  );
}

/** Wires the service and the fixture server before the harness starts the engine. */
process.on("exit", () => {
  try {
    fixtureServer?.close();
    fs.rmSync(SHOT_DIR, { recursive: true, force: true });
  } catch {
    /* nothing to clean */
  }
});

// The harness exports nothing to hook "before start", so the server is started
// eagerly here; `onReady` awaits it.
const ready = startFixtureServer().then((server) => {
  fixtureServer = server;
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
  return server;
});

// Attach the service to the harness's window as soon as one exists. The harness
// creates the window during app.whenReady, so this polls briefly.
function attachService() {
  const { app, BrowserWindow } = require("electron");
  const existing = BrowserWindow.getAllWindows()[0];
  if (!existing) {
    setTimeout(attachService, 50);
    return;
  }
  controller = new BrowserController(
    () => BrowserWindow.getAllWindows()[0] ?? null,
  );
  reportBrowserState = () => {
    const info = controller.info();
    existing.webContents.send("ruby:engine-message", {
      type: "browserState",
      open: controller.isOpen,
      url: info?.url,
      title: info?.title,
      activeTabId: controller.activeTab,
      tabs: controller.listTabs(),
    });
  };
  service = createBrowserService({
    controller,
    screenshotDir: SHOT_DIR,
    onState: reportBrowserState,
    reply: (id, ok, result, error) => {
      const pending = replies.get(id);
      if (!pending) return;
      replies.delete(id);
      clearTimeout(pending.timer);
      if (ok) pending.resolve(result);
      else pending.reject(new Error(error));
    },
    defaultBounds: () => {
      const { width, height } = existing.getContentBounds();
      const panel = Math.max(360, Math.round(width * 0.46));
      return { x: width - panel, y: 0, width: panel, height };
    },
  });
}

void ready.then(() => {
  const { app } = require("electron");
  void app.whenReady().then(attachService);
});
