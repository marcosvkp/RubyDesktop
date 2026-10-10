/**
 * The browser RPC service.
 *
 * Kept separate from `src/main/index.ts` for one concrete reason: the smoke tests
 * run their own Electron main (so they can assert on the app without a human), and
 * they must exercise the *same* browser implementation the app uses. A copy in the
 * test harness would be free to drift, and the drift would look like a passing test.
 *
 * It is emitted as its own bundle (`out/main/browser-service.js`) so the harness can
 * require it directly.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserController } from "./browser.js";
import type { BrowserMethod, BrowserResult } from "@shared/ipc";

export interface BrowserServiceDeps {
  controller: BrowserController;
  /** Where `browser_screenshot` writes PNGs. */
  screenshotDir: string;
  /** Called after any operation that can change the panel's state. */
  onState: () => void;
  /** Answers the engine. Exactly one call per `handle`. */
  reply: (id: string, ok: boolean, result?: BrowserResult, error?: string) => void;
  /** Reports a user-initiated navigation failure to the UI. */
  onUserError?: (message: string) => void;
  /**
   * A rectangle to use when the renderer has not reported one yet.
   *
   * The agent can open the browser before the panel has mounted and measured
   * itself, and a zero-sized view is not merely invisible: Chromium drops
   * synthetic input outside the widget, so clicks silently do nothing. Falling back
   * to a real region makes the browser usable from the first tool call.
   */
  defaultBounds?: () => { x: number; y: number; width: number; height: number };
}

export interface BrowserService {
  /** Performs one browser operation for the engine. */
  handle(id: string, method: BrowserMethod, params: unknown): Promise<void>;
  /** Opens the panel for the user, optionally navigating. */
  openForUser(url?: string): void;
  closeForUser(): void;
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
}

/**
 * Creates the service.
 *
 * Every path answers the engine: a tool call that never resolves would hang the
 * turn until the bridge's own timeout, and the model would have no idea why.
 */
export function createBrowserService(deps: BrowserServiceDeps): BrowserService {
  const { controller, screenshotDir, onState } = deps;

  let bounds: Bounds = { x: 0, y: 0, width: 0, height: 0 };

  /** Bounds to actually use: the reported rectangle, or a sane fallback. */
  const effectiveBounds = (): Bounds => {
    if (bounds.width > 0 && bounds.height > 0) return bounds;
    return deps.defaultBounds?.() ?? { x: 0, y: 0, width: 800, height: 600 };
  };

  /** Opens the view on demand, so one tool call is enough to reach a page. */
  const ensureOpen = (): void => {
    if (!controller.isOpen) controller.open(effectiveBounds());
    else controller.setBounds(effectiveBounds());
  };

  const handle = async (id: string, method: BrowserMethod, params: unknown): Promise<void> => {
    /** Answers the engine for this request. Bound to `id` so no call can forget it. */
    const reply = (ok: boolean, result?: BrowserResult, error?: string): void =>
      deps.reply(id, ok, result, error);

    try {
      switch (method) {
        case "open": {
          const url = (params as { url?: string }).url;
          ensureOpen();
          onState();
          const result = url ? await controller.navigate(url) : await controller.snapshot();
          onState();
          return reply(true, {
            text: result.text || "(page is empty)",
            url: result.url,
            title: result.title,
          });
        }

        case "navigate": {
          ensureOpen();
          const result = await controller.navigate((params as { url: string }).url);
          onState();
          return reply(true, { text: result.text, url: result.url, title: result.title });
        }

        case "back": {
          const result = await controller.goBack();
          onState();
          return reply(true, { text: result.text, url: result.url, title: result.title });
        }

        case "snapshot": {
          const result = await controller.snapshot();
          return reply(true, { text: result.text, url: result.url, title: result.title });
        }

        case "click": {
          const result = await controller.click((params as { ref: string }).ref);
          onState();
          return reply(true, { text: result.text, url: result.url, title: result.title });
        }

        case "type": {
          const p = params as { ref: string; text: string; submit?: boolean };
          const result = await controller.type(p.ref, p.text, p.submit);
          onState();
          return reply(true, { text: result.text, url: result.url, title: result.title });
        }

        case "scroll": {
          const p = params as { direction: "up" | "down" | "top" | "bottom"; amount?: number };
          const result = await controller.scroll(p.direction, p.amount);
          return reply(true, { text: result.text, url: result.url, title: result.title });
        }

        case "screenshot": {
          // Screenshots go to the app's own data dir rather than the workspace: they
          // are a by-product of looking, not an artefact of the user's project.
          await mkdir(screenshotDir, { recursive: true });
          const target = join(screenshotDir, `browser-${Date.now()}.png`);
          const shot = await controller.screenshot(target);
          const info = controller.info();
          return reply(true, {
            text: `Screenshot saved to ${shot.path} (${shot.width}x${shot.height}).`,
            url: info?.url,
            title: info?.title,
          });
        }

        case "close": {
          controller.close();
          onState();
          return reply(true, { text: "Browser closed." });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onState();
      return reply(false, undefined, message);
    }
  };

  return {
    handle,

    openForUser(url?: string): void {
      ensureOpen();
      onState();
      if (!url) return;
      void controller.navigate(url).then(onState, (err: unknown) => {
        deps.onUserError?.(
          `Could not open ${url}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    },

    closeForUser(): void {
      controller.close();
      onState();
    },

    setBounds(next: Bounds): void {
      bounds = next;
      if (controller.isOpen) controller.setBounds(effectiveBounds());
    },
  };
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
