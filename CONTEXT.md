# CONTEXT.md — o que falta

> Documento de passagem. Responde a uma pergunta só: **o que ainda não está feito, e o que
> quem continuar precisa saber para não repetir trabalho nem tropeçar nos mesmos erros.**
>
> Para o *porquê* das decisões e o histórico completo, ver [`PLANO.md`](PLANO.md).
> Para convenções de código, ver [`AGENTS.md`](AGENTS.md).

**Estado:** M0, M1, M2, M3 concluídos e verificados. **M4 e M5 não começaram.**
Ambos os repos limpos. RubyCLI com **1129 testes passando / 0 falhando**.

---

## 1. Marcos que faltam

### M4 — Sub-agentes + orquestração

**Core (RubyCLI)**
- Subagente com **git worktree isolado** (decisão já tomada): cada worker ganha seu próprio
  worktree, escreve sem contenção, e o resultado é mesclado no fim. Requer criar/limpar
  worktree, branch por subagente, **política de merge** (em aberto, ver §4) e rollback em falha.
- Papéis: `explorer` (read-only, como o `task` de hoje) vs `worker` (worktree + escrita).
- Paralelismo com **limite de concorrência** configurável.
- Tool `workflow`: script JS com `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`,
  e resultado estruturado por schema JSON.

**Desktop**
- Árvore de subagentes: progresso, status, tokens/custo por agente.
- Diff do worktree **antes** do merge.

### M5 — Empacotamento + release

- `electron-builder` 26, target **NSIS x64 + arm64**.
- `electron-updater` + GitHub Releases.
- CI GitHub Actions: `windows-latest` (build), `ubuntu-latest` (AppImage/deb),
  `macos-latest` (dmg — só via CI, exige runner macOS).

> ⚠️ **Hoje não existe `.exe`.** O app só roda do código, via `npm start`. Quem quiser testar
> sem terminal depende do M5.

---

## 2. Lacunas no que já está construído

Estas não são "próximas fases" — são buracos no que já foi entregue. Ordenadas por gravidade.

### 🔴 2.1 A tool `task` está registrada e **sempre falha**

`createDefaultRegistry(model, runner)` é chamado no
[`engine-host`](src/engine-host/index.ts) **sem o terceiro argumento** (`spawnSubAgent`). Mas
`createDefaultRegistry` registra `createTaskTool(opts?.spawnSubAgent)` **incondicionalmente**
(`src/tools/index.ts:58`).

Consequência: o agente vê `task` no catálogo de tools, decide delegar, chama — e recebe
`"Sub-agent execution is not configured in this environment."`. Ele vai tentar de novo, gastar
turnos, e o usuário vê uma falha que parece bug do modelo.

É **pior do que não ter a tool**. Duas saídas, ambas pequenas:

- **Ligar** (recomendado): copiar o `spawnExploreAgent` do
  [`cli/index.ts`](../RubyCLI/src/cli/index.ts) — um `Agent` filho com contexto novo e só
  tools `readonly`, sem `task` dentro (sem recursão). Isso já entrega o M4 "explorer" e é
  ~30 linhas.
- **Remover** do registry no Desktop, se o M4 for demorar.

### 🔴 2.2 Não há persistência de conversa

Fechar o app **perde o histórico**. O engine tem `Session` (JSON em `~/.rubycli/sessions/`) e
`Agent.restoreMessages()`, mas o Desktop não usa nenhum dos dois. Também não há lista de
sessões nem "retomar a última".

O `PLANO.md` previa "sessões isoladas + persistência (JSON, sem nativos)" no M2 — ficou de fora.

### 🟡 2.3 A chave de API está em texto plano

Lida de `~/.rubycli/config.json`. O plano do M2 dizia migrar para **`safeStorage`** (keychain do
SO). Não foi feito — a única menção no código é um comentário
([`engine-host/index.ts:465`](src/engine-host/index.ts)).

Atenção: o `safeStorage` **não pode simplesmente substituir** a leitura do config. O app hoje
funciona para quem já tem o CLI configurado, o que é uma boa propriedade. O certo é
*salvar* via `safeStorage` quando o usuário digitar a chave na UI, e *ler* na ordem
safeStorage → env → config. Também falta uma UI para o usuário inserir a chave.

### 🟡 2.4 Goal sem auto-continuação

`src/state/goal.ts` **não tem** `maxRounds`, `round` nem status `blocked`. O goal hoje é
puramente manual: banner + `/goal` + pause/resume/complete/clear.

O plano do M2 previa auto-continuação com `maxRounds` e o comando `/auto`. Não foi feito.
Consequência: o agente não continua sozinho em direção ao objetivo — cada turno precisa de
um humano.

### 🟡 2.5 Blocos de código sem colorização

Markdown renderiza, mas código sai branco. Para um agente de código isso incomoda. Decisão
em aberto (§4): `highlight.js` (~100 KB, síncrono) ou `shiki` (~1 MB, assíncrono).

### 🟢 2.6 `AgentEvent` não enriquecido (dívida do M1)

A union do engine ainda não tem `usage`, `approval_request`, `approval_resolved`, `turn_start`,
`goal_updated`, `compact_start`/`done`, `subagent_*`, `mcp_status`.

**Não bloqueia**: o Desktop contorna com mensagens de IPC próprias (`approvalRequest`,
`approvalResult`, `metric`, `goal`, `mcp`, `browserState`). A desvantagem é que o engine deixa
de ser a fonte da verdade desses eventos — qualquer outro host teria de reinventar o mesmo
protocolo.

### 🟢 2.7 Sem lista de workspaces recentes

Trocar de workspace abre um `dialog.showOpenDialog` toda vez. Não há histórico dos últimos
projetos, nem persistência do último workspace usado entre execuções do app.

### 🟢 2.8 Browser: uma aba só

Sem múltiplas abas, sem UI para limpar cookies/sessão, sem tratamento de download. A partição
é `persist:ruby-browser`, então cookies sobrevivem entre execuções — o que é desejável, mas
não há como limpar.

### 🟢 2.9 Comandos interativos não funcionam (deliberado)

Decisão registrada: **sem `node-pty`**. Comando que espera stdin (`npm init` sem flags,
`git rebase -i`, um `read` do shell) vai travar até o timeout de 30s. O painel de saída mostra
a telemetria, mas não aceita entrada.

### 🟢 2.10 Sandbox é passthrough no Windows

Sem isolamento real de filesystem/rede no Windows. A rede de segurança é o gate HITL
(modal de permissão) + snapshots do engine. Documentar como limitação conhecida ao usuário
final.

### 🟢 2.11 macOS e Linux nunca foram executados

O código tem os caminhos (`bwrap` no Linux, `sandbox-exec` no macOS, resolução de shell por
plataforma), mas **nada foi verificado** — o autor não tem Mac e o Linux não foi exercitado.
Os testes do RubyCLI rodam no Windows. Tratar como "provavelmente funciona", não como "testado".

### 🟢 2.12 O Desktop não tem framework de teste

Só os smoke tests em Electron. Sem vitest, sem cobertura, sem teste unitário de componente.
É aceitável para o tamanho atual, mas o `store.ts` já tem lógica que merecia teste
(o parser de slash commands, o reducer de `handleMessage`).

### 🟢 2.13 `vitest.config.ts` do RubyCLI tem paths obsoletos

O bloco de `coverage.exclude` referencia `src/model/types.ts` e `src/agent/core.ts` — **esses
diretórios não existem mais** (viraram `src/providers/` e `src/core/`). Ou seja: o exclude não
está excluindo o que pretendia, e a cobertura está medindo coisas diferentes do que o autor
imaginava. `src/cli/**` continua excluído, mas boa parte da lógica saiu de lá para
`src/core/permissions.ts` (que **é** coberto — o que é correto).

---

## 3. Como rodar e verificar

### Rodar o app

```powershell
cd G:\VSCodeProjects\RubyDesktop
npm start          # roda o build atual
npm run dev        # idem, mas com reload automático do renderer (melhor para iterar)
```

A chave vem de `RUBY_API_KEY` ou `~/.rubycli/config.json`. Não precisa configurar nada se o
CLI já está configurado.

### Verificar (obrigatório antes de dizer "pronto")

```powershell
# 1. Rebuild — SEMPRE. O out/ pode estar mais velho que o src/.
cd G:\VSCodeProjects\RubyCLI ; npm run build
cd G:\VSCodeProjects\RubyDesktop ; npm run build

# 2. Smoke tests (Electron real, artefatos buildados, provider ao vivo)
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
.\node_modules\electron\dist\electron.exe scripts/smoke-main.cjs
.\node_modules\electron\dist\electron.exe scripts/smoke-permissions.cjs
.\node_modules\electron\dist\electron.exe scripts/smoke-mcp.cjs
.\node_modules\electron\dist\electron.exe scripts/smoke-browser.cjs
.\node_modules\electron\dist\electron.exe scripts/smoke-markdown.cjs
```

Os cinco devem terminar com `RESULT PASS` e **exit code 0**. `scripts/smoke-harness.cjs` é o
bootstrap compartilhado — **toda nova mensagem de IPC precisa ser ligada lá também**, senão o
teste passa enquanto o app real está quebrado.

### Gate do engine

```powershell
cd G:\VSCodeProjects\RubyCLI
npm run typecheck && npm run lint && npm run format:check && npm test
```

Baseline atual: **1129 passando, 0 falhando**. Qualquer falha nova é regressão.

---

## 4. Decisões em aberto

| Questão | Por que importa | Recomendação |
|---|---|---|
| **Code signing no Windows** | Sem certificado, o SmartScreen avisa "editor desconhecido" em todo install | Resolver antes de distribuir; um cert OV já resolve |
| **`@rubyclii/cli` publicado ou privado?** | O app empacotado precisa da dep. Hoje é `file:../RubyCLI` (junction npm) — **isso não empacota** | Publicar no npm, ou bundlear o engine no build (o `vite.engine.config.ts` já bundleia, então talvez baste) |
| **Política de merge dos worktrees (M4)** | Merge automático pode sobrescrever trabalho do usuário | **Sempre mostrar o diff e perguntar** |
| **`highlight.js` vs `shiki`** | Peso do bundle vs qualidade | `highlight.js` se o bundle importar; `shiki` se a qualidade ganhar |
| **Ligar ou remover a tool `task`** | Ver §2.1 — hoje ela sempre falha | Ligar (entrega o explorer do M4 de graça) |

---

## 5. Armadilhas conhecidas

Cada uma dessas custou tempo real. Estão aqui para não custarem de novo.

### Ambiente

- **`ELECTRON_RUN_AS_NODE=1`** faz `electron.exe` se comportar como Node puro — o app não abre
  e dá `Cannot read properties of undefined (reading 'whenReady')`. Limpar a variável antes de
  lançar. (Este harness DSH a define.)
- **`process.execPath` num app Electron é `electron.exe`, não `node`.** Um servidor MCP stdio
  precisa de `ELECTRON_RUN_AS_NODE=1` no env do filho (ver
  [`smoke-mcp.cjs`](scripts/smoke-mcp.cjs)). **No app empacotado isso vira o `.exe` do app** —
  confirmar que continua funcionando no M5.
- **O build do Desktop fica stale facilmente.** `out/` mais velho que `src/` = você testa
  código antigo sem perceber. Sempre `npm run build` antes de testar.

### Dependências entre repos

- **`@rubyclii/cli` resolve por junction npm** (`file:../RubyCLI`). Depois de mudar o engine,
  rodar `npm run build` no RubyCLI — senão o `dist/lib.d.ts` fica velho e o typecheck do
  Desktop quebra com `has no exported member`.

### Electron / CDP

- **`capturePage()` na janela NÃO compõe um `WebContentsView`.** A área do browser sai preta
  no PNG. Capturar a página via CDP (`Page.captureScreenshot`) é o único jeito.
- **Eventos de mouse via CDP exigem o bitmask `buttons`**, não só `button`. Sem ele o comando
  reporta sucesso e nenhum `click` chega na página.
- **O Chromium descarta input sintético de uma view sem foco** — também reportando sucesso.
  Resolvido com `Emulation.setFocusEmulationEnabled`, não com foco do SO.
- **`Page.captureScreenshot` espera um frame do compositor** que uma view escondida pode nunca
  produzir. Tem timeout próprio.

### Arquivos e ferramentas

- **Prettier não é idempotente com CRLF** neste repo (`core.autocrlf=true`): `--write` seguido
  de `--check` pode continuar falhando. Rodar `--write` de novo resolve.
- **O harness DSH renderiza `Claude Code` / `OpenAI` de forma diferente dos bytes reais** ao
  ler arquivos. Não usar a forma renderizada como agulha de busca/substituição.

---

## 6. Ordem sugerida para continuar

1. **§2.1 — ligar a tool `task`** (ou removê-la). É a única lacuna que faz o agente *falhar
   ativamente* hoje, e é barata.
2. **§2.2 — persistência de sessão.** Sem isso o app perde tudo ao fechar; é a lacuna que mais
   incomoda no uso diário.
3. **M5 — empacotar.** Ter um `.exe` destrava teste por terceiros e é pré-requisito para
   qualquer coisa de release.
4. **M4 — subagentes com worktree.** É a maior peça restante e a mais arriscada (merge).
5. Depois: §2.3 (`safeStorage`), §2.4 (auto-continuação do goal), §2.5 (highlighting), §2.13
   (paths do coverage).

Se o objetivo for **colocar na mão de alguém para usar**, a ordem certa é 1 → 3 → 2.
Se for **capacidade do agente**, é 1 → 4.
