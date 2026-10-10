/// <reference types="vite/client" />

import type { RubyDesktopApi } from "@shared/ipc";

declare global {
  interface Window {
    /** Injected by the preload script. See src/preload/index.ts. */
    ruby: RubyDesktopApi;
  }
}
