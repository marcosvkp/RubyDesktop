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
import type { AgentEvent, Message, PermissionMode, SessionSummary } from "@rubyclii/cli";

/** Re-exported so the renderer can name agent events without importing the engine. */
export type { AgentEvent, Message, PermissionMode, SessionSummary };

/** A model as reported by the Ruby catalog. */
export interface ModelSummary {
  id: string;
  label: string;
  contextWindow?: number;
  supportsReasoning?: boolean;
  reasoningEfforts?: ReasoningEffort[];
  supportsVision?: boolean;
}

export type ReasoningEffort = "low" | "medium" | "high";
export type SubAgentRole = "explorer" | "worker";
export type SubAgentStatus =
  | "configuring"
  | "queued"
  | "running"
  | "review"
  | "merging"
  | "merged"
  | "completed"
  | "failed"
  | "cancelled";

export interface UserQuestionOption {
  label: string;
  description?: string;
}

export interface UserQuestionPrompt {
  id: string;
  header?: string;
  question: string;
  options: UserQuestionOption[];
}

export interface UserQuestionRequest {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  questions: UserQuestionPrompt[];
}

export interface SubAgentConfigRequest {
  id: string;
  title: string;
  prompt: string;
  role: SubAgentRole;
  proposedModel: string;
  proposedReasoningEffort?: ReasoningEffort;
  proposedInstructions: string;
  proposalNote?: string;
}

export interface SubAgentSummary {
  id: string;
  title: string;
  prompt: string;
  role: SubAgentRole;
  model: string;
  reasoningEffort?: ReasoningEffort;
  instructions: string;
  status: SubAgentStatus;
  progress?: string;
  output?: string;
  diff?: string;
  changedFiles?: string[];
  error?: string;
  usage?: { inputTokens: number; outputTokens: number; cachedTokens: number; llmCalls: number; toolCalls: number };
}

/** Minimal metadata the renderer needs for slash-command completion. */
export interface SkillSummary {
  name: string;
  description: string;
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

// --- MCP --------------------------------------------------------------------

/** A tool an MCP server exposes. `name` is the server-local name, not the prefixed one. */
export interface McpToolSummary {
  name: string;
  description: string;
}

/** One configured MCP server and whether it is usable. */
export interface McpServerSummary {
  /** The name as configured in mcp.json (the key the user edits). */
  name: string;
  /** The name that appears in tool names, after sanitisation. */
  toolPrefix: string;
  connected: boolean;
  /** Present when the server failed to connect, or connected but could not list tools. */
  error?: string;
  tools: McpToolSummary[];
}

/**
 * An MCP server definition as the UI builds it.
 *
 * Deliberately a plain shape rather than the engine's `McpServerConfig`: the
 * renderer constructs this from form fields and must not depend on engine types.
 */
export type McpServerDraft =
  | { transport: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { transport: "http"; url: string; headers?: Record<string, string> };

// --- Browser (the agent's controllable browser) -----------------------------

/**
 * Browser operations the engine may ask the main process to perform.
 *
 * The engine host has no Electron access by design — it is plain Node so it could
 * run under any supervisor — so the browser tools it registers are thin proxies
 * that RPC into the main process, which owns the `WebContentsView`.
 */
export type BrowserMethod =
  | "open"
  | "navigate"
  | "back"
  | "snapshot"
  | "click"
  | "type"
  | "scroll"
  | "screenshot"
  | "close";

/** Arguments per method. Kept explicit so both sides cannot drift. */
export interface BrowserParams {
  open: { url?: string };
  navigate: { url: string };
  back: Record<string, never>;
  snapshot: Record<string, never>;
  click: { ref: string };
  type: { ref: string; text: string; submit?: boolean };
  scroll: { direction: "up" | "down" | "top" | "bottom"; amount?: number };
  screenshot: Record<string, never>;
  close: Record<string, never>;
}

/** What a browser operation returns to the engine. */
export interface BrowserResult {
  /** A text rendering the model reads: the accessibility tree, or a status line. */
  text: string;
  /** Page URL after the operation, when there is one. */
  url?: string;
  /** Page title after the operation, when there is one. */
  title?: string;
}

// --- Metrics (the output panel) ---------------------------------------------

/**
 * A single line in the agent output panel.
 *
 * Sourced from the engine's observability stream rather than from `AgentEvent`,
 * because latency, token counts and guard trips are not part of the agent's
 * conversation — they are telemetry about it.
 */
type MetricLinePayload =
  | {
      kind: "llm";
      model: string;
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
      firstTokenLatencyMs?: number;
      cachedTokens?: number;
    }
  | { kind: "tool"; name: string; latencyMs: number; success: boolean; outputBytes: number }
  | { kind: "denied"; name: string; reason: string }
  | { kind: "guard"; guard: string; reason: string }
  | { kind: "compact"; trigger: string; detail: string };

export type MetricLine = MetricLinePayload & { agentId?: string };


// --- Engine protocol --------------------------------------------------------

/** Messages sent from the main process to the engine host. */
export type EngineRequest =
  | { type: "hello" }
  | { type: "prompt"; text: string }
  | { type: "activateSkill"; name: string; args: string }
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
  | {
      type: "userQuestionResponse";
      id: string;
      answers: Record<string, string> | null;
    }
  | {
      type: "subAgentConfigResponse";
      id: string;
      action: "start" | "cancel";
      model?: string;
      reasoningEffort?: ReasoningEffort;
      instructions?: string;
    }
  | { type: "subAgentReviewResponse"; id: string; action: "merge" | "discard" | "cancel" }
  | { type: "compact" }
  | { type: "session"; action: "new" | "resume"; sessionId?: string }
  | { type: "goal"; action: "get" }
  | { type: "goal"; action: "set"; text: string }
  | { type: "goal"; action: "note"; text: string }
  | { type: "goal"; action: "status"; status: GoalStatus }
  | { type: "goal"; action: "clear" }
  | { type: "mcp"; action: "refresh" }
  | { type: "mcp"; action: "add"; name: string; config: McpServerDraft }
  | { type: "mcp"; action: "remove"; name: string }
  | { type: "mcp"; action: "test"; name: string; config: McpServerDraft }
  /**
   * The answer to a browser RPC. The engine is blocked on this, so every path that
   * could leave it unanswered must settle it.
   */
  | {
      type: "browserResult";
      id: string;
      ok: boolean;
      result?: BrowserResult;
      error?: string;
    }
  /**
   * Ask the engine to release its resources and exit.
   *
   * MCP servers are child processes; killing the engine outright can leave them
   * orphaned, so the host gets a chance to close them first.
   */
  | { type: "shutdown" }
  | { type: "reset" };

/** Messages sent from the engine host back to the main process. */
export type EngineResponse =
  | {
      type: "ready";
      workspace: string;
      model: string;
      toolCount: number;
      skillCount: number;
      skills: SkillSummary[];
      keySource: string;
      permissionMode: PermissionMode;
    }
  | { type: "models"; models: ModelSummary[] }
  | { type: "skills"; skills: SkillSummary[] }
  | {
      type: "sessions";
      sessions: SessionSummary[];
      currentSessionId?: string;
      /** Present when the active session changed and the renderer should replace its transcript. */
      history?: Message[];
    }
  | { type: "status"; status: EngineStatus }
  | { type: "event"; event: AgentEvent }
  | { type: "usage"; inputTokens: number; outputTokens: number; contextWindow: number }
  | { type: "approvalRequest"; request: ApprovalRequest }
  /** Sent after a response lands, so the modal can clear and the list can update. */
  | { type: "approvalResolved"; id: string; decision: ApprovalDecision; scope: ApprovalScope }
  | { type: "userQuestionRequest"; request: UserQuestionRequest }
  | { type: "userQuestionResolved"; id: string; cancelled: boolean }
  | { type: "subAgentConfigRequest"; request: SubAgentConfigRequest }
  | { type: "subAgentConfigResolved"; id: string; action: "start" | "cancel" }
  | { type: "subAgentUpdate"; agent: SubAgentSummary }
  | { type: "permissionMode"; mode: PermissionMode }
  | { type: "grants"; grants: GrantsSnapshot }
  | { type: "goal"; goal: GoalSummary | null }
  | { type: "mcp"; servers: McpServerSummary[] }
  /** The result of testing one server; does not change the running registry. */
  | { type: "mcpTest"; server: McpServerSummary }
  | { type: "metric"; line: MetricLine }
  /** A browser tool call from the engine, to be performed by the main process. */
  | { type: "browserRequest"; id: string; method: BrowserMethod; params: unknown }
  /** The browser panel opened, closed or changed page. */
  | { type: "browserState"; open: boolean; url?: string; title?: string }
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
  /** Encrypt and store the Ruby API key through the operating system keychain. */
  saveApiKey(key: string): Promise<{ ok: boolean; error?: string }>;
  /** Start a turn. Streamed output arrives via `onEngineMessage`. */
  sendPrompt(text: string): void;
  /** Activate one discovered Skill as an explicit user command. */
  activateSkill(name: string, args: string): void;
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
  /** Answer an interactive question from the main agent or a sub-agent. */
  respondUserQuestion(id: string, answers: Record<string, string> | null): void;
  /** Approve or cancel an agent configuration proposed by the orchestrator. */
  respondSubAgentConfig(
    id: string,
    action: "start" | "cancel",
    config?: { model: string; reasoningEffort?: ReasoningEffort; instructions: string },
  ): void;
  /** Approve applying a worker's diff or discard the isolated worktree. */
  respondSubAgentReview(id: string, action: "merge" | "discard" | "cancel"): void;
  /** Compact the conversation now. */
  compact(): void;
  /** Create a new conversation for the current workspace. */
  newSession(): void;
  /** Resume a conversation for the current workspace. */
  resumeSession(sessionId: string): void;
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
  /** Re-read mcp.json, reconnect every server and report their tools. */
  refreshMcp(): void;
  /** Add or replace a server in mcp.json, then reconnect. */
  addMcpServer(name: string, config: McpServerDraft): void;
  /** Remove a server from mcp.json, then reconnect. */
  removeMcpServer(name: string): void;
  /** Connect to one server and list its tools, without saving or registering. */
  testMcpServer(name: string, config: McpServerDraft): void;
  /** Show the embedded browser. The main process owns the view and its bounds. */
  openBrowser(url?: string): void;
  /** Hide and destroy the embedded browser view. */
  closeBrowser(): void;
  /**
   * Tell the main process where the browser should sit.
   *
   * Only the renderer knows the layout, so it measures the placeholder it reserved
   * and reports the rectangle; the view is then positioned to match exactly.
   */
  setBrowserBounds(bounds: { x: number; y: number; width: number; height: number }): void;
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
    saveApiKey: "ruby:save-api-key",
  },
  /** Renderer → main, fire-and-forget. */
  send: {
    prompt: "ruby:prompt",
    activateSkill: "ruby:activate-skill",
    abort: "ruby:abort",
    setWorkspace: "ruby:set-workspace",
    setModel: "ruby:set-model",
    setPermissionMode: "ruby:set-permission-mode",
    approvalResponse: "ruby:approval-response",
    userQuestionResponse: "ruby:user-question-response",
    subAgentConfigResponse: "ruby:sub-agent-config-response",
    subAgentReviewResponse: "ruby:sub-agent-review-response",
    compact: "ruby:compact",
    newSession: "ruby:new-session",
    resumeSession: "ruby:resume-session",
    getGoal: "ruby:get-goal",
    setGoal: "ruby:set-goal",
    noteGoal: "ruby:note-goal",
    setGoalStatus: "ruby:set-goal-status",
    clearGoal: "ruby:clear-goal",
    refreshMcp: "ruby:refresh-mcp",
    addMcpServer: "ruby:add-mcp-server",
    removeMcpServer: "ruby:remove-mcp-server",
    testMcpServer: "ruby:test-mcp-server",
    openBrowser: "ruby:open-browser",
    closeBrowser: "ruby:close-browser",
    setBrowserBounds: "ruby:set-browser-bounds",
    reset: "ruby:reset",
    refreshModels: "ruby:refresh-models",
  },
  /** Main → renderer, streamed engine output. */
  engineMessage: "ruby:engine-message",
} as const;
