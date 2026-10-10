/**
 * Copies the built-in skills next to the engine bundle.
 *
 * The skills are `SKILL.md` data files, not modules, so the bundler does not see
 * them. Without this the engine host resolves its built-in skills directory to a
 * path that does not exist and reports `skills=0`, silently losing all of them.
 *
 * `SkillRegistry` probes several candidate locations relative to the running
 * module, one of which is `<module dir>/skills/builtin` — which for
 * `out/engine/index.mjs` means `out/engine/skills/builtin`.
 *
 * The source is the installed `@rubyclii/cli` package rather than the sibling
 * checkout: that is the exact artifact this app depends on, and it already ships
 * its built-ins under `dist/skills/builtin`.
 */
import { cp, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const source = join(root, "node_modules", "@rubyclii", "cli", "dist", "skills", "builtin");
const target = join(root, "out", "engine", "skills", "builtin");

if (!existsSync(source)) {
  console.error(`[copy-skills] source not found: ${source}`);
  console.error("[copy-skills] is @rubyclii/cli built? run `npm run build` in the RubyCLI repo.");
  process.exit(1);
}

await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

const copied = (await readdir(target, { withFileTypes: true })).filter((e) => e.isDirectory());
console.log(`[copy-skills] ${copied.length} skills -> out/engine/skills/builtin`);
