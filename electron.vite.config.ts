import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Builds the three Electron-side bundles: main, preload and renderer.
 *
 * The engine host is deliberately NOT here — it is built separately by
 * `vite.engine.config.ts`, because it must be ESM (it imports the ESM-only
 * `@rubyclii/cli` package) while these three stay CJS. Mixing the two formats in
 * one config is not possible, so the split is explicit.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __RUBY_DESKTOP_MAC_AUTO_UPDATES__: JSON.stringify(Boolean(process.env.CSC_LINK || process.env.CSC_NAME)),
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          // Emitted separately so the smoke tests can require the very same browser
          // implementation the app runs, rather than a copy free to drift.
          "browser-service": resolve(__dirname, "src/main/browser-service.ts"),
          browser: resolve(__dirname, "src/main/browser.ts"),
        },
      },
    },
    resolve: {
      alias: { "@shared": resolve(__dirname, "src/shared") },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
      },
    },
    resolve: {
      alias: { "@shared": resolve(__dirname, "src/shared") },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer/src"),
        "@shared": resolve(__dirname, "src/shared"),
      },
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
  },
});
