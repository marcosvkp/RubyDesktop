/**
 * The single store the UI renders from.
 *
 * Zustand rather than per-value atoms: engine output is an append-only stream that
 * fans into a few related slices (transcript, tool calls, status, usage), which is
 * a store-shaped problem. Keeping it in one place also means the IPC subscription
 * has exactly one consumer.
 */
import { create } from "zustand";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalScope,
  EngineResponse,
  EngineStatus,
  GoalStatus,
  GoalSummary,
  GrantKeyKind,
  GrantsSnapshot,
  ModelSummary,
  PermissionMode,
} from "@shared/ipc";

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
  | {
      kind: "tool";
      id: string;
      name: string;
      args: unknown;
      result?: string;
      status: "running" | "ok" | "error" | "denied";
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
  /** Set while the engine is compacting, so the UI can show progress. */
  compacting: boolean;
  /** The tool call the engine is blocked on, if any. */
  approval?: ApprovalRequest;
  permissionMode: PermissionMode;
  grants: GrantsSnapshot;
  /** `undefined` = not loaded yet, `null` = loaded and there is no goal. */
  goal?: GoalSummary | null;

  handleMessage: (message: EngineResponse) => void;
  /** Append a local notice — used by slash commands, which have no engine reply. */
  pushNotice: (text: string, tone?: "info" | "error") => void;
  send: (text: string) => void;
  abort: () => void;
  selectModel: (model: string) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  respondApproval: (
    decision: ApprovalDecision,
    scope: ApprovalScope,
    grantKey?: GrantKeyKind,
  ) => void;
  compact: () => void;
  setGoal: (text: string) => void;
  noteGoal: (text: string) => void;
  setGoalStatus: (status: GoalStatus) => void;
  clearGoal: () => void;
  pickWorkspace: () => void;
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

/** Appends an informational or error notice. */
function notice(items: ChatItem[], text: string, tone: "info" | "error" = "info"): ChatItem[] {
  return [...closeStreaming(items), { kind: "notice", id: nextId(), text, tone }];
}

/** Human label for a permission mode, used in the status bar and notices. */
export const PERMISSION_MODE_LABEL: Record<PermissionMode, string> = {
  normal: "Ask",
  acceptEdits: "Accept edits",
  plan: "Plan",
};

/**
 * Slash commands handled entirely in the renderer.
 *
 * These are UI affordances, not agent turns: they never reach the model, so a
 * mistyped `/compact` cannot be interpreted as a request to write code. The
 * engine-side equivalents (`EngineRequest`) are what actually do the work.
 *
 * Returns true when the input was consumed.
 */
function runSlashCommand(text: string, get: () => State): boolean {
  const [command, ...rest] = text.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();
  const state = get();

  switch (command.toLowerCase()) {
    case "help":
      state.pushNotice(
        [
          "Commands:",
          "/goal <text> — set the workspace goal; /goal with no argument shows it",
          "/goal note <text> — append a progress note",
          "/goal pause | resume | done | clear",
          "/compact — summarize older messages now",
          "/mode ask | edits | plan — change the permission mode",
          "/clear — start a fresh session",
        ].join("\n"),
      );
      return true;

    case "goal": {
      const sub = rest[0]?.toLowerCase();
      if (!arg) {
        const goal = state.goal;
        state.pushNotice(
          goal
            ? `Goal (${goal.status}): ${goal.text}` +
                (goal.notes.length > 0 ? `\n${goal.notes.length} note(s).` : "")
            : "No goal set for this workspace. Use /goal <text>.",
        );
        return true;
      }
      if (sub === "note") {
        const note = rest.slice(1).join(" ").trim();
        if (note) state.noteGoal(note);
        else state.pushNotice("Usage: /goal note <text>", "error");
        return true;
      }
      if (sub === "pause") {
        state.setGoalStatus("paused");
        return true;
      }
      if (sub === "resume") {
        state.setGoalStatus("active");
        return true;
      }
      if (sub === "done" || sub === "complete") {
        state.setGoalStatus("complete");
        return true;
      }
      if (sub === "clear") {
        state.clearGoal();
        return true;
      }
      state.setGoal(arg);
      return true;
    }

    case "compact":
      state.compact();
      return true;

    case "mode": {
      const map: Record<string, PermissionMode> = {
        ask: "normal",
        normal: "normal",
        edits: "acceptEdits",
        "accept-edits": "acceptEdits",
        acceptedits: "acceptEdits",
        plan: "plan",
      };
      const mode = map[arg.toLowerCase()];
      if (!mode) {
        state.pushNotice("Usage: /mode ask | edits | plan", "error");
        return true;
      }
      state.setPermissionMode(mode);
      return true;
    }

    case "plan":
      state.setPermissionMode("plan");
      return true;

    case "clear":
      state.reset();
      return true;

    default:
      state.pushNotice(`Unknown command: /${command}. Try /help.`, "error");
      return true;
  }
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
  compacting: false,
  permissionMode: "normal",
  grants: { project: [], global: [] },

  handleMessage: (message) => {
    switch (message.type) {
      case "ready": {
        const previous = get().workspace;
        // A different workspace means a different project: different files, grants,
        // goal and history. Carrying the old transcript over would be actively
        // misleading, so the session is cleared when the workspace changes.
        const switched = previous !== "" && previous !== message.workspace;
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
          permissionMode: message.permissionMode,
          ...(switched
            ? {
                items: notice(
                  [],
                  `Switched to workspace ${message.workspace}`,
                ),
                contextUsed: 0,
                goal: undefined,
                approval: undefined,
              }
            : {}),
        });
        return;
      }

      case "models":
        set({ models: message.models });
        return;

      case "status":
        set({ status: message.status, busy: message.status === "busy" });
        return;

      case "usage":
        set({ contextUsed: message.inputTokens, contextWindow: message.contextWindow });
        return;

      case "permissionMode":
        set((s) => ({
          permissionMode: message.mode,
          items: notice(s.items, `Permission mode: ${PERMISSION_MODE_LABEL[message.mode]}`),
        }));
        return;

      case "grants":
        set({ grants: message.grants });
        return;

      case "goal":
        set({ goal: message.goal });
        return;

      case "compacting":
        set({ compacting: message.active });
        return;

      case "approvalRequest":
        set({ approval: message.request });
        return;

      case "approvalResolved":
        set((s) => ({
          approval: s.approval?.id === message.id ? undefined : s.approval,
        }));
        return;

      case "error":
        set((s) => ({ items: notice(s.items, message.message, "error") }));
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
                    status: event.result.startsWith("Blocked:")
                      ? "denied"
                      : event.result.startsWith("Error:")
                        ? "error"
                        : "ok",
                  };
                  break;
                }
              }
              return { items };
            });
            return;

          case "skill_activated":
            set((s) => ({ items: notice(s.items, `Skill activated: ${event.name}`) }));
            return;

          case "notice":
            set((s) => ({ items: notice(s.items, event.message) }));
            return;

          case "error":
            set((s) => ({ items: notice(s.items, event.message, "error") }));
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

    // Slash commands are UI-level: echo them so the transcript reads as a
    // conversation, but never send them to the model.
    if (trimmed.startsWith("/")) {
      set((s) => ({
        items: [...closeStreaming(s.items), { kind: "user", id: nextId(), text: trimmed }],
      }));
      runSlashCommand(trimmed, get);
      return;
    }

    set((s) => ({
      items: [...closeStreaming(s.items), { kind: "user", id: nextId(), text: trimmed }],
      busy: true,
    }));
    window.ruby.sendPrompt(trimmed);
  },

  pushNotice: (text, tone = "info") => {
    set((s) => ({ items: notice(s.items, text, tone) }));
  },

  abort: () => window.ruby.abort(),

  selectModel: (model) => {
    set({ model });
    window.ruby.setModel(model);
  },

  setPermissionMode: (mode) => {
    set({ permissionMode: mode });
    window.ruby.setPermissionMode(mode);
  },

  respondApproval: (decision, scope, grantKey) => {
    const approval = get().approval;
    if (!approval) return;
    set({ approval: undefined });
    window.ruby.respondApproval(approval.id, decision, scope, grantKey);
  },

  compact: () => window.ruby.compact(),

  setGoal: (text) => window.ruby.setGoal(text),
  noteGoal: (text) => window.ruby.noteGoal(text),
  setGoalStatus: (status) => window.ruby.setGoalStatus(status),
  clearGoal: () => window.ruby.clearGoal(),

  pickWorkspace: () => {
    void window.ruby.pickWorkspace().then((path) => {
      if (path) window.ruby.setWorkspace(path);
    });
  },

  reset: () => {
    set({ items: [], contextUsed: 0, approval: undefined });
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
