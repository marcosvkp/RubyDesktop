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
  McpServerDraft,
  McpServerSummary,
  MetricLine,
  ModelSummary,
  Message,
  PermissionMode,
  SessionSummary,
  SkillSummary,
  ReasoningEffort,
  SubAgentConfigRequest,
  SubAgentSummary,
  UserQuestionRequest,
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
  | { kind: "notice"; id: string; text: string; tone: "info" | "error" }
  | {
      kind: "question";
      id: string;
      request: UserQuestionRequest;
      status: "pending" | "answered" | "cancelled";
      answers?: Record<string, string>;
    }
  | {
      kind: "subagent-config";
      id: string;
      request: SubAgentConfigRequest;
      status: "pending" | "started" | "cancelled";
    }
  | { kind: "subagent"; id: string; agent: SubAgentSummary };

export interface SessionUsageStats {
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheMeasuredInputTokens: number;
  cacheMeasuredCalls: number;
  llmTimeMs: number;
  firstTokenLatencyTotalMs: number;
  firstTokenSamples: number;
  generationTimeMs: number;
  toolTimeMs: number;
}

export function emptySessionUsageStats(): SessionUsageStats {
  return {
    llmCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheMeasuredInputTokens: 0,
    cacheMeasuredCalls: 0,
    llmTimeMs: 0,
    firstTokenLatencyTotalMs: 0,
    firstTokenSamples: 0,
    generationTimeMs: 0,
    toolTimeMs: 0,
  };
}

function accumulateSessionUsage(stats: SessionUsageStats, line: MetricLine): SessionUsageStats {
  if (line.kind === "llm") {
    const firstTokenLatencyMs = line.firstTokenLatencyMs;
    return {
      ...stats,
      llmCalls: stats.llmCalls + 1,
      inputTokens: stats.inputTokens + line.inputTokens,
      outputTokens: stats.outputTokens + line.outputTokens,
      cachedInputTokens: stats.cachedInputTokens + (line.cachedTokens ?? 0),
      cacheMeasuredInputTokens:
        stats.cacheMeasuredInputTokens + (line.cachedTokens === undefined ? 0 : line.inputTokens),
      cacheMeasuredCalls: stats.cacheMeasuredCalls + (line.cachedTokens === undefined ? 0 : 1),
      llmTimeMs: stats.llmTimeMs + line.latencyMs,
      firstTokenLatencyTotalMs:
        stats.firstTokenLatencyTotalMs + (firstTokenLatencyMs ?? 0),
      firstTokenSamples: stats.firstTokenSamples + (firstTokenLatencyMs === undefined ? 0 : 1),
      generationTimeMs:
        stats.generationTimeMs +
        (firstTokenLatencyMs === undefined
          ? 0
          : Math.max(0, line.latencyMs - firstTokenLatencyMs)),
    };
  }
  if (line.kind === "tool") return { ...stats, toolTimeMs: stats.toolTimeMs + line.latencyMs };
  return stats;
}

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
  sessions: SessionSummary[];
  currentSessionId?: string;
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
  mcpServers: McpServerSummary[];
  skills: SkillSummary[];
  /** The result of the last "test connection", keyed by nothing — it is a one-off. */
  mcpTest?: McpServerSummary;
  /** Output-panel lines, newest last. Capped so a long session cannot grow forever. */
  metrics: MetricLine[];
  /** Aggregate telemetry for the active conversation; independent of the capped activity log. */
  sessionUsage: SessionUsageStats;
  /** Whether the embedded browser view is mounted, and what it is showing. */
  browser: { open: boolean; url?: string; title?: string };

  handleMessage: (message: EngineResponse) => void;
  /** Append a local notice — used by slash commands, which have no engine reply. */
  pushNotice: (text: string, tone?: "info" | "error") => void;
  send: (text: string) => void;
  activateSkill: (name: string, args: string) => void;
  abort: () => void;
  selectModel: (model: string) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  respondApproval: (
    decision: ApprovalDecision,
    scope: ApprovalScope,
    grantKey?: GrantKeyKind,
  ) => void;
  respondUserQuestion: (id: string, answers: Record<string, string> | null) => void;
  respondSubAgentConfig: (
    id: string,
    action: "start" | "cancel",
    config?: { model: string; reasoningEffort?: ReasoningEffort; instructions: string },
  ) => void;
  respondSubAgentReview: (id: string, action: "merge" | "discard" | "cancel") => void;
  compact: () => void;
  newSession: () => void;
  resumeSession: (sessionId: string) => void;
  setGoal: (text: string) => void;
  noteGoal: (text: string) => void;
  setGoalStatus: (status: GoalStatus) => void;
  clearGoal: () => void;
  refreshMcp: () => void;
  addMcpServer: (name: string, config: McpServerDraft) => void;
  removeMcpServer: (name: string) => void;
  testMcpServer: (name: string, config: McpServerDraft) => void;
  clearMcpTest: () => void;
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

/** Rebuilds the visible transcript from the engine's persisted provider messages. */
function restoreTranscript(messages: Message[]): ChatItem[] {
  const items: ChatItem[] = [];
  const callIndexes = new Map<string, number>();

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "text") {
        if (message.role === "user") {
          items.push({ kind: "user", id: nextId(), text: part.text });
        } else {
          items.push({ kind: "assistant", id: nextId(), text: part.text, streaming: false });
        }
      } else if (part.type === "function_call") {
        callIndexes.set(part.id, items.length);
        items.push({
          kind: "tool",
          id: nextId(),
          name: part.name,
          args: part.args,
          status: "running",
        });
      } else {
        const index = callIndexes.get(part.id);
        if (index === undefined) continue;
        const item = items[index];
        if (item?.kind !== "tool") continue;
        items[index] = {
          ...item,
          result: part.result,
          status: part.result.startsWith("Blocked:")
            ? "denied"
            : part.result.startsWith("Error:")
              ? "error"
              : "ok",
        };
      }
    }
  }

  return items.map((item) =>
    item.kind === "tool" && item.status === "running"
      ? { ...item, status: "error", result: "This tool call did not finish before the session ended." }
      : item,
  );
}

/** Human label for a permission mode, used in the status bar and notices. */
export const PERMISSION_MODE_LABEL: Record<PermissionMode, string> = {
  normal: "Perguntar",
  acceptEdits: "Aceitar edições",
  plan: "Planejar",
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
          "Comandos:",
          "Use /new-skill para criar uma Skill personalizada.",
          `Skills disponíveis: ${state.skills.map((skill) => `/${skill.name}`).join(", ") || "nenhuma"}`,
          "/goal <texto> — define a meta do workspace; sem argumento, mostra a meta atual",
          "/goal note <texto> — adiciona uma nota de progresso",
          "/goal pause | resume | done | clear",
          "/compact — resume mensagens antigas agora",
          "/mode ask | edits | plan — altera o modo de permissão",
          "/clear — inicia uma nova conversa",
        ].join("\n"),
      );
      return true;

    case "goal": {
      const sub = rest[0]?.toLowerCase();
      if (!arg) {
        const goal = state.goal;
        state.pushNotice(
          goal
            ? `Meta (${goal.status}): ${goal.text}` +
                (goal.notes.length > 0 ? `\n${goal.notes.length} nota(s).` : "")
            : "Nenhuma meta definida neste workspace. Use /goal <texto>.",
        );
        return true;
      }
      if (sub === "note") {
        const note = rest.slice(1).join(" ").trim();
        if (note) state.noteGoal(note);
        else state.pushNotice("Uso: /goal note <texto>", "error");
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
        state.pushNotice("Uso: /mode ask | edits | plan", "error");
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
      if (state.skills.some((skill) => skill.name === command.toLowerCase())) {
        state.activateSkill(command.toLowerCase(), arg);
        return true;
      }
      state.pushNotice(`Comando desconhecido: /${command}. Use /help.`, "error");
      return true;
  }
}

export const useStore = create<State>((set, get) => ({
  workspace: "",
  models: [],
  model: "",
  status: "starting",
  items: [],
  sessions: [],
  busy: false,
  contextWindow: 0,
  contextUsed: 0,
  compacting: false,
  permissionMode: "normal",
  grants: { project: [], global: [] },
  mcpServers: [],
  skills: [],
  metrics: [],
  sessionUsage: emptySessionUsageStats(),
  browser: { open: false },

  handleMessage: (message) => {
    switch (message.type) {
      case "ready": {
        const previous = get().workspace;
        // A different workspace means a different project: different files, grants,
        // goal and history. Carrying the old transcript over would be actively
        // misleading, so the session is cleared when the workspace changes.
        const switched = previous !== "" && previous !== message.workspace;
        set({
          fatal: undefined,
          engine: {
            workspace: message.workspace,
            model: message.model,
            toolCount: message.toolCount,
            skillCount: message.skillCount,
            keySource: message.keySource,
          },
          workspace: message.workspace,
          model: message.model,
          skills: message.skills,
          permissionMode: message.permissionMode,
          ...(switched
            ? {
                items: notice(
                  [],
                  `Workspace alterado para ${message.workspace}`,
                ),
                sessions: [],
                currentSessionId: undefined,
                contextUsed: 0,
                metrics: [],
                sessionUsage: emptySessionUsageStats(),
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

      case "skills":
        set((s) => ({
          skills: message.skills,
          engine: s.engine ? { ...s.engine, skillCount: message.skills.length } : undefined,
        }));
        return;

      case "sessions":
        set({
          sessions: message.sessions,
          currentSessionId: message.currentSessionId,
          ...(message.history !== undefined
            ? {
                items: restoreTranscript(message.history),
                metrics: [],
                sessionUsage: emptySessionUsageStats(),
              }
            : {}),
        });
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
          items: notice(s.items, `Modo de permissão: ${PERMISSION_MODE_LABEL[message.mode]}`),
        }));
        return;

      case "grants":
        set({ grants: message.grants });
        return;

      case "goal":
        set({ goal: message.goal });
        return;

      case "mcp":
        set({ mcpServers: message.servers });
        return;

      case "mcpTest":
        set({ mcpTest: message.server });
        return;

      case "metric":
        set((s) => ({
          // Bounded: this is a live activity log, not a record. Keeping every line
          // of a long session would grow without limit for no benefit.
          metrics: [...s.metrics, message.line].slice(-300),
          sessionUsage: accumulateSessionUsage(s.sessionUsage, message.line),
        }));
        return;

      case "browserState":
        set({
          browser: { open: message.open, url: message.url, title: message.title },
        });
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

      case "userQuestionRequest":
        set((s) => ({
          items: [
            ...closeStreaming(s.items),
            { kind: "question", id: message.request.id, request: message.request, status: "pending" },
          ],
        }));
        return;

      case "userQuestionResolved":
        if (message.cancelled) {
          set((s) => ({
            items: s.items.map((item) =>
              item.kind === "question" && item.id === message.id && item.status === "pending"
                ? { ...item, status: "cancelled" }
                : item,
            ),
          }));
        }
        return;

      case "subAgentConfigRequest":
        set((s) => ({
          items: [
            ...closeStreaming(s.items),
            {
              kind: "subagent-config",
              id: message.request.id,
              request: message.request,
              status: "pending",
            },
          ],
        }));
        return;

      case "subAgentConfigResolved":
        set((s) => ({
          items: s.items.map((item) =>
            item.kind === "subagent-config" && item.id === message.id
              ? { ...item, status: message.action === "start" ? "started" : "cancelled" }
              : item,
          ),
        }));
        return;

      case "subAgentUpdate":
        set((s) => {
          const index = s.items.findIndex(
            (item) => item.kind === "subagent" && item.agent.id === message.agent.id,
          );
          if (index === -1) {
            return {
              items: [...closeStreaming(s.items), { kind: "subagent", id: message.agent.id, agent: message.agent }],
            };
          }
          const items = [...s.items];
          items[index] = { kind: "subagent", id: message.agent.id, agent: message.agent };
          return { items };
        });
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
            set((s) => ({ items: notice(s.items, `Skill ativada: ${event.name}`) }));
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

  activateSkill: (name, args) => {
    const state = get();
    if (state.busy) return;
    if (!state.skills.some((skill) => skill.name === name)) {
      state.pushNotice(`Skill desconhecida: ${name}`, "error");
      return;
    }
    const command = `/${name}${args.trim() ? ` ${args.trim()}` : ""}`;
    set((s) => ({
      items: [...closeStreaming(s.items), { kind: "user", id: nextId(), text: command }],
      busy: true,
    }));
    window.ruby.activateSkill(name, args);
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

  respondUserQuestion: (id, answers) => {
    set((s) => ({
      items: s.items.map((item) =>
        item.kind === "question" && item.id === id
          ? { ...item, status: answers ? "answered" : "cancelled", answers: answers ?? undefined }
          : item,
      ),
    }));
    window.ruby.respondUserQuestion(id, answers);
  },

  respondSubAgentConfig: (id, action, config) => {
    set((s) => ({
      items: s.items.map((item) =>
        item.kind === "subagent-config" && item.id === id
          ? { ...item, status: action === "start" ? "started" : "cancelled" }
          : item,
      ),
    }));
    window.ruby.respondSubAgentConfig(id, action, config);
  },

  respondSubAgentReview: (id, action) => window.ruby.respondSubAgentReview(id, action),

  compact: () => window.ruby.compact(),

  newSession: () => window.ruby.newSession(),
  resumeSession: (sessionId) => window.ruby.resumeSession(sessionId),

  setGoal: (text) => window.ruby.setGoal(text),
  noteGoal: (text) => window.ruby.noteGoal(text),
  setGoalStatus: (status) => window.ruby.setGoalStatus(status),
  clearGoal: () => window.ruby.clearGoal(),

  refreshMcp: () => window.ruby.refreshMcp(),
  addMcpServer: (name, config) => window.ruby.addMcpServer(name, config),
  removeMcpServer: (name) => window.ruby.removeMcpServer(name),
  testMcpServer: (name, config) => window.ruby.testMcpServer(name, config),
  clearMcpTest: () => set({ mcpTest: undefined }),

  pickWorkspace: () => {
    void window.ruby.pickWorkspace().then((path) => {
      if (path) window.ruby.setWorkspace(path);
    });
  },

  reset: () => {
    set({
      items: [],
      contextUsed: 0,
      metrics: [],
      sessionUsage: emptySessionUsageStats(),
      approval: undefined,
    });
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
