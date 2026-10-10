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
import {
  Agent,
  createClient,
  createDefaultRegistry,
  createSandboxRunner,
  SkillRegistry,
  loadConfig,
  loadSystemInstruction,
  findApiKeyInEnv,
  fetchRemoteModels,
  remoteContextWindow,
  isRubyCatalogModel,
  detectProvider,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
} from "@rubyclii/cli";
import type { AgentEvent, Provider } from "@rubyclii/cli";
import type { EngineRequest, EngineResponse, ModelSummary } from "@shared/ipc";

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
/** Set by `abort`; the run loop checks it between events. */
let cancelled = false;
let running = false;

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
    { model, provider },
  );
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

    const stats = agent.getContextStats();
    post({
      type: "usage",
      inputTokens: stats.estimatedTokens,
      outputTokens: 0,
      contextWindow: stats.contextWindow,
    });
  } catch (err) {
    fail(err);
  } finally {
    running = false;
    post({ type: "status", status: cancelled ? "ready" : "ready" });
  }
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

      await buildAgent();
      post({
        type: "ready",
        workspace: process.cwd(),
        model,
        toolCount,
        skillCount,
        keySource,
      });
      post({ type: "status", status: "ready" });
      await reportModels();
      return;
    }

    case "prompt":
      await runPrompt(request.text);
      return;

    case "abort":
      cancelled = true;
      return;

    case "setModel": {
      model = request.model;
      await buildAgent();
      post({ type: "status", status: "ready" });
      return;
    }

    case "reset": {
      await buildAgent();
      post({ type: "status", status: "ready" });
      return;
    }
  }
}

port.on("message", (event: { data: EngineRequest }) => {
  void handle(event.data).catch(fail);
});

post({ type: "status", status: "starting" });
