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
import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
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

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

async function countSkills(directory) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDirectory = join(directory, entry.name);
    try {
      await readFile(join(skillDirectory, "SKILL.md"), "utf8");
      count++;
    } catch {
      count += await countSkills(skillDirectory);
    }
  }
  return count;
}

const copied = await countSkills(target);
if (copied === 0) {
  console.error(`[copy-skills] no builtin skills were copied from ${source}`);
  process.exit(1);
}
console.log(`[copy-skills] ${copied} skills -> out/engine/skills/builtin`);
