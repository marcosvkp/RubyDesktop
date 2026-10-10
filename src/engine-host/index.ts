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
import {
  Agent,
  createClient,
  createDefaultRegistry,
  createSandboxRunner,
  SkillRegistry,
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
  clearGoal,
  // MCP: servers are configured in ~/.rubycli/mcp.json and their tools are merged
  // into the same registry the built-in tools live in.
  McpManager,
  probeMcpServer,
  loadMcpConfig,
  saveMcpServer,
  removeMcpServer,
  AGENT_DIR,
} from "@rubyclii/cli";
import type {
  AgentEvent,
  ConfirmFn,
  McpClientOpts,
  McpServerConfig,
  ObservabilityEvent,
  PermissionMode,
  Provider,
} from "@rubyclii/cli";
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
} from "@shared/ipc";

// `process.parentPort` is added by Electron's utilityProcess and is not part of
// the standard Node typings.
const port = (process as unknown as { parentPort: Electron.ParentPort }).parentPort;

function post(message: EngineResponse): void {
  port.postMessage(message);
}

/** Report an unexpected failure without killing the process. */
function fail(err: unknown): void {
  post({ type: "error", message: err instanceof Error ? err.message : String(err) });
}

// --- Session state ----------------------------------------------------------

let model = DEFAULT_MODEL;
let baseUrl = DEFAULT_BASE_URL;
let apiKey = "";
let keySource = "unknown";
let provider: Provider = "rubycli";
let agent: Agent | undefined;
let toolCount = 0;
let skillCount = 0;
let permissionMode: PermissionMode = "normal";
/** Set by `abort`; the run loop checks it between events. */
let cancelled = false;
let running = false;

/** Tool-call grants: global (config.json) and per-project (project-permissions/). */
let globalAllowSet = new Set<string>();
let projectAllowSet = new Set<string>();
let denyPatterns: string[] = [];
/** Built from the merged `permissions.ask` patterns; forces a prompt regardless. */
let forcesConfirmation: (toolName: string, args: Record<string, unknown>) => boolean = () => false;

// --- MCP --------------------------------------------------------------------

let mcp: McpManager | undefined;

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
    : { transport: "stdio", command: draft.command, args: draft.args, env: draft.env };
}

/**
 * Connects every configured MCP server. Does not report status: the caller must
 * register the tools first, or the UI would briefly see servers with no tools.
 */
async function connectMcp(): Promise<void> {
  // Drop the previous generation first: a reconnect must not leave orphaned
  // subprocesses behind, and the old manager's tools are about to be replaced.
  if (mcp) {
    await mcp.disconnectAll().catch(() => {});
    mcp = undefined;
  }

  const config = await loadMcpConfig(AGENT_DIR);
  if (!config || Object.keys(config.mcpServers).length === 0) return;

  mcp = await McpManager.create(config, mcpOpts());
}

/** Reports MCP state. Call after connecting or after tools are registered. */
function postMcpStatus(): void {
  const servers: McpServerSummary[] = (mcp?.statuses ?? []).map((status) => ({
    name: status.rawName,
    toolPrefix: status.sanitisedName,
    connected: status.connected,
    error: status.error,
    tools: status.tools.map((tool) => ({ name: tool.name, description: tool.description })),
  }));
  post({ type: "mcp", servers });
}

async function handleMcp(request: Extract<EngineRequest, { type: "mcp" }>): Promise<void> {
  switch (request.action) {
    case "refresh":
      // A full rebuild: the tools have to be registered into the registry the
      // agent actually holds, so reconnecting without rebuilding would leave the
      // agent calling tools that no longer exist.
      await buildAgent();
      post({ type: "status", status: "ready" });
      return;

    case "add":
      await saveMcpServer(AGENT_DIR, request.name, toServerConfig(request.config));
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
          tools: status.tools.map((tool) => ({ name: tool.name, description: tool.description })),
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
function onObservability(event: ObservabilityEvent): void {
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
      line = {
        kind: "compact",
        trigger: event.trigger,
        detail: `removed ${event.messagesRemoved} messages`,
      };
      break;
    case "compact_failed":
      line = { kind: "compact", trigger: event.trigger, detail: `failed: ${event.error}` };
      break;
    default:
      // Everything else (call starts, context snapshots, threshold notices) is
      // either redundant with a line above or too noisy to be worth a row.
      return;
  }
  post({ type: "metric", line });
}

// --- Approval gate ----------------------------------------------------------

interface PendingApproval {
  settle: (decision: ApprovalDecision) => void;
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

/**
 * How long the engine waits for a human before denying.
 *
 * A GUI must never hang a turn forever: if the window is closed or the renderer
 * crashes, the tool call is denied rather than holding the agent loop open.
 */
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

/** The single most useful argument to show a human for a given tool. */
function approvalDetail(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "bash") return String(args.command ?? "");
  if (toolName === "write" || toolName === "edit" || toolName === "multi_edit") {
    return String(args.file_path ?? "");
  }
  return JSON.stringify(args, null, 2);
}

/** Asks the renderer, then waits for the answer. */
function requestApproval(toolName: string, args: Record<string, unknown>): Promise<ApprovalDecision> {
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
const confirmFn: ConfirmFn = async (toolName, args) => {
  const allowSet = new Set([...globalAllowSet, ...projectAllowSet]);
  // `interactive: true` — a modal is the GUI's equivalent of a TTY prompt.
  const decision = decideConfirmation(allowSet, denyPatterns, toolName, args, true);
  if (decision === "allow") return "allow";
  if (decision === "deny") return "deny";
  return requestApproval(toolName, args);
};

/** Persists a grant at the scope the user chose. */
async function persistGrant(key: string, scope: ApprovalScope): Promise<void> {
  if (scope === "global") {
    globalAllowSet.add(key);
    const cfg = await loadConfig();
    await saveConfig({ permissions: { ...cfg.permissions, allow: [...globalAllowSet] } });
  } else if (scope === "project") {
    projectAllowSet.add(key);
    await saveProjectPermissions(process.cwd(), [...projectAllowSet]);
  }
}

/** Reports the merged grant lists so the UI can show what is pre-approved. */
function postGrants(): void {
  post({ type: "grants", grants: { project: [...projectAllowSet], global: [...globalAllowSet] } });
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
  let effectiveScope = scope;
  if (decision !== "allow" || scope === "once") {
    effectiveScope = "once";
  } else if (pending.neverPersist) {
    effectiveScope = "once";
    post({
      type: "error",
      message: `'${pending.toolName}' matches the built-in blocklist, so it was allowed once but not remembered.`,
    });
  }

  if (effectiveScope !== "once") {
    const key =
      grantKey === "toolWide"
        ? pending.grantKeys.toolWide
        : grantKey === "mcpServerWide"
          ? pending.grantKeys.mcpServerWide
          : pending.grantKeys.exact;
    if (key) {
      await persistGrant(key, effectiveScope);
      postGrants();
    } else {
      effectiveScope = "once";
    }
  }

  pending.settle(decision);
  post({ type: "approvalResolved", id, decision, scope: effectiveScope });
}

/** Denies every in-flight approval — used on abort, reset and end of turn. */
function denyAllPending(reason: string): void {
  if (pendingApprovals.size === 0) return;
  for (const [id, pending] of [...pendingApprovals]) {
    post({ type: "approvalResolved", id, decision: "deny", scope: "once" });
    pending.settle("deny");
  }
  pendingApprovals.clear();
  post({ type: "error", message: reason });
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
  if (fromEnv) return { key: fromEnv.value, source: `${fromEnv.name} (environment)` };

  const config = await loadConfig();
  if (config.rubyApiKey) return { key: config.rubyApiKey, source: "~/.rubycli/config.json" };

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
  if (isRubyCatalogModel(name, { hasRubyKey: apiKey.length > 0 })) return "rubycli";
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

/** Builds the agent for the current model. Called on start, model change and reset. */
async function buildAgent(): Promise<void> {
  provider = resolveProviderFor(model);

  const client = createClient(model, apiKey, {
    includeUsage: true,
    provider,
    baseUrl,
  });

  const config = await loadConfig();
  const runner = createSandboxRunner(config.sandbox ?? "auto", process.cwd());
  const tools = createDefaultRegistry(model, runner);
  const skills = new SkillRegistry();
  await skills.discover(process.cwd());

  // MCP tools join the same registry as the built-ins, which is what makes an MCP
  // server indistinguishable from a native tool from the agent's point of view.
  // A failing server is reported and skipped; it never blocks the agent.
  await connectMcp();
  await mcp?.registerTools(tools).catch((err: unknown) => {
    post({ type: "error", message: `MCP tools unavailable: ${err instanceof Error ? err.message : String(err)}` });
  });
  postMcpStatus();

  const systemInstruction = await loadSystemInstruction();

  toolCount = tools.all().length;
  skillCount = skills.list().length;

  agent = new Agent(
    client,
    tools,
    skills,
    systemInstruction,
    undefined,
    undefined,
    // `model` is required here: the Agent derives its context window from the
    // model name, and the client it was handed does not expose one. Omitting it
    // silently falls back to 100k, which would make auto-compaction fire at 75k
    // instead of 75% of the model's real window.
    { model, provider, onObservability },
  );

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

  const summaries: ModelSummary[] = models.map((m) => ({
    id: m.id,
    label: m.display_name ?? m.id,
    contextWindow: remoteContextWindow(m),
    supportsReasoning: m.supports_reasoning,
    supportsVision: m.supports_vision,
  }));
  post({ type: "models", models: summaries });

  // If the configured model is not in this account's catalog, fall back to the
  // first entry rather than failing on the first turn with a 404.
  if (summaries.length > 0 && !summaries.some((m) => m.id === model)) {
    post({
      type: "error",
      message: `Model '${model}' is not available for this key; using '${summaries[0].id}'.`,
    });
    model = summaries[0].id;
    await buildAgent();
    post({ type: "status", status: "ready" });
  }
}

/** Reports the current context usage so the meter stays live between turns. */
function reportUsage(): void {
  if (!agent) return;
  const stats = agent.getContextStats();
  post({
    type: "usage",
    inputTokens: stats.estimatedTokens,
    outputTokens: 0,
    contextWindow: stats.contextWindow,
  });
}

/** Runs one turn, streaming every engine event to the UI. */
async function runPrompt(text: string): Promise<void> {
  if (!agent) {
    post({ type: "error", message: "Engine is not ready yet." });
    return;
  }
  if (running) {
    post({ type: "error", message: "A turn is already in progress." });
    return;
  }

  running = true;
  cancelled = false;
  post({ type: "status", status: "busy" });

  try {
    for await (const event of agent.run(text)) {
      if (cancelled) break;
      post({ type: "event", event: event as AgentEvent });
    }
  } catch (err) {
    fail(err);
  } finally {
    // A turn that ends with an unanswered approval would leave the modal on
    // screen forever; settle them before reporting the turn as finished.
    denyAllPending("Turn ended with pending approvals; they were denied.");
    running = false;
    reportUsage();
    post({ type: "status", status: "ready" });
  }
}

/** Compacts the conversation on demand (`/compact`). */
async function runCompact(): Promise<void> {
  if (!agent) {
    post({ type: "error", message: "Engine is not ready yet." });
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

async function handleGoal(request: Extract<EngineRequest, { type: "goal" }>): Promise<void> {
  const cwd = process.cwd();
  switch (request.action) {
    case "get":
      break;
    case "set":
      await setGoal(request.text, cwd);
      break;
    case "note":
      await noteGoal(request.text, cwd);
      break;
    case "status":
      await setGoalStatus(request.status, cwd);
      break;
    case "clear":
      await clearGoal(cwd);
      break;
  }
  await reportGoal();
}

// --- Message loop -----------------------------------------------------------

async function handle(request: EngineRequest): Promise<void> {
  switch (request.type) {
    case "hello": {
      post({ type: "status", status: "starting" });
      const creds = await resolveCredentials();
      apiKey = creds.key;
      keySource = creds.source;

      const config = await loadConfig();
      baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
      model = config.model ?? DEFAULT_MODEL;

      if (!apiKey) {
        post({
          type: "fatal",
          message:
            "No RubyCLI API key found. Set RUBY_API_KEY, or run the `ruby` CLI once to configure one.",
        });
        return;
      }

      await loadPermissions();

      await buildAgent();
      post({
        type: "ready",
        workspace: process.cwd(),
        model,
        toolCount,
        skillCount,
        keySource,
        permissionMode,
      });
      post({ type: "status", status: "ready" });
      postGrants();
      await reportGoal();
      await reportModels();
      return;
    }

    case "prompt":
      await runPrompt(request.text);
      return;

    case "abort":
      cancelled = true;
      denyAllPending("Turn aborted; pending approvals were denied.");
      return;

    case "setModel": {
      model = request.model;
      await buildAgent();
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
      await handleApprovalResponse(request.id, request.decision, request.scope);
      return;
    }

    case "compact":
      await runCompact();
      return;

    case "goal":
      await handleGoal(request);
      return;

    case "mcp":
      await handleMcp(request);
      return;

    case "shutdown": {
      // Close MCP child processes before the process is torn down, otherwise they
      // outlive the app on Windows, where nothing reaps a detached grandchild.
      await mcp?.disconnectAll().catch(() => {});
      mcp = undefined;
      denyAllPending("Engine shutting down; pending approvals were denied.");
      process.exit(0);
      return;
    }

    case "reset": {
      denyAllPending("Session reset; pending approvals were denied.");
      await buildAgent();
      post({ type: "status", status: "ready" });
      reportUsage();
      return;
    }
  }
}

port.on("message", (event: { data: EngineRequest }) => {
  void handle(event.data).catch(fail);
});

post({ type: "status", status: "starting" });
