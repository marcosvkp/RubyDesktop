/**
 * The embedded browser, driven over the Chrome DevTools Protocol.
 *
 * Why CDP and not just `webContents.executeJavaScript`:
 *
 *  - `Accessibility.getFullAXTree` gives the agent the same view of the page a
 *    screen reader gets — roles, names, values — instead of raw HTML. That is far
 *    cheaper in tokens and far more robust than asking a model to write selectors.
 *  - `Input.dispatchMouseEvent` / `Input.insertText` produce *real* input events,
 *    so a page that listens for trusted events (or a canvas app) still works.
 *  - `Page.captureScreenshot` works without the page being visible on screen.
 *
 * Element references: a snapshot returns elements labelled `[ref=eN]`. Those refs
 * are only meaningful against the snapshot that produced them, so the ref map is
 * rebuilt on every snapshot and any ref from an older one is rejected rather than
 * silently resolving to a different element.
 *
 * Security note: the browser view is a separate, sandboxed `WebContentsView` with
 * no preload and no Node access. Page content is untrusted input — the engine's
 * provenance tracking already treats tool results as untrusted, and browser
 * results carry the same weight.
 */
import {
  WebContentsView,
  type BrowserWindow,
  type WebContents,
} from "electron";
import type { BrowserTabSummary } from "@shared/ipc";

/** CDP version. 1.3 is the current stable protocol. */
const CDP_VERSION = "1.3";

/** How long a screenshot may take before it is treated as unavailable. */
const SCREENSHOT_TIMEOUT_MS = 10_000;

/** One interactive element the agent can act on. */
interface RefEntry {
  ref: string;
  backendNodeId: number;
  role: string;
  name: string;
}

export interface BrowserSnapshot {
  url: string;
  title: string;
  /** Human/LLM-readable rendering of the tree. */
  text: string;
  /** How many actionable refs this snapshot defined. */
  refCount: number;
}

/** Roles worth giving the agent a handle on. Everything else is context. */
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "switch",
  "slider",
  "spinbutton",
  "textfield",
  "disclosuretriangle",
  "togglebutton",
]);

export class BrowserController {
  private view: WebContentsView | null = null;
  private readonly tabs = new Map<string, WebContentsView>();
  private activeTabId: string | undefined;
  private tabSequence = 0;
  private readonly attachedViews = new WeakSet<WebContents>();
  /** Refs from the most recent snapshot, keyed by ref string. */
  private refs = new Map<string, RefEntry>();
  private refSeq = 0;
  /** Serialises CDP traffic; the protocol is order-sensitive. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private getWindow: () => BrowserWindow | null) {}

  /** True when the browser panel is currently mounted. */
  get isOpen(): boolean {
    return this.view !== null;
  }

  get webContents(): WebContents | null {
    return this.view?.webContents ?? null;
  }

  get activeTab(): string | undefined {
    return this.activeTabId;
  }

  listTabs(): BrowserTabSummary[] {
    return [...this.tabs].map(([id, view]) => ({
      id,
      url: view.webContents.getURL(),
      title: view.webContents.getTitle() || "Nova aba",
    }));
  }

  /**
   * Creates the view if needed and places it.
   *
   * Bounds are supplied by the caller because only the window owner knows the
   * layout. Keeping the view out of the DOM is the point: a `WebContentsView` is a
   * separate process, so page code can never reach the app's renderer.
   */
  open(bounds: { x: number; y: number; width: number; height: number }): void {
    const win = this.getWindow();
    if (!win) throw new Error("no window to attach the browser to");

    if (!this.view) {
      const existing =
        this.activeTabId && this.tabs.has(this.activeTabId)
          ? this.activeTabId
          : this.tabs.keys().next().value;
      if (existing) this.activateTab(existing, bounds);
      else this.newTab(bounds);
    } else {
      this.setBounds(bounds);
    }
  }

  /** Creates a separate sandboxed page process that shares the browser cookie jar. */
  newTab(bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): string {
    const win = this.getWindow();
    if (!win) throw new Error("no window to attach the browser to");
    const view = new WebContentsView({
      webPreferences: {
        // Page content is untrusted: no preload, no Node, OS sandbox on.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Tabs share the browser's explicit persistent cookie partition.
        partition: "persist:ruby-browser",
      },
    });
    const id = `browser-tab-${++this.tabSequence}`;
    this.tabs.set(id, view);
    win.contentView.addChildView(view);
    if (!view.webContents.getURL())
      void view.webContents.loadURL("about:blank");
    this.activateTab(id, bounds);
    return id;
  }

  selectTab(
    id: string,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    if (!this.tabs.has(id)) return;
    this.activateTab(id, bounds);
  }

  closeTab(
    id: string,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    const closing = this.tabs.get(id);
    if (!closing) return;
    const win = this.getWindow();
    this.tabs.delete(id);
    try {
      win?.contentView.removeChildView(closing);
    } catch {
      // Window already gone.
    }
    try {
      closing.webContents.close();
    } catch {
      // Already destroyed.
    }
    if (this.activeTabId !== id) return;
    this.view = null;
    this.activeTabId = undefined;
    this.refs.clear();
    const fallback = [...this.tabs.keys()].at(-1);
    if (fallback) this.activateTab(fallback, bounds);
  }

  setBounds(bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): void {
    this.view?.setBounds(bounds);
  }

  close(): void {
    const win = this.getWindow();
    const views = [...this.tabs.values()];
    if (views.length === 0 && this.view) views.push(this.view);
    this.tabs.clear();
    this.view = null;
    this.activeTabId = undefined;
    this.refs.clear();
    for (const view of views) {
      try {
        win?.contentView.removeChildView(view);
      } catch {
        // Window already gone.
      }
      try {
        view.webContents.close();
      } catch {
        // Already destroyed.
      }
    }
  }

  /** Hides the previous native view and raises the selected tab over the page area. */
  private activateTab(
    id: string,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    const next = this.tabs.get(id);
    const win = this.getWindow();
    if (!next || !win) return;
    if (this.view && this.view !== next) {
      this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
    this.view = next;
    this.activeTabId = id;
    this.refs.clear();
    this.refSeq = 0;
    try {
      win.contentView.removeChildView(next);
    } catch {
      // The tab may not have been attached yet.
    }
    win.contentView.addChildView(next);
    next.setBounds(bounds);
  }

  /** Attaches the debugger once. Idempotent. */
  private async ensureAttached(): Promise<WebContents> {
    if (!this.view)
      throw new Error("the browser is not open; call browser_open first");
    const wc = this.view.webContents;
    if (!this.attachedViews.has(wc)) {
      await wc.debugger.attach(CDP_VERSION);
      this.attachedViews.add(wc);
      // Enabling the Accessibility domain is what makes getFullAXTree cheap; it is
      // otherwise computed on demand per call.
      await wc.debugger.sendCommand("Accessibility.enable");
      // Make the page behave as if it were focused even when the app window is in
      // the background. Without this, Chromium drops synthetic input for an
      // unfocused view: the CDP commands still report success, the page's handlers
      // simply never run, and the agent's clicks silently do nothing. Relying on
      // real OS focus instead would mean stealing focus from whatever the user is
      // doing, which is both rude and unreliable (any click elsewhere breaks it).
      await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {
        enabled: true,
      });
    }
    return wc;
  }

  /** Runs a CDP command, serialised against other commands. */
  private send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const run = async (): Promise<T> => {
      const wc = await this.ensureAttached();
      return (await wc.debugger.sendCommand(method, params)) as T;
    };
    // Chain onto the queue so two tool calls cannot interleave CDP traffic.
    const next = this.queue.then(run, run);
    // Keep the chain alive even if this command rejects.
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Waits for the page to finish loading, or for the timeout. */
  private waitForLoad(timeoutMs = 20_000): Promise<void> {
    const wc = this.view?.webContents;
    if (!wc || !wc.isLoading()) return Promise.resolve();

    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        wc.off("did-finish-load", done);
        wc.off("did-fail-load", done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      wc.once("did-finish-load", done);
      wc.once("did-fail-load", done);
    });
  }

  /** Navigates and waits for the load to settle. */
  async navigate(url: string): Promise<BrowserSnapshot> {
    if (!this.view)
      throw new Error("the browser is not open; call browser_open first");

    // Reject anything that is not a real web URL: `file://` would let a page read
    // the local disk through the browser, which is not what this feature is for.
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`'${url}' is not a valid URL`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `only http and https are allowed, got '${parsed.protocol}'`,
      );
    }

    // A navigation invalidates every ref from the previous page.
    this.refs.clear();
    await this.view.webContents.loadURL(parsed.toString());
    await this.waitForLoad();
    return this.snapshot();
  }

  async goBack(): Promise<BrowserSnapshot> {
    const wc = this.view?.webContents;
    if (!wc)
      throw new Error("the browser is not open; call browser_open first");
    this.refs.clear();
    if (wc.navigationHistory.canGoBack()) {
      wc.navigationHistory.goBack();
      await this.waitForLoad();
    }
    return this.snapshot();
  }

  /**
   * Reads the accessibility tree and assigns refs to interactive nodes.
   *
   * The ref map is replaced wholesale: an old ref must not resolve against a new
   * page, because it would point at an unrelated element.
   */
  async snapshot(): Promise<BrowserSnapshot> {
    const wc = this.view?.webContents;
    if (!wc)
      throw new Error("the browser is not open; call browser_open first");

    const { nodes } = await this.send<{ nodes: RawAxNode[] }>(
      "Accessibility.getFullAXTree",
    );

    this.refs.clear();
    this.refSeq = 0;
    const lines: string[] = [];
    let refCount = 0;

    for (const node of nodes) {
      if (node.ignored) continue;
      const role = axValue(node.role);
      if (!role) continue;
      // Generic containers carry no information; their children are emitted
      // independently, so skipping them only removes noise.
      if (role === "generic" || role === "none" || role === "InlineTextBox")
        continue;

      const name = axValue(node.name) ?? "";
      const value = axValue(node.value);
      const backendNodeId = node.backendDOMNodeId;

      let ref: string | undefined;
      if (INTERACTIVE_ROLES.has(role) && typeof backendNodeId === "number") {
        ref = `e${++this.refSeq}`;
        this.refs.set(ref, { ref, backendNodeId, role, name });
        refCount++;
      }

      const label = name.length > 200 ? `${name.slice(0, 200)}…` : name;
      if (!label && !ref && value === undefined) continue;

      const parts = [`- ${role}`];
      if (label) parts.push(`"${label}"`);
      if (ref) parts.push(`[ref=${ref}]`);
      if (value !== undefined && value !== "")
        parts.push(`value="${truncate(value, 100)}"`);
      lines.push(parts.join(" "));
    }

    // Guard against a pathological page producing an unusable wall of text.
    const MAX_LINES = 1500;
    const capped = lines.length > MAX_LINES;
    const text = (capped ? lines.slice(0, MAX_LINES) : lines).join("\n");

    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      text:
        text +
        (capped
          ? `\n\n[truncated: ${lines.length - MAX_LINES} more nodes not shown]`
          : ""),
      refCount,
    };
  }

  /** Resolves a ref from the latest snapshot, or throws a useful error. */
  private requireRef(ref: string): RefEntry {
    const entry = this.refs.get(ref);
    if (!entry) {
      const known = [...this.refs.keys()].slice(0, 12).join(", ");
      throw new Error(
        `unknown ref '${ref}'. Refs are valid only until the page changes; ` +
          `take a new snapshot. Known refs: ${known || "(none)"}`,
      );
    }
    return entry;
  }

  /** Centre point of an element, in CSS pixels relative to the viewport. */
  private async centreOf(entry: RefEntry): Promise<{ x: number; y: number }> {
    const { model } = await this.send<{
      model: { content: number[] };
    }>("DOM.getBoxModel", { backendNodeId: entry.backendNodeId });

    const c = model.content;
    // content is [x1,y1, x2,y2, x3,y3, x4,y4] — the four corners.
    const x = (c[0] + c[2] + c[4] + c[6]) / 4;
    const y = (c[1] + c[3] + c[5] + c[7]) / 4;
    return { x, y };
  }

  /**
   * Focuses the page so synthetic input is actually delivered.
   *
   * Focus emulation (set up in `ensureAttached`) does the heavy lifting, so this
   * only needs to place keyboard focus inside the document. It is best-effort:
   * a destroyed view cannot be focused, and the caller's error path handles that.
   */
  private focusPage(): void {
    try {
      this.view?.webContents.focus();
    } catch {
      // A destroyed view cannot be focused.
    }
  }

  /** Clicks an element with real mouse events, after scrolling it into view. */
  async click(ref: string): Promise<BrowserSnapshot> {
    const entry = this.requireRef(ref);
    await this.send("DOM.scrollIntoViewIfNeeded", {
      backendNodeId: entry.backendNodeId,
    });
    const { x, y } = await this.centreOf(entry);
    const at = { x: Math.round(x), y: Math.round(y) };
    this.focusPage();

    // `buttons` is the pressed-button bitmask, and Chromium's input pipeline uses
    // it — not just `button` — to decide that a press is a real click.
    const base = {
      ...at,
      button: "left" as const,
      clickCount: 1,
      pointerType: "mouse" as const,
    };
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...base,
      buttons: 0,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...base,
      buttons: 1,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...base,
      buttons: 0,
    });

    // A click often navigates or opens a menu; give it a beat before snapshotting
    // so the returned tree describes the result rather than the page that was.
    await delay(400);
    await this.waitForLoad(5_000);
    return this.snapshot();
  }

  /** Focuses an element and inserts text as if typed. */
  async type(
    ref: string,
    text: string,
    submit = false,
  ): Promise<BrowserSnapshot> {
    const entry = this.requireRef(ref);
    await this.send("DOM.scrollIntoViewIfNeeded", {
      backendNodeId: entry.backendNodeId,
    });
    this.focusPage();
    await this.send("DOM.focus", { backendNodeId: entry.backendNodeId });
    // insertText fires a real input event, which is what React-controlled fields
    // listen for. Setting .value over CDP would bypass their state.
    await this.send("Input.insertText", { text });

    if (submit) {
      for (const type of ["keyDown", "keyUp"] as const) {
        await this.send("Input.dispatchKeyEvent", {
          type,
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13,
        });
      }
      await delay(400);
      await this.waitForLoad(5_000);
    }
    return this.snapshot();
  }

  /** Scrolls the page by a number of pixels, or to the top/bottom. */
  async scroll(
    direction: "up" | "down" | "top" | "bottom",
    amount = 600,
  ): Promise<BrowserSnapshot> {
    const wc = this.view?.webContents;
    if (!wc)
      throw new Error("the browser is not open; call browser_open first");

    // Reading layout requires the DOM domain, and the scroll itself is a page
    // operation rather than an input event — this is both simpler and more
    // reliable than synthesising wheel events at a guessed coordinate.
    const script =
      direction === "top"
        ? "window.scrollTo(0, 0)"
        : direction === "bottom"
          ? "window.scrollTo(0, document.body.scrollHeight)"
          : `window.scrollBy(0, ${direction === "down" ? amount : -amount})`;

    await wc.executeJavaScript(`${script}; true`);
    await delay(250);
    return this.snapshot();
  }

  /** Captures the viewport as a PNG and writes it to `path`. */
  async screenshot(
    path: string,
  ): Promise<{ path: string; width: number; height: number }> {
    // `Page.captureScreenshot` waits for a compositor frame. An offscreen or hidden
    // view may never produce one, and the command then never settles — which would
    // consume the entire turn budget. Bound it and fail with a clear reason.
    const data = await withTimeout(
      this.send<{ data: string }>("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      }),
      SCREENSHOT_TIMEOUT_MS,
      "Page.captureScreenshot did not settle — is the browser panel visible?",
    );

    const buffer = Buffer.from(data.data, "base64");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, buffer);

    const size = await this.viewportSize();
    return { path, ...size };
  }

  private async viewportSize(): Promise<{ width: number; height: number }> {
    const bounds = this.view?.getBounds();
    return { width: bounds?.width ?? 0, height: bounds?.height ?? 0 };
  }

  /** Current page URL and title, for the UI header. */
  info(): { url: string; title: string } | null {
    const wc = this.view?.webContents;
    if (!wc) return null;
    return { url: wc.getURL(), title: wc.getTitle() };
  }
}

/** CDP wraps accessibility values in a descriptor object. */
interface RawAxNode {
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: string };
  backendDOMNodeId?: number;
}

function axValue(field: { value?: unknown } | undefined): string | undefined {
  const value = field?.value;
  return typeof value === "string"
    ? value
    : value === undefined
      ? undefined
      : String(value);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Rejects if `promise` has not settled within `ms`. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
