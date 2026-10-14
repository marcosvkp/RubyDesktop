/**
 * Smoke test: the human-in-the-loop permission gate, the goal command and compaction.
 *
 *   npx electron scripts/smoke-permissions.cjs
 *
 * This is the test for the gap M1 shipped with: the engine's `confirmFn` was never
 * wired, so every tool call that required confirmation was silently denied with no
 * prompt. Nothing in the UI said so, which made it a security-relevant bug in both
 * directions — the user lost the ability to approve work, and a "Blocked:" result
 * looked like a tool failure rather than a decision.
 *
 * It drives two real turns against the live provider:
 *
 *   1. a mutating `bash` command the user ALLOWS through the modal — the call must
 *      reach the tool and come back with real output;
 *   2. a second mutating command the user DENIES through the modal — the call must
 *      come back as "Blocked:", proving the denial path is wired too.
 *
 * Then it exercises `/goal` and `/compact` and asserts the rendered DOM.
 *
 * Env knobs:
 *   SMOKE_SCREENSHOT        path for the approval-modal screenshot
 *   SMOKE_SCREENSHOT_GOAL   path for the goal-banner screenshot
 *   SMOKE_TIMEOUT_MS        overall budget (default: 300000)
 */
const { runScenario } = require("./smoke-harness.cjs");
const fs = require("node:fs");
const path = require("node:path");
const { approvalGrantScope, confirmationDecision } = require("../out/main/approval-policy.js");

// A unique target per run: the command must be mutating (so the gate opens) and
// must not collide with a previous run (so a re-run still proves execution).
//
// The names are deliberately neutral. An earlier version used `.ruby-smoke-deny-*`,
// and the model — which can read this very file — worked out that creating it
// would invalidate the test and refused to run the command. The test then failed
// for a reason that had nothing to do with the permission gate. Nothing in the
// prompt should hint that the command is a test fixture.
const STAMP = Date.now().toString(36);
const ALLOW_DIR = `.build-cache-a${STAMP}`;
const DENY_DIR = `.build-cache-b${STAMP}`;
const GOAL_TEXT = `Keep the permission gate honest (${STAMP})`;
const AUTO_GOAL_TEXT = "Reply with exactly GOAL_DONE and nothing else.";

const PROMPT_ALLOW = `Create the directory ${ALLOW_DIR} in the workspace using the bash tool, then report the command output verbatim.`;
const PROMPT_DENY = `Create the directory ${DENY_DIR} in the workspace using the bash tool, then report the command output verbatim.`;

const SHOT_MODAL = process.env.SMOKE_SCREENSHOT;
const SHOT_GOAL = process.env.SMOKE_SCREENSHOT_GOAL;
const WORKSPACE = process.env.RUBY_DESKTOP_WORKSPACE || process.cwd();

/** Phases, in order. Each one is advanced by a specific engine message. */
const PHASE = {
  ALLOW: "allow-turn",
  DENY: "deny-turn",
  GOAL: "goal",
  AUTO_GOAL_SETUP: "auto-goal-setup",
  AUTO_GOAL: "auto-goal",
  COMPACT_STARTING: "compact-starting",
  COMPACT: "compact",
  DONE: "done",
};

runScenario({
  name: "perm",
  workspace: WORKSPACE,
  timeoutMs: Number(process.env.SMOKE_TIMEOUT_MS || 300_000),
  hooks: {
    async onReady(ready, api) {
      try {
        await assertPermissionPolicy();
      } catch (err) {
        return api.finish(1, `permission policy checks failed: ${err.stack || err}`);
      }
      if (ready.permissionMode !== "normal") {
        return api.finish(
          1,
          `expected permissionMode=normal, got ${ready.permissionMode}`,
        );
      }
      api.state.phase = PHASE.ALLOW;
      api.state.toolResults = [];
      api.state.goalSeen = null;
      api.log(
        `phase ${PHASE.ALLOW}: asking for a mutating command (mkdir ${ALLOW_DIR})`,
      );
      const typed = await api.type(PROMPT_ALLOW);
      if (typed !== "sent")
        api.finish(1, `could not drive the Composer: ${typed}`);
    },

    async onMessage(message, api) {
      const { state } = api;

      // --- The modal itself ---------------------------------------------------
      if (message.type === "approvalRequest") {
        // Let React paint the modal before inspecting it.
        await new Promise((r) => setTimeout(r, 400));

        const modal = await api.readDom(`(() => {
          const dialog = document.querySelector('[role="dialog"]');
          if (!dialog) return { present: false };
          return {
            present: true,
            title: dialog.querySelector("h2")?.textContent || "",
            text: dialog.innerText,
            buttons: [...dialog.querySelectorAll("button")].map((b) => b.textContent.trim()),
          };
        })()`);

        if (!modal.present) {
          return api.finish(
            1,
            "engine asked for approval but no modal was rendered",
          );
        }
        api.log(`modal buttons: ${modal.buttons.join(" | ")}`);
        if (!modal.text.includes(message.request.toolName)) {
          return api.finish(
            1,
            `modal does not name the tool '${message.request.toolName}'`,
          );
        }
        if (
          !modal.buttons.includes("Permitir uma vez") ||
          !modal.buttons.includes("Negar")
        ) {
          return api.finish(
            1,
            "modal is missing the Permitir uma vez / Negar buttons",
          );
        }

        const phase = state.phase;
        if (phase === PHASE.ALLOW) {
          if (SHOT_MODAL) await api.screenshot(SHOT_MODAL);
          const clicked = await api.clickButton("Permitir uma vez");
          api.log(`clicked: ${clicked}`);
          if (clicked !== "Permitir uma vez")
            return api.finish(1, "could not click Permitir uma vez");
        } else if (phase === PHASE.DENY) {
          const clicked = await api.clickButton("Negar");
          api.log(`clicked: ${clicked}`);
          if (clicked !== "Negar")
            return api.finish(1, "could not click Negar");
        } else {
          return api.finish(
            1,
            `unexpected approval request during phase ${phase}`,
          );
        }
        return;
      }

      // --- Goal round-trip ----------------------------------------------------
      if (message.type === "goal" && state.phase === PHASE.GOAL) {
        if (!message.goal) return api.finish(1, "goal was not created");
        if (message.goal.text !== GOAL_TEXT) {
          return api.finish(
            1,
            `goal text mismatch: ${JSON.stringify(message.goal.text)}`,
          );
        }
        if (message.goal.status !== "active") {
          return api.finish(
            1,
            `expected an active goal, got ${message.goal.status}`,
          );
        }
        api.log(`goal stored: ${message.goal.text}`);

        // The banner must actually render — a goal the user cannot see is not a
        // feature. Query the banner element itself rather than `body.innerText`:
        // the transcript also echoes the `/goal <text>` the user typed, so a
        // whole-body search passes even when the banner is missing entirely.
        await new Promise((r) => setTimeout(r, 400));
        const banner = await api.readDom(`(() => {
          const el = document.querySelector('[data-testid="goal-banner"]');
          if (!el) return { present: false };
          return {
            present: true,
            text: el.innerText,
            active: el.innerText.toLowerCase().includes("goal"),
          };
        })()`);
        if (!banner.present)
          return api.finish(1, "goal banner did not render in the DOM");
        if (!banner.text.includes(GOAL_TEXT)) {
          return api.finish(
            1,
            `goal banner shows the wrong text: ${JSON.stringify(banner.text)}`,
          );
        }
        api.log("goal banner rendered");

        state.phase = PHASE.AUTO_GOAL_SETUP;
        api.log(
          `phase ${PHASE.AUTO_GOAL_SETUP}: set up a bounded automatic run`,
        );
        await api.type(`/goal ${AUTO_GOAL_TEXT}`);
        return;
      }

      if (message.type === "goal" && state.phase === PHASE.AUTO_GOAL_SETUP) {
        if (!message.goal || message.goal.text !== AUTO_GOAL_TEXT) {
          return api.finish(1, "automatic goal was not saved");
        }
        await new Promise((r) => setTimeout(r, 300));
        state.phase = PHASE.AUTO_GOAL;
        state.autoGoalStarted = false;
        state.autoGoalFinished = false;
        const clicked = await api.clickButton("Continuar");
        if (clicked !== "Continuar") {
          return api.finish(
            1,
            "automatic goal continue control was not available",
          );
        }
        api.log("started automatic goal from the banner");
        return;
      }

      if (message.type === "goalAuto" && state.phase === PHASE.AUTO_GOAL) {
        if (message.running) {
          state.autoGoalStarted = true;
          api.log("automatic goal reported running");
          return;
        }
        if (!state.autoGoalStarted || !state.autoGoalFinished) {
          return api.finish(
            1,
            "automatic goal stopped without a bounded result",
          );
        }
        state.phase = PHASE.COMPACT_STARTING;
        api.log("automatic goal is idle; waiting for the engine ready state");
        return;
      }

      if (
        message.type === "status" &&
        message.status === "ready" &&
        state.phase === PHASE.COMPACT_STARTING
      ) {
        state.phase = PHASE.COMPACT;
        api.log(`phase ${PHASE.COMPACT}: /compact`);
        await api.type("/compact");
        return;
      }

      if (message.type === "goal" && state.phase === PHASE.AUTO_GOAL) {
        if (
          !message.goal ||
          !["complete", "blocked"].includes(message.goal.status)
        )
          return;
        if (message.goal.rounds < 1) {
          return api.finish(1, "automatic goal did not record its first round");
        }
        if (message.goal.status === "blocked" && !message.goal.blockedReason) {
          return api.finish(1, "blocked goal did not explain why it stopped");
        }
        state.autoGoalFinished = true;
        api.log(
          `automatic goal stopped safely with status=${message.goal.status}, rounds=${message.goal.rounds}/${message.goal.maxRounds}`,
        );
        return;
      }

      // --- Compaction ---------------------------------------------------------
      if (message.type === "compacting" && state.phase === PHASE.COMPACT) {
        if (message.active) {
          state.sawCompacting = true;
          return;
        }
        if (!state.sawCompacting)
          return api.finish(1, "never saw compaction start");
        api.log("compaction finished");

        state.phase = PHASE.DONE;
        if (SHOT_GOAL) await api.screenshot(SHOT_GOAL);
        return api.finish(
          0,
          "approval allow+deny, goal auto-continuation and compact all verified",
        );
      }

      // --- Tool results -------------------------------------------------------
      if (message.type === "event" && message.event.type === "tool_result") {
        state.toolResults.push({
          name: message.event.name,
          result: message.event.result,
        });
      }
    },

    async onIdle(state, api) {
      if (state.phase === PHASE.ALLOW) {
        const blocked = state.toolResults.filter((r) =>
          r.result.startsWith("Blocked:"),
        );
        if (blocked.length > 0) {
          return api.finish(
            1,
            `allowed call was still blocked: ${blocked[0].result}`,
          );
        }
        const ran = state.toolResults.find((r) => r.name === "bash");
        if (!ran) return api.finish(1, "the allowed bash call never executed");
        api.log(
          `allow path executed: ${JSON.stringify(ran.result.slice(0, 120))}`,
        );

        // The strongest available evidence: the command's side effect is on disk.
        // A tool that "succeeded" without doing anything would pass a weaker check.
        const created = fs.existsSync(path.join(WORKSPACE, ALLOW_DIR));
        if (!created) {
          return api.finish(
            1,
            `the allowed command reported no block but ${ALLOW_DIR} was not created`,
          );
        }
        api.log(`allow path side effect confirmed: ${ALLOW_DIR} exists`);

        state.phase = PHASE.DENY;
        state.toolResults = [];
        state.text = "";
        api.log(
          `phase ${PHASE.DENY}: asking for a command that will be denied`,
        );
        const typed = await api.type(PROMPT_DENY);
        if (typed !== "sent")
          api.finish(1, `could not drive the Composer: ${typed}`);
        return;
      }

      if (state.phase === PHASE.DENY) {
        const blocked = state.toolResults.find((r) =>
          r.result.startsWith("Blocked:"),
        );
        if (!blocked) {
          return api.finish(
            1,
            `denied call was not reported as blocked; results: ${JSON.stringify(state.toolResults)}`,
          );
        }
        api.log(
          `deny path reported: ${JSON.stringify(blocked.result.slice(0, 120))}`,
        );

        // And the denial must have actually prevented the side effect.
        if (fs.existsSync(path.join(WORKSPACE, DENY_DIR))) {
          return api.finish(1, `the denied command still created ${DENY_DIR}`);
        }
        api.log(
          `deny path side effect correctly absent: ${DENY_DIR} does not exist`,
        );

        state.phase = PHASE.GOAL;
        api.log(`phase ${PHASE.GOAL}: /goal`);
        const typed = await api.type(`/goal ${GOAL_TEXT}`);
        if (typed !== "sent")
          api.finish(1, `could not drive the Composer: ${typed}`);
        return;
      }
    },
  },
});

/** Pure policy regression checks; no dangerous command is ever executed here. */
async function assertPermissionPolicy() {
  const {
    buildPermissionSources,
    decideConfirmation,
    matchesNeverAutoApprove,
  } = await import("@rubyclii/cli");

  const repositorySettings = {
    permissions: {
      allow: ["bash:*"],
      ask: ["write:*"],
      deny: ["edit:*"],
    },
  };
  const sources = buildPermissionSources({}, repositorySettings, {});
  if (sources.globalAllowSet.size !== 0 || sources.projectAllowSet.size !== 0) {
    throw new Error("repository-shipped allow rules became trusted grants");
  }
  if (!sources.askPatterns.includes("write:*") || !sources.denyPatterns.includes("edit:*")) {
    throw new Error("safe restrictive repository rules were not retained");
  }
  const repoGrantDecision = decideConfirmation(
    new Set([...sources.globalAllowSet, ...sources.projectAllowSet]),
    sources.denyPatterns,
    "bash",
    { command: "mkdir harmless-smoke-directory" },
    true,
  );
  if (repoGrantDecision !== "ask") {
    throw new Error(`repository allow unexpectedly skipped confirmation (${repoGrantDecision})`);
  }

  const dangerous = { command: "rm -rf /" };
  if (!matchesNeverAutoApprove("bash", dangerous)) {
    throw new Error("catastrophic command was not recognized by the approval blocklist");
  }
  const dangerousDecision = confirmationDecision(
    true,
    decideConfirmation(new Set(["bash:*"]), [], "bash", dangerous, true),
  );
  if (dangerousDecision !== "ask") {
    throw new Error("a global bash grant bypassed the catastrophic approval prompt");
  }
  if (approvalGrantScope("allow", "global", true) !== "once") {
    throw new Error("a hand-approved catastrophic command could persist a grant");
  }
  console.log("[perm] policy verified: repository grants ignored; dangerous grant prompts and remains one-time");
}

// The test creates unique throwaway paths; clean them even when a smoke phase fails.
process.on("exit", () => {
  for (const target of [ALLOW_DIR, DENY_DIR]) {
    try {
      fs.rmSync(path.join(WORKSPACE, target), { recursive: true, force: true });
    } catch {
      /* The run may not have created it or the workspace may already be unavailable. */
    }
  }
});
