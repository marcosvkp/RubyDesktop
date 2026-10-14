/**
 * Browser tools for the agent.
 *
 * The engine host has no Electron access — it is plain Node so it could run under
 * any supervisor — while the browser is an Electron `WebContentsView` owned by the
 * main process. So each of these tools is a thin proxy: it sends a `browserRequest`
 * over the parent port and awaits the matching `browserResult`.
 *
 * That indirection is deliberate rather than incidental. It keeps the engine
 * portable, and it means the browser is reachable *only* through this narrow
 * method list — the agent cannot ask the main process to do anything else.
 */
import type { Tool, ToolRegistry, ToolResult } from "@rubyclii/cli";
import type { BrowserResult } from "@shared/ipc";
import { BrowserBridge } from "@shared/browser-bridge";

/**
 * How long a browser operation may take before the tool fails.
 *
 * Long enough for a slow page load, short enough that a wedged browser does not
 * consume the whole turn budget.
 */
export { BrowserBridge };

/** Turns a browser result into a tool result the model can read. */
function toToolResult(result: BrowserResult): ToolResult {
  const header = result.url ? `URL: ${result.url}\nTitle: ${result.title ?? ""}\n\n` : "";
  return { success: true, output: header + result.text };
}

/**
 * Builds the browser tool set.
 *
 * Read-only tools are marked `readonly` so plan mode permits them and they skip the
 * confirmation gate; anything that can change page state or cause an outbound
 * request is not, so it goes through the same approval modal as `bash`.
 */
export function createBrowserTools(bridge: BrowserBridge): Tool[] {
  const open: Tool = {
    name: "browser_open",
    description:
      "Open the embedded browser, optionally navigating to a URL. Call this before any other browser tool.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "http(s) URL to open (optional)" },
      },
    },
    async execute(params) {
      const url = params.url as string | undefined;
      const result = await bridge.call("open", { url });
      return toToolResult(result);
    },
  };

  const navigate: Tool = {
    name: "browser_navigate",
    description: "Navigate the embedded browser to a URL and return the page's accessibility tree.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "http(s) URL to navigate to" } },
      required: ["url"],
    },
    validate: (params) =>
      typeof params.url === "string" && params.url.trim() ? null : "url is required",
    async execute(params) {
      const result = await bridge.call("navigate", { url: String(params.url) });
      return toToolResult(result);
    },
  };

  const snapshot: Tool = {
    name: "browser_snapshot",
    readonly: true,
    description:
      "Read the current page as an accessibility tree. Interactive elements are labelled [ref=eN]; " +
      "pass those refs to browser_click and browser_type. Refs are only valid for the most recent " +
      "snapshot, so take a new one after the page changes.",
    parameters: { type: "object", properties: {} },
    async execute() {
      return toToolResult(await bridge.call("snapshot", {}));
    },
  };

  const click: Tool = {
    name: "browser_click",
    description:
      "Click an element by its ref from the latest browser_snapshot, then return the resulting page.",
    parameters: {
      type: "object",
      properties: { ref: { type: "string", description: "Element ref, e.g. e12" } },
      required: ["ref"],
    },
    validate: (params) =>
      typeof params.ref === "string" && params.ref.trim() ? null : "ref is required",
    async execute(params) {
      const result = await bridge.call("click", { ref: String(params.ref) });
      return toToolResult(result);
    },
  };

  const type: Tool = {
    name: "browser_type",
    description:
      "Type text into an element by its ref from the latest browser_snapshot. " +
      "Set submit to press Enter afterwards (for search boxes and forms).",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Element ref, e.g. e4" },
        text: { type: "string", description: "Text to type" },
        submit: { type: "boolean", description: "Press Enter after typing" },
      },
      required: ["ref", "text"],
    },
    validate: (params) => {
      if (typeof params.ref !== "string" || !params.ref.trim()) return "ref is required";
      if (typeof params.text !== "string") return "text is required";
      return null;
    },
    async execute(params) {
      const result = await bridge.call("type", {
        ref: String(params.ref),
        text: String(params.text),
        submit: params.submit === true,
      });
      return toToolResult(result);
    },
  };

  const scroll: Tool = {
    name: "browser_scroll",
    description:
      "Scroll the page and return the updated tree. Useful when the content you need is below the fold.",
    parameters: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["up", "down", "top", "bottom"],
          description: "Where to scroll",
        },
        amount: { type: "number", description: "Pixels to scroll (default 600)" },
      },
      required: ["direction"],
    },
    validate: (params) =>
      ["up", "down", "top", "bottom"].includes(String(params.direction))
        ? null
        : "direction must be one of up, down, top, bottom",
    async execute(params) {
      const result = await bridge.call("scroll", {
        direction: params.direction as "up" | "down" | "top" | "bottom",
        amount: typeof params.amount === "number" ? params.amount : undefined,
      });
      return toToolResult(result);
    },
  };

  const back: Tool = {
    name: "browser_back",
    description: "Go back one page in the embedded browser.",
    parameters: { type: "object", properties: {} },
    async execute() {
      return toToolResult(await bridge.call("back", {}));
    },
  };

  const screenshot: Tool = {
    name: "browser_screenshot",
    description:
      "Capture the browser viewport as a PNG and return the file path. Use this when the layout " +
      "itself matters (visual bugs, CSS), not for reading text — browser_snapshot is better for that.",
    parameters: { type: "object", properties: {} },
    async execute() {
      const result = await bridge.call("screenshot", {});
      return toToolResult(result);
    },
  };

  const close: Tool = {
    name: "browser_close",
    description: "Close the embedded browser when you are done with it.",
    parameters: { type: "object", properties: {} },
    async execute() {
      return toToolResult(await bridge.call("close", {}));
    },
  };

  return [open, navigate, snapshot, click, type, scroll, back, screenshot, close];
}

/** Registers the browser tools into a registry. */
export function registerBrowserTools(registry: ToolRegistry, bridge: BrowserBridge): void {
  for (const tool of createBrowserTools(bridge)) registry.register(tool);
}
