/**
 * Engine host — the agent runs here, not in the Electron main process.
 *
 * Why a separate process at all:
 *
 *  - A turn is long-running and CPU/IO heavy. In the main process it would block
 *    the UI and, if it ever threw, take the whole app down with it.
 *  - The engine is plain Node: it wants a real `process.cwd()` (the file tools use
 *    it for path containment) and it must not be entangled with Chromium.
 *
 * Why `utilityProcess` specifically: Electron gives it a Node runtime, a lifecycle
 * tied to the app, and a structured-clone message channel to the main process —
 * which is exactly what is needed, without the extra process management that
 * `child_process.fork` would require.
 *
 * This process has no knowledge of Electron. It speaks the `EngineRequest` /
 * `EngineResponse` protocol in `@shared/ipc` and nothing else, so the same file
 * would work under a plain Node supervisor.
 */
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  Agent,
  createClient,
  createDefaultRegistry,
  createSandboxRunner,
  SkillRegistry,
  ToolRegistry,
  Session,
  loadConfig,
  loadSettings,
  loadSystemInstruction,
  findApiKeyInEnv,
  fetchRemoteModels,
  remoteContextWindow,
  isRubyCatalogModel,
  detectProvider,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
  // Permission policy — the pure half of the gate. This host renders the question
  // as an IPC message instead of a terminal prompt.
  buildPermissionSources,
  createForcesConfirmationFn,
  decideConfirmation,
  grantKeysFor,
  ignoredProjectAllowWarning,
  matchesNeverAutoApprove,
  loadProjectPermissions,
  saveProjectPermissions,
  saveConfig,
  // Goals are per-workspace state, stored outside the repository.
  loadGoal,
  setGoal,
  noteGoal,
  setGoalStatus,
  setGoalMaxRounds,
  clearGoal,
  runAutoGoal,
  // MCP: servers are configured in ~/.rubycli/mcp.json and their tools are merged
  // into the same registry the built-in tools live in.
  McpManager,
  probeMcpServer,
  loadMcpConfig,
  resolveMcpServerConfig,
  saveMcpServer,
  removeMcpServer,
  isValidMcpServerName,
  validateMcpServerConfig,
  AGENT_DIR,
} from "@rubyclii/cli";
import type {
  AgentEvent,
  ConfirmFn,
  McpClientOpts,
  McpServerConfig,
  Tool,
  ObservabilityEvent,
  PermissionMode,
  Provider,
  Message,
  SessionEntry,
  SessionLogEntry,
  SessionUiEvent,
  SpawnSubAgentOptions,
  WorkflowAgentRequest,
  WorkflowEvent,
  UserQuestionRequest as AskUserPayload,
  UserQuestionResult,
} from "@rubyclii/cli";
import { BrowserBridge, registerBrowserTools } from "./browser-tools.js";
import { approvalGrantScope, confirmationDecision } from "@shared/approval-policy";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalScope,
  EngineRequest,
  EngineResponse,
  GrantKeyKind,
  GoalSummary,
  McpServerDraft,
  McpServerSummary,
  MetricLine,
  ModelSummary,
  ReasoningEffort,
  SkillSummary,
  SubAgentConfigRequest,
  SubAgentSummary,
  SubAgentTranscriptEntry,
  UserQuestionAnswer,
  UserQuestionRequest,
} from "@shared/ipc";
import { WorktreeManager } from "./worktrees.js";

// `process.parentPort` is added by Electron's utilityProcess and is not part of
// the standard Node typings.
const port = (process as unknown as { parentPort: Electron.ParentPort })
  .parentPort;

function readConfiguredMaxIterations(): number | undefined {
  const value = Number(process.env.RUBY_DESKTOP_MAX_ITERATIONS);
  return Number.isInteger(value) && value >= 1 && value <= 500
    ? value
    : undefined;
}

function post(message: EngineResponse): void {
  port.postMessage(message);
}

/** Serializes session writes so UI annotations stay between the tool call and result they describe. */
function logSessionEntry(
  entry: SessionLogEntry,
  target: Session | undefined = session,
): Promise<void> {
  if (!target) return Promise.resolve();
  const write = sessionLogQueue.then(() => target.log(entry));
  sessionLogQueue = write.catch(() => {});
  return write;
}

function logSessionUiEvent(
  event: SessionUiEvent,
  target?: Session,
): Promise<void> {
  return logSessionEntry({ type: "ui_event", event }, target);
}

/** Report an unexpected failure without killing the process. */
function fail(err: unknown): void {
  post({
    type: "error",
    message: err instanceof Error ? err.message : String(err),
  });
}

function getSkillSummaries(): SkillSummary[] {
  return (
    skillRegistry
      ?.list()
      .map(({ name, description }) => ({ name, description })) ?? []
  );
}

// --- Session state ----------------------------------------------------------

let model = DEFAULT_MODEL;
let configuredModel = DEFAULT_MODEL;
let reasoningEffort: ReasoningEffort | undefined;
let baseUrl = DEFAULT_BASE_URL;
let apiKey = "";
let keySource = "unknown";
let provider: Provider = "rubycli";
let agent: Agent | undefined;
let session: Session | undefined;
let sessionMessages: Message[] = [];
let sessionOutputTokens = 0;
let latestContextTokens: number | undefined;
let latestContextSource: "engine" | "provider" = "engine";
let sessionLogQueue: Promise<void> = Promise.resolve();
let toolCount = 0;
let skillCount = 0;
let skillRegistry: SkillRegistry | undefined;
let modelCatalog: ModelSummary[] = [];
const worktrees = new WorktreeManager();
const subAgentControllers = new Map<string, AbortController>();
const subAgentRuns = new Map<string, Promise<string>>();
const subAgentSessions = new Map<string, Session>();
const subAgentSessionIds = new Map<string, string>();
const latestSubAgentSummaries = new Map<string, SubAgentSummary>();
const subAgentPostState = new Map<
  string,
  {
    lastPostedAt: number;
    lastPersistedAt: number;
    timer?: NodeJS.Timeout;
    latest?: SubAgentSummary;
  }
>();
const SUBAGENT_STREAM_THROTTLE_MS = 100;
const SUBAGENT_CHECKPOINT_INTERVAL_MS = 5_000;
const persistedSubAgentStatuses = new Map<string, SubAgentSummary["status"]>();
const pendingSubAgentReviews = new Map<
  string,
  (action: "merge" | "discard" | "cancel") => void
>();
let activeSubAgentCount = 0;
const MAX_CONCURRENT_SUBAGENTS = 3;
let permissionMode: PermissionMode = "normal";
/** Set by `abort`; the run loop checks it between events. */
let cancelled = false;
let running = false;
let activeTurnController: AbortController | undefined;
let activeOperationCompletion: Promise<void> | undefined;
let resolveActiveOperation: (() => void) | undefined;
let autoGoalController: AbortController | undefined;
let autoGoalRunning = false;

/** Tool-call grants: global (config.json) and per-project (project-permissions/). */
let globalAllowSet = new Set<string>();
let projectAllowSet = new Set<string>();
let denyPatterns: string[] = [];
/** Built from the merged `permissions.ask` patterns; forces a prompt regardless. */
let forcesConfirmation: (
  toolName: string,
  args: Record<string, unknown>,
) => boolean = () => false;

// --- Browser ----------------------------------------------------------------

/**
 * Proxy for the main process's embedded browser.
 *
 * The engine cannot reach Electron, so `browser_*` tools RPC into main. Created
 * eagerly rather than lazily: the tools must exist in the registry from the first
 * turn, or the model would never learn it can browse.
 */
const browserBridge = new BrowserBridge((id, method, params) => {
  post({ type: "browserRequest", id, method, params });
});

// --- MCP --------------------------------------------------------------------

let mcp: McpManager | undefined;
let mcpToolNames = new Set<string>();
let mcpManagementQueue: Promise<void> = Promise.resolve();

/**
 * How long to wait for an MCP server to connect or list tools.
 *
 * A server that hangs must not stall the whole app on startup: the built-in tools
 * are perfectly usable without it, so a timeout degrades to "this server is
 * unavailable" rather than "the agent is unavailable".
 */
const MCP_TIMEOUT_MS = 15_000;

function mcpOpts(): McpClientOpts {
  return { callTimeout: MCP_TIMEOUT_MS };
}

/** Maps the wire draft onto the engine's config shape. */
function toServerConfig(draft: McpServerDraft): McpServerConfig {
  return draft.transport === "http"
    ? { transport: "http", url: draft.url, headers: draft.headers }
    : {
        transport: "stdio",
        command: draft.command,
        args: draft.args,
        env: draft.env,
      };
}

/**
 * Replaces the active MCP generation, removes stale tools, then reports status.
 * This may run between model calls as well as during initial agent setup.
 */
async function connectMcp(registry: ToolRegistry): Promise<void> {
  // Remove the previous generation from the live registry before disconnecting
  // its clients. Agent refreshes its offered schemas before each model call, so
  // the next iteration sees exactly the tools from this generation.
  for (const name of mcpToolNames) registry.unregister(name);
  mcpToolNames = new Set<string>();

  // Drop the previous generation first: a reconnect must not leave orphaned
  // subprocesses behind, and the old manager's tools are about to be replaced.
  if (mcp) {
    await mcp.disconnectAll().catch(() => {});
    mcp = undefined;
  }

  const config = await loadMcpConfig(AGENT_DIR);
  if (!config || Object.keys(config.mcpServers).length === 0) {
    toolCount = registry.all().length;
    postMcpStatus();
    return;
  }

  mcp = await McpManager.create(config, mcpOpts());
  await mcp.registerTools(registry);
  for (const status of mcp.statuses) {
    for (const tool of status.tools) {
      mcpToolNames.add(`mcp__${status.sanitisedName}__${tool.name}`);
    }
  }
  toolCount = registry.all().length;
  postMcpStatus();
}

/** Reports MCP state. Call after connecting or after tools are registered. */
function postMcpStatus(): void {
  const servers: McpServerSummary[] = (mcp?.statuses ?? []).map((status) => ({
    name: status.rawName,
    toolPrefix: status.sanitisedName,
    connected: status.connected,
    error: status.error,
    tools: status.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
  }));
  post({ type: "mcp", servers });
}

function isStringMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function queueMcpManagement<T>(operation: () => Promise<T>): Promise<T> {
  const next = mcpManagementQueue.then(operation, operation);
  mcpManagementQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function mcpConfigFromToolArgs(
  args: Record<string, unknown>,
): McpServerConfig | null {
  if (args.transport === "stdio") {
    if (typeof args.command !== "string") return null;
    if (
      args.args !== undefined &&
      (!Array.isArray(args.args) ||
        !args.args.every((v) => typeof v === "string"))
    ) {
      return null;
    }
    if (args.env !== undefined && !isStringMap(args.env)) return null;
    return {
      transport: "stdio",
      command: args.command,
      args: args.args as string[] | undefined,
      env: args.env as Record<string, string> | undefined,
    };
  }

  if (args.transport === "http") {
    if (typeof args.url !== "string") return null;
    if (args.headers !== undefined && !isStringMap(args.headers)) return null;
    return {
      transport: "http",
      url: args.url,
      headers: args.headers as Record<string, string> | undefined,
    };
  }

  return null;
}

/** The chat-facing MCP control plane; mutating actions always go through approval. */
function createMcpManagementTool(registry: ToolRegistry): Tool {
  return {
    name: "manage_mcp_servers",
    description:
      "List configured MCP servers, add a tested stdio or HTTP server, or remove a server. Adding and removing require user approval. Successful changes reconnect MCP servers and update the tools offered to you immediately.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "add", "remove"],
          description: "Operation to perform.",
        },
        name: {
          type: "string",
          description: "Server name; letters, digits, _ and - only.",
        },
        transport: { type: "string", enum: ["stdio", "http"] },
        command: {
          type: "string",
          description: "Executable for a stdio MCP server.",
        },
        args: { type: "array", items: { type: "string" } },
        env: {
          type: "object",
          description:
            "Optional environment variables for stdio. Use ${NAME} references for values managed outside the chat.",
        },
        url: { type: "string", description: "URL for an HTTP MCP server." },
        headers: {
          type: "object",
          description:
            "Optional HTTP headers. Use ${NAME} references for secrets managed outside the chat.",
        },
      },
      required: ["action"],
    },
    readonly: false,
    requiresConfirmation: (args) =>
      args.action === "add" || args.action === "remove",
    validate: (args) => {
      if (
        args.action !== "list" &&
        args.action !== "add" &&
        args.action !== "remove"
      ) {
        return "action must be list, add, or remove";
      }
      if (args.action === "list") return null;
      if (typeof args.name !== "string" || !isValidMcpServerName(args.name)) {
        return "name must contain only letters, digits, _ and -";
      }
      if (args.action === "remove") return null;
      const config = mcpConfigFromToolArgs(args);
      return config
        ? validateMcpServerConfig(
            resolveMcpServerConfig(args.name as string, config),
          )
        : "provide a valid stdio or HTTP server configuration";
    },
    execute: (args) =>
      queueMcpManagement(async () => {
        const action = args.action;
        if (action === "list") {
          const config = await loadMcpConfig(AGENT_DIR);
          const statuses = new Map(
            (mcp?.statuses ?? []).map((status) => [status.rawName, status]),
          );
          const servers = Object.entries(config?.mcpServers ?? {}).map(
            ([name, server]) => {
              const status = statuses.get(name);
              return {
                name,
                transport: server.transport,
                connected: status?.connected ?? false,
                ...(status?.error ? { error: status.error } : {}),
                tools:
                  status?.tools.map(({ name: toolName, description }) => ({
                    name: toolName,
                    description,
                  })) ?? [],
              };
            },
          );
          return {
            success: true,
            output: JSON.stringify({ servers }, null, 2),
          };
        }

        const name = args.name as string;
        if (action === "remove") {
          const removed = await removeMcpServer(AGENT_DIR, name);
          if (!removed)
            return {
              success: false,
              output: "",
              error: `No MCP server named '${name}' is configured.`,
            };
          await connectMcp(registry);
          return {
            success: true,
            output: `Removed '${name}'. Remaining MCP servers reconnected and the tool list was refreshed.`,
          };
        }

        const current = await loadMcpConfig(AGENT_DIR);
        if (current?.mcpServers[name]) {
          return {
            success: false,
            output: "",
            error: `MCP server '${name}' already exists. Remove it before adding a replacement.`,
          };
        }

        const serverConfig = mcpConfigFromToolArgs(args);
        if (!serverConfig)
          return {
            success: false,
            output: "",
            error: "Provide a valid stdio or HTTP server configuration.",
          };

        const resolvedConfig = resolveMcpServerConfig(name, serverConfig);
        const probe = await probeMcpServer(name, resolvedConfig, mcpOpts());
        if (!probe.connected) {
          return {
            success: false,
            output: "",
            error: `MCP server '${name}' did not connect: ${probe.error ?? "unknown error"}. Nothing was saved.`,
          };
        }

        await saveMcpServer(AGENT_DIR, name, serverConfig);
        try {
          await connectMcp(registry);
        } catch (error) {
          await removeMcpServer(AGENT_DIR, name).catch(() => false);
          await connectMcp(registry).catch(() => {});
          return {
            success: false,
            output: "",
            error: `MCP server '${name}' could not be activated; its config was rolled back: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
        const active = mcp?.statuses.find((status) => status.rawName === name);
        if (!active?.connected || active.error) {
          await removeMcpServer(AGENT_DIR, name);
          await connectMcp(registry);
          return {
            success: false,
            output: "",
            error: `MCP server '${name}' passed its test but failed during activation; its config was rolled back.`,
          };
        }

        return {
          success: true,
          output: `Added '${name}' and connected it. ${active.tools.length} MCP tool(s) are available in the next model call.`,
        };
      }),
  };
}

async function handleMcp(
  request: Extract<EngineRequest, { type: "mcp" }>,
): Promise<void> {
  if (request.action !== "test" && (running || autoGoalRunning)) {
    post({
      type: "error",
      message: "Finish or stop the current turn before changing MCP servers.",
    });
    return;
  }
  switch (request.action) {
    case "refresh":
      // A full rebuild: the tools have to be registered into the registry the
      // agent actually holds, so reconnecting without rebuilding would leave the
      // agent calling tools that no longer exist.
      await buildAgent();
      post({ type: "status", status: "ready" });
      return;

    case "add":
      await saveMcpServer(
        AGENT_DIR,
        request.name,
        toServerConfig(request.config),
      );
      await buildAgent();
      post({ type: "status", status: "ready" });
      return;

    case "remove":
      await removeMcpServer(AGENT_DIR, request.name);
      await buildAgent();
      post({ type: "status", status: "ready" });
      return;

    case "test": {
      // A probe touches neither mcp.json nor the running registry, so a server
      // can be tried before it is trusted with a place in the agent's toolset.
      const status = await probeMcpServer(
        request.name,
        toServerConfig(request.config),
        mcpOpts(),
      );
      post({
        type: "mcpTest",
        server: {
          name: status.rawName,
          toolPrefix: status.sanitisedName,
          connected: status.connected,
          error: status.error,
          tools: status.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
          })),
        },
      });
      return;
    }
  }
}

// --- Observability ----------------------------------------------------------

/**
 * Turns the engine's telemetry into output-panel lines.
 *
 * These are about the conversation rather than part of it, which is why they do
 * not travel as `AgentEvent`s: the panel shows latency, token counts and guard
 * trips, none of which belong in the transcript the model sees.
 */
function onObservability(event: ObservabilityEvent, agentId?: string): void {
  if (!agentId && event.type === "context_snapshot") {
    latestContextTokens = event.estimatedTokens;
    latestContextSource = "engine";
    reportUsage();
    return;
  }
  if (!agentId && event.type === "llm_call_end") {
    sessionOutputTokens += event.outputTokens;
    if (event.inputTokens > 0) {
      latestContextTokens = event.inputTokens;
      latestContextSource = "provider";
    }
    reportUsage();
  }
  if (!agentId && event.type === "llm_call_start") {
    post({
      type: "turnProgress",
      phase: "model_request",
      model: event.model,
      inputMessages: event.inputMessages,
    });
    return;
  }
  if (!agentId && event.type === "tool_exec_start" && event.name === "think") {
    // Signal the phase without forwarding the private scratchpad or its arguments.
    post({ type: "turnProgress", phase: "internal_analysis" });
    return;
  }
  let line: MetricLine | undefined;
  switch (event.type) {
    case "llm_call_end":
      line = {
        kind: "llm",
        model: event.model,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        latencyMs: event.latencyMs,
        firstTokenLatencyMs: event.firstTokenLatencyMs,
        cachedTokens: event.cachedTokens,
      };
      break;
    case "tool_exec_end":
      line = {
        kind: "tool",
        name: event.name,
        latencyMs: event.latencyMs,
        success: event.success,
        outputBytes: event.outputBytes,
      };
      break;
    case "tool_denied":
      line = { kind: "denied", name: event.name, reason: event.reason };
      break;
    case "guard_triggered":
      line = { kind: "guard", guard: event.guard, reason: event.reason };
      break;
    case "compact_completed":
      post({ type: "compacting", active: false });
      line = {
        kind: "compact",
        trigger: event.trigger,
        detail: `removed ${event.messagesRemoved} messages`,
      };
      break;
    case "compact_failed":
      post({ type: "compacting", active: false });
      line = {
        kind: "compact",
        trigger: event.trigger,
        detail: `failed: ${event.error}`,
      };
      break;
    case "compact_started":
      post({ type: "compacting", active: true });
      line = {
        kind: "compact",
        trigger: event.trigger,
        detail: event.ratio === undefined
          ? "compaction started"
          : `compaction started at ${Math.round(event.ratio * 100)}% context usage`,
      };
      break;
    case "compact_threshold_warned":
      line = {
        kind: "compact",
        trigger: "auto",
        detail: `context reached ${Math.round(event.ratio * 100)}%; automatic compaction is approaching`,
      };
      break;
    default:
      // Everything else (call starts, context snapshots, threshold notices) is
      // either redundant with a line above or too noisy to be worth a row.
      return;
  }
  post({ type: "metric", line: agentId ? { ...line, agentId } : line });
}

// --- Approval gate ----------------------------------------------------------

interface PendingApproval {
  settle: (decision: ApprovalDecision) => void;
  agentId?: string;
  toolName: string;
  grantKeys: { exact: string; toolWide: string; mcpServerWide?: string };
  /**
   * True when the call matches the catastrophic blocklist (recursive `rm /`,
   * `curl | sh`, fork bombs). A human may still approve it once by hand, but it is
   * never written to disk as a standing grant — an "always allow" for `rm -rf /`
   * would silently disable the gate for the rest of the project's life.
   */
  neverPersist: boolean;
}

/**
 * Pending approvals, keyed by the id sent to the renderer.
 *
 * The engine blocks the tool call on this promise. Every path that could leave it
 * unresolved must settle it: the response handler, the timeout, and abort.
 */
const pendingApprovals = new Map<string, PendingApproval>();

interface PendingUserQuestion {
  request: UserQuestionRequest;
  settle: (result: UserQuestionResult) => void;
}

interface ResolvedSubAgentConfig {
  id: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  instructions: string;
}

interface PendingSubAgentConfig {
  request: SubAgentConfigRequest;
  settle: (config: ResolvedSubAgentConfig | null) => void;
}

const pendingUserQuestions = new Map<string, PendingUserQuestion>();
const pendingSubAgentConfigs = new Map<string, PendingSubAgentConfig>();
const askForSubAgentConfig = new AsyncLocalStorage<boolean>();

/**
 * How long the engine waits for a human before denying.
 *
 * A GUI must never hang a turn forever: if the window is closed or the renderer
 * crashes, the tool call is denied rather than holding the agent loop open.
 */
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
const USER_QUESTION_TIMEOUT_MS = 10 * 60 * 1000;
const SUBAGENT_CONFIG_TIMEOUT_MS = 10 * 60 * 1000;
const SUBAGENT_REVIEW_TIMEOUT_MS = 10 * 60 * 1000;

/** Pauses the requesting agent until the renderer submits its structured answer. */
function requestUserQuestion(
  agentId: string,
  agentName: string,
  question: AskUserPayload,
): Promise<UserQuestionResult> {
  const id = randomUUID();
  const request: UserQuestionRequest = {
    id,
    agentId,
    agentName,
    title: question.title,
    questions: question.questions,
  };

  return new Promise<UserQuestionResult>((resolve) => {
    let settled = false;
    const settle = (result: UserQuestionResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingUserQuestions.delete(id);
      void logSessionUiEvent({
        version: 1,
        kind: "user-question",
        id,
        data: {
          request,
          status: result.cancelled ? "cancelled" : "answered",
          ...(!result.cancelled ? { answers: result.answers } : {}),
        },
      });
      post({ type: "userQuestionResolved", id, cancelled: result.cancelled });
      resolve(result);
    };

    const timer = setTimeout(() => {
      post({
        type: "error",
        message: `Question from ${agentName} timed out; it was cancelled.`,
      });
      settle({ answers: {}, cancelled: true });
    }, USER_QUESTION_TIMEOUT_MS);

    pendingUserQuestions.set(id, { request, settle });
    void logSessionUiEvent({
      version: 1,
      kind: "user-question",
      id,
      data: { request, status: "pending" },
    });
    post({ type: "userQuestionRequest", request });
  });
}

/** A stopped turn must never leave an ask-user tool awaiting renderer input. */
function cancelAllUserQuestions(reason: string): void {
  if (pendingUserQuestions.size === 0) return;
  for (const pending of [...pendingUserQuestions.values()]) {
    pending.settle({ answers: {}, cancelled: true });
  }
  post({ type: "error", message: reason });
}

function cancelUserQuestionsForAgent(agentId: string): void {
  for (const pending of [...pendingUserQuestions.values()]) {
    if (pending.request.agentId === agentId)
      pending.settle({ answers: {}, cancelled: true });
  }
}

function handleUserQuestionResponse(
  id: string,
  answers: Record<string, UserQuestionAnswer> | null,
): void {
  const pending = pendingUserQuestions.get(id);
  if (!pending) return;
  if (!answers) {
    pending.settle({ answers: {}, cancelled: true });
    return;
  }

  const questions = new Map(
    pending.request.questions.map((question) => [question.id, question]),
  );
  const safeAnswers: Record<string, UserQuestionAnswer> = {};
  for (const [key, value] of Object.entries(answers)) {
    const question = questions.get(key);
    if (!question) continue;
    if (question.selectionMode === "multiple") {
      const values = Array.isArray(value)
        ? value
        : typeof value === "string"
          ? [value]
          : [];
      const safeValues = values
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().slice(0, 3000))
        .filter(Boolean)
        .slice(0, 9);
      if (safeValues.length > 0) safeAnswers[key] = safeValues;
    } else {
      const answer = Array.isArray(value) ? value[0] : value;
      if (typeof answer === "string" && answer.trim())
        safeAnswers[key] = answer.trim().slice(0, 3000);
    }
  }
  pending.settle({ answers: safeAnswers, cancelled: false });
}

/** Resolve a valid proposal from the current catalog, falling back to the selected model. */
function prepareSubAgentConfigRequest(
  prompt: string,
  options: SpawnSubAgentOptions,
  allowCatalogless = false,
): SubAgentConfigRequest {
  const requestedModel = options.model ?? model;
  let proposedModel = requestedModel;
  let modelInfo = modelCatalog.find((entry) => entry.id === proposedModel);
  const notes: string[] = [];
  if (!modelInfo) {
    modelInfo =
      modelCatalog.find((entry) => entry.id === model) ?? modelCatalog[0];
    if (!modelInfo && !allowCatalogless)
      throw new Error(
        "The model catalog is unavailable; no sub-agent was started.",
      );
    if (modelInfo) {
      proposedModel = modelInfo.id;
      notes.push(
        `O modelo '${requestedModel}' não está no catálogo atual. Alternativa selecionada: '${proposedModel}'.`,
      );
    } else {
      proposedModel = model;
      notes.push(
        `O catálogo de modelos não está disponível; usando o modelo atual '${model}'.`,
      );
    }
  }
  const efforts = modelInfo?.reasoningEfforts ?? [];
  const proposedEffort =
    options.reasoningEffort && modelInfo && efforts.includes(options.reasoningEffort)
      ? options.reasoningEffort
      : undefined;
  if (options.reasoningEffort && modelInfo && !proposedEffort) {
    notes.push(
      `O modelo '${proposedModel}' não oferece o effort '${options.reasoningEffort}'. Escolha outro modelo ou effort.`,
    );
  } else if (options.reasoningEffort && !modelInfo) {
    notes.push(
      `O catálogo está indisponível; o effort '${options.reasoningEffort}' foi omitido para evitar enviar um valor incompatível.`,
    );
  }

  return {
    id: randomUUID(),
    title: options.title,
    prompt,
    role: options.role,
    proposedModel,
    ...(proposedEffort ? { proposedReasoningEffort: proposedEffort } : {}),
    proposedInstructions: options.instructions ?? "",
    ...(notes.length ? { proposalNote: notes.join(" ") } : {}),
  };
}

/** Starts immediately with the validated recommendation; no renderer prompt is opened. */
function resolveAutomaticSubAgentConfig(
  prompt: string,
  options: SpawnSubAgentOptions,
): ResolvedSubAgentConfig {
  const request = prepareSubAgentConfigRequest(prompt, options, true);
  return {
    id: request.id,
    model: request.proposedModel,
    ...(request.proposedReasoningEffort
      ? { reasoningEffort: request.proposedReasoningEffort }
      : {}),
    instructions: request.proposedInstructions,
  };
}

/** Lets the user inspect and edit a model-authored worker configuration before it runs. */
async function requestSubAgentConfig(
  prompt: string,
  options: SpawnSubAgentOptions,
): Promise<ResolvedSubAgentConfig | null> {
  const request = prepareSubAgentConfigRequest(prompt, options);
  const id = request.id;

  await logSessionUiEvent({
    version: 1,
    kind: "subagent-config",
    id,
    data: { request, status: "pending" },
  });

  return new Promise<ResolvedSubAgentConfig | null>((resolve) => {
    let settled = false;
    const settle = (config: ResolvedSubAgentConfig | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingSubAgentConfigs.delete(id);
      if (!config) {
        void logSessionUiEvent({
          version: 1,
          kind: "subagent-config",
          id,
          data: { request, status: "cancelled" },
        });
        post({ type: "subAgentConfigResolved", id, action: "cancel" });
      }
      resolve(config);
    };

    const timer = setTimeout(() => {
      post({
        type: "error",
        message: `Configuration for '${options.title}' timed out.`,
      });
      settle(null);
    }, SUBAGENT_CONFIG_TIMEOUT_MS);

    pendingSubAgentConfigs.set(id, { request, settle });
    post({ type: "subAgentConfigRequest", request });
  });
}

function handleSubAgentConfigResponse(
  request: Extract<EngineRequest, { type: "subAgentConfigResponse" }>,
): void {
  const pending = pendingSubAgentConfigs.get(request.id);
  if (!pending) return;
  if (request.action === "cancel") {
    pending.settle(null);
    return;
  }

  const modelInfo = modelCatalog.find((entry) => entry.id === request.model);
  if (!modelInfo) {
    post({
      type: "error",
      message: "O modelo selecionado não está mais disponível no catálogo.",
    });
    pending.settle(null);
    return;
  }
  if (
    request.reasoningEffort &&
    !modelInfo.reasoningEfforts?.includes(request.reasoningEffort)
  ) {
    post({
      type: "error",
      message: `O modelo '${modelInfo.id}' não aceita o effort '${request.reasoningEffort}'.`,
    });
    pending.settle(null);
    return;
  }

  const config: ResolvedSubAgentConfig = {
    id: request.id,
    model: modelInfo.id,
    ...(request.reasoningEffort
      ? { reasoningEffort: request.reasoningEffort }
      : {}),
    instructions: (request.instructions ?? "").slice(0, 8000),
  };
  void logSessionUiEvent({
    version: 1,
    kind: "subagent-config",
    id: request.id,
    data: {
      request: pending.request,
      status: "started",
      resolved: {
        model: config.model,
        ...(config.reasoningEffort
          ? { reasoningEffort: config.reasoningEffort }
          : {}),
        instructions: config.instructions,
      },
    },
  });
  pending.settle(config);
  post({
    type: "subAgentConfigResolved",
    id: request.id,
    action: "start",
    config: {
      model: config.model,
      ...(config.reasoningEffort
        ? { reasoningEffort: config.reasoningEffort }
        : {}),
      instructions: config.instructions,
    },
  });
}

/** The single most useful argument to show a human for a given tool. */
function approvalDetail(
  toolName: string,
  args: Record<string, unknown>,
): string {
  if (toolName === "bash") return String(args.command ?? "");
  if (
    toolName === "write" ||
    toolName === "edit" ||
    toolName === "multi_edit"
  ) {
    return String(args.file_path ?? "");
  }
  return JSON.stringify(args, null, 2);
}

/** Asks the renderer, then waits for the answer. */
function requestApproval(
  toolName: string,
  args: Record<string, unknown>,
  agentId?: string,
): Promise<ApprovalDecision> {
  const id = randomUUID();
  const mcpServer = toolName.match(/^mcp__(.+?)__/)?.[1];

  const request: ApprovalRequest = {
    id,
    toolName,
    detail: approvalDetail(toolName, args),
    args,
    mcpServer,
    grantKeys: grantKeysFor(toolName, args),
  };

  return new Promise<ApprovalDecision>((resolve) => {
    let settled = false;
    const settle = (decision: ApprovalDecision): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingApprovals.delete(id);
      resolve(decision);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      post({
        type: "error",
        message: `Approval for '${toolName}' timed out after 10 minutes; the call was denied.`,
      });
      post({ type: "approvalResolved", id, decision: "deny", scope: "once" });
      settle("deny");
    }, APPROVAL_TIMEOUT_MS);

    pendingApprovals.set(id, {
      settle,
      agentId,
      toolName,
      grantKeys: request.grantKeys,
      neverPersist: matchesNeverAutoApprove(toolName, args),
    });
    post({ type: "approvalRequest", request });
  });
}

/**
 * The GUI's `ConfirmFn`.
 *
 * Policy comes from the engine's own pure layer, so the desktop app honours the
 * same `permissions.allow` / `permissions.ask` / `permissions.deny` rules as the
 * CLI — including the rule that grants are only ever read from user-controlled
 * storage, never from a repository-shipped `.rubycli/settings.json`.
 */
function createConfirmFn(agentId?: string): ConfirmFn {
  return async (toolName, args) => {
    const allowSet = new Set([...globalAllowSet, ...projectAllowSet]);
    // `interactive: true` — a modal is the GUI's equivalent of a TTY prompt.
    const policyDecision = decideConfirmation(
      allowSet,
      denyPatterns,
      toolName,
      args,
      true,
    );
    const decision = confirmationDecision(
      matchesNeverAutoApprove(toolName, args),
      policyDecision,
    );
    if (decision === "allow") return "allow";
    if (decision === "deny") return "deny";
    return requestApproval(toolName, args, agentId);
  };
}

const confirmFn = createConfirmFn("main");

function denyAgentApprovals(agentId: string): void {
  for (const [id, pending] of [...pendingApprovals]) {
    if (pending.agentId !== agentId) continue;
    post({ type: "approvalResolved", id, decision: "deny", scope: "once" });
    pending.settle("deny");
  }
}

/** Persists a grant at the scope the user chose. */
async function persistGrant(key: string, scope: ApprovalScope): Promise<void> {
  if (scope === "global") {
    const cfg = await loadConfig();
    await saveConfig({
      permissions: {
        ...cfg.permissions,
        allow: [...new Set([...(cfg.permissions?.allow ?? []), key])],
      },
    });
    globalAllowSet.add(key);
  } else if (scope === "project") {
    await saveProjectPermissions(
      process.cwd(),
      [...new Set([...projectAllowSet, key])],
    );
    projectAllowSet.add(key);
  }
}

/** Reports the merged grant lists so the UI can show what is pre-approved. */
function postGrants(): void {
  post({
    type: "grants",
    grants: { project: [...projectAllowSet], global: [...globalAllowSet] },
  });
}

async function handleApprovalResponse(
  id: string,
  decision: ApprovalDecision,
  scope: ApprovalScope,
  grantKey: GrantKeyKind = "exact",
): Promise<void> {
  const pending = pendingApprovals.get(id);
  if (!pending) return; // already timed out, aborted or answered

  // Only an approval creates a grant, and a call on the catastrophic blocklist is
  // never remembered. The one-off click is still honoured either way.
  let effectiveScope = approvalGrantScope(
    decision,
    scope,
    pending.neverPersist,
  );
  if (pending.neverPersist && decision === "allow" && scope !== "once") {
    post({
      type: "error",
      message: `'${pending.toolName}' matches the built-in blocklist, so it was allowed once but not remembered.`,
    });
  }

  let grantPersisted = false;
  try {
    if (effectiveScope !== "once") {
      const key =
        grantKey === "toolWide"
          ? pending.grantKeys.toolWide
          : grantKey === "mcpServerWide"
            ? pending.grantKeys.mcpServerWide
            : pending.grantKeys.exact;
      if (key) {
        await persistGrant(key, effectiveScope);
        grantPersisted = true;
      } else {
        effectiveScope = "once";
      }
    }
  } catch (error) {
    effectiveScope = "once";
    post({
      type: "error",
      message: `A permissão foi concedida apenas desta vez porque não foi possível salvá-la: ${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    // Persistence failure must never leave the agent waiting for this approval.
    pending.settle(decision);
  }
  if (grantPersisted) postGrants();
  post({ type: "approvalResolved", id, decision, scope: effectiveScope });
}

/** Denies every in-flight approval — used on abort, reset and end of turn. */
function denyAllPending(reason: string): void {
  const hadApprovals = pendingApprovals.size > 0;
  const hadQuestions = pendingUserQuestions.size > 0;
  const hadSubAgentWork =
    pendingSubAgentConfigs.size > 0 || subAgentControllers.size > 0;
  for (const [id, pending] of [...pendingApprovals]) {
    post({ type: "approvalResolved", id, decision: "deny", scope: "once" });
    pending.settle("deny");
  }
  pendingApprovals.clear();
  if (hadQuestions) cancelAllUserQuestions(reason);
  for (const pending of [...pendingSubAgentConfigs.values()])
    pending.settle(null);
  for (const [id, controller] of subAgentControllers) {
    controller.abort();
    cancelUserQuestionsForAgent(id);
    pendingSubAgentReviews.get(id)?.("cancel");
  }
  if (hadApprovals || hadSubAgentWork) post({ type: "error", message: reason });
}

// --- Credentials and agent construction -------------------------------------

/**
 * Resolves the API key the same way the CLI does: environment first, then
 * `~/.rubycli/config.json`.
 *
 * M2 replaces the config-file half with `safeStorage`, so the key lives in the
 * OS keychain rather than plaintext. Reading the CLI's config here means the
 * desktop app works for anyone who already has the CLI configured, which is the
 * right default for a first milestone.
 */
async function resolveCredentials(): Promise<{ key: string; source: string }> {
  const fromEnv = findApiKeyInEnv();
  if (fromEnv) {
    const source =
      process.env.RUBY_DESKTOP_KEY_SOURCE === "safeStorage"
        ? "Ruby Desktop · cofre seguro do sistema"
        : `${fromEnv.name} (environment)`;
    return { key: fromEnv.value, source };
  }

  const config = await loadConfig();
  if (config.rubyApiKey)
    return { key: config.rubyApiKey, source: "~/.rubycli/config.json" };

  return { key: "", source: "none" };
}

/**
 * Picks the provider for a model name.
 *
 * RubyCLI's catalog re-serves models whose names belong to other providers'
 * prefixes (`glm-5.3`, `kimi-k3`, `deepseek-v4.1-flash`, `gpt-6-*`). Those must go
 * to Ruby, and the decision depends on whether a Ruby key is configured — hence
 * `isRubyCatalogModel` rather than plain prefix detection.
 */
function resolveProviderFor(name: string): Provider {
  if (isRubyCatalogModel(name, { hasRubyKey: apiKey.length > 0 }))
    return "rubycli";
  return detectProvider(name);
}

/** Loads the permission policy from the user's own storage. */
async function loadPermissions(): Promise<void> {
  const cwd = process.cwd();
  const [config, settings, storedProject] = await Promise.all([
    loadConfig(),
    loadSettings(cwd),
    loadProjectPermissions(cwd),
  ]);
  const sources = buildPermissionSources(config, settings, storedProject);
  globalAllowSet = sources.globalAllowSet;
  projectAllowSet = sources.projectAllowSet;
  denyPatterns = sources.denyPatterns;
  // `ask` rules force a prompt even for tools whose own predicate would not ask.
  forcesConfirmation = createForcesConfirmationFn(sources.askPatterns);

  // A repository that ships `permissions.allow` is attempting GHSA-3g98-ffw6-87mg.
  // The CLI warns on stderr; the GUI surfaces it as a visible notice instead.
  const warning = ignoredProjectAllowWarning(settings);
  if (warning) post({ type: "error", message: warning });
}

function postSubAgent(agent: SubAgentSummary): void {
  const transcript = agent.transcript?.slice(-80).map((entry) => {
    if (entry.kind === "tool") {
      return {
        ...entry,
        ...(entry.result ? { result: entry.result.slice(-3_000) } : {}),
      };
    }
    return { ...entry, text: entry.text.slice(-12_000) };
  });
  if (transcript) {
    let totalChars = transcript.reduce(
      (total, entry) =>
        total +
        (entry.kind === "tool"
          ? entry.name.length + (entry.result?.length ?? 0)
          : entry.text.length),
      0,
    );
    while (transcript.length > 1 && totalChars > 48_000) {
      const removed = transcript.shift();
      if (removed) {
        totalChars -=
          removed.kind === "tool"
            ? removed.name.length + (removed.result?.length ?? 0)
            : removed.text.length;
      }
    }
  }
  const snapshot: SubAgentSummary = {
    ...agent,
    ...(agent.output ? { output: agent.output.slice(-12_000) } : {}),
    ...(transcript ? { transcript } : {}),
    ...(agent.diff ? { diff: agent.diff.slice(0, 120_000) } : {}),
    ...(agent.changedFiles
      ? { changedFiles: agent.changedFiles.slice(0, 200) }
      : {}),
  };
  latestSubAgentSummaries.set(agent.id, snapshot);
  const agentSession = subAgentSessions.get(agent.id);
  const now = Date.now();
  const previous = persistedSubAgentStatuses.get(agent.id);
  const statusChanged = previous !== agent.status;
  const state = subAgentPostState.get(agent.id) ?? {
    lastPostedAt: 0,
    lastPersistedAt: 0,
  };
  subAgentPostState.set(agent.id, state);
  const emit = (value: SubAgentSummary): void => {
    state.lastPostedAt = Date.now();
    state.latest = undefined;
    if (subAgentSessionIds.get(agent.id) === session?.id)
      post({ type: "subAgentUpdate", agent: value });
  };
  if (statusChanged || now - state.lastPostedAt >= SUBAGENT_STREAM_THROTTLE_MS) {
    if (state.timer) clearTimeout(state.timer);
    state.timer = undefined;
    emit(snapshot);
  } else {
    state.latest = snapshot;
    if (!state.timer) {
      state.timer = setTimeout(() => {
        state.timer = undefined;
        if (state.latest) emit(state.latest);
      }, SUBAGENT_STREAM_THROTTLE_MS - (now - state.lastPostedAt));
    }
  }
  if (
    statusChanged ||
    now - state.lastPersistedAt >= SUBAGENT_CHECKPOINT_INTERVAL_MS
  ) {
    persistedSubAgentStatuses.set(agent.id, agent.status);
    state.lastPersistedAt = now;
    void logSessionUiEvent(
      {
        version: 1,
        kind: "subagent",
        id: agent.id,
        data: { agent: snapshot },
      },
      agentSession,
    );
  }
}

/** Rebuild child-agent state from the selected conversation's saved UI events. */
function restoreSubAgentSummaries(
  sessionId: string,
  entries: SessionEntry[],
): void {
  const restored = new Map<string, SubAgentSummary>();
  for (const entry of entries) {
    if (
      entry.type !== "ui_event" ||
      entry.event.version !== 1 ||
      entry.event.kind !== "subagent"
    )
      continue;
    const candidate = entry.event.data.agent;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      continue;
    const summary = candidate as Partial<SubAgentSummary>;
    if (
      typeof summary.id !== "string" ||
      typeof summary.title !== "string" ||
      typeof summary.role !== "string" ||
      typeof summary.model !== "string" ||
      typeof summary.status !== "string"
    )
      continue;
    const valid = summary as SubAgentSummary;
    const recovered =
      !subAgentRuns.has(valid.id) &&
      ["queued", "running", "review", "merging"].includes(valid.status)
        ? {
            ...valid,
            status: "interrupted" as const,
            progress: "Execução interrompida ao fechar o app",
          }
        : valid;
    restored.set(valid.id, recovered);
    subAgentSessionIds.set(valid.id, sessionId);
    persistedSubAgentStatuses.set(valid.id, recovered.status);
  }
  for (const [id, summary] of restored) {
    // Preserve any newer live state that arrived after the last disk checkpoint.
    if (!subAgentRuns.has(id)) latestSubAgentSummaries.set(id, summary);
  }
}

function waitForSubAgentReview(
  id: string,
): Promise<"merge" | "discard" | "cancel"> {
  return new Promise((resolve) => {
    const settle = (action: "merge" | "discard" | "cancel"): void => {
      clearTimeout(timer);
      pendingSubAgentReviews.delete(id);
      resolve(action);
    };
    const timer = setTimeout(() => {
      post({
        type: "error",
        message: `A revisão do sub-agente '${id}' expirou após 10 minutos e foi cancelada.`,
      });
      settle("cancel");
    }, SUBAGENT_REVIEW_TIMEOUT_MS);
    pendingSubAgentReviews.set(id, settle);
  });
}

function handleSubAgentReviewResponse(
  id: string,
  action: "merge" | "discard" | "cancel",
): void {
  const controller = subAgentControllers.get(id);
  if (action === "cancel" && controller) {
    controller.abort();
    denyAgentApprovals(id);
    cancelUserQuestionsForAgent(id);
  }
  pendingSubAgentReviews.get(id)?.(action);
}

async function acquireSubAgentSlot(signal: AbortSignal): Promise<() => void> {
  while (activeSubAgentCount >= MAX_CONCURRENT_SUBAGENTS) {
    if (signal.aborted)
      throw new Error("Sub-agent was cancelled while queued.");
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (signal.aborted) throw new Error("Sub-agent was cancelled while queued.");
  activeSubAgentCount++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeSubAgentCount = Math.max(0, activeSubAgentCount - 1);
  };
}

async function runSubAgent(
  prompt: string,
  options: SpawnSubAgentOptions,
  config: ResolvedSubAgentConfig,
): Promise<string> {
  const id = config.id;
  const runSession = session;
  if (runSession) {
    subAgentSessions.set(id, runSession);
    subAgentSessionIds.set(id, runSession.id);
  }
  const controller = new AbortController();
  subAgentControllers.set(id, controller);
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    llmCalls: 0,
    toolCalls: 0,
  };
  const transcript: SubAgentTranscriptEntry[] = [];
  let transcriptSequence = 0;
  const summary: SubAgentSummary = {
    id,
    title: options.title,
    prompt,
    role: options.role,
    model: config.model,
    ...(config.reasoningEffort
      ? { reasoningEffort: config.reasoningEffort }
      : {}),
    instructions: config.instructions,
    status: "queued",
    progress: "Aguardando uma vaga de execução",
    usage,
    transcript,
  };
  const recordNotice = (text: string): void => {
    transcript.push({
      id: `${id}-event-${++transcriptSequence}`,
      kind: "notice",
      text,
      createdAt: Date.now(),
    });
    summary.transcript = transcript;
    postSubAgent({ ...summary, usage: { ...usage } });
  };
  postSubAgent(summary);

  let releaseSlot: (() => void) | undefined;
  let workspaceRoot = process.cwd();
  let hasWorktree = false;
  let output = "";
  try {
    releaseSlot = await acquireSubAgentSlot(controller.signal);
    if (controller.signal.aborted)
      throw new Error("Sub-agent was cancelled before launch.");

    if (options.role === "worker") {
      summary.progress = "Criando um worktree isolado a partir do estado atual";
      postSubAgent(summary);
      workspaceRoot = await worktrees.create(id, process.cwd());
      hasWorktree = true;
    }

    const selectedProvider = resolveProviderFor(config.model);
    const childClient = createClient(config.model, apiKey, {
      includeUsage: true,
      provider: selectedProvider,
      baseUrl,
      supportsReasoningEffort: Boolean(
        modelCatalog.find((entry) => entry.id === config.model)?.reasoningEfforts?.length,
      ),
      ...(config.reasoningEffort
        ? { reasoningEffort: config.reasoningEffort }
        : {}),
    });
    const configFromDisk = await loadConfig();
    const runner = createSandboxRunner(
      configFromDisk.sandbox ?? "auto",
      workspaceRoot,
    );
    const available = createDefaultRegistry(config.model, runner, {
      includeTask: false,
      workspaceRoot,
      askUser: (question) => requestUserQuestion(id, options.title, question),
    });
    let childTools = available;
    if (options.role === "explorer") {
      childTools = new ToolRegistry();
      for (const tool of available.all())
        if (tool.readonly && tool.name !== "web_fetch" && tool.name !== "web_search") {
          childTools.register(tool);
        }
    }
    const childSkills = new SkillRegistry();
    await childSkills.discover(workspaceRoot);
    const harness = [
      "You are a delegated Ruby Desktop sub-agent.",
      `Role: ${options.role}. Workspace: ${workspaceRoot}.`,
      options.role === "explorer"
        ? "Investigate only; available tools are read-only. Return findings and file references."
        : "Implement only in this isolated worktree. Do not modify the user's main working tree. Return a concise summary of changes and verification.",
      config.instructions
        ? `User guidance for this agent:\n${config.instructions}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const child = new Agent(
      childClient,
      childTools,
      childSkills,
      `${await loadSystemInstruction()}\n\n## Sub-agent harness\n\n${harness}`,
      undefined,
      options.maxTurns,
      {
        model: config.model,
        provider: selectedProvider,
        ...(config.reasoningEffort
          ? { reasoningEffort: config.reasoningEffort }
          : {}),
        workspaceRoot,
        onObservability: (event) => {
          onObservability(event, id);
          if (event.type === "llm_call_end") {
            usage.inputTokens += event.inputTokens;
            usage.outputTokens += event.outputTokens;
            usage.cachedTokens += event.cachedTokens ?? 0;
            usage.llmCalls++;
          } else if (event.type === "tool_exec_end") {
            usage.toolCalls++;
          }
          postSubAgent({ ...summary, usage: { ...usage } });
        },
      },
    );
    child.setConfirmFn(createConfirmFn(id));
    child.setForcesConfirmationFn(forcesConfirmation);
    child.setPermissionMode(permissionMode);
    summary.status = "running";
    summary.progress =
      options.role === "worker"
        ? "Implementando no worktree isolado"
        : "Investigando o workspace";
    postSubAgent(summary);

    for await (const event of child.run(prompt, "react", controller.signal)) {
      if (controller.signal.aborted) break;
      if (event.type === "text") {
        output += event.text;
        summary.output = output.slice(-12_000);
        const last = transcript[transcript.length - 1];
        if (last?.kind === "assistant") {
          last.text = (last.text + event.text).slice(-12_000);
        } else {
          transcript.push({
            id: `${id}-event-${++transcriptSequence}`,
            kind: "assistant",
            text: event.text.slice(-12_000),
            createdAt: Date.now(),
          });
        }
        summary.transcript = transcript;
        postSubAgent({ ...summary, usage: { ...usage } });
      } else if (event.type === "tool_call") {
        summary.progress = `Usando ${event.name}`;
        transcript.push({
          id: `${id}-event-${++transcriptSequence}`,
          kind: "tool",
          name: event.name,
          status: "running",
          ...(event.id ? { toolCallId: event.id } : {}),
          createdAt: Date.now(),
        });
        summary.transcript = transcript;
        postSubAgent({ ...summary, usage: { ...usage } });
      } else if (event.type === "tool_result") {
        summary.progress = `Concluiu ${event.name}`;
        let tool = event.id
          ? transcript.find(
              (entry) =>
                entry.kind === "tool" && entry.toolCallId === event.id,
            )
          : undefined;
        if (!tool) {
          for (let index = transcript.length - 1; index >= 0; index--) {
            const candidate = transcript[index];
            if (
              candidate?.kind === "tool" &&
              candidate.status === "running" &&
              candidate.name === event.name
            ) {
              tool = candidate;
              break;
            }
          }
        }
        if (tool?.kind === "tool") {
          tool.status = "completed";
          tool.result = event.result.slice(0, 3_000);
        } else {
          transcript.push({
            id: `${id}-event-${++transcriptSequence}`,
            kind: "tool",
            name: event.name,
            status: "completed",
            result: event.result.slice(0, 3_000),
            ...(event.id ? { toolCallId: event.id } : {}),
            createdAt: Date.now(),
          });
        }
        summary.transcript = transcript;
        postSubAgent({ ...summary, usage: { ...usage } });
      } else if (event.type === "skill_activated") {
        recordNotice(`Skill ativada: ${event.name}`);
      } else if (event.type === "notice") {
        recordNotice(event.message);
      } else if (event.type === "error") {
        throw new Error(event.message);
      } else if (event.type === "done") {
        break;
      }
    }

    if (controller.signal.aborted) {
      summary.status = "cancelled";
      summary.progress = "Execução cancelada; o worktree será descartado";
      postSubAgent(summary);
      return output.trim();
    }

    if (options.role === "worker") {
      const result = await worktrees.diff(id);
      if (result.changedFiles.length === 0) {
        summary.status = "completed";
        summary.progress = "Concluído sem alterações no worktree";
        postSubAgent(summary);
        return output.trim();
      }

      summary.status = "review";
      summary.progress = "Revise o diff; nada foi aplicado ao workspace";
      summary.diff = result.diff.slice(0, 120_000);
      summary.changedFiles = result.changedFiles;
      postSubAgent({ ...summary, usage: { ...usage } });

      while (true) {
        const action = await waitForSubAgentReview(id);
        if (action === "cancel" || controller.signal.aborted) {
          summary.status = "cancelled";
          summary.progress = "Diff descartado; workspace não foi alterado";
          postSubAgent(summary);
          return output.trim();
        }
        if (action === "discard") {
          summary.status = "cancelled";
          summary.progress = "Diff descartado; workspace não foi alterado";
          postSubAgent(summary);
          return output.trim();
        }

        summary.status = "merging";
        summary.progress = "Verificando conflitos e aplicando o diff aprovado";
        summary.error = undefined;
        postSubAgent(summary);
        try {
          await worktrees.apply(id);
          summary.status = "merged";
          summary.progress = "Diff aprovado e aplicado ao workspace";
          postSubAgent(summary);
          return output.trim();
        } catch (error) {
          summary.status = "review";
          summary.progress =
            "O diff conflita com alterações atuais; revise antes de tentar novamente";
          summary.error =
            error instanceof Error ? error.message : String(error);
          postSubAgent(summary);
        }
      }
    }

    summary.status = "completed";
    summary.progress = "Investigação concluída";
    postSubAgent(summary);
    return output.trim();
  } catch (error) {
    summary.status = controller.signal.aborted ? "cancelled" : "failed";
    summary.error = error instanceof Error ? error.message : String(error);
    summary.progress = controller.signal.aborted
      ? "Cancelado"
      : "Falha na execução";
    postSubAgent(summary);
    if (controller.signal.aborted) return output.trim();
    throw error;
  } finally {
    pendingSubAgentReviews.delete(id);
    cancelUserQuestionsForAgent(id);
    subAgentControllers.delete(id);
    releaseSlot?.();
    const postState = subAgentPostState.get(id);
    if (postState?.timer) clearTimeout(postState.timer);
    subAgentPostState.delete(id);
    subAgentSessions.delete(id);
    if (hasWorktree) await worktrees.cleanup(id);
  }
}

function trackSubAgentRun(id: string, run: Promise<string>): void {
  subAgentRuns.set(id, run);
  const clear = (): void => {
    if (subAgentRuns.get(id) === run) subAgentRuns.delete(id);
  };
  // Handle background failures here so a detached task cannot create an
  // unhandled rejection. The failed summary remains available to the parent.
  void run.then(clear, clear);
}

function startTrackedSubAgent(
  prompt: string,
  options: SpawnSubAgentOptions,
  config: ResolvedSubAgentConfig,
): Promise<string> {
  const run = runSubAgent(prompt, options, config);
  trackSubAgentRun(config.id, run);
  return run;
}

async function spawnSubAgent(
  prompt: string,
  options: SpawnSubAgentOptions,
): Promise<string> {
  const config = askForSubAgentConfig.getStore()
    ? await requestSubAgentConfig(prompt, options)
    : resolveAutomaticSubAgentConfig(prompt, options);
  if (!config)
    throw new Error(
      `Sub-agent '${options.title}' was cancelled before launch.`,
    );
  startTrackedSubAgent(prompt, options, config);
  return [
    `Sub-agent iniciado em segundo plano: ${options.title} (${options.role}).`,
    `ID: ${config.id}`,
    `Modelo: ${config.model}${config.reasoningEffort ? ` · effort ${config.reasoningEffort}` : ""}`,
    config.instructions ? `Orientações: ${config.instructions}` : "",
    "Continue o trabalho principal em paralelo. Consulte subagent_status com action=list ou action=get para acompanhar e ler os resultados.",
  ]
    .filter(Boolean)
    .join("\n");
}

function subAgentForCurrentSession(id: string): SubAgentSummary | undefined {
  if (subAgentSessionIds.get(id) !== session?.id) return undefined;
  return latestSubAgentSummaries.get(id);
}

function serializeSubAgent(
  summary: SubAgentSummary,
  includeTranscript: boolean,
): string {
  const value = {
    id: summary.id,
    title: summary.title,
    prompt: summary.prompt,
    role: summary.role,
    model: summary.model,
    ...(summary.reasoningEffort
      ? { reasoningEffort: summary.reasoningEffort }
      : {}),
    status: summary.status,
    ...(summary.progress ? { progress: summary.progress } : {}),
    ...(summary.instructions ? { instructions: summary.instructions } : {}),
    ...(summary.output ? { output: summary.output.slice(-12_000) } : {}),
    ...(summary.error ? { error: summary.error } : {}),
    ...(summary.changedFiles?.length
      ? { changedFiles: summary.changedFiles }
      : {}),
    ...(summary.usage ? { usage: summary.usage } : {}),
    ...(includeTranscript && summary.transcript
      ? {
          transcript: summary.transcript.slice(-12).map((entry) =>
            entry.kind === "tool"
              ? { ...entry, result: entry.result?.slice(-1_500) }
              : { ...entry, text: entry.text.slice(-4_000) },
          ),
        }
      : {}),
  };
  return JSON.stringify(value, null, 2);
}

function createSubAgentStatusTool(): Tool {
  return {
    name: "subagent_status",
    description:
      "Inspect background sub-agents started with task. Use list to see current-chat agents, get to read one agent's output and recent context, or wait for a bounded time before checking again.",
    readonly: true,
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "get", "wait"],
          description: "list shows agents, get returns one agent, wait checks again after a bounded wait.",
        },
        id: {
          type: "string",
          description: "Sub-agent ID returned by task; required for get and wait.",
        },
        timeout_ms: {
          type: "number",
          description: "For wait only: 1000–30000 ms. Defaults to 10000 ms.",
        },
      },
      required: ["action"],
    },
    async execute(params) {
      const action = params.action;
      if (action === "list") {
        const agents = [...latestSubAgentSummaries.values()]
          .filter((entry) => Boolean(subAgentForCurrentSession(entry.id)))
          .map((entry) => ({
            id: entry.id,
            title: entry.title,
            role: entry.role,
            model: entry.model,
            status: entry.status,
            ...(entry.progress ? { progress: entry.progress } : {}),
            ...(entry.error ? { error: entry.error } : {}),
          }));
        return { success: true, output: JSON.stringify(agents, null, 2) };
      }

      if (action !== "get" && action !== "wait") {
        return {
          success: false,
          output: "Action must be list, get, or wait.",
          error: "Invalid action.",
        };
      }
      const id = typeof params.id === "string" ? params.id : "";
      if (!id) {
        return {
          success: false,
          output: "An agent ID is required for get and wait.",
          error: "Missing ID.",
        };
      }
      const current = subAgentForCurrentSession(id);
      if (!current) {
        return {
          success: false,
          output: `No sub-agent '${id}' exists in the current conversation. Use action=list to inspect available IDs.`,
          error: "Sub-agent not found in current conversation.",
        };
      }

      if (action === "wait") {
        const run = subAgentRuns.get(id);
        if (run) {
          const requested = Number(params.timeout_ms);
          const timeoutMs = Number.isFinite(requested)
            ? Math.max(1_000, Math.min(30_000, Math.floor(requested)))
            : 10_000;
          let timer: NodeJS.Timeout | undefined;
          await Promise.race([
            run.catch(() => undefined),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, timeoutMs);
            }),
          ]);
          if (timer) clearTimeout(timer);
        }
      }

      const latest = subAgentForCurrentSession(id);
      return latest
        ? { success: true, output: serializeSubAgent(latest, action === "get") }
        : {
            success: false,
            output: `Sub-agent '${id}' is not available in the current conversation.`,
            error: "Sub-agent unavailable.",
          };
    },
  };
}

/** A workflow uses the same visible model picker, approval and worktree policy as task(). */
const workflowConfigs = new WeakMap<
  WorkflowAgentRequest,
  ResolvedSubAgentConfig
>();

function workflowSubAgentOptions(
  request: WorkflowAgentRequest,
): SpawnSubAgentOptions {
  return {
    maxTurns: request.maxTurns ?? 15,
    title: request.name,
    role: request.role,
    ...(request.model ? { model: request.model } : {}),
    ...(request.reasoningEffort
      ? { reasoningEffort: request.reasoningEffort }
      : {}),
    ...(request.instructions ? { instructions: request.instructions } : {}),
  };
}

function workflowPrompt(request: WorkflowAgentRequest): string {
  if (!request.resultSchema) return request.prompt;
  return (
    `${request.prompt}\n\n` +
    "## Required structured result\n" +
    "Return only valid JSON matching this schema, with no surrounding explanation or markdown fence:\n" +
    `\n${JSON.stringify(request.resultSchema, null, 2)}`
  );
}

async function configureWorkflowAgent(
  request: WorkflowAgentRequest,
): Promise<ResolvedSubAgentConfig> {
  const options = workflowSubAgentOptions(request);
  return resolveAutomaticSubAgentConfig(workflowPrompt(request), options);
}

async function runWorkflowExplorer(
  request: WorkflowAgentRequest,
): Promise<string> {
  const config = await configureWorkflowAgent(request);
  return startTrackedSubAgent(
    workflowPrompt(request),
    workflowSubAgentOptions(request),
    config,
  );
}

async function confirmWorkflowWorker(
  request: WorkflowAgentRequest,
): Promise<boolean> {
  const config = await configureWorkflowAgent(request);
  workflowConfigs.set(request, config);
  return true;
}

async function runWorkflowWorker(
  request: WorkflowAgentRequest,
): Promise<string> {
  const config = workflowConfigs.get(request);
  workflowConfigs.delete(request);
  if (!config)
    throw new Error(
      `Workflow worker '${request.name}' has no approved configuration.`,
    );
  const run = startTrackedSubAgent(
    workflowPrompt(request),
    workflowSubAgentOptions(request),
    config,
  );
  return await run;
}

function reportWorkflowEvent(event: WorkflowEvent): void {
  post({ type: "workflowEvent", event });
}

/** Builds the agent for the current model. Called on start, model change and reset. */
async function buildAgent(): Promise<void> {
  // A previous provider measurement may belong to another model or session.
  // The next engine snapshot will provide a fresh estimate for the new agent.
  latestContextTokens = undefined;
  latestContextSource = "engine";
  provider = resolveProviderFor(model);

  const client = createClient(model, apiKey, {
    includeUsage: true,
    provider,
    baseUrl,
    supportsReasoningEffort: Boolean(
      modelCatalog.find((entry) => entry.id === model)?.reasoningEfforts?.length,
    ),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  });

  const config = await loadConfig();
  const runner = createSandboxRunner(config.sandbox ?? "auto", process.cwd());
  const baseInstruction = await loadSystemInstruction();
  const catalogInstructions = modelCatalog.length
    ? `Available sub-agent models (choose exact ids; use a supported reasoning effort):\n${modelCatalog
        .map(
          (entry) =>
            `- ${entry.id}${entry.reasoningEfforts?.length ? ` (effort: ${entry.reasoningEfforts.join(", ")})` : ""}`,
        )
        .join("\n")}`
    : "The model catalog is unavailable; do not invent a model id. The task tool will use the currently selected model.";
  const systemInstruction = `${baseInstruction}\n\n## Visible progress updates\n\nFor complex tasks that use tools or take multiple steps, use the report_progress tool at meaningful milestones. Send one concise, user-facing sentence describing the current step or its high-level reason. This message appears in the chat's progress panel. It is a public summary, never private scratchpad reasoning or detailed internal deliberation. Do not use it for simple questions or repeat the same update.\n\n## Sub-agent orchestration\n\nDelegate useful independent work with the task tool without asking the user first. Choose a concise title, role (explorer for read-only research, worker for isolated implementation), exact catalog model, supported reasoning effort, and focused instructions. By default, launch with your proposed configuration immediately and do not open a configuration question. Set ask_for_configuration=true only when the user explicitly asks to configure, choose, review, or edit the sub-agent before it starts (for example: “peça para eu configurar o sub-agent”). If the user asks you to use sub-agents, that alone is authorization to launch them autonomously. Workflow agents also start with the recommended configuration.\n\nThe task tool starts a child in the background and immediately returns its ID; it does not wait for the child to finish. Launch independent tasks early, one after another without waiting between launches (up to the concurrency limit), then continue your own work. Consult subagent_status with action=list/get while working, and use its bounded wait action only when you need a particular result. Do not serialize independent tasks by waiting for each one before starting the next. Before your final answer, check the relevant children and use their completed findings. Workers still run in isolated Git worktrees; their diffs require the user's approval before application, and all normal tool permission prompts still apply. If the user asks to configure an agent manually, prefer the task tool with ask_for_configuration=true.\n\n${catalogInstructions}`;
  const mcpGuidance = [
    "## MCP server management",
    "Use manage_mcp_servers with action=list to inspect configured servers and available tools. Use action=add only when the user asks to add a server; provide its exact name and transport configuration. The app asks the user to approve every add or remove. A new server is probed before its configuration is saved and its tools are offered on the next model call. Use ${NAME} references for credentials instead of putting secret values in chat.",
  ].join("\n");
  const fullSystemInstruction = `${systemInstruction}\n\n${mcpGuidance}`;
  const tools = createDefaultRegistry(model, runner, {
    spawnSubAgent,
    askUser: (question) => requestUserQuestion("main", "Ruby", question),
    workflow: {
      runAgent: runWorkflowExplorer,
      confirmWorker: confirmWorkflowWorker,
      runWorkerInWorktree: runWorkflowWorker,
      maxConcurrency: MAX_CONCURRENT_SUBAGENTS,
      onEvent: reportWorkflowEvent,
    },
  });
  const taskTool = tools.get("task");
  if (taskTool) {
    taskTool.description =
      "Launch an independent sub-agent autonomously using the selected catalog model and reasoning effort. " +
      "Set ask_for_configuration=true only if the user explicitly wants to review or edit the agent configuration before launch. " +
      "Workers run in an isolated Git worktree and their diff always requires the user's approval before it is applied.";
    taskTool.parameters.properties = {
      ...(taskTool.parameters.properties ?? {}),
      ask_for_configuration: {
        type: "boolean",
        description:
          "Optional. Set true only when the user explicitly asks to configure or review this sub-agent before it starts. Default false launches autonomously.",
      },
    };
    const executeTask = taskTool.execute.bind(taskTool);
    taskTool.execute = (params, context) => {
      const ask = params.ask_for_configuration === true;
      const taskParams = { ...params };
      delete taskParams.ask_for_configuration;
      return askForSubAgentConfig.run(ask, () =>
        executeTask(taskParams, context),
      );
    };
  }
  tools.register(createSubAgentStatusTool());
  tools.register(createMcpManagementTool(tools));
  const skills = new SkillRegistry();
  await skills.discover(process.cwd());
  skillRegistry = skills;

  // MCP tools join the same registry as the built-ins, which is what makes an MCP
  // server indistinguishable from a native tool from the agent's point of view.
  // A failing server is reported and skipped; it never blocks the agent.
  await connectMcp(tools).catch((err: unknown) => {
    post({
      type: "error",
      message: `MCP tools unavailable: ${err instanceof Error ? err.message : String(err)}`,
    });
  });

  // Browser tools are always registered: they fail with a clear message if the
  // panel is closed, which is better than the model not knowing browsing exists.
  registerBrowserTools(tools, browserBridge);

  // This tool writes a short public status summary to the progress panel. It
  // never exposes the private `think` scratchpad or accepts arbitrary side effects.
  tools.register({
    name: "report_progress",
    readonly: true,
    description:
      "Send a concise public progress summary to the user: the current step or its high-level reason. Never include private reasoning, scratchpad content, detailed internal deliberation, or secrets. Use only at meaningful milestones of multi-step work.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "One short user-facing progress sentence, up to 320 characters.",
        },
      },
      required: ["message"],
    },
    validate: (params) =>
      typeof params.message === "string" && params.message.trim().length > 0
        ? null
        : "message must be a non-empty string.",
    execute: async (params) => {
      const message = (params.message as string).trim().slice(0, 320);
      post({ type: "turnProgress", phase: "public_update", message });
      return { success: true, output: "Progress summary shown to the user." };
    },
  });

  toolCount = tools.all().length;
  skillCount = skills.list().length;

  agent = new Agent(
    client,
    tools,
    skills,
    fullSystemInstruction,
    undefined,
    readConfiguredMaxIterations(),
    // `model` is required here: the Agent derives its context window from the
    // model name, and the client it was handed does not expose one. Omitting it
    // silently falls back to 100k, which would make auto-compaction fire at 75k
    // instead of 75% of the model's real window.
    {
      model,
      provider,
      onObservability,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    },
  );

  if (session) {
    agent.setSessionTmpDir(session.tmpDir);
    if (sessionMessages.length > 0) agent.restoreMessages(sessionMessages);
  }

  // Wire the GUI's half of the permission gate. Without these two the executor
  // denies every call that requires confirmation, silently and without a prompt.
  agent.setConfirmFn(confirmFn);
  agent.setForcesConfirmationFn(forcesConfirmation);
  agent.setPermissionMode(permissionMode);
}

/** Fetches the model catalog and reports it to the UI. */
async function reportModels(): Promise<void> {
  const { models, error } = await fetchRemoteModels(baseUrl, apiKey);
  if (error) {
    post({ type: "error", message: `Model catalog unavailable: ${error}` });
    return;
  }

  const summaries: ModelSummary[] = models
    .filter((m) => m.id?.trim())
    .map((m) => {
      const modelProvider = isRubyCatalogModel(m.id, {
        hasRubyKey: apiKey.length > 0,
      })
        ? "rubycli"
        : detectProvider(m.id);
      const supportsEffort =
        m.supports_reasoning &&
        (modelProvider === "rubycli" || modelProvider === "openai");
      const advertisedEfforts = m.reasoning_efforts ?? m.reasoningEfforts;
      const reasoningEfforts: ReasoningEffort[] = supportsEffort
        ? Array.isArray(advertisedEfforts)
          ? advertisedEfforts
              .map(normalizeReasoningEffort)
              .filter((effort): effort is ReasoningEffort => effort !== undefined)
          : ["none", "minimal", "low", "medium", "high", "xhigh", "max"]
        : [];
      return {
        id: m.id,
        label: m.display_name ?? m.id,
        contextWindow: remoteContextWindow(m),
        supportsReasoning: m.supports_reasoning,
        reasoningEfforts,
        supportsVision: m.supports_vision,
      };
    });
  modelCatalog = summaries;
  post({ type: "models", models: summaries });

  // Keep a Desktop selection across engine restarts. If it vanished from the
  // account catalog, fall back to the configured model, then RubySmart, then the
  // first available entry. The main process saves this resolved ID after ready.
  if (summaries.length > 0) {
    const desktopPreference = process.env.RUBY_DESKTOP_PREFERRED_MODEL?.trim();
    const available = new Set(summaries.map((entry) => entry.id));
    const fallback = [configuredModel, DEFAULT_MODEL].find((candidate) =>
      available.has(candidate),
    );
    model =
      (desktopPreference && available.has(desktopPreference)
        ? desktopPreference
        : undefined) ??
      fallback ??
      summaries[0].id;

    const requestedEffort = parseReasoningEffort(
      process.env.RUBY_DESKTOP_PREFERRED_REASONING_EFFORT,
    );
    const selectedModel = summaries.find((entry) => entry.id === model);
    reasoningEffort =
      requestedEffort && selectedModel?.reasoningEfforts?.includes(requestedEffort)
        ? requestedEffort
        : undefined;
    if (process.env.RUBY_DESKTOP_PREFERRED_REASONING_EFFORT && !reasoningEffort) {
      post({
        type: "error",
        message: `O effort salvo não está disponível para '${model}'. Usando o padrão do modelo.`,
      });
    }

    if (desktopPreference && !available.has(desktopPreference)) {
      post({
        type: "error",
        message: `O modelo salvo '${desktopPreference}' não está disponível para esta chave. Usando '${model}' como fallback.`,
      });
    } else if (!desktopPreference && !available.has(configuredModel)) {
      post({
        type: "error",
        message: `O modelo configurado '${configuredModel}' não está disponível para esta chave. Usando '${model}' como fallback.`,
      });
    }
  } else {
    reasoningEffort = undefined;
  }
}

const REASONING_EFFORT_VALUES: readonly ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return REASONING_EFFORT_VALUES.includes(value as ReasoningEffort);
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "off") return "none";
  if (normalized === "minimum") return "minimal";
  if (normalized === "extra-high" || normalized === "extra_high") {
    return "xhigh";
  }
  if (normalized === "maximum") return "max";
  return isReasoningEffort(normalized) ? normalized : undefined;
}

function parseReasoningEffort(value: string | undefined): ReasoningEffort | undefined {
  return value && isReasoningEffort(value) ? value : undefined;
}

/** Reports the current context usage so the meter stays live between turns. */
function reportUsage(): void {
  if (!agent) return;
  const stats = agent.getContextStats();
  post({
    type: "usage",
    inputTokens: latestContextTokens ?? stats.estimatedTokens,
    outputTokens: sessionOutputTokens,
    contextWindow: stats.contextWindow,
    contextSource: latestContextTokens === undefined ? "engine" : latestContextSource,
  });
}

/** Sends the current workspace's recent sessions and, when changed, its transcript. */
async function reportSessions(transcript?: SessionEntry[]): Promise<void> {
  post({
    type: "sessions",
    sessions: await Session.list(process.cwd()),
    currentSessionId: session?.id,
    ...(transcript !== undefined ? { transcript } : {}),
  });
}

/** Starts a new persisted conversation without changing the workspace. */
async function startNewSession(): Promise<void> {
  if (running || autoGoalRunning) {
    post({
      type: "error",
      message:
        "Finish or stop the current turn before starting a new conversation.",
    });
    return;
  }
  await sessionLogQueue;
  session = await Session.create(process.cwd());
  sessionMessages = [];
  sessionOutputTokens = 0;
  persistedSubAgentStatuses.clear();
  await buildAgent();
  await reportSessions([]);
  reportUsage();
  post({ type: "status", status: "ready" });
}

/** Resumes the engine context and visible transcript from one workspace session. */
async function resumeSession(sessionId: string): Promise<void> {
  if (running || autoGoalRunning) {
    post({
      type: "error",
      message:
        "Finish or stop the current turn before switching conversations.",
    });
    return;
  }
  await sessionLogQueue;
  const loaded = await Session.loadMessages(sessionId, process.cwd());
  session = loaded.session;
  sessionMessages = loaded.messages;
  sessionOutputTokens = 0;
  persistedSubAgentStatuses.clear();
  restoreSubAgentSummaries(session.id, loaded.entries);
  await buildAgent();
  await reportSessions(loaded.entries);
  reportUsage();
  post({ type: "status", status: "ready" });
}

/** Opens the latest non-empty conversation, or creates the first one. */
async function restoreLatestSession(): Promise<SessionEntry[]> {
  try {
    const loaded = await Session.loadMessages("latest", process.cwd());
    session = loaded.session;
    sessionMessages = loaded.messages;
    restoreSubAgentSummaries(session.id, loaded.entries);
    return loaded.entries;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("No sessions")) throw err;
    session = await Session.create(process.cwd());
    sessionMessages = [];
    return [];
  }
}

/** Runs one engine turn and streams its events; orchestration owns busy/status state. */
async function runAgentTurn(
  text: string,
  sessionText: string,
  signal?: AbortSignal,
): Promise<{ text: string; errors?: string[] }> {
  if (!agent) throw new Error("Engine is not ready yet.");
  let turnText = "";
  let pendingAssistantText = "";
  const errors: string[] = [];
  await logSessionEntry({ type: "user", content: sessionText });
  const flushAssistantText = async (): Promise<void> => {
    if (!pendingAssistantText) return;
    const content = pendingAssistantText;
    pendingAssistantText = "";
    await logSessionEntry({ type: "assistant", content });
  };
  for await (const event of agent.run(text, "react", signal)) {
    if (signal?.aborted || cancelled) break;
    if (event.type === "text") {
      turnText += event.text;
      pendingAssistantText += event.text;
      post({ type: "event", event: event as AgentEvent });
      continue;
    }
    await flushAssistantText();
    if (event.type === "error") errors.push(event.message);
    if (event.type === "tool_call") {
      await logSessionEntry({
        type: "tool_call",
        name: event.name,
        args: event.args,
        ...(event.thoughtSignature
          ? { thoughtSignature: event.thoughtSignature }
          : {}),
      });
    }
    if (event.type === "tool_result") {
      await logSessionEntry({
        type: "tool_result",
        name: event.name,
        result: event.result,
      });
    }
    post({ type: "event", event: event as AgentEvent });
  }
  await flushAssistantText();
  return { text: turnText, ...(errors.length > 0 ? { errors } : {}) };
}

async function refreshSessionAfterTurn(): Promise<void> {
  await skillRegistry?.discover(process.cwd());
  if (skillRegistry) {
    const discovered = getSkillSummaries();
    skillCount = discovered.length;
    post({ type: "skills", skills: discovered });
  }
  denyAllPending("Turn ended with pending approvals; they were denied.");
  browserBridge.failAll("Turn ended before the browser operation completed.");
  reportUsage();
  await sessionLogQueue;
  if (session) {
    try {
      sessionMessages = (await Session.loadMessages(session.id, process.cwd()))
        .messages;
    } catch (err) {
      fail(err);
    }
    await reportSessions();
  }
}

/** Runs one turn, streaming every engine event to the UI. */
async function runPrompt(text: string, sessionText = text): Promise<void> {
  if (!agent) {
    post({ type: "error", message: "Engine is not ready yet." });
    return;
  }
  if (running || autoGoalRunning) {
    post({ type: "error", message: "A turn is already in progress." });
    return;
  }

  running = true;
  cancelled = false;
  activeOperationCompletion = new Promise<void>((resolve) => {
    resolveActiveOperation = resolve;
  });
  activeTurnController = new AbortController();
  post({ type: "status", status: "busy" });
  try {
    await runAgentTurn(text, sessionText, activeTurnController.signal);
  } catch (err) {
    fail(err);
  } finally {
    try {
      await refreshSessionAfterTurn();
    } finally {
      activeTurnController = undefined;
      running = false;
      post({ type: "status", status: "ready" });
      resolveActiveOperation?.();
      resolveActiveOperation = undefined;
      activeOperationCompletion = undefined;
    }
  }
}

/** Activates a discovered Skill from a slash command typed by the user. */
async function runSkill(name: string, args: string): Promise<void> {
  if (!agent || !skillRegistry) {
    post({ type: "error", message: "The Skill catalog is not ready yet." });
    post({ type: "status", status: "ready" });
    return;
  }
  if (running || autoGoalRunning) {
    post({ type: "error", message: "A turn is already in progress." });
    return;
  }

  const skill = skillRegistry.get(name);
  if (!skill) {
    post({ type: "error", message: `Unknown Skill: ${name}` });
    post({ type: "status", status: "ready" });
    return;
  }
  try {
    const body = await skillRegistry.load(name, args);
    if (!body) {
      post({ type: "error", message: `Could not load Skill: ${name}` });
      post({ type: "status", status: "ready" });
      return;
    }

    agent.injectSkill(name, body);
    post({ type: "event", event: { type: "skill_activated", name } });
    const prompt = args.trim() || `Siga as instruções da Skill "${name}".`;
    const command = `/${name}${args.trim() ? ` ${args.trim()}` : ""}`;
    await runPrompt(prompt, command);
  } catch (err) {
    post({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
    post({ type: "status", status: "ready" });
  }
}

/** Compacts the conversation on demand (`/compact`). */
async function runCompact(): Promise<void> {
  if (!agent) {
    post({ type: "error", message: "Engine is not ready yet." });
    return;
  }
  if (running || autoGoalRunning) {
    post({
      type: "error",
      message: "Finish or stop the current turn before compacting.",
    });
    return;
  }
  post({ type: "compacting", active: true });
  try {
    const result = await agent.compact();
    // A short conversation is not compactable, and the engine reports that as
    // "removed 0 messages" rather than as an error. Saying "compacted 0 messages
    // into a 0-char summary" would read like a failure, so say what actually
    // happened.
    post({
      type: "event",
      event: {
        type: "notice",
        message:
          result.messagesRemoved === 0
            ? "Nothing to compact — the conversation is still short enough to keep in full."
            : `Compacted ${result.messagesRemoved} older messages into a ${result.summaryLength}-char summary.`,
      } as AgentEvent,
    });
  } catch (err) {
    fail(err);
  } finally {
    post({ type: "compacting", active: false });
    reportUsage();
  }
}

// --- Goals ------------------------------------------------------------------

/** Reads the workspace goal and pushes it to the UI. */
async function reportGoal(): Promise<void> {
  const goal = await loadGoal(process.cwd());
  post({ type: "goal", goal: (goal as GoalSummary | null) ?? null });
}

async function startGoalAuto(maxRounds?: number): Promise<void> {
  if (!agent) throw new Error("Engine is not ready yet.");
  if (running || autoGoalRunning)
    throw new Error("A turn is already in progress.");

  const controller = new AbortController();
  autoGoalController = controller;
  autoGoalRunning = true;
  activeOperationCompletion = new Promise<void>((resolve) => {
    resolveActiveOperation = resolve;
  });
  cancelled = false;
  post({ type: "goalAuto", running: true });
  post({ type: "status", status: "busy" });

  try {
    const result = await runAutoGoal({
      cwd: process.cwd(),
      ...(maxRounds !== undefined ? { maxRounds } : {}),
      signal: controller.signal,
      onGoalUpdated: (goal) =>
        post({ type: "goal", goal: (goal as GoalSummary | null) ?? null }),
      runTurn: async (prompt, signal) => {
        activeTurnController = controller;
        const result = await runAgentTurn(
          prompt,
          `[Continuação automática da meta] ${prompt}`,
          signal,
        );
        await refreshSessionAfterTurn();
        return result;
      },
    });

    if (result.status === "blocked") {
      post({
        type: "event",
        event: {
          type: "notice",
          message: `A continuação automática foi bloqueada após ${result.rounds} rodada(s). ${result.reason ?? "Revise o progresso e retome a meta para tentar novamente."}`,
        } as AgentEvent,
      });
    } else if (result.status === "completed") {
      post({
        type: "event",
        event: {
          type: "notice",
          message: `Meta concluída em ${result.rounds} rodada(s) automática(s).`,
        } as AgentEvent,
      });
    } else if (result.status === "inactive") {
      post({
        type: "error",
        message:
          result.goal?.status === "complete"
            ? "A meta já está concluída."
            : "A meta não está ativa. Retome uma meta pausada para continuar.",
      });
    }
  } finally {
    await refreshSessionAfterTurn();
    activeTurnController = undefined;
    autoGoalController = undefined;
    autoGoalRunning = false;
    post({ type: "goalAuto", running: false });
    post({ type: "status", status: "ready" });
    resolveActiveOperation?.();
    resolveActiveOperation = undefined;
    activeOperationCompletion = undefined;
  }
}

async function handleGoal(
  request: Extract<EngineRequest, { type: "goal" }>,
): Promise<void> {
  const cwd = process.cwd();
  switch (request.action) {
    case "get":
      break;
    case "set":
      autoGoalController?.abort();
      await setGoal(request.text, cwd);
      break;
    case "note":
      await noteGoal(request.text, cwd);
      break;
    case "status":
      if (request.status !== "active") autoGoalController?.abort();
      await setGoalStatus(request.status, cwd);
      break;
    case "maxRounds":
      await setGoalMaxRounds(request.maxRounds, cwd);
      break;
    case "auto":
      await startGoalAuto(request.maxRounds);
      return;
    case "stopAuto":
      autoGoalController?.abort();
      break;
    case "clear":
      autoGoalController?.abort();
      await clearGoal(cwd);
      break;
  }
  await reportGoal();
}

// --- Message loop -----------------------------------------------------------

async function handle(request: EngineRequest): Promise<void> {
  switch (request.type) {
    case "hello": {
      if (running || autoGoalRunning) {
        post({ type: "error", message: "The engine cannot be reinitialized during an active turn." });
        return;
      }
      post({ type: "status", status: "starting" });
      const creds = await resolveCredentials();
      apiKey = creds.key;
      keySource = creds.source;

      const config = await loadConfig();
      baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
      configuredModel = config.model ?? DEFAULT_MODEL;
      model =
        process.env.RUBY_DESKTOP_PREFERRED_MODEL?.trim() || configuredModel;

      if (!apiKey) {
        post({
          type: "fatal",
          message:
            "No RubyCLI API key found. Set RUBY_API_KEY, or run the `ruby` CLI once to configure one.",
        });
        return;
      }

      await reportModels();
      await loadPermissions();

      const transcript = await restoreLatestSession();
      await buildAgent();
      // The renderer clears the previous workspace transcript on `ready`. Send
      // that boundary before the restored session, or switching projects can
      // briefly load the right history and then erase it in the ready handler.
      post({
        type: "ready",
        workspace: process.cwd(),
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        toolCount,
        skillCount,
        skills: getSkillSummaries(),
        keySource,
        permissionMode,
      });
      await reportSessions(transcript);
      post({ type: "status", status: "ready" });
      postGrants();
      await reportGoal();
      reportUsage();
      return;
    }

    case "prompt":
      await runPrompt(request.text);
      return;

    case "activateSkill":
      await runSkill(request.name, request.args);
      return;

    case "abort":
      cancelled = true;
      autoGoalController?.abort();
      activeTurnController?.abort();
      denyAllPending("Turn aborted; pending approvals were denied.");
      return;

    case "setModel": {
      if (running || autoGoalRunning) {
        post({
          type: "error",
          message: "Finish or stop the current turn before switching models.",
        });
        return;
      }
      const selected = modelCatalog.find((entry) => entry.id === request.model);
      if (!selected) {
        post({ type: "error", message: `O modelo '${request.model}' não está disponível.` });
        return;
      }
      if (
        request.reasoningEffort &&
        !selected.reasoningEfforts?.includes(request.reasoningEffort)
      ) {
        post({
          type: "error",
          message: `O modelo '${request.model}' não aceita o effort '${request.reasoningEffort}'.`,
        });
        return;
      }
      model = request.model;
      reasoningEffort = request.reasoningEffort;
      await buildAgent();
      post({
        type: "modelSelection",
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      });
      reportUsage();
      post({ type: "status", status: "ready" });
      return;
    }

    case "setPermissionMode": {
      permissionMode = request.mode;
      agent?.setPermissionMode(permissionMode);
      post({ type: "permissionMode", mode: permissionMode });
      return;
    }

    case "approvalResponse": {
      await handleApprovalResponse(
        request.id,
        request.decision,
        request.scope,
        request.grantKey,
      );
      return;
    }

    case "userQuestionResponse": {
      handleUserQuestionResponse(request.id, request.answers);
      return;
    }

    case "subAgentConfigResponse": {
      handleSubAgentConfigResponse(request);
      return;
    }

    case "clearSubAgents": {
      const ids = Array.isArray(request.ids)
        ? [...new Set(
            request.ids
              .filter((id): id is string => typeof id === "string" && id.length > 0)
              .map((id) => id.slice(0, 200)),
          )].slice(0, 500)
        : [];
      if (ids.length > 0) {
        await logSessionUiEvent({
          version: 1,
          kind: "subagent",
          id: `clear-${randomUUID()}`,
          data: { clearedIds: ids },
        });
      }
      return;
    }

    case "subAgentReviewResponse": {
      handleSubAgentReviewResponse(request.id, request.action);
      return;
    }

    case "compact":
      await runCompact();
      return;

    case "session":
      if (request.action === "new") {
        await startNewSession();
      } else {
        if (!request.sessionId)
          throw new Error("A session id is required to resume a conversation.");
        await resumeSession(request.sessionId);
      }
      return;

    case "goal":
      await handleGoal(request);
      return;

    case "mcp":
      await handleMcp(request);
      return;

    case "browserResult": {
      browserBridge.resolve(
        request.id,
        request.ok,
        request.result,
        request.error,
      );
      return;
    }

    case "shutdown": {
      // Close MCP child processes before the process is torn down, otherwise they
      // outlive the app on Windows, where nothing reaps a detached grandchild.
      await mcp?.disconnectAll().catch(() => {});
      mcp = undefined;
      denyAllPending("Engine shutting down; pending approvals were denied.");
      await Promise.allSettled([...subAgentRuns.values()]);
      await sessionLogQueue;
      await worktrees.cleanupAll();
      process.exit(0);
      return;
    }

    case "reset": {
      if (running || autoGoalRunning) {
        cancelled = true;
        activeTurnController?.abort();
        autoGoalController?.abort();
        browserBridge.failAll("The session was reset while a browser operation was active.");
        denyAllPending("Session reset; pending approvals were denied.");
        await activeOperationCompletion;
      } else {
        denyAllPending("Session reset; pending approvals were denied.");
      }
      await startNewSession();
      return;
    }
  }
}

port.on("message", (event: { data: EngineRequest }) => {
  void handle(event.data).catch(fail);
});

post({ type: "status", status: "starting" });
