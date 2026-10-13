# AGENTS.md

This file provides guidance to agents working in this repository. It is the
machine-facing companion to [`CONTEXT.md`](CONTEXT.md) (what is still missing) and
[`PLANO.md`](PLANO.md) (the plan and its rationale, in Portuguese).

**Before starting work, read [`CONTEXT.md`](CONTEXT.md).** It lists the known gaps,
the open decisions, and the traps — several of which cost real time to find.

## Project Overview

Ruby Desktop — an Electron desktop agent app connected to the Ruby provider
(`https://app.rubycli.cloud`). It is a **separate repository** from the engine.

```
G:\VSCodeProjects\RubyCLI        # the engine — @rubyclii/cli (MIT, TypeScript)
G:\VSCodeProjects\RubyDesktop    # this repo — the Electron shell
```

Stack: Electron 44, React 19, Tailwind v4, zustand 5, TypeScript 6, Vite 7.

## The Two-Repo Relationship

This is the thing most likely to trip you up.

- The Desktop consumes the engine as a **published package**: `"@rubyclii/cli": "file:../RubyCLI"`.
  npm creates a junction, so edits to the engine are visible immediately — but its
  `dist/` is **not** rebuilt for you.
- **After changing anything in RubyCLI, run `npm run build` there.** Otherwise
  `dist/lib.d.ts` goes stale and the Desktop's typecheck fails with
  `has no exported member 'X'`, which looks like a Desktop bug and is not.
- The engine is the right place for anything about _how the agent works_
  (tools, permissions policy, MCP, compaction, goals). This repo is for _how it is
  presented and hosted_.
- Keep `RubyCLI`'s own `AGENTS.md` conventions in mind when editing it: it has
  layering rules (`tools/` never imports `core/`), a Prettier/ESLint gate, and a
  vitest suite that must stay green.

## Commands

```bash
npm start              # run the built app (electron-vite preview)
npm run dev            # same, with renderer hot reload — use this while iterating
npm run build          # typecheck + engine bundle + main/preload/renderer
npm run build:engine   # engine bundle only (faster loop when only the host changed)
npm run typecheck      # both sides: typecheck:node + typecheck:web
```

`npm run build` is required before testing: `out/` is what runs, and it goes stale
silently. There is no test runner — verification is the smoke suite (below).

## Architecture

Three processes, and the boundaries between them are load-bearing.

```
main process (Electron, CJS)          src/main/
   │  owns the window, the embedded browser, and the engine's lifetime
   │
   ├── utilityProcess.fork ─────────► engine host (plain Node, ESM)   src/engine-host/
   │      no Electron access, no Chromium; speaks only the IPC contract
   │
   └── BrowserWindow ───────────────► renderer (Chromium, sandboxed)  src/renderer/
          no Node, no filesystem; gets `window.ruby` from the preload
```

**`src/shared/ipc.ts` is the single contract.** It defines `EngineRequest`
(main → engine), `EngineResponse` (engine → main), `RubyDesktopApi` (what the
preload exposes), and the `IPC` channel-name map. Add a message there first, then
wire it on both sides. Never let a channel name drift — that is why they live in
one object.

### Why the engine is a separate process

A turn is long-running and CPU/IO heavy; in the main process it would block the UI
and take the app down if it threw. It is also plain Node on purpose: it wants a real
`process.cwd()` (the file tools use it for path containment) and must stay free of
Chromium so it could run under any supervisor.

### Why there are two Vite configs

`@rubyclii/cli` is **ESM-only**, so the engine bundle must be ESM. Main, preload and
renderer stay CJS. Vite cannot mix formats in one config, hence
`vite.engine.config.ts` alongside `electron.vite.config.ts`. The engine config also
**bundles** its dependencies rather than externalising them, so the shipped app does
not need `node_modules` for the engine.

`src/main/browser.ts` and `src/main/browser-service.ts` are separate main entries so
the smoke tests can `require` the exact implementation the app runs. A copy in the
test would be free to drift, and the drift would look like a passing test.

### The renderer must never import the engine at runtime

`src/shared/ipc.ts` uses `import type { AgentEvent } from "@rubyclii/cli"`. That is
erased at build time. Runtime imports would pull the whole engine — and its Node
dependencies — into the browser bundle. Types only, always.

## Security Invariants

These are deliberate and should not be relaxed without a clear reason.

- **Renderer is untrusted UI**: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`. Everything it can do is enumerated on `window.ruby` by the
  preload; the raw `IpcRendererEvent` is never forwarded (it exposes `sender`).
- **Renderer CSP is `connect-src 'none'`.** The UI never fetches anything itself;
  all network access belongs to the engine, which keeps the API key out of the
  browser context.
- **Permission grants are read only from user-controlled storage** — global
  `~/.rubycli/config.json` and per-project
  `~/.rubycli/project-permissions/<hash>.json`. A repository-shipped
  `.rubycli/settings.json` may carry `ask`/`deny` (restrictive, safe) but its
  `allow` list is **ignored** (GHSA-3g98-ffw6-87mg). Do not "fix" this by reading
  project `allow` entries.
- **The catastrophic blocklist is never persisted as a grant.** A call matching
  recursive `rm /`, `curl | sh` or a fork bomb can be approved once by hand, but
  never remembered — an "always allow" there would disable the gate permanently.
- **Markdown renders without raw HTML** (no `rehype-raw`). Assistant text is
  untrusted: it can quote a web page or a workspace file.
- **The browser accepts only `http`/`https`.** `file://` would let a page read the
  local disk through the browser. The view has no preload, no Node, and its own
  session partition.
- **The approval gate must always settle.** The engine blocks a tool call on the
  renderer's answer; a timeout, abort, reset, end-of-turn and shutdown all resolve
  it. A path that leaves it pending hangs the turn forever.

## Source Structure

```
src/
  shared/ipc.ts          # THE contract: requests, responses, API surface, channels
  main/
    index.ts             # window lifecycle, IPC wiring, engine spawn/kill
    browser.ts           # WebContentsView + CDP driver
    browser-service.ts   # browser RPC handling (separate entry, so tests share it)
  preload/index.ts       # the only bridge; enumerates `window.ruby`
  engine-host/
    index.ts             # agent construction, approvals, goals, MCP, metrics
    browser-tools.ts     # browser_* tools — thin proxies that RPC into main
  renderer/src/
    store.ts             # zustand store; the single consumer of engine messages
    components/          # ChatView, Markdown, ApprovalModal, GoalBanner,
                         # McpPanel, OutputPanel, BrowserPanel, Composer, Sidebar…
scripts/
  smoke-harness.cjs      # shared bootstrap for every smoke test
  smoke-*.cjs            # one per feature area
  fixtures/              # MCP server fixture, browser fixture pages
```

## Conventions

- **Comments explain _why_, not _what_.** Several files carry a paragraph at the top
  saying what the module is for and what it must not do. Match that.
- **Design tokens come from the site.** `src/renderer/src/styles/theme.css` holds the
  Ruby palette (`--primary: #de0068`, `--background: #050304`, …). Use the semantic
  classes (`bg-page`, `text-muted-foreground`, `border-line`), not raw hex.
- **`options.model` must be passed to `new Agent(...)`.** The Agent derives its
  context window from the model name; omitting it silently falls back to 100k, so
  auto-compaction fires at 75k instead of 75% of the real window.
- **Markdown is memoised on its text.** The store rebuilds its item array on every
  streamed token, so without memoisation every finished message re-parses on each
  new one.

## Testing & Verification

There is no unit-test framework. Verification is the Electron smoke suite, which
runs the **built artifacts** against the live provider:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
.\node_modules\electron\dist\electron.exe scripts/smoke-main.cjs
.\node_modules\electron\dist\electron.exe scripts/smoke-permissions.cjs
.\node_modules\electron\dist\electron.exe scripts/smoke-mcp.cjs
.\node_modules\electron\dist\electron.exe scripts/smoke-browser.cjs
.\node_modules\electron\dist\electron.exe scripts/smoke-markdown.cjs
.\node_modules\electron\dist\electron.exe scripts/smoke-session-history.cjs
```

All six must end with `RESULT PASS` and **exit code 0**. Run `npm run build` first.

**When you add an IPC channel, wire it in `scripts/smoke-harness.cjs` too.** The
harness reimplements the main process's IPC wiring; a channel missing there means
the smoke test passes while the real app is broken.

Assertions should be on **effects, not on reported success**. The two bugs that
mattered most here were both silent: the permission gate denied every call while
tools reported success, and CDP clicks reported success while no click reached the
page. A test that trusts the tool's own "ok" would have passed through both.

## Traps

Full list in [`CONTEXT.md` §5](CONTEXT.md). The ones that bite most often:

- **`ELECTRON_RUN_AS_NODE=1` in the environment** makes `electron.exe` behave as
  plain Node — the app never opens. Clear it before launching.
- **`process.execPath` is `electron.exe`, not `node`.** A stdio MCP server must be
  spawned with `ELECTRON_RUN_AS_NODE=1` in its env. In a packaged app this becomes
  the app's own `.exe`; confirm it still works at packaging time.
- **`capturePage()` does not composite a `WebContentsView`** — that area is black in
  a window screenshot. Capture the page via CDP instead.
- **CDP mouse events need the `buttons` bitmask**, not just `button`, and Chromium
  drops synthetic input for an unfocused view — both while reporting success.
- **Prettier is not idempotent under `core.autocrlf=true`** here: `--write` then
  `--check` can still fail. Run `--write` again.
