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
  PermissionMode,
  RecentWorkspaceSummary,
  BrowserTabSummary,
  SessionEntry,
  SessionSummary,
  SkillSummary,
  ReasoningEffort,
  SubAgentConfigRequest,
  SubAgentSummary,
  UserQuestionAnswer,
  UserQuestionRequest,
} from "@shared/ipc";
import { isKnownSlashCommand } from "./slash-commands";

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
  | {
      kind: "todo-list";
      id: "todo-list";
      items: TodoTask[];
      toolCalls: number;
    }
  | {
      kind: "tool";
      id: string;
      callId?: string;
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
      status: "pending" | "answered" | "cancelled" | "interrupted";
      answers?: Record<string, UserQuestionAnswer>;
    }
  | {
      kind: "subagent-config";
      id: string;
      request: SubAgentConfigRequest;
      status: "pending" | "started" | "cancelled" | "interrupted";
      resolved?: {
        model: string;
        reasoningEffort?: ReasoningEffort;
        instructions: string;
      };
    }
  | { kind: "subagent"; id: string; agent: SubAgentSummary };

export interface TodoTask {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "done";
}

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

type MetricEntry = MetricLine & { id: string };
export type TurnProgress = Extract<EngineResponse, { type: "turnProgress" }> & {
  receivedAt: number;
  publicSummary?: string;
};

export interface QueuedMessage {
  id: string;
  text: string;
  createdAt: number;
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

function accumulateSessionUsage(
  stats: SessionUsageStats,
  line: MetricLine,
): SessionUsageStats {
  if (line.kind === "llm") {
    const firstTokenLatencyMs = line.firstTokenLatencyMs;
    return {
      ...stats,
      llmCalls: stats.llmCalls + 1,
      inputTokens: stats.inputTokens + line.inputTokens,
      outputTokens: stats.outputTokens + line.outputTokens,
      cachedInputTokens: stats.cachedInputTokens + (line.cachedTokens ?? 0),
      cacheMeasuredInputTokens:
        stats.cacheMeasuredInputTokens +
        (line.cachedTokens === undefined ? 0 : line.inputTokens),
      cacheMeasuredCalls:
        stats.cacheMeasuredCalls + (line.cachedTokens === undefined ? 0 : 1),
      llmTimeMs: stats.llmTimeMs + line.latencyMs,
      firstTokenLatencyTotalMs:
        stats.firstTokenLatencyTotalMs + (firstTokenLatencyMs ?? 0),
      firstTokenSamples:
        stats.firstTokenSamples + (firstTokenLatencyMs === undefined ? 0 : 1),
      generationTimeMs:
        stats.generationTimeMs +
        (firstTokenLatencyMs === undefined
          ? 0
          : Math.max(0, line.latencyMs - firstTokenLatencyMs)),
    };
  }
  if (line.kind === "tool")
    return { ...stats, toolTimeMs: stats.toolTimeMs + line.latencyMs };
  return stats;
}

interface EngineInfo {
  workspace: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  toolCount: number;
  skillCount: number;
  keySource: string;
}

interface State {
  workspace: string;
  recentWorkspaces: RecentWorkspaceSummary[];
  engine?: EngineInfo;
  models: ModelSummary[];
  model: string;
  reasoningEffort?: ReasoningEffort;
  status: EngineStatus;
  items: ChatItem[];
  queuedMessages: QueuedMessage[];
  turnCount: number;
  stepCount: number;
  sessions: SessionSummary[];
  currentSessionId?: string;
  /** Completed sub-agent rows the user has hidden from this conversation's panel. */
  clearedSubAgentIds: string[];
  busy: boolean;
  /** An asynchronous slash command is running outside a model turn. */
  queueCommandPending: boolean;
  turnProgress?: TurnProgress;
  fatal?: string;
  contextWindow: number;
  contextUsed: number;
  contextSource: "engine" | "provider";
  /** Set while the engine is compacting, so the UI can show progress. */
  compacting: boolean;
  /** The tool call the engine is blocked on, if any. */
  approval?: ApprovalRequest;
  permissionMode: PermissionMode;
  grants: GrantsSnapshot;
  /** `undefined` = not loaded yet, `null` = loaded and there is no goal. */
  goal?: GoalSummary | null;
  goalAutoRunning: boolean;
  mcpServers: McpServerSummary[];
  skills: SkillSummary[];
  /** The result of the last "test connection", keyed by nothing — it is a one-off. */
  mcpTest?: McpServerSummary;
  /** Output-panel lines, newest last. Capped so a long session cannot grow forever. */
  metrics: MetricEntry[];
  /** Aggregate telemetry for the active conversation; independent of the capped activity log. */
  sessionUsage: SessionUsageStats;
  /** Whether the embedded browser view is mounted, and what it is showing. */
  browser: {
    open: boolean;
    url?: string;
    title?: string;
    activeTabId?: string;
    tabs: BrowserTabSummary[];
  };

  handleMessage: (message: EngineResponse) => void;
  /** Append a local notice — used by slash commands, which have no engine reply. */
  pushNotice: (text: string, tone?: "info" | "error") => void;
  send: (text: string) => void;
  removeQueuedMessage: (id: string) => void;
  moveQueuedMessage: (id: string, direction: -1 | 1) => void;
  drainQueue: () => void;
  activateSkill: (name: string, args: string) => void;
  abort: () => void;
  selectModel: (model: string, reasoningEffort?: ReasoningEffort) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  respondApproval: (
    decision: ApprovalDecision,
    scope: ApprovalScope,
    grantKey?: GrantKeyKind,
  ) => void;
  respondUserQuestion: (
    id: string,
    answers: Record<string, UserQuestionAnswer> | null,
  ) => void;
  respondSubAgentConfig: (
    id: string,
    action: "start" | "cancel",
    config?: {
      model: string;
      reasoningEffort?: ReasoningEffort;
      instructions: string;
    },
  ) => void;
  respondSubAgentReview: (
    id: string,
    action: "merge" | "discard" | "cancel",
  ) => void;
  clearCompletedSubAgents: (ids: string[]) => void;
  compact: () => void;
  newSession: () => void;
  resumeSession: (sessionId: string) => void;
  setGoal: (text: string) => void;
  noteGoal: (text: string) => void;
  setGoalStatus: (status: GoalStatus) => void;
  setGoalMaxRounds: (maxRounds: number) => void;
  startAutoGoal: (maxRounds?: number) => void;
  stopAutoGoal: () => void;
  clearGoal: () => void;
  refreshMcp: () => void;
  addMcpServer: (name: string, config: McpServerDraft) => void;
  removeMcpServer: (name: string) => void;
  testMcpServer: (name: string, config: McpServerDraft) => void;
  clearMcpTest: () => void;
  pickWorkspace: () => void;
  switchWorkspace: (path: string) => void;
  reset: () => void;
  dismissFatal: () => void;
}

let counter = 0;
let metricCounter = 0;
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
    item.kind === "assistant" && item.streaming
      ? { ...item, streaming: false }
      : item,
  );
}

const MAX_TOOL_RESULT_CHARS = 32_000;

function truncateToolResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_CHARS) return result;
  const omitted = result.length - MAX_TOOL_RESULT_CHARS;
  return `${result.slice(0, MAX_TOOL_RESULT_CHARS)}\n\n[… resultado truncado; ${omitted.toLocaleString("pt-BR")} caracteres omitidos para reduzir o uso de memória …]`;
}

function countChatItems(items: ChatItem[]): { turnCount: number; stepCount: number } {
  let turnCount = 0;
  let stepCount = 0;
  for (const item of items) {
    if (item.kind === "user" && !item.text.trimStart().startsWith("/")) turnCount++;
    else if (item.kind === "tool") stepCount++;
    else if (item.kind === "todo-list") stepCount += item.toolCalls;
  }
  return { turnCount, stepCount };
}

function parseTodoItems(args: unknown): TodoTask[] | undefined {
  if (!isRecord(args) || !Array.isArray(args.items) || args.items.length > 100)
    return undefined;
  const parsed: TodoTask[] = [];
  for (const value of args.items) {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      typeof value.text !== "string" ||
      (value.status !== "pending" &&
        value.status !== "in_progress" &&
        value.status !== "done")
    )
      return undefined;
    parsed.push({
      id: value.id.slice(0, 100),
      text: value.text.slice(0, 1000),
      status: value.status,
    });
  }
  return parsed;
}

/** Keeps the latest full todo_write snapshot while counting hidden todo tool calls. */
function recordTodoCall(
  chatItems: ChatItem[],
  replacement?: TodoTask[],
): ChatItem[] {
  const index = chatItems.findIndex(
    (item) => item.kind === "todo-list" && item.id === "todo-list",
  );
  const current = index >= 0 ? chatItems[index] : undefined;
  const todoItem: ChatItem = {
    kind: "todo-list",
    id: "todo-list",
    items:
      replacement ?? (current?.kind === "todo-list" ? current.items : []),
    toolCalls: (current?.kind === "todo-list" ? current.toolCalls : 0) + 1,
  };
  if (index < 0) return [...chatItems, todoItem];
  return chatItems.map((item, itemIndex) =>
    itemIndex === index ? todoItem : item,
  );
}

/** Appends an informational or error notice. */
function notice(
  items: ChatItem[],
  text: string,
  tone: "info" | "error" = "info",
): ChatItem[] {
  return [
    ...closeStreaming(items),
    { kind: "notice", id: nextId(), text, tone },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isQuestionAnswer(value: unknown): value is UserQuestionAnswer {
  return (
    typeof value === "string" ||
    (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
  );
}

function isQuestionRequest(value: unknown): value is UserQuestionRequest {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    !Array.isArray(value.questions) ||
    value.questions.length < 1 ||
    value.questions.length > 3
  )
    return false;
  return value.questions.every(
    (question) =>
      isRecord(question) &&
      typeof question.id === "string" &&
      typeof question.question === "string" &&
      (question.selectionMode === undefined ||
        question.selectionMode === "single" ||
        question.selectionMode === "multiple") &&
      Array.isArray(question.options) &&
      question.options.every(
        (option) => isRecord(option) && typeof option.label === "string",
      ),
  );
}

function isSubAgentConfigRequest(
  value: unknown,
): value is SubAgentConfigRequest {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.prompt === "string" &&
    typeof value.role === "string" &&
    typeof value.proposedModel === "string" &&
    typeof value.proposedInstructions === "string"
  );
}

interface RestoredToolCall {
  id: string;
  callId?: string;
  name: string;
  args: unknown;
  hasUiAnnotation: boolean;
}

function legacyQuestionFromTool(
  call: RestoredToolCall,
  result: string,
): ChatItem | undefined {
  if (!isRecord(call.args) || !Array.isArray(call.args.questions))
    return undefined;
  const questions = call.args.questions.flatMap((raw, index) => {
    if (!isRecord(raw) || typeof raw.question !== "string") return [];
    const options = Array.isArray(raw.options)
      ? raw.options.flatMap((option) => {
          if (typeof option === "string") return [{ label: option }];
          if (!isRecord(option) || typeof option.label !== "string") return [];
          return [
            {
              label: option.label,
              ...(typeof option.description === "string"
                ? { description: option.description }
                : {}),
            },
          ];
        })
      : [];
    return [
      {
        id: typeof raw.id === "string" ? raw.id : `q${index + 1}`,
        ...(typeof raw.header === "string" ? { header: raw.header } : {}),
        question: raw.question,
        options,
        ...(raw.selectionMode === "multiple"
          ? { selectionMode: "multiple" as const }
          : {}),
      },
    ];
  });
  if (questions.length === 0) return undefined;

  const id = `legacy-question-${call.id}`;
  const request: UserQuestionRequest = {
    id,
    agentId: "main",
    agentName: "Ruby",
    title:
      typeof call.args.title === "string"
        ? call.args.title
        : "Pergunta do agente",
    questions,
  };
  let answers: Record<string, UserQuestionAnswer> | undefined;
  try {
    const parsed: unknown = JSON.parse(result);
    if (
      isRecord(parsed) &&
      isRecord(parsed.answers) &&
      Object.values(parsed.answers).every(isQuestionAnswer)
    ) {
      answers = parsed.answers as Record<string, UserQuestionAnswer>;
    }
  } catch {
    // Older cancelled questions return a plain sentence instead of JSON.
  }
  return {
    kind: "question",
    id,
    request,
    status: answers ? "answered" : "cancelled",
    ...(answers ? { answers } : {}),
  };
}

function legacySubAgentItems(
  call: RestoredToolCall,
  result: string,
): ChatItem[] {
  if (!result.startsWith("Sub-agent:")) return [];
  const heading = result.match(/^Sub-agent:\s*(.*?)\s+\((explorer|worker)\)/m);
  const modelLine =
    result.match(/^Model:\s*(.+)$/m)?.[1] ?? "modelo desconhecido";
  const model = modelLine.split(" · effort ")[0];
  const effort = modelLine.match(/ · effort (low|medium|high)$/)?.[1] as
    | ReasoningEffort
    | undefined;
  const instructions = result.match(/^Instructions:\s*(.*)$/m)?.[1] ?? "";
  const output = result.split("\n\n").slice(1).join("\n\n").slice(-12_000);
  const title =
    isRecord(call.args) && typeof call.args.title === "string"
      ? call.args.title
      : (heading?.[1] ?? "Sub-agent");
  const role =
    isRecord(call.args) &&
    (call.args.role === "explorer" || call.args.role === "worker")
      ? call.args.role
      : heading?.[2] === "worker"
        ? "worker"
        : "explorer";
  const prompt =
    isRecord(call.args) && typeof call.args.prompt === "string"
      ? call.args.prompt
      : "";
  const configId = `legacy-config-${call.id}`;
  const agentId = `legacy-agent-${call.id}`;
  const request: SubAgentConfigRequest = {
    id: configId,
    title,
    prompt,
    role,
    proposedModel: model,
    proposedInstructions: instructions,
  };
  const agent: SubAgentSummary = {
    id: agentId,
    title,
    prompt,
    role,
    model,
    ...(effort ? { reasoningEffort: effort } : {}),
    instructions,
    status: "completed",
    progress: "Restaurado do histórico da sessão",
    output,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      llmCalls: 0,
      toolCalls: 0,
    },
  };
  return [
    {
      kind: "subagent-config",
      id: configId,
      request,
      status: "started",
      resolved: {
        model,
        ...(effort ? { reasoningEffort: effort } : {}),
        instructions,
      },
    },
    { kind: "subagent", id: agentId, agent },
  ];
}

function restoreTranscript(entries: SessionEntry[]): ChatItem[] {
  const items: ChatItem[] = [];
  const toolCallsByName = new Map<string, RestoredToolCall[]>();

  const upsert = (item: ChatItem): void => {
    const index = items.findIndex(
      (current) => current.kind === item.kind && current.id === item.id,
    );
    if (index === -1) items.push(item);
    else items[index] = item;
  };
  const markLatestCall = (
    name: string,
    matches?: (args: unknown) => boolean,
  ): void => {
    const call = [...(toolCallsByName.get(name) ?? [])]
      .reverse()
      .find((candidate) => !matches || matches(candidate.args));
    if (call) call.hasUiAnnotation = true;
  };

  for (const entry of entries) {
    if (entry.type === "user") {
      items.push({ kind: "user", id: nextId(), text: entry.content });
    } else if (entry.type === "assistant") {
      // activate_skill is handled inside the engine and, unlike regular tools,
      // does not emit a tool_result event. A following assistant message proves
      // the activation call returned; close it here when replaying older logs.
      const pendingSkills = toolCallsByName.get("activate_skill") ?? [];
      for (const call of pendingSkills) {
        const index = items.findIndex(
          (item) => item.kind === "tool" && item.id === call.id,
        );
        const item = index >= 0 ? items[index] : undefined;
        if (item?.kind !== "tool" || item.status !== "running") continue;
        const name = isRecord(item.args) && typeof item.args.name === "string"
          ? item.args.name
          : "skill";
        items[index] = {
          ...item,
          result: `Skill ativada: ${name}`,
          status: "ok",
        };
      }
      toolCallsByName.delete("activate_skill");
      items.push({
        kind: "assistant",
        id: nextId(),
        text: entry.content,
        streaming: false,
      });
    } else if (entry.type === "tool_call") {
      // `think` is a private scratchpad. Keep it out of both live and restored UI.
      if (entry.name === "think" || entry.name === "report_progress") continue;
      if (entry.name === "todo_write") {
        items.splice(0, items.length, ...recordTodoCall(items, parseTodoItems(entry.args)));
        continue;
      }
      if (entry.name === "todo_read") {
        items.splice(0, items.length, ...recordTodoCall(items));
        continue;
      }
      const id = nextId();
      const calls = toolCallsByName.get(entry.name) ?? [];
      calls.push({
        id,
        callId: entry.id,
        name: entry.name,
        args: entry.args,
        hasUiAnnotation: false,
      });
      toolCallsByName.set(entry.name, calls);
      items.push({
        kind: "tool",
        id,
        callId: entry.id,
        name: entry.name,
        args: entry.args,
        status: "running",
      });
    } else if (entry.type === "tool_result") {
      const calls = toolCallsByName.get(entry.name);
      const callIndex = entry.id
        ? (calls?.findIndex((candidate) => candidate.callId === entry.id) ?? -1)
        : calls?.length
          ? 0
          : -1;
      const call = callIndex >= 0 ? calls?.splice(callIndex, 1)[0] : undefined;
      const index = call
        ? items.findIndex((item) => item.kind === "tool" && item.id === call.id)
        : -1;
      const item = index >= 0 ? items[index] : undefined;
      if (index >= 0 && item?.kind === "tool") {
        items[index] = {
          ...item,
          result: truncateToolResult(entry.result),
          status: entry.result.startsWith("Blocked:")
            ? "denied"
            : entry.result.startsWith("Error:")
              ? "error"
              : "ok",
        };
      }
      if (!call || call.hasUiAnnotation || index < 0) continue;
      const restoredCards =
        call.name === "task"
          ? legacySubAgentItems(call, entry.result)
          : call.name === "ask_user"
            ? [legacyQuestionFromTool(call, entry.result)].filter(
                (value): value is ChatItem => Boolean(value),
              )
            : [];
      if (restoredCards.length > 0)
        items.splice(index + 1, 0, ...restoredCards);
    } else if (entry.type === "ui_event" && entry.event.version === 1) {
      const { kind, id } = entry.event;
      const data = entry.event.data;
      if (!isRecord(data) || typeof id !== "string") continue;
      if (kind === "subagent-config") {
        const request = data.request;
        if (!isSubAgentConfigRequest(request) || request.id !== id) continue;
        markLatestCall(
          "task",
          (args) =>
            isRecord(args) &&
            args.title === request.title &&
            args.prompt === request.prompt,
        );
        const status =
          data.status === "started" ||
          data.status === "cancelled" ||
          data.status === "interrupted"
            ? data.status
            : "interrupted";
        const resolved =
          isRecord(data.resolved) &&
          typeof data.resolved.model === "string" &&
          typeof data.resolved.instructions === "string"
            ? (data.resolved as {
                model: string;
                reasoningEffort?: ReasoningEffort;
                instructions: string;
              })
            : undefined;
        upsert({
          kind: "subagent-config",
          id,
          request,
          status,
          ...(resolved ? { resolved } : {}),
        });
      } else if (kind === "subagent") {
        if (
          !isRecord(data.agent) ||
          typeof data.agent.id !== "string" ||
          data.agent.id !== id ||
          typeof data.agent.title !== "string"
        )
          continue;
        const agent = data.agent as unknown as SubAgentSummary;
        markLatestCall(
          "task",
          (args) =>
            isRecord(args) &&
            args.title === agent.title &&
            args.prompt === agent.prompt,
        );
        const restoredAgent = [
          "queued",
          "running",
          "review",
          "merging",
        ].includes(agent.status)
          ? {
              ...agent,
              status: "interrupted" as const,
              progress: "Execução interrompida ao fechar o app",
            }
          : agent;
        upsert({ kind: "subagent", id, agent: restoredAgent });
      } else if (kind === "user-question") {
        const request = data.request;
        if (!isQuestionRequest(request) || request.id !== id) continue;
        markLatestCall("ask_user");
        const status =
          data.status === "answered" ||
          data.status === "cancelled" ||
          data.status === "interrupted"
            ? data.status
            : "interrupted";
        const answers =
          isRecord(data.answers) &&
          Object.values(data.answers).every(isQuestionAnswer)
            ? (data.answers as Record<string, UserQuestionAnswer>)
            : undefined;
        upsert({
          kind: "question",
          id,
          request,
          status,
          ...(answers ? { answers } : {}),
        });
      }
    }
  }

  return items.map((item) =>
    item.kind === "tool" && item.status === "running"
      ? {
          ...item,
          status: "error",
          result: "This tool call did not finish before the session ended.",
        }
      : item,
  );
}

function restoredClearedSubAgentIds(entries: SessionEntry[]): string[] {
  const cleared = new Set<string>();
  for (const entry of entries) {
    if (
      entry.type !== "ui_event" ||
      entry.event.version !== 1 ||
      entry.event.kind !== "subagent" ||
      !isRecord(entry.event.data) ||
      !Array.isArray(entry.event.data.clearedIds)
    )
      continue;
    for (const id of entry.event.data.clearedIds) {
      if (typeof id === "string" && id.length > 0) cleared.add(id);
    }
  }
  return [...cleared];
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
          `Skills disponíveis: ${state.skills.map((skill) => `/${skill.name}`).join(", ") || "nenhuma"}`,
          "/goal <texto> — define a meta do workspace; sem argumento, mostra a meta atual",
          "/goal note <texto> — adiciona uma nota de progresso",
          "/goal pause | resume | done | clear",
          "/goal auto [rodadas] — continua a meta até concluir ou atingir o limite",
          "/goal stop — interrompe a continuação automática",
          "/goal max-rounds <1-100> — ajusta o limite de continuação",
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
            ? `Meta (${goal.status}): ${goal.text}\nRodadas: ${goal.rounds}/${goal.maxRounds}` +
                (goal.blockedReason
                  ? `\nBloqueio: ${goal.blockedReason}`
                  : "") +
                (goal.notes.length > 0 ? `\n${goal.notes.length} nota(s).` : "")
            : "Nenhuma meta definida neste workspace. Use /goal <texto>.",
        );
        return true;
      }
      if (sub === "auto") {
        const maxRounds = rest[1] === undefined ? undefined : Number(rest[1]);
        if (
          maxRounds !== undefined &&
          (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 100)
        ) {
          state.pushNotice(
            "Uso: /goal auto [limite de 1 a 100 rodadas]",
            "error",
          );
        } else {
          state.startAutoGoal(maxRounds);
        }
        return true;
      }
      if (sub === "stop") {
        state.stopAutoGoal();
        return true;
      }
      if (sub === "max-rounds") {
        const maxRounds = Number(rest[1]);
        if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 100) {
          state.pushNotice("Uso: /goal max-rounds <1-100>", "error");
        } else {
          state.setGoalMaxRounds(maxRounds);
        }
        return true;
      }
      if (sub === "note") {
        const note = rest.slice(1).join(" ").trim();
        if (note) state.noteGoal(note);
        else state.pushNotice("Uso: /goal note <texto>", "error");
        return true;
      }
      if (sub === "pause") {
        if (rest.length > 1) {
          state.pushNotice("Uso: /goal pause", "error");
          return true;
        }
        state.setGoalStatus("paused");
        return true;
      }
      if (sub === "resume") {
        if (rest.length > 1) {
          state.pushNotice("Uso: /goal resume", "error");
          return true;
        }
        state.setGoalStatus("active");
        return true;
      }
      if (sub === "done" || sub === "complete") {
        if (rest.length > 1) {
          state.pushNotice("Uso: /goal done", "error");
          return true;
        }
        state.setGoalStatus("complete");
        return true;
      }
      if (sub === "clear") {
        if (rest.length > 1) {
          state.pushNotice("Uso: /goal clear", "error");
          return true;
        }
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
      state.pushNotice(
        `Comando desconhecido: /${command}. Use /help.`,
        "error",
      );
      return true;
  }
}

/** Whether a slash command has an engine response that can resume FIFO draining. */
function slashCommandWaitsForEngine(text: string, skills: SkillSummary[]): boolean {
  const [command = "", ...rest] = text.slice(1).split(/\s+/);
  const name = command.toLowerCase();
  const arg = rest.join(" ").trim();
  if (name === "help" || name === "clear") return false;
  if (name === "compact" || name === "mode" || name === "plan") {
    if (name === "mode") {
      return ["ask", "normal", "edits", "accept-edits", "acceptedits", "plan"].includes(arg.toLowerCase());
    }
    return true;
  }
  if (name === "goal") {
    if (!arg) return false;
    const action = rest[0]?.toLowerCase();
    if (action === "auto") {
      const rounds = rest[1] === undefined ? undefined : Number(rest[1]);
      return rounds === undefined || (Number.isInteger(rounds) && rounds >= 1 && rounds <= 100);
    }
    if (action === "stop" || action === "note") return action === "stop" || Boolean(rest.slice(1).join(" ").trim());
    if (action === "max-rounds") {
      const rounds = Number(rest[1]);
      return Number.isInteger(rounds) && rounds >= 1 && rounds <= 100;
    }
    if (["pause", "resume", "done", "complete", "clear"].includes(action ?? "")) {
      return rest.length === 1;
    }
    return true;
  }
  return skills.some((skill) => skill.name.toLowerCase() === name);
}

/** Adds a transcript echo and dispatches one prompt or UI command. */
function dispatchText(
  text: string,
  get: () => State,
  set: (partial: Partial<State> | ((state: State) => Partial<State>)) => void,
): boolean {
  if (isKnownSlashCommand(text, get().skills)) {
    set((s) => ({
      items: [
        ...closeStreaming(s.items),
        { kind: "user", id: nextId(), text },
      ],
    }));
    const waitsForResponse = slashCommandWaitsForEngine(text, get().skills);
    if (waitsForResponse) set({ queueCommandPending: true });
    if (/^\/compact(?:\s|$)/i.test(text)) set({ compacting: true });
    runSlashCommand(text, get);
    return waitsForResponse;
  }

  set((s) => ({
    items: [
      ...closeStreaming(s.items),
      { kind: "user", id: nextId(), text },
    ],
    turnCount: s.turnCount + 1,
    busy: true,
  }));
  window.ruby.sendPrompt(text);
  return true;
}

export const useStore = create<State>((set, get) => ({
  workspace: "",
  recentWorkspaces: [],
  models: [],
  model: "",
  reasoningEffort: undefined,
  status: "starting",
  items: [],
  queuedMessages: [],
  turnCount: 0,
  stepCount: 0,
  sessions: [],
  clearedSubAgentIds: [],
  busy: false,
  queueCommandPending: false,
  contextWindow: 0,
  contextUsed: 0,
  contextSource: "engine",
  compacting: false,
  permissionMode: "normal",
  grants: { project: [], global: [] },
  goalAutoRunning: false,
  mcpServers: [],
  skills: [],
  metrics: [],
  sessionUsage: emptySessionUsageStats(),
  browser: { open: false, tabs: [] },

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
            reasoningEffort: message.reasoningEffort,
            toolCount: message.toolCount,
            skillCount: message.skillCount,
            keySource: message.keySource,
          },
          workspace: message.workspace,
          model: message.model,
          reasoningEffort: message.reasoningEffort,
          skills: message.skills,
          permissionMode: message.permissionMode,
          ...(switched
            ? {
                items: notice(
                  [],
                  `Workspace alterado para ${message.workspace}`,
                ),
                turnCount: 0,
                stepCount: 0,
                sessions: [],
                currentSessionId: undefined,
                clearedSubAgentIds: [],
                contextUsed: 0,
                contextSource: "engine",
                metrics: [],
                sessionUsage: emptySessionUsageStats(),
                goal: undefined,
                goalAutoRunning: false,
                approval: undefined,
                queuedMessages: [],
              }
            : {}),
        });
        return;
      }

      case "models":
        set({ models: message.models });
        return;

      case "modelSelection":
        set((s) => ({
          model: message.model,
          reasoningEffort: message.reasoningEffort,
          engine: s.engine
            ? {
                ...s.engine,
                model: message.model,
                reasoningEffort: message.reasoningEffort,
              }
            : undefined,
        }));
        return;

      case "skills":
        set((s) => ({
          skills: message.skills,
          engine: s.engine
            ? { ...s.engine, skillCount: message.skills.length }
            : undefined,
        }));
        return;

      case "sessions": {
        const transcriptItems = message.transcript !== undefined
          ? restoreTranscript(message.transcript)
          : undefined;
        const clearedSubAgentIds = message.transcript !== undefined
          ? restoredClearedSubAgentIds(message.transcript)
          : undefined;
        set({
          sessions: message.sessions,
          currentSessionId: message.currentSessionId,
          queueCommandPending: false,
          ...(transcriptItems !== undefined
            ? {
                items: transcriptItems,
                clearedSubAgentIds,
                ...countChatItems(transcriptItems),
                contextUsed: 0,
                contextSource: "engine",
                metrics: [],
                sessionUsage: emptySessionUsageStats(),
              }
            : {}),
        });
        get().drainQueue();
        return;
      }

      case "status":
        set({
          status: message.status,
          busy: message.status === "busy",
          ...(message.status === "ready" ? { queueCommandPending: false } : {}),
          ...(message.status !== "busy" ? { turnProgress: undefined } : {}),
        });
        if (message.status === "ready") get().drainQueue();
        return;

      case "turnProgress":
        set((s) => {
          const publicSummary =
            message.phase === "public_update"
              ? message.message
              : s.turnProgress?.publicSummary;
          return {
            turnProgress: {
              ...message,
              receivedAt: Date.now(),
              ...(publicSummary ? { publicSummary } : {}),
            },
          };
        });
        return;

      case "usage":
        set({
          contextUsed: message.inputTokens,
          contextWindow: message.contextWindow,
          contextSource: message.contextSource,
        });
        return;

      case "permissionMode":
        set((s) => ({
          permissionMode: message.mode,
          queueCommandPending: false,
          items: notice(
            s.items,
            `Modo de permissão: ${PERMISSION_MODE_LABEL[message.mode]}`,
          ),
        }));
        get().drainQueue();
        return;

      case "grants":
        set({ grants: message.grants });
        return;

      case "goal":
        set({ goal: message.goal, queueCommandPending: false });
        get().drainQueue();
        return;

      case "goalAuto":
        set({ goalAutoRunning: message.running });
        return;

      case "workflowEvent":
        set((s) => ({
          items: notice(s.items, `Workflow · ${message.event.message}`),
        }));
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
          metrics: [...s.metrics, { ...message.line, id: `metric-${++metricCounter}` }].slice(-300),
          sessionUsage: accumulateSessionUsage(s.sessionUsage, message.line),
        }));
        return;

      case "browserState":
        set({
          browser: {
            open: message.open,
            url: message.url,
            title: message.title,
            activeTabId: message.activeTabId,
            tabs: message.tabs ?? [],
          },
        });
        return;

      case "workspaceRecents":
        set({ recentWorkspaces: message.workspaces });
        return;

      case "compacting":
        set({
          compacting: message.active,
          ...(message.active ? {} : { queueCommandPending: false }),
        });
        if (!message.active) get().drainQueue();
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
            {
              kind: "question",
              id: message.request.id,
              request: message.request,
              status: "pending",
            },
          ],
        }));
        return;

      case "userQuestionResolved":
        if (message.cancelled) {
          set((s) => ({
            items: s.items.map((item) =>
              item.kind === "question" &&
              item.id === message.id &&
              item.status === "pending"
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
              ? {
                  ...item,
                  status: message.action === "start" ? "started" : "cancelled",
                  ...(message.config ? { resolved: message.config } : {}),
                }
              : item,
          ),
        }));
        return;

      case "subAgentUpdate":
        set((s) => {
          const index = s.items.findIndex(
            (item) =>
              item.kind === "subagent" && item.agent.id === message.agent.id,
          );
          if (index === -1) {
            return {
              items: [
                ...closeStreaming(s.items),
                {
                  kind: "subagent",
                  id: message.agent.id,
                  agent: message.agent,
                },
              ],
            };
          }
          const items = [...s.items];
          items[index] = {
            kind: "subagent",
            id: message.agent.id,
            agent: message.agent,
          };
          return { items };
        });
        return;

      case "error":
        set((s) => ({
          items: notice(s.items, message.message, "error"),
          queueCommandPending: false,
          ...(s.compacting && s.queueCommandPending ? { compacting: false } : {}),
        }));
        get().drainQueue();
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
            if (event.name === "think" || event.name === "report_progress") {
              set((s) => ({
                stepCount: s.stepCount + 1,
                items: closeStreaming(s.items),
              }));
              return;
            }
            if (event.name === "todo_write" || event.name === "todo_read") {
              const todos =
                event.name === "todo_write"
                  ? parseTodoItems(event.args)
                  : undefined;
              set((s) => ({
                stepCount: s.stepCount + 1,
                items: recordTodoCall(closeStreaming(s.items), todos),
              }));
              return;
            }
            set((s) => ({
              stepCount: s.stepCount + 1,
              items: [
                ...closeStreaming(s.items),
                {
                  kind: "tool",
                  id: nextId(),
                  callId: event.id,
                  name: event.name,
                  args: event.args,
                  status: "running",
                },
              ],
            }));
            return;

          case "tool_result":
            if (event.name === "think" || event.name === "report_progress") return;
            if (event.name === "todo_write" || event.name === "todo_read") return;
            set((s) => {
              // Provider IDs pair results with their exact call; retain the name/FIFO
              // fallback for older engines that do not emit IDs.
              const items = [...s.items];
              for (let i = items.length - 1; i >= 0; i--) {
                const item = items[i];
                if (
                  item.kind === "tool" &&
                  (event.id
                    ? item.callId === event.id
                    : item.name === event.name) &&
                  item.status === "running"
                ) {
                  items[i] = {
                    ...item,
                    result: truncateToolResult(event.result),
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
            set((s) => {
              const items = [...s.items];
              for (let i = items.length - 1; i >= 0; i--) {
                const item = items[i];
                if (
                  item.kind === "tool" &&
                  item.name === "activate_skill" &&
                  item.status === "running" &&
                  isRecord(item.args) &&
                  item.args.name === event.name
                ) {
                  items[i] = {
                    ...item,
                    result: `Skill ativada: ${event.name}`,
                    status: "ok",
                  };
                  break;
                }
              }
              return {
                items: notice(items, `Skill ativada: ${event.name}`),
              };
            });
            return;

          case "notice":
            set((s) => ({ items: notice(s.items, event.message) }));
            return;

          case "error":
            set((s) => ({ items: notice(s.items, event.message, "error") }));
            return;

          case "done":
            set((s) => ({
              items: closeStreaming(s.items),
              turnProgress: undefined,
            }));
            return;
        }
      }
    }
  },

  send: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const state = get();
    if (state.busy || state.compacting || state.queueCommandPending) {
      set((s) => ({
        queuedMessages: [
          ...s.queuedMessages,
          { id: nextId(), text: trimmed, createdAt: Date.now() },
        ],
      }));
      return;
    }

    dispatchText(trimmed, get, set);
  },

  removeQueuedMessage: (id) => {
    set((s) => ({
      queuedMessages: s.queuedMessages.filter((message) => message.id !== id),
    }));
  },

  moveQueuedMessage: (id, direction) => {
    set((s) => {
      const index = s.queuedMessages.findIndex((message) => message.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= s.queuedMessages.length) return {};
      const queuedMessages = [...s.queuedMessages];
      [queuedMessages[index], queuedMessages[target]] = [
        queuedMessages[target],
        queuedMessages[index],
      ];
      return { queuedMessages };
    });
  },

  drainQueue: () => {
    const state = get();
    if (
      state.status !== "ready" ||
      state.busy ||
      state.compacting ||
      state.queueCommandPending ||
      state.queuedMessages.length === 0
    ) {
      return;
    }

    const [next, ...remaining] = state.queuedMessages;
    if (!next) return;
    set({ queuedMessages: remaining });
    const waitingForResponse = dispatchText(next.text, get, set);

    // Local commands such as /help do not start an engine turn. Keep draining
    // those in order; model turns and compaction stop the queue until completion.
    if (
      !waitingForResponse &&
      !get().busy &&
      !get().compacting &&
      get().status === "ready"
    ) {
      queueMicrotask(() => get().drainQueue());
    }
  },

  activateSkill: (name, args) => {
    const state = get();
    if (state.busy) {
      state.pushNotice("Aguarde o turno atual terminar para ativar outra Skill.", "error");
      return;
    }
    const skill = state.skills.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (!skill) {
      state.pushNotice(`Skill desconhecida: ${name}`, "error");
      return;
    }
    const command = `/${skill.name}${args.trim() ? ` ${args.trim()}` : ""}`;
    set((s) => ({
      items: [
        ...closeStreaming(s.items),
        { kind: "user", id: nextId(), text: command },
      ],
      busy: true,
    }));
    window.ruby.activateSkill(skill.name, args);
  },

  pushNotice: (text, tone = "info") => {
    set((s) => ({ items: notice(s.items, text, tone) }));
  },

  abort: () => window.ruby.abort(),

  selectModel: (model, reasoningEffort) => {
    window.ruby.setModel(model, reasoningEffort);
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
          ? {
              ...item,
              status: answers ? "answered" : "cancelled",
              answers: answers ?? undefined,
            }
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

  respondSubAgentReview: (id, action) =>
    window.ruby.respondSubAgentReview(id, action),

  clearCompletedSubAgents: (ids) => {
    const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
    if (unique.length === 0) return;
    set((state) => ({
      clearedSubAgentIds: [...new Set([...state.clearedSubAgentIds, ...unique])],
    }));
    window.ruby.clearSubAgents(unique);
  },

  compact: () => {
    set({ compacting: true, queueCommandPending: true });
    window.ruby.compact();
  },

  newSession: () => {
    set({ queuedMessages: [], queueCommandPending: true });
    window.ruby.newSession();
  },
  resumeSession: (sessionId) => {
    set({ queuedMessages: [], queueCommandPending: true });
    window.ruby.resumeSession(sessionId);
  },

  setGoal: (text) => window.ruby.setGoal(text),
  noteGoal: (text) => window.ruby.noteGoal(text),
  setGoalStatus: (status) => window.ruby.setGoalStatus(status),
  setGoalMaxRounds: (maxRounds) => window.ruby.setGoalMaxRounds(maxRounds),
  startAutoGoal: (maxRounds) => {
    set({ queueCommandPending: true });
    window.ruby.startAutoGoal(maxRounds);
  },
  stopAutoGoal: () => window.ruby.stopAutoGoal(),
  clearGoal: () => window.ruby.clearGoal(),

  refreshMcp: () => window.ruby.refreshMcp(),
  addMcpServer: (name, config) => window.ruby.addMcpServer(name, config),
  removeMcpServer: (name) => window.ruby.removeMcpServer(name),
  testMcpServer: (name, config) => window.ruby.testMcpServer(name, config),
  clearMcpTest: () => set({ mcpTest: undefined }),

  switchWorkspace: (path) => {
    set({ queuedMessages: [], queueCommandPending: true });
    window.ruby.setWorkspace(path);
  },

  pickWorkspace: () => {
    void window.ruby.pickWorkspace().then((path) => {
      if (path) get().switchWorkspace(path);
    });
  },

  reset: () => {
    set({
      items: [],
      clearedSubAgentIds: [],
      queuedMessages: [],
      queueCommandPending: true,
      turnCount: 0,
      stepCount: 0,
      contextUsed: 0,
      contextSource: "engine",
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
  return window.ruby.onEngineMessage((message) =>
    useStore.getState().handleMessage(message),
  );
}
