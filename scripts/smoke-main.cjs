/**
 * Smoke test: one real turn through the whole stack.
 *
 *   npx electron scripts/smoke-main.cjs
 *
 * It exercises the real built artifacts — `out/engine/index.mjs` in a
 * `utilityProcess`, and `out/renderer` in a `BrowserWindow` — rather than
 * importing TypeScript source, so it verifies what actually ships.
 *
 * Env knobs:
 *   SMOKE_PROMPT      prompt to send    (default: a tool-free "reply OK")
 *   SMOKE_SCREENSHOT  path to write a PNG of the UI
 *   SMOKE_TIMEOUT_MS  overall budget    (default: 180000)
 */
const { runScenario } = require("./smoke-harness.cjs");

const PROMPT = process.env.SMOKE_PROMPT || "Reply with exactly: OK";
const SHOT = process.env.SMOKE_SCREENSHOT;

runScenario({
  name: "smoke",
  prompt: PROMPT,
  workspace: process.env.RUBY_DESKTOP_WORKSPACE || process.cwd(),
  screenshotPath: SHOT,
  timeoutMs: Number(process.env.SMOKE_TIMEOUT_MS || 180_000),
  hooks: {
    async onReady(_ready, api) {
      // Drive the prompt through the real path a user takes: type into the
      // Composer and press Enter. That exercises Composer -> store.send ->
      // preload -> IPC -> main -> engine, and is what puts the user's message
      // into the transcript.
      api.log(`typing prompt into the Composer: ${JSON.stringify(PROMPT)}`);
      const typed = await api.type(PROMPT);
      if (typed !== "sent") api.finish(1, `could not drive the Composer: ${typed}`);
    },

    async onIdle(state, api) {
      await api.screenshot(SHOT);
      if (!state.sawReady) return api.finish(1, "never received ready");
      if (!state.text.trim()) return api.finish(1, "turn produced no text");
      api.finish(0, "engine started, turn streamed, no errors");
    },
  },
});
