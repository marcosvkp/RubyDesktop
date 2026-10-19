# Plano — Ruby Desktop (App de Agents)

> App desktop de agentes de código, estilo DeepSeek Harness, conectado ao provider Ruby.
> Base: **`marcosvkp/rubycli`** (MIT, TypeScript) — engine que já existe e já é seu.

Status: **M0–M6 ✅ · M3.5–M3.7 UX ✅ · M4.1–M4.4 ✅ · M6.1 Git/worktrees ✅ · `v0.1.8` multiplataforma publicada · M8 implementado · M7.2 imagens entregue · M7.1/M7.3 pendentes**
Data: 2026-10-19
Workspace: `G:\VSCodeProjects\RubyDesktop`
Repos: `RubyDesktop` (este) + `RubyCLI` (engine, local em `G:\VSCodeProjects\RubyCLI`)

**Atualização de implementação — 2026-10-17:** limite de ciclos do agente principal configurável no
Desktop (1–500, padrão 50), fila de mensagens e indicador de atividade foram entregues. A release
`v0.1.5` foi publicada após sucesso dos builds Windows, Linux e macOS, com 17 artefatos. A CI
`39047192606` passou. Nesta validação local, `npm run typecheck` e `npm run build` passaram.
**`v0.1.6` — 2026-10-17:** reasoning effort configurável e persistente no seletor do modelo, lista de
tarefas do agente no chat e Skills visuais de Minecraft reforçadas. O RubyCLI foi pinado em
`2dda3e29ddb75c0f118c1e18746a20fe1947f2a9`. A CI `39068759583` e o workflow de release
`39068771826` passaram em Windows, Linux e macOS; a release foi publicada com 17 assets.
**`v0.1.7` — 2026-10-18:** RubyCLI pinado em
`3af15adcd0a78cb37b459f0947a7dcc4d47c9723`. Navegador, Git, Worktrees e MCP
passaram a compartilhar a área lateral direita. Git mostra status/diff, stage/unstage e commit
explícito; Worktrees lista, cria, abre e remove worktrees limpos. O painel MCP foi simplificado e os
subagentes agora executam em segundo plano, com consulta por ID e restauração de status pela sessão.
`npm run build` passou; CI `39093051445` e release `39093055854` passaram nos três sistemas. A release
foi publicada com 17 assets para Windows, Linux e macOS. Os instaladores Windows/macOS são unsigned,
portanto o sistema pode exibir avisos e atualizações automáticas dessas plataformas não estão ativas.
**`v0.1.8` — 2026-10-19:** geração e edição de imagens via API Ruby, prévia no chat e `save_path`
obrigatório que persiste cada resultado no projeto. RubyCLI pinado em
`e7fbd81d2bb0bd58c1305438e4b208bcd46563cf`. CI `39300373579` e release `39300378171` passaram em
Windows, Linux e macOS, com 17 assets publicados. Windows/macOS seguem sem assinatura.
Historicamente, a `v0.1.3` foi publicada com 19 artefatos. Na validação local daquela rodada,
`smoke-markdown`, `smoke-session-history` e `smoke-browser` passaram; `smoke-main` recebeu HTTP 502
do provider, `smoke-permissions` não completou uma segunda chamada ao provider e `smoke-mcp` não foi
repetido. A suíte completa de smokes havia passado na etapa M6 anterior.

RubyCLI build/typecheck/lint/format passaram; o Vitest local executado pelo hook reportou 1165
aprovados, 70 ignorados e 21 falhas nos casos live, com assertion de libuv no Node 24/Windows
(`3221226505`). As falhas da CI anterior em resolução de caminhos e startup de shell foram corrigidas
em `rubycli@9eb5139` e `rubycli@b02ca4e`; a CI do Desktop `c722d9b` passou em Windows, Linux e
macOS, incluindo os smokes determinísticos e verificação dos pacotes.

**Hardening `FIX-1` a `FIX-38` — 2026-10-14:** concluídas as correções aplicáveis ao Desktop:
validação de IPC e navegação, blocklist e grants, encerramento/reset do engine, RPC e refs do
browser, worktrees, persistência de subagentes, proteção de memória e renderização, acessibilidade,
coletor de releases, verificador de pacotes, pin do RubyCLI e hardening de CI/build. `npm run
typecheck` e `npm run build` passaram. A CI cobre smokes determinísticos de worktrees, staging de
release, updater e modo Node stdio do executável empacotado; também roda os seis smokes Electron nos
três sistemas quando `RUBY_API_KEY` está definida. Os smokes não foram executados localmente nesta
rodada. O RubyCLI ainda precisa adicionar ids em `tool_call`/`tool_result` para o Desktop poder
correlacionar chamadas idênticas concorrentes sem heurística.

**Estado verificado no fim do M2**

- RubyCLI: suíte **1104 passando / 0 falhando** (baseline do Windows zerado), `typecheck`,
  `lint` e `format:check` limpos. Commits `47cc5e0` e `fd17d52` sobre os 3 do M0.
- RubyDesktop: `typecheck:node` + `typecheck:web` limpos, build de engine/main/preload/renderer OK.
- Smoke tests (Electron real, artefatos buildados, provider ao vivo):
  - `scripts/smoke-main.cjs` → PASS, exit 0.
  - `scripts/smoke-permissions.cjs` → PASS, exit 0: modal renderiza e permite; o `mkdir`
    permitido **cria o diretório de fato**; o negado devolve `Blocked:` e **não cria**;
    banner de goal renderiza; `/compact` completa.

**Estado verificado no fim do M3 (MCP + painel de saída + browser)**

- RubyCLI: suíte **1129 passando / 0 falhando**, `typecheck`/`lint`/`format:check` limpos.
  Commits `fa3dfec` (MCP para embedders) e `82770a2` (default model + `RUBYCLI_HOME`).
- RubyDesktop: `typecheck` limpo, build OK. Commits `ec0e131` (MCP + output panel) e
  `a15adfe` (browser via CDP).
- **Os quatro smoke tests passam com exit 0**, todos contra artefatos buildados e provider ao vivo:
  | Teste | O que prova |
  |---|---|
  | `smoke-main.cjs` | turno real, streaming, sem erros |
  | `smoke-permissions.cjs` | modal permite/nega; o `mkdir` permitido cria de fato, o negado não cria; goal renderiza; `/compact` completa |
  | `smoke-mcp.cjs` | servidor MCP real como subprocesso; o modelo chama a tool e recebe o marcador do fixture; servidor quebrado é reportado sem afetar o saudável |
  | `smoke-browser.cjs` | navegação, digitação e clique via CDP com efeito real na página; back, scroll, screenshot, ref obsoleto rejeitado |

---

## 1. Decisão central

**Não forkar um app de terceiros. Extrair o engine do `rubycli` e construir um shell Electron fino em cima.**

Por quê: o `rubycli` já é um engine de agente completo (loop, providers, MCP, tools, subagentes, goal, compact, sessões, permissões). O que falta não é o _cérebro_ — é uma **casca desktop** e **três capacidades novas** (browser controlável, orquestração real de subagentes, empacotamento). Construir isso em cima do engine é ordens de magnitude menos trabalho do que forkar opencode/goose/Jan e reimplementar provider + MCP + loop.

Consequência: o `rubycli` passa a publicar o engine como **biblioteca** (`@rubycli/core`) e o Desktop é um **repositório separado** que consome essa biblioteca. Um engine, duas interfaces (CLI + Desktop), dois repos.

**Decisão tomada:** repo separado consumindo o core publicado (não monorepo único).

Implicação prática: todo o trabalho de engine (extrair o core, injetar `ConfirmFn`, enriquecer os eventos, subagentes com worktree, corrigir os bugs) acontece **no repo `rubycli`**; todo o trabalho de casca desktop acontece **neste repo (`RubyDesktop`)**. O plano tem duas trilhas paralelas por isso.

---

## 2. O que já existe no `rubycli` (inventário verificado)

Li o repositório `github.com/marcosvkp/rubycli` (332 entradas, ~149 arquivos em `src/`, ~890 KB de TS fora de `eval/`). Já implementado:

| Capacidade                                                                    | Onde                                  | Estado                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| Loop do agente (react, 50 turnos, abort por erro de ambiente)                 | `src/core/agent.ts` (21 KB)           | ✅ pronto                                                       |
| Stream de eventos (`AgentEvent`)                                              | `src/core/agent.ts`                   | ✅ pronto                                                       |
| Providers: OpenAI-compat, Anthropic, Gemini, Ollama                           | `src/providers/*`                     | ✅ pronto                                                       |
| Registry de providers com `baseUrl` custom                                    | `src/providers/registry.ts`           | ✅ pronto                                                       |
| Acumulação de `tool_calls` em streaming (por `index`)                         | `src/providers/openai.ts`             | ✅ pronto                                                       |
| Salvage de tool calls em texto (modelos OSS)                                  | `src/providers/salvage.ts`            | ✅ pronto                                                       |
| **MCP** stdio + streamable HTTP                                               | `src/mcp/*`                           | ✅ pronto                                                       |
| Tools: read/write/edit/multiEdit/glob/grep/ls/bash/webFetch/todo/think        | `src/tools/*`                         | ✅ pronto                                                       |
| **Subagente** (`task`, read-only, 15 turnos)                                  | `src/tools/task/subagent.ts`          | ⚠️ parcial                                                      |
| **Goal** persistente (`active`/`paused`/`complete` + notas)                   | `src/state/goal.ts`                   | ✅ pronto                                                       |
| **Compact** + auto-compact em 75% do contexto                                 | `src/core/compact.ts`                 | ✅ pronto                                                       |
| Sessões + snapshots/rewind                                                    | `src/state/session.ts`, `snapshot.ts` | ✅ pronto                                                       |
| Permissões por projeto                                                        | `src/state/project-permissions.ts`    | ✅ pronto                                                       |
| Skills (41 builtin: 13 gerais + 28 Minecraft; autocomplete no Desktop) | `src/skills/*`                   | ✅ engine publicado em `rubycli@b02ca4e` e pinado no candidato Desktop `0.1.4` |
| Sandbox de exec (macOS `sandbox-exec`, Linux `bwrap`, passthrough no Windows) | `src/tools/exec/sandbox/*`            | ⚠️ no Windows é passthrough                                     |
| Slash commands `/goal /compact /plan /auto /rewind …`                         | `src/cli/repl.ts` + composer          | ✅ parcial no Desktop; `/auto`, `/rewind` seguem só no terminal |

**Conclusão: ~80% do que o app precisa já está escrito.** O trabalho é de integração e casca.

---

## 3. Achados dos testes ao vivo (evidência, não suposição)

Rodei testes reais contra `https://app.rubycli.cloud/v1` usando a chave já configurada em `~/.rubycli/config.json`. Resultados:

### 3.1 Tool calling: **FUNCIONA** ✅

O ponto que decidia o projeto inteiro. Confirmado ao vivo:

| Teste                                                           | Modelos                                                                                       | Resultado                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Tool call não-streaming                                         | `ruby-smart`, `glm-5.3`, `glm-5.3-flash`, `deepseek-v4.1-flash`, `muse-spark-1.3-contributor` | `finish_reason=tool_calls`, `tool_calls` estruturado com args JSON corretos ✅ |
| Deltas incrementais em streaming                                | `muse-spark-1.3-contributor`                                                                  | `delta.tool_calls[].index=0` → `id`+`name` → fragmento `{"city":"Paris"}` ✅   |
| `stream_options:{include_usage:true}`                           | idem                                                                                          | `usage` no chunk final (`prompt=732 completion=362 total=1094`) ✅             |
| `tool_choice:"auto"` / `"required"` / `"none"`                  | `muse-spark`                                                                                  | Todos aceitos. `required` força a chamada; `none` suprime ✅                   |
| **Tool calls paralelos**                                        | `ruby-smart`                                                                                  | 2 `tool_calls` numa resposta (`get_weather` + `get_time`) ✅                   |
| Round-trip multi-turno (`assistant.tool_calls` + `role:"tool"`) | `ruby-smart`                                                                                  | Formato aceito sem erro ✅                                                     |
| Anthropic `tool_use` em `/anthropic/v1/messages`                | `ruby-smart`                                                                                  | `stop_reason=tool_use`, `input={"city":"Paris"}`, `usage in=722 out=189` ✅    |
| `/v1/messages` (shape Anthropic)                                | `ruby-smart`                                                                                  | Também funciona ✅                                                             |

Ou seja: **`tool_choice`, tool calls paralelos e o formato Anthropic funcionam** — três coisas que a documentação pública não cobre. Pode desenhar o loop com confiança total.

### 3.2 Catálogo real: 14 modelos

`GET /v1/models` devolve, por modelo: `id, name, display_name, object, type, created, created_at, owned_by, context_window, max_output_tokens, supports_reasoning, supports_vision`.

| id                           | contexto  | reasoning | vision |
| ---------------------------- | --------- | --------- | ------ |
| `ruby-smart`                 | 512.000   | ❌        | ✅     |
| `gpt-6-sol`                  | 1.000.000 | ✅        | ✅     |
| `gpt-6.1-sol`                | 1.000.000 | ✅        | ✅     |
| `gpt-6-astra`                | 1.000.000 | ✅        | ✅     |
| `deepseek-v4.1-flash`        | 1.000.000 | ✅        | ✅     |
| `glm-5.3`                    | 1.000.000 | ✅        | ❌     |
| `glm-5.3-flash`              | 1.000.000 | ✅        | ✅     |
| `gpt-6-luna`                 | 1.000.000 | ✅        | ✅     |
| `muse-spark-1.3-contributor` | 1.000.000 | ❌        | ✅     |
| `kimi-k3`                    | 1.000.000 | ✅        | ✅     |
| `mimo-v2.6-flash`            | 1.048.576 | ✅        | ✅     |
| `mimo-v2.6-pro`              | 1.048.576 | ✅        | ✅     |
| `mimo-v2.6-pro-ultraspeed`   | 1.048.576 | ✅        | ✅     |

> **Correção de registro.** Numa versão anterior deste documento eu afirmei que o
> catálogo devolvia um modelo com `id` vazio (`display_name` "the model 5.5").
> **Isso estava errado** — foi um erro meu de leitura, não um bug do provider.
> Verifiquei com dump do JSON cru: 14 modelos, **nenhum** com `id` ausente, nulo ou
> em branco. O filtro defensivo que ficou no `models.ts` é hardening legítimo, mas
> não corrige um defeito observado.

### 3.3 Dois bugs encontrados 🔴

**(1) `ruby-auto` não existe — o CLI está quebrado out-of-the-box.**

```
POST /v1/chat/completions  {"model":"ruby-auto", ...}
→ 404 {"error":{"message":"O modelo 'ruby-auto' não existe. Consulte GET /v1/models.",
        "type":"not_found_error","param":"model","code":"model_not_found"}}
```

Mas `DEFAULT_MODEL = "ruby-auto"` em `src/rubycli.ts:18` e o preset `rubycli` também. E o README diz _"The default model is `ruby-auto`"_. **Qualquer usuário que instale o CLI e rode `ruby` sem configurar modelo toma 404.** Correção aplicada: default = `ruby-smart` (existe no catálogo, carrega o prefixo `ruby-` e tem 512k de contexto).

**(2) `max_output_tokens` vem `null` para quase todos** (só `mimo-v2.6-*` têm `131072`). Sem isso não dá para saber o teto de saída por modelo — o app deve usar um default conservador e nunca confiar no campo. Correção aplicada: `remoteMaxOutputTokens()` devolve `undefined` em vez de `null`, para que nenhum chamador encaminhe um `max_tokens` nulo (que a API rejeita).

### 3.4 Achados no código local (`G:\VSCodeProjects\RubyCLI`)

Com o projeto em mãos, confirmei a origem dos bugs e achei mais dois.

**(3) 🔴 `redactRubyKey` não redige as chaves reais — corrigido.** Em `src/rubycli.ts`:

```ts
const RUBYCLI_KEY_RE = /\bruby_sk_[A-Za-z0-9_-]{8,}\b/g; // espera ruby_sk_...
```

Mas a chave real é `sk-ruby-...` (confirmado na chave ativa em `~/.rubycli/config.json`). O regex **nunca casa**. Consequência: uma chave nua em texto (mensagem de erro, conteúdo de sessão, log) **não é redigida** pela função cujo trabalho é exatamente esse. O `BEARER_RE` cobre `Bearer sk-...` e o `ASSIGN_RE` cobre `api_key=...`, mas o token solto passava. Correção aplicada: padrão `sk-ruby-` adicionado, com lookahead em vez de `\b` no fim (porque `-` é não-palavra, então `\b` recusaria uma chave terminada em hífen), mantendo o padrão antigo por compatibilidade.

**(4) `API_KEY_ENV` divergente da documentação — corrigido.** `src/rubycli.ts` exportava `API_KEY_ENV = "RUBYCLI_API_KEY"`, enquanto o instalador e a documentação pública usam `RUBY_API_KEY`. Correção aplicada: `API_KEY_ENVS = ["RUBY_API_KEY", "RUBYCLI_API_KEY"]`, com `findApiKeyInEnv()` / `readApiKeyFromEnv()` usados pelo onboarding e pelo `/status`.

**(5) 🔴 Roteamento de provider por prefixo quebra 8 dos 14 modelos — NÃO corrigido.** `detectProviderFromRegistry()` decide o provider por prefixo do nome do modelo, e vários presets de terceiros declaram prefixos que colidem com o catálogo da Ruby:

| Modelo do catálogo Ruby                                 | É roteado para        | Deveria ir para |
| ------------------------------------------------------- | --------------------- | --------------- |
| `glm-5.3`, `glm-5.3-flash`                              | `zai` (`ZAI_API_KEY`) | `rubycli`       |
| `deepseek-v4.1-flash`                                   | `deepseek`            | `rubycli`       |
| `kimi-k3`                                               | `moonshot`            | `rubycli`       |
| `claude-haiku-5.5`                                      | `anthropic`           | `rubycli`       |
| `gpt-6-sol`, `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-luna` | `openai`              | `rubycli`       |

Só escapam `ruby-smart` (prefixo `ruby-`), `muse-spark-*` e `mimo-v2.6-*` (sem prefixo → caem no `DEFAULT_PROVIDER`, que é `rubycli`). Na prática, escolher qualquer um desses 8 modelos no app falha com "No ZAI API key found" ou bate no endpoint errado.

A raiz é que o catálogo da Ruby é **por conta e arbitrário por design** (o backend é a fonte da verdade), então prefixo de nome não é um sinal confiável. A correção precisava ser **catalog-aware**.

**✅ Corrigido em `c80ea19`.** A decisão foi movida para `resolveProvider` (camada CLI), não para o `detectProviderFromRegistry` puro: decidir a favor da Ruby exige saber se há chave Ruby configurada, o que a função pura não enxerga. `resolveProvider` agora prefere o catálogo Ruby quando existe chave, e permanece inalterado quando não existe — então setups de terceiros continuam funcionando e os testes existentes de `detectProviderFromRegistry` não mudaram.

Verificado end-to-end com base URL inválida (sem gastar créditos): `glm-5.3`, `kimi-k3`, `deepseek-v4.1-flash`, `gpt-6-sol` → `provider=rubycli`; e o controle `glm-4.5` → ainda `zai` (com o erro esperado de chave ausente).

**(6) 🟡 `AGENTS.md` / `engineering-practices.md` desatualizados** — herdados do upstream sem renomear. Apontavam para caminhos e diretórios que não existem mais:

| Documento dizia                                 | Realidade                                          |
| ----------------------------------------------- | -------------------------------------------------- |
| `src/agent/`, `src/model/`                      | `src/core/`, `src/providers/`                      |
| `~/.opencli/config.json`, `~/.opencli/mcp.json` | `~/.rubycli/`                                      |
| `OPENCLI_SYSTEM_MD`, `OPENCLI_MAX_TOOL_OUTPUT`  | `RUBYCLI_*` (com `OPENCLI_*` como fallback legado) |
| projeto "OpenCLI"                               | "RubyCLI" (`PRODUCT_NAME` em `src/rubycli.ts`)     |

Isso importa porque **`AGENTS.md` é o arquivo que agentes de código leem** — inclusive eu, ao trabalhar no M0.

**✅ Corrigido em `528b23d`**, com cada caminho verificado na fonte (`state/config.ts`, `state/settings.ts`, `skills/registry.ts`, `mcp/config.ts`, `core/prompt.ts`, `core/executor.ts`).

**O que está bom:** o `AGENTS.md` documenta regras de camada explícitas — "`core/` e `providers/` nunca importam de `cli/` ou `state/`; chaves e config são resolvidas pela camada CLI e passadas como argumento de construtor", e "`core/` é biblioteca pura — sem leitura de `process.env`". **A arquitetura já sanciona o embed no Electron.** Verifiquei na prática: nenhum arquivo fora de `cli/` importa `@clack/prompts`, e `core/` só referencia `state/` via `import type` (apagado em compile time).

### 3.5 Baseline da suíte de testes (Windows)

Rodei `npm run typecheck && npm test` no repo local:

- **`npm run typecheck` → exit 0** ✅ (limpo)
- **`npm test` → 13 falhas / 1028 passando / 71 pulados**, em 6 arquivos:

Depois das correções do M0.1: **13 falhas / 1040 passando** — mesmas 13 falhas, **+12 testes novos**, zero regressão.

| Arquivo                                      | Falhas |
| -------------------------------------------- | ------ |
| `src/tools/exec/bash.test.ts`                | 4      |
| `src/tools/exec/sandbox/passthrough.test.ts` | 3      |
| `src/eval/sandbox/contract.test.ts`          | 2      |
| `src/cli/mentions.test.ts`                   | 1      |
| `src/core/agent.e2e.test.ts`                 | 1      |
| `src/tools/file/file.test.ts`                | 1      |

**ATUALIZAÇÃO (M2): baseline zerado — 1104 passando, 0 falhando.** As 13 falhas não
eram "semântica de shell no Windows" a aceitar; eram **três bugs reais de Windows**
(commit `fd17d52` no RubyCLI):

1. O tool `bash` dava `spawn("bash")`, que no Windows é o **launcher do WSL**
   (`System32\bash.exe`), não um shell. Sem distro instalada ele sai com código 1 e
   escreve o erro onde o tool nunca lê — toda comando voltava
   `(no output) / Error: Exited with code 1`, indistinguível de "seu comando falhou".
   Agora resolve um bash de verdade (Git for Windows / MSYS2 / Cygwin), depois
   PowerShell, depois `cmd.exe`.
2. Timeouts dependiam de process groups (`process.kill(-pid)`), que o Windows não tem:
   comando em timeout **nunca era morto de fato**. Agora usa `taskkill /F /T`.
3. O glob comparava padrão com `/` contra `relative()`, que no Windows devolve `\`.
   `@src/*.ts` e `**/*.ts` não casavam com **nada**, e `*.ts` casava demais.

**Consequência:** "não regredir" deixou de ser o critério; a suíte é gate de verdade.

---

## 4. Arquitetura proposta

### 4.1 Visão geral

```
┌─────────────────────────────────────────────────────────────────────┐
│  Electron — Renderer (React 19 + TS + zustand)                       │
│  Sidebar workspaces │ Chat streaming │ Painel browser │ Terminal     │
│  Árvore de subagentes │ Modal de permissão │ Medidor de contexto     │
└───────────────────────────▲─────────────────────────────────────────┘
                            │ contextBridge (preload, canal tipado)
                            │ contextIsolation:true, nodeIntegration:false
┌───────────────────────────┴─────────────────────────────────────────┐
│  Electron — Main process                                             │
│  • Janelas, menus, tray, updater                                     │
│  • WebContentsView  →  browser do agente (CDP via debugger.attach)   │
│  • Vault da API key (safeStorage)                                    │
│  • Roteador IPC  ⇄  engine                                           │
│  • RPC de ferramentas: engine pede → main executa → devolve          │
└───────────────────────────▲─────────────────────────────────────────┘
                            │ utilityProcess.fork() (Node, isolado)
┌───────────────────────────┴─────────────────────────────────────────┐
│  @rubycli/core  — o engine (hoje src/core, providers, tools, mcp…)   │
│  Agent · ToolRegistry · MCPManager · Compact · Goal · Sessions       │
│  ConfirmFn  ← injetado pelo host (clack no CLI, IPC no Desktop)      │
└───────────────────────────▲─────────────────────────────────────────┘
                            │ HTTP+SSE
                  ┌─────────┴──────────┐
                  │ app.rubycli.cloud  │  (OpenAI-compat / Anthropic)
                  └────────────────────┘
```

### 4.2 Regras de arquitetura

1. **O engine nunca importa `@clack/prompts` nem nada de UI.** Hoje o `src/cli/confirm.ts` (14 KB) é acoplado a terminal. A interface `ConfirmFn` **já existe** em `src/core/executor.ts` e já é injetada via `agent.ts` (`confirmFn?`, `forcesConfirmationFn?`). Basta mover a implementação clack para o pacote CLI e criar uma implementação IPC no Desktop. **Essa é a peça-chave que torna a GUI possível sem reescrever o engine.**
2. **O engine roda em `utilityProcess.fork()`**, nunca no main process. Motivo: turnos longos de agente bloqueiam; e `node-pty`/nativos podem derrubar o processo inteiro.
3. **Renderer é puro** (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`). Toda capacidade passa por `contextBridge`.
4. **Ferramentas que só o main pode executar** (browser, janela, diálogos) são registradas no `ToolRegistry` do engine, mas a execução faz RPC de volta ao main. O engine não sabe que existe Electron.
5. **Um engine, duas interfaces.** CLI continua funcionando idêntico; Desktop é um segundo host.

### 4.3 Estrutura dos dois repos

**Repo A — `rubycli`** (upstream, você já tem; publica o engine):

```
rubycli/                          (pnpm workspace)
├─ packages/
│  ├─ core/                       # engine puro, sem UI  → @rubycli/core
│  │  ├─ src/core/                # agent, compact, context, executor, prompt
│  │  ├─ src/providers/           # openai, anthropic, gemini, ollama, registry
│  │  ├─ src/tools/               # file, exec, web, task
│  │  ├─ src/mcp/                 # client, manager, config
│  │  ├─ src/state/               # session, goal, snapshot, settings, perms
│  │  ├─ src/skills/
│  │  └─ package.json             # ⚠️ ADICIONAR "exports" (hoje só tem "bin")
│  └─ cli/                        # terminal UI  → @rubyclii/cli
│     └─ src/                     # repl, renderer, confirm (clack), mcp-cmd
└─ pnpm-workspace.yaml
```

**Repo B — `RubyDesktop`** (este workspace; consome o engine):

```
RubyDesktop/
├─ src/main/                      # janelas, IPC router, browser, vault, updater
├─ src/preload/                   # contextBridge
├─ src/renderer/                  # React 19 + zustand
├─ src/engine-host/               # utilityProcess entry: instancia o Agent
├─ electron.vite.config.ts
├─ electron-builder.yml
└─ package.json                   # depende de @rubycli/core
```

### 4.4 Workflow entre os dois repos

O ponto sensível do modelo de repo separado: iterar em engine + app ao mesmo tempo sem publicar a cada mudança.

| Momento             | Como o Desktop consome o core                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Desenvolvimento** | `pnpm link` (ou dependência `link:`/`file:`) apontando para `G:\VSCodeProjects\RubyCLI` → hot reload atravessa os repos |
| **CI / release**    | versão publicada no npm (`@rubycli/core@x.y.z`) com `pnpm publish`                                                      |

Regras:

1. O repo já está local em **`G:\VSCodeProjects\RubyCLI`** (git limpo, `main`, `upstream` = `zjshen14/opencli`). Sem necessidade de clonar.
2. `@rubycli/core` versiona semver independente do CLI; mudança de contrato de eventos = **major**.
3. O contrato de eventos da §4.5 é a **API pública** entre os repos — versionar e documentar como tal.
4. Nunca importar `@rubycli/core` de dentro do renderer: só do `engine-host`.

### 4.5 Contrato de eventos (IPC) — a API pública entre os repos

O engine já emite `AgentEvent`. Hoje é pobre para GUI — precisa de mais tipos:

```ts
// já existe
{ type: "text"; text: string }
{ type: "tool_call"; name: string; args: Record<string, unknown> }
{ type: "tool_result"; name: string; result: string }
{ type: "skill_activated"; name: string }
{ type: "error"; message: string }
{ type: "notice"; message: string }
{ type: "done" }

// ADICIONAR para a GUI
{ type: "usage"; input: number; output: number; cached?: number; contextRatio: number }
{ type: "approval_request"; id: string; tool: string; args: unknown; kind: "once"|"always" }
{ type: "approval_resolved"; id: string; decision: "allow"|"allow_always"|"deny" }
{ type: "turn_start"; turn: number; maxTurns: number }
{ type: "goal_updated"; goal: Goal | null }
{ type: "compact_start" | "compact_done"; before: number; after: number }
{ type: "subagent_start"; id: string; parentId: string; label: string; prompt: string }
{ type: "subagent_event"; id: string; event: AgentEvent }   // recursivo
{ type: "subagent_end"; id: string; status: "ok"|"error"; summary: string }
{ type: "mcp_status"; server: string; state: "connecting"|"ready"|"failed"; tools: number }
```

Esse é o contrato que a UI inteira consome. Definir cedo evita retrabalho.

### 4.6 Design e identidade visual

**Decisão: o app replica a identidade do site `app.rubycli.cloud`.** Tokens, stack e regras em [`DESIGN.md`](DESIGN.md), com referências visuais em `design/`.

O essencial, lido do CSS de produção do site:

- Stack do site = **Tailwind CSS v4 + shadcn/ui** (o CSS define exatamente o conjunto de tokens do shadcn). O app usa a mesma stack e os **mesmos nomes de token**, então os componentes entram sem tradução.
- Dark **quente**, nunca cinza: fundo `#050304` (preto com viés vinho), texto `#f7eff3` (branco com viés rosa). Nunca `#000` nem `#fff` puros.
- Rosa/magenta é **acento**, não fundo: `--primary: #de0068`, com `--ring: #e83174` e `--model-accent: #ff638d`. Nunca preenche áreas grandes.
- Tipografia **Geist** + **Geist Mono**, raio `0.7rem`, bordas `#ffffff1a`.
- Linguagem: eyebrow labels (maiúsculas, rosa, `tracking-widest`), títulos display em duas linhas, cards com borda sutil e numeração `01/02/03`, pill toggles, divisores de 1px, glow rosa usado com moderação.
- O conjunto de tokens `--sidebar-*` já existe no site e mapeia direto na sidebar de workspaces do app.

Detalhamento completo, snippet de tema pronto e regras de acessibilidade: [`DESIGN.md`](DESIGN.md).

---

## 5. Como cada requisito essencial é atendido

| #   | Requisito                      | Como                                                                                                                                                                                                                                                                                   | Esforço           |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1   | **Facilidade para MCPs**       | Engine já tem stdio + streamable HTTP (`src/mcp/*`), config `~/.rubycli/mcp.json`, `${VAR}` expansion, timeout por servidor, nomes `mcp__<server>__<tool>`, gating HITL. Falta só **UI**: lista, adicionar/editar/remover, testar conexão, ver tools descobertas, aprovar por servidor | 🟢 Baixo          |
| 2   | **Windows / Linux / Mac**      | Electron + TS é multiplataforma nativo. Windows e Linux você testa e empacota. **macOS não é empacotável a partir do Windows** — exige runner macOS (CI) e, para distribuir sem aviso, conta Apple Developer                                                                           | 🟡 Médio          |
| 3   | **Executável Windows**         | `electron-builder` 26 + target **NSIS** (x64 + arm64). `asarUnpack` para módulos nativos. Auto-update via `electron-updater` + GitHub Releases                                                                                                                                         | 🟢 Baixo          |
| 4   | **Workspaces**                 | Workspace = pasta de projeto. `~/.rubycli/projects` + `project-permissions` já existem. Adicionar: switcher, sessões por workspace, persistência, restaurar último                                                                                                                     | 🟢 Baixo          |
| 5   | **Provider Ruby**              | Já é o default do engine. Guardar chave em `safeStorage` (não em JSON plano). Buscar `/v1/models` por chave, **filtrar id vazio**, default = `ruby-smart` (nunca `ruby-auto`). Segundo backend Anthropic já validado                                                                   | 🟢 Baixo          |
| 6   | **WebBrowser integrado**       | `WebContentsView` (Electron 44; `BrowserView` está **deprecado**) + CDP via `webContents.debugger.attach('1.3')`. Tools novas: `browser_open/navigate/snapshot/click/type/scroll/screenshot`. Snapshot para o LLM via `Accessibility.getFullAXTree`                                    | 🟡 Médio          |
| 7   | **Comando de goal**            | `runAutoGoal` implementa limite, progresso, conclusão, pausa e bloqueio; Desktop tem controles no banner e slash commands                                                                                                                                                              | ✅ Entregue em M6 |
| 8   | **Comando de compact**         | `src/core/compact.ts` + auto-compact em 75% já prontos. Adicionar: `/compact` na UI, medidor de contexto ao vivo, preview do resumo, undo                                                                                                                                              | 🟢 Baixo          |
| 9   | **Sub-agentes + orquestração** | Explorers/workers, configuração e revisão no chat, perguntas inline e DSL `workflow` com grupos e JSON Schema                                                                                                                                                                          | ✅ M4.1–M4.4      |
| 10  | **Multi-provider**             | Registry já suporta baseUrl custom. Expor na UI: Ruby (nativo), OpenAI-compat custom, Anthropic                                                                                                                                                                                        | 🟢 Baixo          |

---

## 6. Roadmap por fases

Duas trilhas em paralelo: **Core** (repo `rubycli`) e **Desktop** (repo `RubyDesktop`). O Core sempre entrega antes, porque o Desktop depende dele.

### M0 — Fundação ✅ CONCLUÍDO (3 commits)

**Trilha Core (`G:\VSCodeProjects\RubyCLI`)** — `main`, working tree limpo

**M0.1 — correções ✅** (`c80ea19`)

- ✅ Bug #1: `DEFAULT_MODEL` → `ruby-smart` (era `ruby-auto`, que dá 404). O cliente de compactação tinha o mesmo id inválido.
- ✅ Bug #2 (segurança): `redactRubyKey` agora redige `sk-ruby-...` (antes só casava o formato antigo `ruby_sk_`, então chave real passava crua).
- ✅ Bug #3: `remoteMaxOutputTokens()` trata `max_output_tokens: null` sem vazar `null`.
- ✅ Bug #4: aceita `RUBY_API_KEY` **e** `RUBYCLI_API_KEY`.
- ✅ Bug #5 (roteamento): `resolveProvider` prefere o catálogo Ruby quando há chave Ruby. **Verificado end-to-end**: `glm-5.3`, `kimi-k3`, `deepseek-v4.1-flash`, `gpt-6-sol` → `rubycli`; `glm-4.5` (controle) continua `zai`.
- ✅ Catálogo estático do preset `rubycli` com os 14 modelos reais e context windows verificados.
- ✅ +44 testes. `typecheck`/`lint`/`format:check` limpos.

**M0.2 — biblioteca ✅** (`3538cbd`)

- ✅ `src/lib.ts`: superfície pública documentada do engine (agent, providers, tools, MCP, skills, state, goal, snapshot).
- ✅ `exports` map + `main`/`types` no `package.json`.
- ✅ Declarações via `tsc --emitDeclarationOnly` (o `dts` do tsup falha no TS 6 com TS5101 `baseUrl`).
- ✅ **Bug #6 (novo):** o pacote buildado não achava as skills builtin — o caminho vinha de `import.meta.url` e resolvia para `<pkg>/skills/builtin`, que não é publicado. O pacote publicado **nunca teve skills builtin**. Corrigido com sondagem de candidatos + cópia no build.
- ✅ **Verificado importando o `dist/lib.js` real**: 13 tools, 13 skills, turno completo com streaming, `contextWindow=512000` (o real do modelo, não o default de 100k).

**M0.3 — docs ✅** (`528b23d`)

- ✅ `AGENTS.md`, `CLAUDE.md`, `docs/engineering-practices.md` corrigidos: apontavam para `~/.opencli`, `OPENCLI_*`, `src/agent/`+`src/model/` e default Gemini.
- ✅ `AGENTS.md` e `CLAUDE.md` em sincronia (corpo idêntico, 180 linhas cada).

**Achados registrados para o M1**

- ⚠️ **`options.model` é obrigatório ao construir o `Agent`.** A janela de contexto é resolvida pelo nome do modelo, e o client não expõe o dele. Omitir cai silenciosamente no default de 100k, e o auto-compact dispararia em 75k em vez de 75% da janela real.
- ⚠️ **Split `packages/core` + `packages/cli` é desnecessário.** Confirmado que a camada já está limpa (nada fora de `cli/` importa clack; `core/` só toca `state/` via `import type`). Basta o barrel + `exports` — que é o que foi feito. Publicar como `@rubyclii/cli` mesmo.
- ℹ️ **Contaminação pré-existente:** `[OI]`/`[CC]` aparecem literalmente em comentários de `providers/openai.ts`, `factory.ts`, `core/agent.ts`, `core/executor.ts` e `cli/status-footer.ts` (herdado do upstream). Não é meu e não quebra nada, mas vale limpar algum dia.

**Trilha Desktop (`RubyDesktop`)** — próximo

- Scaffold: Electron 44 + electron-vite + React 19 + TypeScript + zustand 5.
- **UI base: Tailwind CSS v4 + shadcn/ui**, com o tema do [`DESIGN.md`](DESIGN.md) (tokens idênticos ao site) e as fontes **Geist** / **Geist Mono** empacotadas.
- Linkar o `RubyCLI` local; provar `import { Agent } from "@rubyclii/cli"`.
- Esqueleto de janela + preload + canal IPC.
- **Entregável:** janela Electron abre, com a identidade visual da Ruby, e fala com o core.

### M1 — Chat com streaming

**Core:** enriquecer `AgentEvent` com os tipos novos da §4.5 (usage, approval, turn, subagent, mcp_status); bump major.

**Desktop**

- Engine em `utilityProcess.fork()`; IPC tipado com o contrato da §4.5.
- UI seguindo [`DESIGN.md`](DESIGN.md): sidebar de workspaces com os tokens `--sidebar-*`, chat com streaming token-a-token, tool calls colapsáveis (card com header mono + ícone em quadrado rosa), markdown em `react-markdown` e realce lexical leve de código (implementado na M3.5).
- Seletor de modelo: pill toggle no estilo do site, lendo `/v1/models` (filtrando `id` vazio); chave em `safeStorage`.
- **Entregável:** app abre, conversa, executa tool calls, edita arquivos — visualmente indistinguível da identidade Ruby.

### M2 — Workspaces, Goal, Compact, Permissões

**Core:** ✅ separar a política de permissão (`src/core/permissions.ts`) da renderização
no terminal (`src/cli/confirm.ts`) e publicá-la no `src/lib.ts`; a política pura
(`decideConfirmation`, `decideAutoApprove`, `matchesNeverAutoApprove`,
`buildPermissionSources`, `grantKeysFor`) é o que o Desktop usa.

**Desktop** — ✅ CONCLUÍDO

- Workspace switcher: trocar de workspace **reinicia o engine com o novo `cwd`**, que é
  o que isola sessão, grants, goal e contenção de path. Sem estado compartilhado para
  vazar, porque o processo que o guarda é substituído.
- **Modal de permissão** ([`ApprovalModal.tsx`](src/renderer/src/components/ApprovalModal.tsx))
  substituindo o prompt clack: allow once / allow this call always / always allow tool /
  always allow everywhere / deny. Escape = deny. O engine bloqueia a tool call até a
  resposta e tem timeout de 10 min (um GUI nunca pode pendurar um turno).
- Goal: banner persistente ([`GoalBanner.tsx`](src/renderer/src/components/GoalBanner.tsx)),
  notas, `/goal`, pause/resume/complete/clear. Estado por workspace em `~/.rubycli/goals/`.
- Compact: `/compact`, botão na status bar, medidor de contexto ao vivo, auto em 75%.
- Modo de permissão na status bar (`Ask` / `Accept edits` / `Plan`) — é um _modo_, então
  fica sempre visível em vez de escondido num diálogo.
- **Entregável:** ✅ fluxo agêntico completo com HITL, verificado ponta-a-ponta.

**Achado crítico corrigido no M2:** o M1 nunca ligou o `confirmFn`, então o
`executor` negava silenciosamente toda tool que exigia confirmação
(`deps.confirmFn ? ... : "deny"`), sem prompt e sem aviso. Um `Blocked:` aparecia
como falha de tool, não como decisão. Era um bug de segurança nas duas direções.

### M3 — MCP + Terminal + Browser

**Desktop** — ✅ **CONCLUÍDO** (MCP, painel de saída e browser).

**MCP** ✅

- Painel ([`McpPanel.tsx`](src/renderer/src/components/McpPanel.tsx)): lista cada servidor
  configurado com se está utilizável, as tools que expõe sob o nome real
  `mcp__<servidor>__<tool>`, ou o erro que o impediu. Um servidor que não sobe é
  **reportado**, não some silenciosamente, e não derruba os saudáveis junto.
- Add por stdio ou HTTP, com passo de **"test connection"** que conecta, lista tools e
  desconecta sem salvar nem tocar no registry em uso — dá para testar antes de confiar.
- Tools MCP passam pelo **mesmo modal de aprovação** dos built-ins: uma tool de servidor
  de terceiros não é mais confiável que um comando de shell.
- Core: `McpManager.statuses` (cada servidor uma vez, com estado e tools),
  `probeMcpServer` (o botão de testar), `saveMcpServer`/`removeMcpServer` (escrita atômica
  de `mcp.json` — um write rasgado tornaria o arquivo inteiro ilegível e levaria todos os
  outros servidores junto).

**Terminal = painel de saída do agente** ✅ (decisão tomada, sem `node-pty`)

- [`OutputPanel.tsx`](src/renderer/src/components/OutputPanel.tsx) transmite os eventos de
  observabilidade do engine: tokens, latência e TTFT por chamada de modelo; duração e
  tamanho de saída por tool call; negações, guards e compactação. É por isso que ele lê
  telemetria em vez do transcript — continua útil no meio do turno, quando ainda não há
  nada a dizer. Segue o fim só enquanto o usuário não rolou para cima; limitado a 300 linhas.

**Browser** ✅

- `WebContentsView` (Electron 44; `BrowserView` está deprecado) + CDP via
  `webContents.debugger.attach('1.3')`. Tools `browser_open/navigate/snapshot/click/type/scroll/back/screenshot/close`
  registradas no `ToolRegistry` e executadas por RPC de volta ao main
  ([`browser-tools.ts`](src/engine-host/browser-tools.ts) ↔ [`browser.ts`](src/main/browser.ts)).
- Snapshot para o LLM via `Accessibility.getFullAXTree`: árvore de roles/nomes em vez de HTML
  cru — muito mais barato em tokens e mais robusto que pedir ao modelo para escrever seletores.
  Elementos interativos ganham `[ref=eN]`, reconstruídos a cada snapshot; um ref antigo é
  **rejeitado**, porque resolveria para outro elemento na página nova.
- Input real (`Input.dispatchMouseEvent`/`insertText`), então páginas que escutam eventos
  confiáveis funcionam. Só `http(s)`: `file://` deixaria uma página ler o disco local.
- **Entregável:** ✅ as três integrações do M3 funcionando.

**Verificação do M3 (browser):** `scripts/smoke-browser.cjs` → PASS, exit 0. As asserções são
sobre o **estado da página**, não sobre a saída das tools: digitar e clicar executa o listener
DOM da própria página, que devolve o valor digitado (`FIXTURE-GREETING:Ada`) — prova de que o
clique foi um evento confiável de verdade. Cobre também navegação, back, scroll, screenshot e
rejeição de ref obsoleto.

**Três armadilhas encontradas (todas falhas silenciosas):**

1. Eventos de mouse via CDP exigem o bitmask `buttons`, não só `button` — sem ele o comando
   reporta sucesso e nenhum `click` chega à página.
2. O Chromium **descarta input sintético de uma view sem foco**, também reportando sucesso.
   Resolvido com `Emulation.setFocusEmulationEnabled` em vez de roubar o foco do SO (que seria
   mal-educado e frágil). Verificado: o mesmo clique que não fazia nada funciona com o foco
   emulado e a janela em segundo plano.
3. Uma view de tamanho zero engole input, e o agente pode abrir o browser antes de o renderer
   medir o placeholder — agora há região de fallback. `Page.captureScreenshot` também espera um
   frame do compositor que uma view escondida pode nunca produzir, então tem timeout em vez de
   pendurar o turno.

> Nota: `capturePage()` na janela **não** compõe um `WebContentsView` (é uma camada nativa
> separada), então essa área sai preta no PNG da janela; a página é capturada via CDP em
> [`smoke-m3-browser-page.png`](design/smoke-m3-browser-page.png).

**Verificação do M3 (MCP + painel):** `scripts/smoke-mcp.cjs` → PASS, exit 0. Sobe um
**servidor MCP real como subprocesso** (`scripts/fixtures/echo-mcp-server.cjs`, JSON-RPC
stdio sem dependências), e prova o ciclo completo: o modelo chama
`mcp__smoke_fixture__echo` e recebe de volta o marcador do próprio fixture
(`fixture:echo:hello-from-test`), não uma resposta inventada. Também verifica que um
servidor que falha ao subir é reportado e não afeta o saudável, e que o painel recebeu
telemetria durante um turno real.

**Achado corrigido no M3:** `DEFAULTS.model` ainda era `ruby-auto`, alias que o provider
não publica — uma instalação nova (sem `config.json`) começava num modelo que dá 404. Só
apareceu porque o teste MCP roda com `RUBYCLI_HOME` isolado. Corrigido para `DEFAULT_MODEL`
(commit `82770a2` no RubyCLI), junto com o override `RUBYCLI_HOME` para o diretório de estado.

### M3.5 — Continuidade e polimento da UX ✅

**Implementado neste checkout; build e cinco smoke tests aprovados.**

- Conversas persistidas por workspace, restauração da sessão mais recente, lista de recentes,
  nova conversa e retomada pela sidebar.
- Scroll do chat só acompanha tokens enquanto o usuário está perto do fim; ao ler mensagens
  anteriores, aparece um atalho para voltar ao fim.
- Código com botão de cópia e realce lexical leve para linguagens comuns; Markdown continua sem
  HTML bruto.
- Campo de chave em Configurações, criptografado com `safeStorage`; salvar a chave reinicia o engine.
  O renderer não recebe a chave.
- `task` executa o papel explorer com tools read-only e sem delegação recursiva. Workers e
  worktrees permanecem no M4.
- Sidebar reorganizada, diagnósticos recolhidos e rótulos principais em português.

**Limites conhecidos naquele marco:** o realce lexical não substitui um parser completo. Workspaces
recentes, múltiplas abas e auto-continuação foram concluídos na etapa M6 abaixo.

### M3.6 — Estatísticas do chat e seletor de modelo ✅

- Seletor pesquisável movido para o composer; lista contexto e capacidades do modelo, e bloqueia
  a troca durante um turno ativo.
- Chips clicáveis abrem detalhes de turnos/etapas, uso de tokens, cache e contexto. A sessão mostra
  duração do modelo e das ferramentas, TTFT médio e tokens por segundo quando o provider retorna
  telemetria suficiente.
- `cachedTokens` passa do evento de observabilidade existente do RubyCLI para o contrato IPC do
  Desktop. O indicador separa chamadas com cache reportado e explica quando os dados são parciais.
- Limites: tokens/cache não são gravados no histórico e começam a contar nesta execução. O medidor
  usa a estimativa do engine enquanto a chamada está em andamento e, quando disponível, os tokens
  de entrada reportados pelo provider após a resposta; a compactação usa a estimativa interna.
- `smoke-markdown.cjs` confirma que os quatro painéis de estatísticas e o seletor abrem com dados.

### M4 — Sub-agentes + Orquestração

#### M4.1 — Configuração e perguntas no chat ✅

**Core (RubyCLI)**

- Expor o catálogo de modelos e os reasoning efforts compatíveis para que cada subagente receba
  uma configuração explícita. Se modelo/effort não estiver disponível, explicar e propor uma
  alternativa; nunca trocar silenciosamente.
- Aceitar instruções do usuário em linguagem natural para definir quantidade, papel, modelo, effort
  e foco dos subagentes. O orquestrador pode recomendar uma divisão e justificar modelo/effort;
  iniciar autonomamente com a recomendação é o padrão. Só abrir a configuração manual quando o
  usuário pedir para escolher, revisar ou editar os parâmetros antes de iniciar.
- Permitir instruções próprias por worker (papel, contexto, limites, ferramentas e formato da
  entrega), funcionando como um harness configurável e não apenas como texto da tarefa.
- Oferecer uma chamada estruturada para a IA fazer perguntas de esclarecimento ao usuário. A
  resposta retorna ao turno que aguardava, em vez de depender de a IA escrever uma pergunta em
  texto comum. Se a pergunta vier de um subagente, identificar sua origem e rotear a resposta ao
  worker correto.

**Desktop**

- Iniciar o subagente com a proposta da IA sem pergunta por padrão. Se o usuário pedir configuração
  manual, mostrar o formulário inline para editar modelo, effort e orientações; alternativas continuam
  identificadas antes do início.
- Mostrar a pergunta como cartão inline no chat, com opções selecionáveis e campo de resposta
  livre; identificar quem perguntou, enviar a resposta ao agente correto e retomar o turno.
- Tratar respostas, cancelamento, abort, reset e shutdown para que nenhuma espera fique pendurada.
  Esse fluxo de esclarecimento é separado do modal de aprovação de ferramentas.

#### M4.2 — Workers isolados ✅

**Core (RubyCLI)**

- Cada `worker` recebe branch e git worktree próprios, criados de um snapshot do estado de trabalho atual sem alterar o índice do usuário. O diff inclui arquivos novos e só é aplicado após aprovação explícita.
- Papéis implementados: `explorer` (read-only) e `worker` (edição no worktree). Ferramentas de arquivo bloqueiam caminhos fora da raiz isolada; a aprovação existente continua ativa.
- Concorrência limitada a três workers. Cancelamento e falha descartam worktree/branch; conflitos preservam o diff para nova revisão.

#### M4.3 — Acompanhamento e revisão no Desktop ✅

**Desktop**

- UI: árvore de subagentes com progresso, status, custo/tokens por agente; diff do worktree antes do merge.
- A aba lista agentes ativos e finalizados, abre tarefa/orientações/atividade e permite limpar os
  finalizados da lista; essa limpeza fica registrada na sessão sem remover cartões do chat.
- `task` inicia subagentes em segundo plano e retorna o ID imediatamente. Tarefas independentes
  podem ser lançadas em paralelo enquanto o principal continua seu trabalho; `subagent_status` lista,
  consulta o contexto e o resultado de cada agente ou aguarda por um intervalo limitado.
- Em cada agente, mostrar modelo, effort, papel e instruções; manter as perguntas e respostas no
  histórico visível do chat, identificando qual agente perguntou e recebeu cada resposta.
- **Entregável:** orquestração multi-agente real.

#### M4.4 — DSL de workflows ✅

**RubyCLI**

- Tool `workflow` com `agent()`, `parallel()`, `pipeline()`, `phase()` e `log()` usando um parser
  restrito que não avalia JavaScript arbitrário.
- Paralelismo tem limite e snapshot consistente de resultados anteriores; saída estruturada pode ser
  validada por JSON Schema.
- Hosts fornecem o executor de explorer, confirmação explícita para workers e execução isolada em
  worktree. O Desktop conecta os callbacks ao mesmo seletor de modelo, perguntas e revisão do tool
  `task`.
- Validação direcionada: 15 testes de workflow passaram.

### M5 — Empacotamento + release

**Desktop**

- `electron-builder` 26: NSIS x64 + arm64 e instalador combinado com seleção de arquitetura. O
  engine ESM é copiado para `resources/engine` fora do ASAR, pois `utilityProcess` precisa abrir
  um caminho de arquivo real. `electron-updater` permanece dependência de runtime dentro do ASAR.
- `electron-updater` instala atualizações automaticamente nos pacotes com feed compatível.
  `verifyUpdateCodeSignature` segue habilitado no Windows; instalação automática no Windows/macOS
  depende das credenciais de assinatura. Linux AppImage/deb recebe feed; builds Windows/macOS sem
  assinatura consultam a release pública e oferecem abrir a página de downloads.
- GitHub Actions: CI compila e verifica o pacote em Windows, Linux e macOS; workflow por tag constrói Windows,
  Linux (AppImage/deb) e macOS (DMG + ZIP), anexa os artefatos em uma release draft para revisão e
  publicação manual.
- A release mais recente é `v0.1.6`, publicada em 2026-10-17 com 17 artefatos. Os builds Windows,
  Linux e macOS passaram no workflow; os instaladores macOS/Linux ainda não foram executados
  interativamente neste host.
- **Entregável:** instaladores Windows, Linux e macOS, pipeline multiplataforma e verificação de
  releases do GitHub; `v0.1.6` publicada.

#### Uso operacional

```powershell
cd G:\VSCodeProjects\RubyCLI ; npm run build
cd G:\VSCodeProjects\RubyDesktop ; npm run dist
npm run package:dir
```

O GitHub Actions clona `marcosvkp/rubycli` por padrão. Configure a Actions variable obrigatória
`RUBYCLI_REF` com o SHA completo de 40 caracteres do engine; `RUBYCLI_REPOSITORY` pode trocar o
repositório. A revisão é verificada contra `ruby-engine.lock.json`. A tag de release precisa ser
`v<package.json.version>`;
`v0.1.6` corresponde à versão publicada atual.

O workflow permite publicar instaladores Windows/macOS sem certificados; o sistema pode exibir
avisos e o app abre a página de downloads quando há uma nova versão. Com os segredos de assinatura
configurados, o workflow valida os binários e inclui os feeds de atualização automática. Configure
`WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` (ou `WIN_CSC_NAME`) para Windows e
`MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` e `APPLE_TEAM_ID`
para macOS. Linux sempre publica AppImage, `.deb` e o feed próprio. Configure `RUBY_API_KEY` como
secret para executar os seis smokes no CI.

**Release direta `v0.1.4` — 2026-10-17:** gerada neste host Windows com `npm run dist` e publicada
diretamente no GitHub, sem aguardar o Actions. Inclui os instaladores combinados, x64 e ARM64. O
pacote passou por `scripts/verify-package.cjs release`, que confirmou o engine e as 41 Skills builtin.
Os executáveis não têm assinatura Authenticode; Windows pode exibir o SmartScreen e a atualização é
manual. Esta release ainda não contém instaladores Linux/macOS.

**Release multiplataforma `v0.1.5` — 2026-10-17:** publicada pelo GitHub Actions após os três
runners concluírem. Inclui três instaladores Windows, AppImage e `.deb` Linux, DMG e ZIP macOS x64 e
arm64 e os blockmaps aplicáveis (17 assets). O workflow `39046928882` revelou que AppImage não tem
blockmap; o coletor foi corrigido em `200d3a4` e o workflow `39047209443` passou. A CI `39047192606`
também passou.

**Release multiplataforma `v0.1.6` — 2026-10-17:** publicada após os três builds e a verificação
dos pacotes passarem. Inclui três instaladores Windows, AppImage e `.deb` Linux, DMG e ZIP macOS
x64/arm64 e os blockmaps aplicáveis (17 assets). CI `39068759583`; release `39068771826`.

**Verificação M5:** a release `v0.1.3` foi construída e publicada pelo workflow multiplataforma; os
19 artefatos incluem instaladores para Windows x64/arm64/combinado, Linux AppImage/deb e macOS
x64/arm64 DMG/ZIP, além dos metadados de update. `npm run build` passou com o verificador de releases.
A execução interativa dos instaladores macOS/Linux continua pendente em seus sistemas próprios.

**Verificação do hardening:** `npm run typecheck` e `npm run build` passaram em 2026-10-14. A suíte
Electron não foi executada nesta rodada; CI agora a executa nos três sistemas quando `RUBY_API_KEY`
está configurada. Smoke dos executáveis instalados e validação MCP no pacote seguem pendentes.

### M6 — Continuação de goals e polimento pós-release ✅

**RubyCLI**

- Goals persistem `maxRounds`, rodadas concluídas e `blockedReason`; goals antigos são migrados com
  limite padrão. `runAutoGoal()` é host-neutral, executa uma rodada por vez, pausa em cancelamento,
  conclui por `GOAL_DONE` e bloqueia após limite ou falha até a retomada explícita.
- REPL oferece `/goal auto`, `/goal stop` e `/goal max-rounds <1-100>`. Cobertura inclui 11 testes
  de estado/continuação. `vitest.config.ts` agora exclui paths existentes (`src/providers/types.ts`
  e `src/core/agent.ts`).
- O runner de avaliação registra stderr/sinal/erro de spawn e falha cenários quando o subprocesso
  retorna código não zero. A matriz desta máquina não foi aprovada: o único provider configurado
  rejeitou a credencial OpenAI, seguido de assertion de libuv no Node 24/Windows (`3221226505`).

**RubyDesktop**

- Banner de goal permite configurar limite, iniciar ou parar a continuação; o estado `blocked`, motivo
  e contagem ficam visíveis. O smoke de permissões valida uma execução pela UI até estado `complete`
  ou `blocked`, e confirma retorno ao estado ready.
- Persistência local dos oito workspaces mais recentes, troca validada, abas sandboxed do browser com
  seleção/fechamento e refs CDP renovadas. Sidebar/painéis ficam responsivos abaixo de 1000px; abas
  aceitam navegação por setas e controles têm labels/foco visível.
- Verificação: `npm run build` passou; os seis smoke scripts Electron passaram com exit 0 quando
  executados com acesso ampliado. O build e o Electron no sandbox restrito falham em caminhos de
  acesso/cache, então essa diferença de ambiente permanece documentada.

### M6.1 — Git e worktrees no painel direito ✅

- Abas Navegador, Git, Worktrees e MCP compartilham o painel direito; o chat permanece montado durante
  a troca e um navegador aberto pelo agente volta automaticamente à frente.
- Git mostra branch, upstream e divergência, arquivos alterados e diff. O usuário pode stage/unstage
  arquivos e criar commits somente com mensagem explícita e arquivos staged.
- Worktrees são listados com branch, HEAD e estado limpo/sujo; é possível criar branch/worktree,
  abrir como workspace e remover quando limpo. O app recusa remover o worktree principal, bloqueado,
  sujo ou em uso.
- A execução usa `execFile` com argumentos separados, sem shell; o IPC aceita operações tipadas e os
  paths de arquivos são validados contra o status do Git. Requer instalação local do Git.
- Fetch/pull/push, checkout de branch, merge e resolução de conflitos permanecem como próximos itens
  caso o usuário queira sincronização remota pela UI.
- Validação local: `npm run typecheck` e `npm run build` passaram; smokes não foram executados.

### M7 — Anexos multimodais e geração de imagens (parcial)

O composer atualmente transmite texto puro. O campo `supportsVision` do catálogo apenas identifica
modelos capazes de receber imagens; o Desktop ainda não envia imagens de entrada. A geração via API
Ruby foi implementada em M7.2, sem inferir capacidade de geração a partir de `supportsVision`.

#### M7.1 — Anexar imagens ao chat

- Adicionar seleção de arquivos, colagem e drag-and-drop, com prévia, remoção e estados de envio.
- Validar tipo, tamanho e quantidade no processo principal; aceitar apenas formatos compatíveis com
  o provider e evitar que o renderer receba acesso irrestrito a caminhos locais.
- Expandir contrato IPC e input do engine para transportar texto mais imagens em payload
  multimodal estruturado; não embutir dados binários/base64 no texto do prompt.
- Respeitar a capacidade do modelo selecionado: habilitar envio apenas para modelos de visão e
  explicar quando o modelo atual não aceitar anexos.
- Guardar anexos em armazenamento controlado pelo app e registrar referências estáveis no histórico;
  reabrir a sessão deve manter prévia e acesso às imagens.

#### M7.2 — Tools de geração e edição de imagens ✅ local

- `image_quote` chama `POST /v1/images/quote` com modelo, tamanho, qualidade e quantidade; informa
  `estimatedCredits` e a faixa `minEstimatedCredits`–`maxEstimatedCredits` quando retornadas. Envia
  `referenceCount: 0` para geração sem imagem de referência e aceita os valores aninhados como número
  ou string.
- `image_generate` exige uma cotação de até cinco minutos com os mesmos parâmetros. Por padrão, a
  chamada que consome créditos pede aprovação. Configurações do Desktop oferece um opt-in persistente
  para geração/edição autônoma; mesmo nesse modo a cotação é consultada automaticamente antes da ação.
  Usa a chave Ruby injetada no engine host e chama `POST /v1/images/generations`; não repete chamadas
  automaticamente para evitar cobrança duplicada após timeout.
- `image_models` consulta `GET /v1/images/models` e fornece os ids habilitados na conta. O agente usa
  esse catálogo específico, sem procurar no workspace ou inferir geração a partir de `supportsVision`.
- A API devolve base64, que é validado por MIME/assinatura, tamanho e quantidade. O executor entrega os
  bytes em `AgentEvent.tool_result.images`, fora de `FunctionResultPart`, para não os incluir no próximo
  contexto do modelo. A geração encaminha `resolution` e `aspect_ratio`, reconhece `media_type` e
  informa `usage.credits` quando disponível. O Desktop mostra prévia inline e download no cartão da tool.
- O histórico local salva o resultado como evento `generated-image` do JSONL. Reabrir a conversa
  restaura a prévia; isso grava os bytes somente na máquina do usuário. O contrato do provider declara
  que prompt/imagem não são armazenados no servidor e que seus logs guardam consumo/metadados.
- A tool só é registrada no Desktop quando o provider é Ruby e há chave configurada. A edição
  `image_edit` chama `POST /v1/images/edits` com multipart, referência PNG/JPEG/WebP relativa ao
  workspace de até 12 MB, e exige quote com `referenceCount: 1`. Geração usa `referenceCount: 0`.
- `image_generate` e `image_edit` exigem `save_path` relativo ao projeto e rejeitam a chamada antes de
  gerar/editar se o destino estiver ausente ou inválido. O host valida contenção incluindo links
  simbólicos e recusa sobrescrever arquivos. O agente deve escolher um nome descritivo e único em
  `assets/generated/` quando o usuário não informar o destino. A extensão salva corresponde ao MIME
  real retornado pela API; o cartão também mantém prévia e download.
- A imagem fica no arquivo do projeto e como base64 no evento JSONL local para restaurar a prévia; não
  existe cópia em pasta temporária. O base64 não entra no histórico enviado ao modelo.

#### M7.3 — Segurança e critérios de aceite (parcial)

- RubyCLI tem testes determinísticos para cotação, autenticação, limite/base64/MIME, confirmação e
  isolamento dos bytes do contexto. Smokes verificam exibição ao vivo e restauração.
- Os seis smoke scripts Desktop passaram com artefatos compilados. `npm run build` passou.
- Na suíte RubyCLI completa, 1169 testes passaram e 70 foram ignorados; 21 casos live da matriz de
  avaliação falharam com exit `3221226505` no Windows e um teste de compactação aninhada expirou em 5s.
- Permanecem pendentes anexos de entrada e uso mais completo dos metadados de `/images/models` para
  seleção por capacidade/preferência. A edição, gravação e preferência autônoma precisam de smokes
  determinísticos próprios.

**Próxima tarefa:** implementar anexos de entrada (arquivo, clipboard e drag-and-drop), validar e persistir
referências locais, e transportar mensagem multimodal somente para modelos com `supportsVision`.

### M8 — Skills de modding Minecraft (implementadas e commitadas)

Foram criadas 28 skills built-in originais em `RubyCLI/src/skills/builtin`, cobrindo Java
(Fabric/NeoForge, Gradle, GameTest, Mixins, datagen, worldgen e multi-versão), Bedrock
(packs, Script API, Molang, partículas, NBT, testes e edição de mundos), JSON UI, Blockbench,
Paper, launcher, RCON e publicação. O roteador `/minecraft-mods` seleciona a especialidade; cada
skill entra no catálogo automático e no autocomplete de slash commands já existente.

- Skills consultam versão/loader e documentação oficial antes de assumir compatibilidade.
- Publicação, comandos de servidor, instalação de ferramentas e escrita destrutiva continuam no
  fluxo de confirmação normal; as skills não concedem permissões.
- O pack externo de JSON UI citado em `SEARCH.md` não foi copiado porque não declara licença.
  As skills locais são conteúdo novo; não incluem MCP, Studio, renderer ou ferramentas externas.
- RubyCLI foi enviado em `70e9e2d` (Skills e leitura rápida), `9eb5139` (paths Windows nos runners
  POSIX) e `b02ca4e` (timeout de startup mais estável no smoke Windows). `ruby-engine.lock.json` e
  `RUBYCLI_REF` apontam para `b02ca4e`; `npm run build` do Desktop passou e verificou **41 Skills**.
- O candidato Desktop `0.1.4` ainda não foi marcado: a CI passou e o workflow protegido exige certificado
  Windows e certificado/credenciais Apple, que não estão configurados no repositório.

---

## 7. Riscos e mitigações

| Risco                                                                   | Impacto  | Mitigação                                                                                                                              |
| ----------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ruby-auto` inválido → 404 no primeiro uso                              | 🔴 Alto  | M0 corrige o default; app nunca hardcoda modelo; default = 1º do catálogo                                                              |
| Modelo do catálogo com `id` vazio → 400                                 | 🟡 Médio | Filtrar `id` vazio em toda leitura do catálogo + corrigir backend                                                                      |
| Tool calling falhar em algum modelo do catálogo                         | 🟡 Médio | **Já validado em 5 modelos.** Guarda: probe de capacidade por modelo + `salvage.ts` já pronto no engine                                |
| `max_output_tokens` quase sempre `null`                                 | 🟡 Médio | Default conservador por modelo; nunca confiar no campo                                                                                 |
| macOS não empacotável do Windows                                        | 🟡 Médio | CI com runner macOS; ou lançar Windows+Linux e adicionar mac depois                                                                    |
| Módulos nativos (`node-pty`, `better-sqlite3`)                          | 🟢 Baixo | **Risco eliminado no v1**: decisão de usar painel de saída (sem PTY) e sessões em JSON (sem SQLite). Nenhum módulo nativo previsto     |
| Sandbox de exec é passthrough no Windows                                | 🟡 Médio | Documentar como limitação conhecida; usar permissões HITL + snapshots/rewind como rede de segurança                                    |
| `utilityProcess` + MCP stdio (`process.execPath` vira o app empacotado) | 🟡 Médio | `ELECTRON_RUN_AS_NODE=1` ou empacotar um binário Node real                                                                             |
| Engine muito acoplado ao terminal                                       | 🟡 Médio | M0 resolve: `ConfirmFn` já é o seam; mover clack para o CLI                                                                            |
| Imagens: visão versus geração e payload de arquivos                     | 🟡 Médio | Confirmar capacidades do provider antes de habilitar a UI; validar MIME/tamanho no main e transportar payload estruturado pelo IPC        |
| **Dois repos: sincronizar mudanças de contrato**                        | 🟡 Médio | `pnpm link` no desenvolvimento, semver no release, e o contrato de eventos da §4.5 tratado como API pública (major em breaking change) |
| Escopo inflar ("não muito complexo")                                    | 🟡 Médio | Reuso do engine é o que mantém simples; browser e orquestração são os únicos blocos novos de verdade                                   |

---

## 8. Decisões

### Resolvidas

| #   | Decisão                            | Escolha                                                                                                                                         |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Onde vive o Desktop                | **Repo separado** consumindo `@rubycli/core` publicado                                                                                          |
| 2   | Subagentes com escrita             | **Git worktree isolado por subagente**                                                                                                          |
| 3   | Terminal integrado                 | **Painel de saída do agente** no v1 (zero nativos); PTY real depois, se necessário                                                              |
| 4   | Nome do app                        | **Ruby Desktop**                                                                                                                                |
| 8   | Modelo e effort de subagentes (M4) | **Selecionáveis a partir do catálogo; o orquestrador pode recomendar e justificar, e o usuário pode definir ou ajustar os valores por agente.** |
| 9   | Orientação dos subagentes (M4)     | **Cada agente pode receber instruções próprias de papel, contexto, limites, ferramentas e formato de saída.**                                   |
| 10  | Perguntas de esclarecimento (M4.1) | **Cartões interativos inline no chat, com opções e resposta livre; a resposta retoma o turno que aguarda.**                                     |
| 11  | Revisão e merge dos workers        | **Mostrar diff, validar com `git apply --check` e só aplicar após ação explícita; conflito conserva o worktree para revisão.**                  |
| 12  | Concorrência de subagentes         | **Limite de três agentes em execução simultânea.**                                                                                              |
| 13  | Distribuição M5                    | **Release multiplataforma `v0.1.6` publicada via GitHub Actions. Builds sem assinatura no Windows/macOS oferecem download manual; instalação automática requer feed e assinatura.** |
| 14  | Blocklist catastrófica em todos hosts | **RubyCLI consulta a blocklist em `decideConfirmation`; grants amplos/exatos não a sobrepõem e o override manual vale só uma execução (`ae45df6`).** |
| 15  | Correlação de chamadas de ferramenta | **IDs opcionais do provider atravessam `AgentEvent` e JSONL; Desktop pareia por ID e mantém fallback para históricos antigos (`ae45df6`).** |

### Ainda abertas

5. **Code signing:** cadastrar os certificados/credenciais Windows/macOS para remover avisos e habilitar atualização automática; o workflow suporta builds unsigned.
6. **Instaladores em execução:** instalar e abrir os pacotes em Windows, macOS e Linux, incluindo teste de MCP stdio no pacote.
7. **Chave de smoke da CI:** configurar `RUBY_API_KEY` quando o provider estiver disponível para executar smokes live.

---

## 9. Comparação com o DeepSeek Harness

| Capacidade do DSH                        | Nosso caminho                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| Workspaces isolados                      | ✅ M2                                                                                        |
| Goal automático                          | ✅ engine host-neutral com limite, pausa, conclusão e estado bloqueado; controles no Desktop |
| Compact de contexto                      | ✅ já no engine, UI em M2                                                                    |
| MCP (stdio + HTTP)                       | ✅ já no engine, UI em M3                                                                    |
| Subagentes com workers e revisão         | ✅ M4.1–M4.3                                                                                 |
| DSL de workflows                         | ✅ M4.4 com parser restrito, paralelismo e JSON Schema                                       |
| Browser integrado controlado pelo agente | ✅ M3; múltiplas abas em M6                                                                  |
| Skills                                   | ✅ 41 no engine RubyCLI; pinado no candidato Desktop `0.1.4`                                 |
| Terminal integrado                       | ✅ M3                                                                                        |
| Permissões com aprovação                 | ✅ engine tem, UI em M2                                                                      |
| Empacotamento Windows                    | ✅ M5: instaladores x64/arm64/combinado; `v0.1.6` multiplataforma publicada sem assinatura     |
| Provider plugável                        | ✅ já no engine + Ruby nativo                                                                |

---

## 10. Próximo passo

M0–M6 foram entregues e `v0.1.8` é a release mais recente. M8 está no RubyCLI e no Desktop. M7.2
(cotação, geração, edição por arquivo do workspace, gravação obrigatória de assets e prévia inline de
imagens) foi publicada com a engine RubyCLI `e7fbd81d`. O próximo marco é M7.1: anexar imagens de
entrada, persistir referências locais e enviar payload multimodal somente a modelos que anunciam
`supportsVision`. Depois, adicionar smokes para edição, salvamento e autonomia, e aproveitar mais
metadados do catálogo específico de modelos de geração.

Em paralelo, permanecem tarefas operacionais: repetir a matriz live com uma chave válida e provider
disponível; validar os instaladores em Windows, macOS e Linux; e configurar assinatura se for
desejada instalação automática no Windows/macOS. Testes unitários para reducers/componentes do
renderer e a unificação dos eventos do engine continuam como melhorias opcionais.
