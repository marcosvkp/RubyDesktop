/**
 * The single store the UI renders from.
 *
 * Zustand rather than per-value atoms: engine output is an append-only stream that
 * fans into a few related slices (transcript, tool calls, status, usage), which is
 * a store-shaped problem. Keeping it in one place also means the IPC subscription
 * has exactly one consumer.
 */
import { create } from "zustand";
import type { EngineResponse, EngineStatus, ModelSummary } from "@shared/ipc";

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
  | {
      kind: "tool";
      id: string;
      name: string;
      args: unknown;
      result?: string;
      status: "running" | "ok" | "error";
    }
  | { kind: "notice"; id: string; text: string; tone: "info" | "error" };

interface EngineInfo {
  workspace: string;
  model: string;
  toolCount: number;
  skillCount: number;
  keySource: string;
}

interface State {
  workspace: string;
  engine?: EngineInfo;
  models: ModelSummary[];
  model: string;
  status: EngineStatus;
  items: ChatItem[];
  busy: boolean;
  fatal?: string;
  contextWindow: number;
  contextUsed: number;

  handleMessage: (message: EngineResponse) => void;
  send: (text: string) => void;
  abort: () => void;
  selectModel: (model: string) => void;
  reset: () => void;
  dismissFatal: () => void;
}

let counter = 0;
const nextId = (): string => `i${++counter}`;

/**
 * Appends streamed text to the assistant message currently being built, creating
 * one on first use. Consecutive `text` events belong to the same message; anything
 * else (a tool call, a notice) closes it so the next text starts a new bubble.
 */
function appendAssistantText(items: ChatItem[], text: string): ChatItem[] {
  const last = items[items.length - 1];
  if (last && last.kind === "assistant" && last.streaming) {
    const updated: ChatItem = { ...last, text: last.text + text };
    return [...items.slice(0, -1), updated];
  }
  return [...items, { kind: "assistant", id: nextId(), text, streaming: true }];
}

/** Marks the in-flight assistant message as finished. */
function closeStreaming(items: ChatItem[]): ChatItem[] {
  return items.map((item) =>
    item.kind === "assistant" && item.streaming ? { ...item, streaming: false } : item,
  );
}

export const useStore = create<State>((set, get) => ({
  workspace: "",
  models: [],
  model: "",
  status: "starting",
  items: [],
  busy: false,
  contextWindow: 0,
  contextUsed: 0,

  handleMessage: (message) => {
    switch (message.type) {
      case "ready":
        set({
          engine: {
            workspace: message.workspace,
            model: message.model,
            toolCount: message.toolCount,
            skillCount: message.skillCount,
            keySource: message.keySource,
          },
          workspace: message.workspace,
          model: message.model,
        });
        return;

      case "models":
        set({ models: message.models });
        return;

      case "status":
        set({ status: message.status, busy: message.status === "busy" });
        return;

      case "usage":
        set({ contextUsed: message.inputTokens, contextWindow: message.contextWindow });
        return;

      case "error":
        set((s) => ({
          items: [...closeStreaming(s.items), { kind: "notice", id: nextId(), text: message.message, tone: "error" }],
        }));
        return;

      case "fatal":
        set({ fatal: message.message, status: "error", busy: false });
        return;

      case "event": {
        const event = message.event;
        switch (event.type) {
          case "text":
            set((s) => ({ items: appendAssistantText(s.items, event.text) }));
            return;

          case "tool_call":
            set((s) => ({
              items: [
                ...closeStreaming(s.items),
                {
                  kind: "tool",
                  id: nextId(),
                  name: event.name,
                  args: event.args,
                  status: "running",
                },
              ],
            }));
            return;

          case "tool_result":
            set((s) => {
              // Attach the result to the most recent matching call that is still
              // running, so parallel calls cannot overwrite each other's output.
              const items = [...s.items];
              for (let i = items.length - 1; i >= 0; i--) {
                const item = items[i];
                if (item.kind === "tool" && item.name === event.name && item.status === "running") {
                  items[i] = {
                    ...item,
                    result: event.result,
                    status: event.result.startsWith("Error:") ? "error" : "ok",
                  };
                  break;
                }
              }
              return { items };
            });
            return;

          case "skill_activated":
            set((s) => ({
              items: [
                ...s.items,
                { kind: "notice", id: nextId(), text: `Skill activated: ${event.name}`, tone: "info" },
              ],
            }));
            return;

          case "notice":
            set((s) => ({
              items: [...s.items, { kind: "notice", id: nextId(), text: event.message, tone: "info" }],
            }));
            return;

          case "error":
            set((s) => ({
              items: [...s.items, { kind: "notice", id: nextId(), text: event.message, tone: "error" }],
            }));
            return;

          case "done":
            set((s) => ({ items: closeStreaming(s.items) }));
            return;
        }
      }
    }
  },

  send: (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().busy) return;
    set((s) => ({
      items: [...closeStreaming(s.items), { kind: "user", id: nextId(), text: trimmed }],
      busy: true,
    }));
    window.ruby.sendPrompt(trimmed);
  },

  abort: () => window.ruby.abort(),

  selectModel: (model) => {
    set({ model });
    window.ruby.setModel(model);
  },

  reset: () => {
    set({ items: [], contextUsed: 0 });
    window.ruby.reset();
  },

  dismissFatal: () => set({ fatal: undefined }),
}));

/**
 * Wires the engine stream into the store. Called once, from `main.tsx`, so React
 * StrictMode's double-invocation cannot install two listeners.
 */
export function connectEngine(): () => void {
  return window.ruby.onEngineMessage((message) => useStore.getState().handleMessage(message));
}
