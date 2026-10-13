import { useState } from "react";
import { Plug, Plus, RefreshCw, Trash2, X, Check, AlertTriangle } from "lucide-react";
import { useStore } from "../store";
import { cn } from "../lib/utils";
import type { McpServerDraft } from "@shared/ipc";

/**
 * MCP server management.
 *
 * MCP is the feature the whole app exists to make easy, so the panel does three
 * things and no more: show what is configured and whether it works, add a server,
 * and try one before saving it. The "test" step matters — a broken server in
 * mcp.json is otherwise only visible as tools that silently never appear.
 */
export function McpPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const servers = useStore((s) => s.mcpServers);
  const test = useStore((s) => s.mcpTest);
  const refresh = useStore((s) => s.refreshMcp);
  const remove = useStore((s) => s.removeMcpServer);
  const add = useStore((s) => s.addMcpServer);
  const testServer = useStore((s) => s.testMcpServer);
  const clearTest = useStore((s) => s.clearMcpTest);
  const [adding, setAdding] = useState(false);

  return (
    <div
      data-testid="mcp-panel"
      className="flex w-96 shrink-0 flex-col border-l border-sidebar-border bg-sidebar"
    >
      <header className="flex items-center gap-2 border-b border-sidebar-border px-4 py-3">
        <Plug className="h-3.5 w-3.5 text-chart-1" />
        <span className="eyebrow">Servidores MCP</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={refresh}
          title="Reconectar servidores"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Fechar"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {adding ? (
          <AddServerForm
            onCancel={() => setAdding(false)}
            onTest={(name, config) => testServer(name, config)}
            onSave={(name, config) => {
              add(name, config);
              setAdding(false);
            }}
            test={test}
            clearTest={clearTest}
          />
        ) : null}

        {servers.length === 0 && !adding ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            Nenhum servidor MCP configurado. Adicione um para incluir ferramentas ao agente.
          </p>
        ) : null}

        <div className="space-y-2">
          {servers.map((server) => (
            <div
              key={server.name}
              data-testid={`mcp-server-${server.name}`}
              className="rounded-lg border border-line bg-card px-3 py-2"
            >
              <div className="flex items-center gap-2">
                {server.connected ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-chart-5" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-chart-3" />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                  {server.name}
                </span>
                <button
                  type="button"
                  onClick={() => remove(server.name)}
                  title="Remover servidor"
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>

              {server.error ? (
                <p className="mt-1 text-[11px] break-words text-chart-3">{server.error}</p>
              ) : null}

              {server.tools.length > 0 ? (
                <ul className="mt-1.5 space-y-0.5">
                  {server.tools.map((tool) => (
                    <li
                      key={tool.name}
                      className="truncate font-mono text-[10px] text-muted-foreground"
                      title={tool.description}
                    >
                      mcp__{server.toolPrefix}__{tool.name}
                    </li>
                  ))}
                </ul>
              ) : server.connected && !server.error ? (
                <p className="mt-1 text-[11px] text-muted-foreground">conectado, sem ferramentas</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {!adding ? (
        <div className="border-t border-sidebar-border p-3">
          <button
            type="button"
            onClick={() => {
              clearTest();
              setAdding(true);
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar servidor
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Add form with a test-before-save step. */
function AddServerForm({
  onCancel,
  onSave,
  onTest,
  test,
  clearTest,
}: {
  onCancel: () => void;
  onSave: (name: string, config: McpServerDraft) => void;
  onTest: (name: string, config: McpServerDraft) => void;
  test?: { connected: boolean; error?: string; tools: { name: string }[] };
  clearTest: () => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");

  // Any edit invalidates a previous test result: leaving it on screen would show a
  // green "connected" for a config that is no longer the one being described.
  const edit = <T,>(setter: (value: T) => void) => (value: T): void => {
    clearTest();
    setter(value);
  };

  const draft = (): McpServerDraft =>
    transport === "http"
      ? { transport: "http", url: url.trim() }
      : {
          transport: "stdio",
          command: command.trim(),
          // Space-separated is what every MCP README shows, and parsing JSON here
          // would be a second syntax for the user to get wrong.
          args: args.trim() ? args.trim().split(/\s+/) : undefined,
        };

  const valid = name.trim() !== "" && (transport === "http" ? url.trim() !== "" : command.trim() !== "");

  return (
    <div className="mb-3 rounded-lg border border-line bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="eyebrow">Novo servidor</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <Field label="Nome">
        <input
          value={name}
          onChange={(e) => edit(setName)(e.target.value)}
          placeholder="filesystem"
          className="w-full rounded border border-line bg-page px-2 py-1 font-mono text-xs text-foreground outline-none focus:border-ring"
        />
      </Field>

      <Field label="Transporte">
        <div className="flex gap-1">
          {(["stdio", "http"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => edit(setTransport)(t)}
              className={cn(
                "rounded px-2 py-0.5 text-[11px] transition-colors",
                transport === t
                  ? "bg-sidebar-accent text-foreground"
                  : "text-muted-foreground hover:bg-white/5",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </Field>

      {transport === "stdio" ? (
        <>
          <Field label="Comando">
            <input
              value={command}
              onChange={(e) => edit(setCommand)(e.target.value)}
              placeholder="npx"
              className="w-full rounded border border-line bg-page px-2 py-1 font-mono text-xs text-foreground outline-none focus:border-ring"
            />
          </Field>
          <Field label="Argumentos">
            <input
              value={args}
              onChange={(e) => edit(setArgs)(e.target.value)}
              placeholder="-y @modelcontextprotocol/server-filesystem ."
              className="w-full rounded border border-line bg-page px-2 py-1 font-mono text-xs text-foreground outline-none focus:border-ring"
            />
          </Field>
        </>
      ) : (
        <Field label="URL">
          <input
            value={url}
            onChange={(e) => edit(setUrl)(e.target.value)}
            placeholder="https://example.dev/mcp"
            className="w-full rounded border border-line bg-page px-2 py-1 font-mono text-xs text-foreground outline-none focus:border-ring"
          />
        </Field>
      )}

      {test ? (
        <div
          className={cn(
            "mt-2 rounded border px-2 py-1.5 text-[11px]",
            test.connected
              ? "border-chart-5/40 bg-chart-5/5 text-foreground/80"
              : "border-chart-3/40 bg-chart-3/5 text-chart-3",
          )}
        >
          {test.connected
            ? `Conectado — ${test.tools.length} ${test.tools.length === 1 ? "ferramenta disponível" : "ferramentas disponíveis"}.`
            : `Falha: ${test.error}`}
        </div>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={!valid}
          onClick={() => onSave(name.trim(), draft())}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Salvar
        </button>
        <button
          type="button"
          disabled={!valid}
          onClick={() => onTest(name.trim(), draft())}
          className="rounded-md border border-line px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-white/5 disabled:opacity-40"
        >
          Testar conexão
        </button>
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground">
        Salvo em ~/.rubycli/mcp.json. O teste conecta sem salvar, para verificar o servidor
        antes de incluir as ferramentas no agente.
      </p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="mb-2 block">
      <span className="mb-0.5 block text-[10px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
