import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * Builds the engine host as a standalone ESM bundle.
 *
 * Why it is separate from `electron.vite.config.ts`:
 *
 *  - **ESM, not CJS.** `@rubyclii/cli` is `"type": "module"`. Loading it from a
 *    CJS bundle would depend on `require(esm)` interop; emitting ESM sidesteps
 *    that entirely, and Electron supports ESM in `utilityProcess`.
 *  - **Dependencies are bundled, not external.** `ssr.noExternal` forces
 *    `@rubyclii/cli` and its transitive deps into the output. The engine host
 *    therefore has no `node_modules` requirements at runtime, which keeps
 *    packaging simple: nothing extra has to be unpacked from the asar or shipped
 *    alongside it.
 */
export default defineConfig({
  // Vite externalizes dependencies by default in SSR builds. The engine is
  // shipped outside app.asar without node_modules, so inline every package.
  ssr: {
    noExternal: true,
  },
  build: {
    outDir: "out/engine",
    emptyOutDir: true,
    target: "node20",
    ssr: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: resolve(__dirname, "src/engine-host/index.ts"),
      // `electron` is the only thing that must stay external: it is provided by
      // the host process, not resolved from disk.
      external: ["electron"],
      output: {
        format: "es",
        entryFileNames: "index.mjs",
      },
    },
  },
  resolve: {
    alias: { "@shared": resolve(__dirname, "src/shared") },
  },
});
