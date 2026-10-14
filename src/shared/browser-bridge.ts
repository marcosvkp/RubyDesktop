import type { BrowserMethod, BrowserParams, BrowserResult } from "./ipc";

interface PendingBrowserCall {
  resolve: (result: BrowserResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** RPC adapter between engine tools and the Electron-owned browser service. */
export class BrowserBridge {
  private pending = new Map<string, PendingBrowserCall>();
  private seq = 0;

  constructor(
    /** Posts a request to the main process. */
    private readonly post: (id: string, method: BrowserMethod, params: unknown) => void,
  ) {}

  /** Calls one browser method and waits for the main process to answer. */
  call<M extends BrowserMethod>(
    method: M,
    params: BrowserParams[M],
  ): Promise<BrowserResult> {
    const id = `b${++this.seq}`;
    return new Promise<BrowserResult>((resolve, reject) => {
      // Long enough for a slow page load, short enough that a wedged browser does
      // not consume the whole turn budget.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`browser ${method} timed out after 45_000ms`));
      }, 45_000);

      this.pending.set(id, { resolve, reject, timer });
      this.post(id, method, params);
    });
  }

  /** Settles a pending call. Unknown ids are ignored — a late reply is not an error. */
  resolve(id: string, ok: boolean, result?: BrowserResult, error?: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (ok) pending.resolve(result ?? { text: "(no result)" });
    else pending.reject(new Error(error ?? "browser operation failed"));
  }

  /** Fails every in-flight call — used when the turn ends or the app quits. */
  failAll(reason: string): void {
    for (const [, pending] of [...this.pending]) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }
}
