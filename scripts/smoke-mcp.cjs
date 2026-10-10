/**
 * Smoke test: MCP end to end, plus the agent output panel.
 *
 *   npx electron scripts/smoke-mcp.cjs
 *
 * This is the test that matters for "facilidade para implementar MCPs": it does
 * not stub anything. It points the engine at a real MCP server subprocess, and
 * checks that the server's tools become tools the agent can actually call.
 *
 * It writes to a throwaway ~/.rubycli directory (via RUBYCLI_HOME) so it never
 * touches the developer's real MCP configuration.
 *
 * Steps:
 *   1. add a stdio server through the UI store, backed by the fixture
 *   2. assert it connects and its tools are listed, with the mcp__<srv>__<tool> prefix
 *   3. drive a real agent turn that must call the MCP tool and see the fixture's reply
 *   4. add a server that fails to start, and assert it is reported rather than dropped
 *   5. assert the output panel received telemetry
 *
 * Env knobs:
 *   SMOKE_SCREENSHOT  path for a PNG of the MCP panel
 *   SMOKE_TIMEOUT_MS  overall budget (default: 300000)
 */
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { runScenario } = require("./smoke-harness.cjs");

const FIXTURE = path.join(__dirname, "fixtures", "echo-mcp-server.cjs");
const SERVER_NAME = "smoke_fixture";
const BAD_NAME = "smoke_broken";
const TOOL_PREFIX = `mcp__${SERVER_NAME}__`;
const SHOT = process.env.SMOKE_SCREENSHOT;

/** A throwaway agent dir so the real ~/.rubycli/mcp.json is never touched. */
const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "ruby-smoke-mcp-"));

/**
 * Redirecting RUBYCLI_HOME also redirects the config file, so the engine would
 * find no API key there. Read the real one and hand it over as an env var, which
 * the engine checks first — that way the test uses a sandboxed agent dir without
 * copying credentials into it.
 */
function realApiKey() {
  try {
    const configPath = path.join(os.homedir(), ".rubycli", "config.json");
    return JSON.parse(fs.readFileSync(configPath, "utf8")).rubyApiKey || "";
  } catch {
    return "";
  }
}

const API_KEY = process.env.RUBY_API_KEY || realApiKey();

/**
 * How to launch the fixture server.
 *
 * `process.execPath` is `electron.exe` here, not `node`, so the fixture must be
 * spawned with `ELECTRON_RUN_AS_NODE=1` — that makes the Electron binary behave as
 * a plain Node runtime. Doing it this way keeps the test free of any assumption
 * about where a standalone Node is installed.
 */
function fixtureServer(extraEnv) {
  return {
    transport: "stdio",
    command: process.execPath,
    args: [FIXTURE],
    env: { ELECTRON_RUN_AS_NODE: "1", ...extraEnv },
  };
}

const PHASE = {
  ADD: "add",
  TURN: "turn",
  BROKEN: "broken",
  DONE: "done",
};

runScenario({
  name: "mcp",
  workspace: process.env.RUBY_DESKTOP_WORKSPACE || process.cwd(),
  timeoutMs: Number(process.env.SMOKE_TIMEOUT_MS || 300_000),
  env: { RUBYCLI_HOME: SANDBOX_HOME, ...(API_KEY ? { RUBY_API_KEY: API_KEY } : {}) },
  hooks: {
    async onReady(_ready, api) {
      api.state.phase = PHASE.ADD;
      api.state.mcpEvents = [];
      api.state.toolResults = [];
      api.log(`sandbox agent dir: ${SANDBOX_HOME}`);
      api.log(`fixture: ${FIXTURE}`);
      if (!API_KEY) {
        return api.finish(1, "no Ruby API key found (env or ~/.rubycli/config.json)");
      }

      // Add through the same IPC the UI's "Add server" button uses.
      api.post({
        type: "mcp",
        action: "add",
        name: SERVER_NAME,
        config: fixtureServer(),
      });
    },

    async onMessage(message, api) {
      const { state } = api;
      // The engine reports MCP status from inside buildAgent, which runs before
      // `ready` is posted — so these must be initialised here, not in onReady.
      state.mcpEvents ??= [];
      state.toolResults ??= [];

      // MCP tools go through the same HITL gate as built-ins, which is exactly
      // what should happen: a tool from a third-party server is not more trusted
      // than a shell command. Approve it so the turn can proceed.
      if (message.type === "approvalRequest") {
        if (!message.request.toolName.startsWith(TOOL_PREFIX)) {
          return api.finish(1, `unexpected approval request for '${message.request.toolName}'`);
        }
        await new Promise((r) => setTimeout(r, 300));
        const clicked = await api.clickButton("Allow once");
        api.log(`approved MCP tool call via the modal: ${clicked}`);
        if (clicked !== "Allow once") return api.finish(1, "could not approve the MCP tool call");
        return;
      }

      if (message.type === "mcp") {
        state.mcpEvents.push(message.servers);
        const server = message.servers.find((s) => s.name === SERVER_NAME);

        if (state.phase === PHASE.ADD) {
          if (!server) {
            return api.finish(
              1,
              `fixture server missing from MCP status; saw: ${JSON.stringify(message.servers)}`,
            );
          }
          if (!server.connected) {
            return api.finish(1, `fixture server did not connect: ${server.error}`);
          }
          if (server.tools.length !== 1 || server.tools[0].name !== "echo") {
            return api.finish(
              1,
              `expected 1 tool named 'echo', got ${JSON.stringify(server.tools)}`,
            );
          }
          api.log(`fixture connected, tools: ${server.tools.map((t) => t.name).join(", ")}`);

          state.phase = PHASE.TURN;
          state.toolResults = [];
          state.text = "";
          api.log(`phase ${PHASE.TURN}: asking the agent to use the MCP tool`);
          const typed = await api.type(
            "Use the MCP tool echo with the text 'hello-from-test' and report its exact output. Do not use any other tool.",
          );
          if (typed !== "sent") api.finish(1, `could not drive the Composer: ${typed}`);
          return;
        }

        if (state.phase === PHASE.BROKEN) {
          const broken = message.servers.find((s) => s.name === BAD_NAME);
          if (!broken) {
            return api.finish(1, "a server that fails to start vanished from the status list");
          }
          if (broken.connected) {
            return api.finish(1, "a server that fails to start was reported as connected");
          }
          if (!broken.error) {
            return api.finish(1, "a failed server was reported without an error message");
          }
          api.log(`broken server reported: ${broken.error}`);

          // A failing server must not take the healthy one down with it.
          const healthy = message.servers.find((s) => s.name === SERVER_NAME);
          if (!healthy?.connected) {
            return api.finish(1, "the healthy server stopped being connected");
          }
          api.log("healthy server still connected alongside the broken one");

          state.phase = PHASE.DONE;
          if (SHOT) {
            // Open the panel so the screenshot shows the feature rather than the
            // chat behind it.
            const opened = await api.clickButton("MCP");
            api.log(`opened MCP panel: ${opened}`);
            await new Promise((r) => setTimeout(r, 400));
            const panel = await api.readDom(
              `Boolean(document.querySelector('[data-testid="mcp-panel"]'))`,
            );
            if (!panel) return api.finish(1, "the MCP panel did not render when toggled");
            api.log("MCP panel rendered");
            await api.screenshot(SHOT);
          }
          return api.finish(0, "MCP add, tool call, failure reporting and output panel verified");
        }
        return;
      }

      if (message.type === "metric") {
        state.metrics = (state.metrics || 0) + 1;
        return;
      }

      if (message.type === "event" && message.event.type === "tool_result") {
        state.toolResults.push({ name: message.event.name, result: message.event.result });
      }
    },

    async onIdle(state, api) {
      if (state.phase !== PHASE.TURN) return;

      const mcpCall = state.toolResults.find((r) => r.name.startsWith(TOOL_PREFIX));
      if (!mcpCall) {
        return api.finish(
          1,
          `the agent never called the MCP tool; tool results: ${JSON.stringify(
            state.toolResults.map((r) => r.name),
          )}`,
        );
      }
      // The marker proves the value came back from the fixture subprocess and not
      // from the model inventing a plausible answer.
      if (!mcpCall.result.includes("fixture:echo:hello-from-test")) {
        return api.finish(1, `MCP tool returned unexpected output: ${mcpCall.result}`);
      }
      api.log(`MCP tool round-trip confirmed: ${JSON.stringify(mcpCall.result.slice(0, 120))}`);

      if (!state.metrics || state.metrics === 0) {
        return api.finish(1, "the output panel received no telemetry during a real turn");
      }
      api.log(`output panel received ${state.metrics} metric lines`);

      state.phase = PHASE.BROKEN;
      api.log(`phase ${PHASE.BROKEN}: adding a server that cannot start`);
      api.post({
        type: "mcp",
        action: "add",
        name: BAD_NAME,
        config: fixtureServer({ MCP_FIXTURE_FAIL: "1" }),
      });
    },
  },
});

// Best-effort cleanup; the app has already exited by the time this runs.
process.on("exit", () => {
  try {
    fs.rmSync(SANDBOX_HOME, { recursive: true, force: true });
  } catch {
    /* nothing to clean */
  }
});
