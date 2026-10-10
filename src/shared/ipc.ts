/**
 * The IPC contract between the renderer, the main process and the engine host.
 *
 * This is the API surface the whole UI is built on, so it is defined once, here,
 * and imported by all three sides. The engine host re-emits the agent's own event
 * union verbatim rather than translating it, so the renderer sees exactly what the
 * engine produced.
 *
 * Layering note: the `import type` below is erased at build time. The renderer
 * therefore gets the engine's event *types* without pulling any engine code into
 * the browser bundle — the renderer must never import `@rubyclii/cli` at runtime.
 */
import type { AgentEvent } from "@rubyclii/cli";

/** Re-exported so the renderer can name agent events without importing the engine. */
export type { AgentEvent };

/** A model as reported by the Ruby catalog. */
export interface ModelSummary {
  id: string;
  label: string;
  contextWindow?: number;
  supportsReasoning?: boolean;
  supportsVision?: boolean;
}

/** Lifecycle state of the engine host, surfaced in the status bar. */
export type EngineStatus = "starting" | "ready" | "busy" | "error" | "stopped";

/** Messages sent from the main process to the engine host. */
export type EngineRequest =
  | { type: "hello" }
  | { type: "prompt"; text: string }
  | { type: "abort" }
  | { type: "setModel"; model: string }
  | { type: "reset" };

/** Messages sent from the engine host back to the main process. */
export type EngineResponse =
  | {
      type: "ready";
      workspace: string;
      model: string;
      toolCount: number;
      skillCount: number;
      keySource: string;
    }
  | { type: "models"; models: ModelSummary[] }
  | { type: "status"; status: EngineStatus }
  | { type: "event"; event: AgentEvent }
  | { type: "usage"; inputTokens: number; outputTokens: number; contextWindow: number }
  | { type: "error"; message: string }
  | { type: "fatal"; message: string };

/**
 * The narrow API exposed on `window.ruby` by the preload script.
 *
 * Deliberately small and explicit: the renderer gets exactly these functions and
 * nothing else, so it cannot reach Node, the filesystem or the engine directly.
 */
export interface RubyDesktopApi {
  /** Current workspace directory, resolved by the main process. */
  getWorkspace(): Promise<string>;
  /** Engine lifecycle + model catalog snapshot. */
  getEngineInfo(): Promise<EngineResponse | undefined>;
  /** Start a turn. Streamed output arrives via `onEngineMessage`. */
  sendPrompt(text: string): void;
  /** Cancel the in-flight turn. */
  abort(): void;
  /** Switch the model used for subsequent turns. */
  setModel(model: string): void;
  /** Clear the conversation and start a fresh session. */
  reset(): void;
  /** Ask the engine to refresh its model catalog. */
  refreshModels(): void;
  /** Subscribe to engine output. Returns an unsubscribe function. */
  onEngineMessage(handler: (message: EngineResponse) => void): () => void;
}

/** IPC channel names, kept in one place so both sides cannot drift. */
export const IPC = {
  /** Renderer → main, request/response. */
  invoke: {
    getWorkspace: "ruby:get-workspace",
    getEngineInfo: "ruby:get-engine-info",
  },
  /** Renderer → main, fire-and-forget. */
  send: {
    prompt: "ruby:prompt",
    abort: "ruby:abort",
    setModel: "ruby:set-model",
    reset: "ruby:reset",
    refreshModels: "ruby:refresh-models",
  },
  /** Main → renderer, streamed engine output. */
  engineMessage: "ruby:engine-message",
} as const;
