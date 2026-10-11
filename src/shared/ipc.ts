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
import type { AgentEvent, PermissionMode } from "@rubyclii/cli";

/** Re-exported so the renderer can name agent events without importing the engine. */
export type { AgentEvent, PermissionMode };

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

// --- Permissions ------------------------------------------------------------

/** How long a grant lasts. `once` is not persisted; the other two are. */
export type ApprovalScope = "once" | "project" | "global";

/**
 * Which grant key an "always allow" writes.
 *
 * Mirrors the terminal picker's three persistent choices: this exact call, any
 * call to this tool, or any tool from this MCP server.
 */
export type GrantKeyKind = "exact" | "toolWide" | "mcpServerWide";

/** The answer the user gave in the approval modal. */
export type ApprovalDecision = "allow" | "deny";

/**
 * A tool call the engine has paused on, waiting for the user.
 *
 * The engine generates the `id` and blocks the tool call until the renderer sends
 * back an `approvalResponse` with the same id. If the renderer never answers (window
 * closed, engine torn down) the engine's timeout denies the call — a GUI must never
 * be able to hang a turn forever.
 */
export interface ApprovalRequest {
  id: string;
  toolName: string;
  /** The single most useful argument to show a human: the command, or the file path. */
  detail: string;
  /** Every argument, for the "show details" disclosure. */
  args: Record<string, unknown>;
  /** Set when the call came from an MCP server, so the UI can offer a server-wide grant. */
  mcpServer?: string;
  /** The three grant keys this call could be remembered as. */
  grantKeys: { exact: string; toolWide: string; mcpServerWide?: string };
}

/** Persisted grant lists, shown in the settings surface. */
export interface GrantsSnapshot {
  project: string[];
  global: string[];
}

// --- Goals ------------------------------------------------------------------

export type GoalStatus = "active" | "paused" | "complete";

/** A goal as the UI renders it. Mirrors the engine's on-disk `Goal`. */
export interface GoalSummary {
  id: string;
  text: string;
  status: GoalStatus;
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

// --- Engine protocol --------------------------------------------------------

/** Messages sent from the main process to the engine host. */
export type EngineRequest =
  | { type: "hello" }
  | { type: "prompt"; text: string }
  | { type: "abort" }
  | { type: "setModel"; model: string }
  | { type: "setPermissionMode"; mode: PermissionMode }
  | {
      type: "approvalResponse";
      id: string;
      decision: ApprovalDecision;
      scope: ApprovalScope;
      /** Which key to persist when `scope` is not "once". Defaults to "exact". */
      grantKey?: GrantKeyKind;
    }
  | { type: "compact" }
  | { type: "goal"; action: "get" }
  | { type: "goal"; action: "set"; text: string }
  | { type: "goal"; action: "note"; text: string }
  | { type: "goal"; action: "status"; status: GoalStatus }
  | { type: "goal"; action: "clear" }
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
      permissionMode: PermissionMode;
    }
  | { type: "models"; models: ModelSummary[] }
  | { type: "status"; status: EngineStatus }
  | { type: "event"; event: AgentEvent }
  | { type: "usage"; inputTokens: number; outputTokens: number; contextWindow: number }
  | { type: "approvalRequest"; request: ApprovalRequest }
  /** Sent after a response lands, so the modal can clear and the list can update. */
  | { type: "approvalResolved"; id: string; decision: ApprovalDecision; scope: ApprovalScope }
  | { type: "permissionMode"; mode: PermissionMode }
  | { type: "grants"; grants: GrantsSnapshot }
  | { type: "goal"; goal: GoalSummary | null }
  | { type: "compacting"; active: boolean }
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
  /** Open a native directory picker. Resolves to undefined if the user cancelled. */
  pickWorkspace(): Promise<string | undefined>;
  /** Switch workspace. The engine restarts with the new directory as its cwd. */
  setWorkspace(path: string): void;
  /** Engine lifecycle + model catalog snapshot. */
  getEngineInfo(): Promise<EngineResponse | undefined>;
  /** Start a turn. Streamed output arrives via `onEngineMessage`. */
  sendPrompt(text: string): void;
  /** Cancel the in-flight turn. */
  abort(): void;
  /** Switch the model used for subsequent turns. */
  setModel(model: string): void;
  /** Switch the interactive permission mode. */
  setPermissionMode(mode: PermissionMode): void;
  /** Answer a pending approval. */
  respondApproval(
    id: string,
    decision: ApprovalDecision,
    scope: ApprovalScope,
    grantKey?: GrantKeyKind,
  ): void;
  /** Compact the conversation now. */
  compact(): void;
  /** Read the goal for this workspace. */
  getGoal(): void;
  /** Set / replace the goal for this workspace. */
  setGoal(text: string): void;
  /** Append a progress note to the goal. */
  noteGoal(text: string): void;
  /** Pause, resume or complete the goal. */
  setGoalStatus(status: GoalStatus): void;
  /** Delete the goal. */
  clearGoal(): void;
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
    pickWorkspace: "ruby:pick-workspace",
    getEngineInfo: "ruby:get-engine-info",
  },
  /** Renderer → main, fire-and-forget. */
  send: {
    prompt: "ruby:prompt",
    abort: "ruby:abort",
    setWorkspace: "ruby:set-workspace",
    setModel: "ruby:set-model",
    setPermissionMode: "ruby:set-permission-mode",
    approvalResponse: "ruby:approval-response",
    compact: "ruby:compact",
    getGoal: "ruby:get-goal",
    setGoal: "ruby:set-goal",
    noteGoal: "ruby:note-goal",
    setGoalStatus: "ruby:set-goal-status",
    clearGoal: "ruby:clear-goal",
    reset: "ruby:reset",
    refreshModels: "ruby:refresh-models",
  },
  /** Main → renderer, streamed engine output. */
  engineMessage: "ruby:engine-message",
} as const;
