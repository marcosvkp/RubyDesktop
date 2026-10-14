# SEARCH.md — Registro de pesquisas

> Registro completo das pesquisas feitas para o Ruby Desktop (out/2026): benchmark de
> projetos comparáveis, atualidade da stack, mineração de features, e o ecossistema de
> mods de Minecraft (Java e Bedrock) para skills/ferramentas do harness.
>
> **Metodologia e limitações.** A ferramenta `web_search` estava **sem API key** nesta
> sessão; toda a pesquisa foi feita por `web_fetch` direto (API do GitHub, raw do
> GitHub, sites oficiais, npm registry). Estrelas = API do GitHub em 2026-10-14
> (exatas) ou shields.io (arredondadas, ex. "53k"). Itens não verificados estão
> marcados como **[não verificado]**. O `minecraft.net` (EULA/Usage Guidelines) esteve
> inacessível — as ressalvas legais da seção 5 devem ser confirmadas manualmente.

---

## 1. Benchmark — projetos comparáveis

### 1.1 Tabela comparativa

Ruby Desktop v0.1.3 (privado) — Electron 44 + React 19 + zustand 5; engine em
`utilityProcess` Node puro (ESM); tools read/write/edit/bash/glob/grep; MCP stdio+HTTP;
subagentes com git worktree; goals com auto-continuação; auto-compaction; sessões;
permissões HITL com modal; browser embutido via CDP com snapshots de acessibilidade;
workflow DSL; skills SKILL.md; catálogo multi-provider; NSIS x64+arm64 / AppImage /
deb / DMG; auto-update sem assinatura (Win/mac); só smoke tests.

| Projeto | ★ | Licença | Testes | MCP | Subagentes | Browser | Assinatura |
|---|---|---|---|---|---|---|---|
| **Ruby Desktop** | privado | MIT | só smokes manuais | stdio+HTTP | ✅ worktree por worker | ✅ CDP+a11y | ❌ |
| [opencode](https://github.com/anomalyco/opencode) (antes sst/opencode) | 213,5k | MIT | [não verificado] | ✅ | ✅ build/plan/general | webfetch | ✅ |
| [OpenHands](https://github.com/OpenHands/OpenHands) | 90,9k | MIT | CI | via ACP | ✅ (sandbox Docker) | ❌ | ✅ |
| [Codex](https://github.com/openai/codex) | 129,2k | Apache-2.0 | [não verificado] | [não verificado] | [não verificado] | [não verificado] | ✅ |
| [goose](https://github.com/aaif-goose/goose) (ex-block/goose) | 55,3k | Apache-2.0 | CI | ✅ (70+ extensões) | recipes | ❌ | ✅ |
| [Cherry Studio](https://github.com/CherryHQ/cherry-studio) | 52,6k | AGPL-3.0 | **Vitest+Playwright e2e** | SDK oficial | via Agent SDK | computer-use | ✅ notariza |
| [Aider](https://github.com/Aider-AI/aider) | 49,6k | Apache-2.0 | suíte | ❌ | ❌ | ❌ | pip |
| [Jan](https://github.com/janhq/jan) | 44,9k | — | Vitest+e2e | — | ❌ | ❌ | ✅ |
| [Chatbox](https://github.com/chatboxai/chatbox) | 42,0k | GPL-3.0 | Vitest+Biome | — | ❌ | ❌ | ✅ |
| [LobeHub](https://github.com/lobehub/lobehub) (ex lobe-chat) | 83,2k | — | [não verificado] | ✅ | Agent Groups | ❌ | ✅ |
| [open-webui](https://github.com/open-webui/open-webui) | 155,7k | — | [não verificado] | ✅ | ❌ | ❌ | ✅ |
| Claude Agent SDK | (fechado/SDK) | — | — | ✅ (4 tipos) | ✅ rico (`AgentDefinition`) | extensão | ✅ |

### 1.2 O que os comparáveis fazem melhor

1. **Testes** — Cherry Studio: Vitest por processo (main/preload/renderer/shared/aiCore)
   + Playwright e2e + `smoke:utility-process`; Jan: Vitest em 3 workspaces + e2e que
   builda o binário real; Chatbox: Vitest + Biome. O gap mais gritante do benchmark.
2. **Assinatura/supply chain** — Cherry Studio já notariza (`@electron/notarize`,
   `@electron/osx-sign`); o electron-builder v27 passa a **exigir** manifests de update
   assinados com Ed25519 (`latest*.yml`), verificação fail-closed no updater.
3. **Permissões granulares (opencode)** — `allow/ask/deny` por tool com wildcard,
   "última regra vence", guards `external_directory` e `doom_loop` (mesma tool repetida
   3x), `*.env` negado por default.
4. **Sandbox fail-closed (Claude Agent SDK)** — `SandboxSettings` com
   `filesystem`/`network`/`credentials` + `failIfUnavailable`; `autoAllowBashIfSandboxed`.
   OpenHands: sandbox Docker (1 container por conversa) e aviso explícito sem sandbox.
5. **Contrato de eventos rico (Agent SDK)** — `SDKCompactBoundaryMessage`,
   `SDKPartialAssistantMessage`, `SDKPermissionDeniedMessage`,
   `SDKBackgroundTasksChangedMessage`, `task_progress`, hooks
   `PreToolUse/PostToolUse/Stop/SubagentStop/PreCompact/PostCompact`.
6. **Refinamentos de aprovação (Agent SDK)** — `defaultToNo` (modal abre no "negar"),
   `suppressAlwaysAllowRule` (asks que não viram grant), `matchedAskRule`
   (regra forçada ≠ pedido humano), `title`/`displayName`/`decisionReason` prontos para o modal.
7. **i18n/docs como gate de CI (Cherry)** — `i18n:extract/lint/unused/hardcoded-check`;
   `docs:check-links/structure/frontmatter`.
8. **ACP (Agent Client Protocol)** — padrão para trocar agentes entre harnesses
   (opencode e OpenHands já usam).

### 1.3 O que o Ruby Desktop faz melhor

- **Separação de processos do engine** (utilityProcess Node puro, sem Chromium, com
  `process.cwd()` real) — Chatbox roda tudo no main; Jan precisou migrar para Tauri/Rust.
- **Contrato IPC único** (`src/shared/ipc.ts`, nomes de canal num só objeto) — acima da média.
- **Browser agêntico** (WebContentsView + CDP + a11y snapshots + refs) — só
  OpenHands/Claude têm algo próximo; Chatbox/Jan/ChatWise/opencode só têm `webfetch`.
- **Contenção do renderer** (CSP `connect-src 'none'`, markdown sem HTML bruto, grants
  só de storage do usuário com `allow` de repo ignorado — GHSA-3g98-ffw6-87mg).
- **Goal com auto-continuação e auto-compaction próprios** — Chatbox/Jan/ChatWise não têm loop de agente.
- **Worktree por subagente** com review de diff antes do merge (OpenHands apenas
  *recomenda* worktrees ao usuário).

### 1.4 Ideias aproveitáveis (síntese)

Playwright `_electron` para e2e; `forceCodeSigning: true`; assinatura de manifests
Ed25519; Azure Trusted Signing; sandbox fail-closed para bash; regras de permissão com
wildcard; eventos mais granulares no `AgentEvent`; `maxTurns`/`background`/observer por
subagente; hooks de ciclo de vida; Sentry+OpenTelemetry.

### 1.5 Fontes (benchmark)

- READMEs: [Cherry Studio](https://raw.githubusercontent.com/CherryHQ/cherry-studio/main/README.md) · [Chatbox](https://raw.githubusercontent.com/ChatboxAI/chatbox/main/README.md) · [Jan](https://raw.githubusercontent.com/janhq/jan/main/README.md) · [opencode (dev)](https://raw.githubusercontent.com/sst/opencode/dev/README.md) · [goose](https://raw.githubusercontent.com/block/goose/main/README.md) · [Aider](https://raw.githubusercontent.com/Aider-AI/aider/main/README.md) · [Codex](https://raw.githubusercontent.com/openai/codex/main/README.md) · [OpenHands](https://raw.githubusercontent.com/All-Hands-AI/OpenHands/main/README.md) · [LobeHub (canary)](https://raw.githubusercontent.com/lobehub/lobehub/canary/README.md)
- package.jsons: [Cherry](https://raw.githubusercontent.com/CherryHQ/cherry-studio/main/package.json) · [Jan](https://raw.githubusercontent.com/janhq/jan/main/package.json)
- Docs: [permissões do opencode](https://opencode.ai/docs/permissions/) · [opencode docs](https://opencode.ai/docs/) · [goose recipes](https://goose-docs.ai/docs/guides/recipes/) · [sdk.d.ts do Claude Agent SDK (unpkg)](https://unpkg.com/@anthropic-ai/claude-agent-sdk/sdk.d.ts)
- Electron: [Security checklist](https://www.electronjs.org/docs/latest/tutorial/security) · [Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing) · [Code Signing (electron-builder)](https://www.electron.build/docs/features/code-signing/) · [Signed Update Manifests](https://www.electron.build/docs/features/signed-update-manifests/) · [Playwright — Electron](https://playwright.dev/docs/api/class-electron)
- Event contracts: [AI SDK Stream Protocols](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol) · [LangGraph streaming](https://docs.langchain.com/oss/python/langgraph/streaming) · [LangGraph event streaming](https://docs.langchain.com/oss/python/langgraph/event-streaming)
- Padrões: [MCP spec 2025-06-18 (elicitation, structured output)](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation) · [MCP Registry](https://github.com/modelcontextprotocol/registry) (7,4k★) · [mcp-ui](https://github.com/MCP-UI-Org/mcp-ui) (5,2k★) · [ACP](https://github.com/agentclientprotocol/agent-client-protocol) (4,4k★) · [Agent Skills standard](https://agentskills.io) · [OTel GenAI semconv](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- Awesome lists: [awesome-llm-apps](https://github.com/Shubhamsaboo/awesome-llm-apps) (141,7k★) · [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) (96,3k★) · [awesome-ai-agents](https://github.com/e2b-dev/awesome-ai-agents) (30,4k★)

---

## 2. Atualidade da stack (npm registry, 2026-10-14)

| Pacote | Projeto usa | Latest | Status |
|---|---|---|---|
| electron | `^44.7.0` | 44.7.2 | ✅ atual |
| electron-builder | `^26.15.3` | 26.15.3 | ✅ idêntico |
| react | `^19.3.0` | 19.3.1 | ✅ atual |
| zustand | `^5.0.15` | 5.0.15 | ✅ idêntico |
| typescript | `^6.0.3` | **7.0.2** | ⚠️ major atrás |
| vite | `^7.3.7` | **8.3.4** | ⚠️ major atrás |

`npm audit`: 0 vulnerabilidades de runtime; 8 moderadas em dev (cadeia do
electron-builder: app-builder-lib/dmg-builder).

---

## 3. Feature mining — Ruby Desktop (46 features)

Tudo abaixo é o que o Ruby Desktop **não** tem. Valor = impacto para o app;
Esforço = S/M/L.

| # | Feature | O que é | Onde vi | Valor | Esf. |
|---|---|---|---|---|---|
| 1 | Command palette (cmdk) | Cmd+K global: comandos, sessões, arquivos, settings | Cherry "Global Search"; opencode Commands | Alto | S |
| 2 | Notificação nativa + badge | SO avisa fim de turno/goal/permissão pendente | padrão Electron (Cherry/Chatbox) | Alto | S |
| 3 | Tray + mini-mode + atalho global | bandeira + janela flutuante p/ prompt rápido | Cherry "Window Pinning"; Electron Tray/globalShortcut | Alto | S |
| 4 | Deep link `rubydesktop://` | abrir sessão/recipe/prompt por link | [goose Deeplink Generator](https://goose-docs.ai/docs/guides/recipes/) | Alto | S |
| 5 | Drag-and-drop no composer | arrastar imagem/PDF/arquivo p/ o prompt (base do M7) | opencode; ChatWise multi-modal | Alto | S |
| 6 | Prompt library | prompts reutilizáveis com variáveis | [Chatbox](https://github.com/chatboxai/chatbox) | Médio | S |
| 7 | Tokens + custo por sessão/goal | contador, custo USD, budget máximo | SDK `maxBudgetUsd`/`taskBudget`; Cherry `gpt-tokenizer` | Alto | S |
| 8 | UX de permissão refinada | title/why, "sempre permitir" como sugestão, `defaultToNo` | SDK `CanUseTool` | Alto | S |
| 9 | Banner de rate limit | countdown + retry elegante em 429 | SDK `SDKRateLimitInfo`; goose | Médio | S |
| 10 | `/init` AGENTS.md + `@` file mention | onboarding + contexto por fuzzy-search | opencode | Alto | S |
| 11 | Slash commands + rules por projeto | comandos custom e regras versionadas | opencode Rules/Commands; goose | Alto | S |
| 12 | Auto-update UX | changelog, canais, "reiniciar agora" | Cherry electron-updater 6.7 | Alto | S |
| 13 | Undo/redo por turno | checkpoint de arquivos + reapresentar prompt | opencode `/undo`; SDK `enableFileCheckpointing`/`rewindFiles` | Alto | M |
| 14 | Plan mode visual | read-only → plano aprovável antes de executar | opencode build/plan (Tab); SDK `permissionMode: 'plan'` | Alto | M |
| 15 | Diff viewer / split view | revisar/aceitar por arquivo antes de aplicar | Cherry `@pierre/diffs`; ChatWise Artifacts | Alto | M |
| 16 | Git worktree UI + criar PR | painel dos worktrees + botão create PR | opencode GitHub/GitLab integration | Alto | M |
| 17 | Background tasks com stop por tarefa | shell/subagent/workflow em background | SDK `BackgroundTaskSummary`/`stop_task` | Alto | M |
| 18 | Hooks de ciclo de vida | scripts em PreToolUse/PostToolUse/Stop/PreCompact… | SDK hooks (20+ eventos) | Médio | M |
| 19 | Custom tools do usuário | ferramentas JS/TS de pasta do usuário | opencode Custom Tools; SDK `plugins` | Alto | M |
| 20 | LSP + formatters pós-edição | diagnóstico em tempo real, auto-format | [opencode LSP](https://opencode.ai/docs/lsp/)/[Formatters](https://opencode.ai/docs/formatters/) | Alto | M |
| 21 | Sandbox de bash | restringir fs/rede/credenciais de comandos | SDK `SandboxSettings` | Alto | M |
| 22 | Lint/test auto e auto-fix | rodar após cada edição; agente corrige | [Aider lint/test](https://aider.chat/docs/usage/lint-test.html) | Alto | M |
| 23 | Structured output (JSON schema) | saídas de tool tipadas/validadas | [MCP structured tool output](https://modelcontextprotocol.io/specification/2025-06-18/server/tools); SDK `outputFormat` | Médio | S/M |
| 24 | MCP elicitation + sampling | servidor pede dados ao usuário / usa modelo do cliente | [MCP Elicitation](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation); goose | Médio | M |
| 25 | MCP marketplace | instalar servidores com 1 clique do registry | [MCP Registry](https://github.com/modelcontextprotocol/registry) (7,4k★) | Alto | M |
| 26 | Mini-apps / MCP-UI | UI interativa (HTML/React) de MCP dentro do chat | [mcp-ui](https://github.com/MCP-UI-Org/mcp-ui) (5,2k★); Cherry Mini Programs; goose MCP Apps | Alto | L |
| 27 | RAG local / knowledge base | embeddings + sqlite-vec + PDF/DOCX com citações | Cherry `sqlite-vec`, `pdfjs-dist`, `officeparser`; open-webui | Alto | L |
| 28 | OCR + captura de tela | screenshot/região → contexto visual; OCR | Cherry `node-screenshots`, `ppu-paddle-ocr`, `tesseract.js` | Alto | M |
| 29 | Web search nativo | ferramenta de busca para o agente | ChatWise (Tavily); Cherry `@mozilla/readability` | Alto | S/M |
| 30 | Voice input/output | ditar prompts, ouvir respostas | [Aider voice](https://aider.chat/docs/usage/voice.html); Cherry `sherpa-onnx-node`; `@lobehub/tts` | Médio | M |
| 31 | Terminal embutido (node-pty/ConPTY) | terminal real dentro do app | goose Terminal Integration | Alto | M |
| 32 | Sessão fork / time travel | retomar de um ponto específico | SDK `resumeSessionAt`/`forkSession` | Médio | M |
| 33 | Subagent progress + observer | resumos periódicos; agente-observador | SDK `agentProgressSummaries`/`ObserverReport` | Médio | M |
| 34 | Multi-model simultâneo | mesma pergunta a N modelos, comparar | Cherry "Multi-model Conversations" | Médio | M |
| 35 | Share de conversas | sessão como página compartilhável | opencode `/share`; Cherry | Médio | M |
| 36 | Backup WebDAV + sync | backup de sessões/config/knowledge | Cherry WebDAV | Médio | M |
| 37 | Telemetry OTel GenAI + Sentry | traces no padrão OTel GenAI (inclui MCP) | Cherry `@sentry/electron` + `@opentelemetry/*` | Médio | S/M |
| 38 | Selection assistant | texto selecionado em qualquer app → contexto | Cherry `selection-hook` | Médio | M |
| 39 | Servidor ACP | engine vira backend de editores (Zed, VS Code) | [ACP](https://github.com/agentclientprotocol/agent-client-protocol) (4,4k★) | Médio | L |
| 40 | Agentes agendados + webhooks | cron/eventos disparam sessões | LobeHub Schedule; OpenHands Automations; Cherry `croner` | Alto | L |
| 41 | Relatórios automáticos (digest) | agente gera relatório periódico → Slack/e-mail | OpenHands reports; LobeHub | Alto | M |
| 42 | Memória white-box editável | memória visível/editável por agente/projeto | LobeHub White-Box Memory; SDK `AgentDefinition.memory` | Alto | L |
| 43 | IM gateway (Telegram/Slack/WhatsApp) | conversar com os agentes por mensageiro | Cherry `grammy`, `dingtalk-stream`; LobeHub IM Gateway | Alto | L |
| 44 | Companion mobile / remote control | controlar sessões remotamente | Cherry `remote-protocol`/`remote-transport`; ChatWise iOS/Android | Médio | L |
| 45 | Modelos locais (Ollama/llama.cpp) | privacidade e modo offline | [Jan](https://github.com/janhq/jan) (API local :1337); Cherry Ollama/LM Studio | Médio | L |
| 46 | Recipes/workflows compartilháveis | prompt+tools+settings em arquivo + deeplink | [goose Recipes](https://goose-docs.ai/docs/guides/recipes/) (subrecipes, cookbook) | Alto | M |

### 3.1 Top 10 quick wins (esforço S, valor alto)

1. Command palette (cmdk) (#1)
2. Drag-and-drop de imagens/arquivos no Composer (#5)
3. Notificações nativas + badge — "aguardando aprovação" (#2)
4. UX de permissão refinada — `defaultToNo`, `title`/`why` (#8)
5. Tokens + custo por sessão/goal (#7)
6. Tray + mini-mode + atalho global (#3)
7. Deep link `rubydesktop://` (#4)
8. `/init` AGENTS.md + `@`-menções (#10)
9. Slash commands + rules por projeto (#11)
10. Auto-update UX com changelog (#12) ou web search (#29)

### 3.2 Top 10 moonshots (diferenciais competitivos)

1. **Mini-apps / MCP-UI** (#26) — o "Artifacts" dos agentes de ferramenta
2. **Ruby Operator** — agentes agendados 24/7 + digest (#40+#41)
3. **Memória white-box editável** (#42)
4. **Computer use de desktop** — screenshot + OCR + clique (#28)
5. **Servidor ACP** (#39)
6. **RAG local com sqlite-vec** (#27)
7. **Time travel de sessão** — checkpoint + fork + diff viewer (#13+#32+#15)
8. **Agent teams canvas** — worktrees em paralelo + progress summaries (#16+#33+#46)
9. **Voice-first** (#30)
10. **Marketplace de skills/MCP** integrado ao MCP Registry oficial (#25)

---

## 4. Minecraft — ecossistema de modding (para skills/ferramentas do harness)

### 4.1 Contexto de versão (importante!)

O Minecraft migrou para **versionamento anual**: a linha "1.21.x" terminou em **1.21.11**
e as versões atuais são **26.1 / 26.2 / 26.3** (26.4-snapshots em dev). Fixar a
versão-alvo é mandatório — quebras de API a cada minor.

### 4.2 Mapa Java vs Bedrock

| Dimensão | **Java Edition (mods)** | **Bedrock Edition (addons)** |
|---|---|---|
| Loaders | Fabric, NeoForge (sucessor do Forge desde 1.20.2), Quilt, Forge legado (≤1.20.1) | Sem loader: behavior/resource packs nativos + Script API (JS) em client/BDS/realms; nativo via LeviLamina (BDS) |
| Linguagem/API | Java (Kotlin opcional): registry, networking, brigadier, rendering (FRAPI/Indigo), events | **JSON** declarativo (entidades, blocos, itens, partículas, animações, render controllers, geometry) + **Molang** + **JavaScript/TS** (Script API `@minecraft/server` 2.10.0 estável, `@minecraft/server-ui` 2.2.0 estável) |
| Build/tooling | Gradle + fabric-loom (369★) / ModDevGradle (113★) / architectury-loom (151★); Mixin (1,7k★); Stonecutter (102★) multi-versão; IntelliJ MinecraftDev (1.798★) | **Sem build**: texto/JSON + zip (`.mcaddon`/`.mcpack`); validação via "content log" |
| Mappings | Intermediary + Yarn (1,2k★, CC0) ou Mojmap via NeoForm (53★); `genSources`/[mappings.dev](https://mappings.dev/) | Sem obfuscação de conteúdo, mas sem schema oficial estável — [bedrock.dev](https://bedrock.dev/), [bedrock-samples](https://github.com/Mojang/bedrock-samples) (1,8k★) |
| Data/JSON | Datapacks: recipes, loot, advancements, worldgen, tags; DataGen; mcfunction + [datapack-language-server](https://github.com/SPGoding/datapack-language-server) (477★) | Tudo é data; Molang como "expressões" |
| Testes | **GameTest headless** (`./gradlew runGameTestServer`) — ideal p/ CI de agente | GameTest via `@minecraft/server-gametest`/`/gametest` em BDS — menos maduro |
| Assets | [Blockbench](https://github.com/JannisX11/blockbench) (6,1k★) exporta Java/Bedrock/OptiFine/GeckoLib | Blockbench + [Snowstorm](https://github.com/JannisX11/snowstorm) (242★) + [bridge.](https://github.com/bridge-core/bridge.) (344★) |
| Distribuição | [Modrinth API](https://docs.modrinth.com/api/) (Labrinth v2, PAT/OAuth, 300 req/min, User-Agent obrigatório) + [Minotaur](https://github.com/modrinth/minotaur) (132★); CurseForge (`x-api-key`) | `.mcaddon` em comunidades (MCPEDL etc.); Marketplace exige parceria |
| Servidores p/ automação | [Paper](https://github.com/PaperMC/Paper) (12,7k★)/Purpur (2,4k★); RCON; [MCProtocolLib](https://github.com/GeyserMC/MCProtocolLib) (909★) | BDS + `@minecraft/server-net`/`server-admin` (1.0.0-beta, só BDS); LeviLamina (1,7k★), PocketMine-MP (3,6k★), Endstone (754★), Dragonfly (850★) |
| Automação por agente | **Alta** (scaffold/build/test/publish via CLI); média-alta p/ código (Mixins frágeis); alta p/ data JSON | **Altíssima** p/ geração de packs (tudo arquivo); alta p/ Script API (JS tipado); média p/ validação |
| Dificuldade | Média-alta: mappings voláteis, quebras por minor, curva de Mixin | Média: JSON extenso mas estável, docs fragmentadas, Molang com sintaxe própria |

### 4.3 Repos e bibliotecas-chave (★ verificadas via API)

**Java — loaders, build, código**

| Repo | ★ | O que é |
|---|---|---|
| [FabricMC/fabric](https://github.com/FabricMC/fabric) | 3.195 | Fabric API (branch padrão "26.3", Apache-2.0) |
| [FabricMC/fabric-example-mod](https://github.com/FabricMC/fabric-example-mod) | 2.373 | **Template oficial (CC0 — domínio público)**, `is_template: true` |
| [FabricMC/yarn](https://github.com/FabricMC/yarn) | 1,2k | Mappings comunitários (CC0) |
| [FabricMC/fabric-loader](https://github.com/FabricMC/fabric-loader) | 889 | Loader |
| [FabricMC/fabric-loom](https://github.com/FabricMC/fabric-loom) | 369 | Plugin Gradle (dev env, genSources), MIT |
| [neoforged/NeoForge](https://github.com/neoforged/NeoForge) | 2.096 | Sucessor do Forge (branch "26.3.x", LGPL-2.1) |
| [neoforged/ModDevGradle](https://github.com/neoforged/ModDevGradle) | 113 | Plugin Gradle NeoForge **[não verificado — rate limit]** |
| [neoforged/NeoForm](https://github.com/neoforged/NeoForm) | 53 | Deobfuscação/reempacotamento |
| [SpongePowered/Mixin](https://github.com/SpongePowered/Mixin) | 1,7k | Injeção de bytecode |
| [QuiltMC/quilt-loader](https://github.com/QuiltMC/quilt-loader) | 520 | Loader Quilt |
| [kikugie/stonecutter](https://github.com/kikugie/stonecutter) | 102 | Multi-versão (Gradle plugin, LGPL-3.0) |
| [architectury/architectury-loom](https://github.com/architectury/architectury-loom) | 151 | Loom multi-loader |
| [minecraft-dev/MinecraftDev](https://github.com/minecraft-dev/MinecraftDev) | 1.798 | Plugin IntelliJ |
| [Creators-of-Create/Create](https://github.com/Creators-of-Create/Create) | 4,6k | Mod de referência de qualidade (Registrate, datagen) |
| [misode/mcmeta](https://github.com/misode/mcmeta) | 632 | Dados vanilla por versão (p/ validar JSON gerado) |
| [kube-mods/kubejs](https://github.com/kube-mods/kubejs) | 479 | Scripting de mods (LGPL-3.0, branch "2601") |
| [SPGoding/datapack-language-server](https://github.com/SPGoding/datapack-language-server) | 477 | LSP de datapacks/mcfunction |
| [ModdingX/LibX](https://github.com/ModdingX/LibX) | 9 | Lib de modding (Apache-2.0) **[baixa adoção]** |

**Java — servidores/plugins**: [PaperMC/Paper](https://github.com/PaperMC/Paper) 12.733★ (paper-api, brigadier) · Purpur 2,4k★ · [GeyserMC/MCProtocolLib](https://github.com/GeyserMC/MCProtocolLib) 909★ (MIT)

**Bedrock — packs, ferramentas, servidores**

| Repo | ★ | O que é |
|---|---|---|
| [Mojang/bedrock-samples](https://github.com/Mojang/bedrock-samples) | 1.773 | **Oficial da Mojang**: samples de resource/behavior packs + assets de referência (atualizado out/2026) |
| [Amulet-Team/Amulet-Map-Editor](https://github.com/Amulet-Team/Amulet-Map-Editor) | 2.248 | Editor/conversor de mundos (Java 1.12+ e Bedrock 1.7+), Python |
| [Amulet-Team/Amulet-Core](https://github.com/Amulet-Team/Amulet-Core) | 248 | Biblioteca Python/C++ de leitura/escrita de saves |
| [pmmp/PocketMine-MP](https://github.com/pmmp/PocketMine-MP) | 3,6k | Servidor Bedrock em PHP |
| [LiteLDev/LeviLamina](https://github.com/LiteLDev/LeviLamina) | 1,7k | Loader de mods nativos do BDS |
| [df-mc/dragonfly](https://github.com/df-mc/dragonfly) | 850 | Servidor Bedrock em Go |
| [EndstoneMC/endstone](https://github.com/EndstoneMC/endstone) | 754 | Plugins Python/C++ sobre BDS |
| [PrismarineJS/bedrock-protocol](https://github.com/PrismarineJS/bedrock-protocol) | 485 | Protocolo Bedrock em JS (MIT) |
| [JannisX11/snowstorm](https://github.com/JannisX11/snowstorm) | 242 | Editor web de partículas (Vue, GPL-3.0) |
| [bridge-core/bridge.](https://github.com/bridge-core/bridge.) | 344 | IDE de add-ons Bedrock (TS, GPL-3.0) — **parado desde 2022** |

**Assets**: [JannisX11/blockbench](https://github.com/JannisX11/blockbench) 6.057★ (Electron, GPL-3.0, `.bbmodel`, exportadores Bedrock/Java/GeckoLib) · [blockbench-plugins](https://github.com/JannisX11/blockbench-plugins) 184★ (repo oficial — **proíbe plugins com IA**)

**NBT/dados (JS — para tools no engine Node)**: [NBTify](https://github.com/Offroaders123/NBTify) 73★ (MIT, TS, npm `nbtify`, suporta Java e Bedrock) · [PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data) 953★ (dados de blocos/itens, linguagem-independente) · [EngineHub/SchematicJS](https://github.com/EngineHub/SchematicJS) 21★ (schematics WorldEdit)

**Bots / IA (LLM + Minecraft)**: [cabaletta/baritone](https://github.com/cabaletta/baritone) 9.298★ (pathfinding, LGPL-3.0, branch 1.21.4) · [PrismarineJS/mineflayer](https://github.com/PrismarineJS/mineflayer) 7.582★ (bot Java em Node, MIT) · [MineDojo/Voyager](https://github.com/MineDojo/Voyager) 7.260★ (agente LLM com "skill library" de JS) · [MineDojo/MineDojo](https://github.com/MineDojo/MineDojo) 2.271★ (gym/dataset p/ RL/LLM, MIT) · [facebookresearch/CraftAssist](https://github.com/facebookresearch/CraftAssist) 630★ (assistente NL, Meta)

### 4.4 MCPs de Minecraft já existentes (não escrever do zero!)

| MCP | ★ | O que expõe |
|---|---|---|
| [yuniko-software/minecraft-mcp-server](https://github.com/yuniko-software/minecraft-mcp-server) | 780 | stdio `npx` sobre mineflayer: mover, voar, inventário, place/dig, forno, entidades, chat, gamemode (MC 1.21.11), Apache-2.0 |
| [jasonjgardner/blockbench-mcp-plugin](https://github.com/jasonjgardner/blockbench-mcp-plugin) | 522 | **BlockbenchMCP**: plugin do Blockbench (HTTP `localhost:3000/bb-mcp`) + **servidor headless stdio** para `.bbmodel`; tools de cubos/UV/texturas/animação/export + `execute_script`/`risky_eval`; **já publica agent skills** (skills.sh); GPL-3.0 |
| [d3ara1n/Polymerium](https://github.com/d3ara1n/Polymerium) | 121 | Launcher de instâncias com CLI e modo MCP |
| [bigph00t/hermescraft](https://github.com/bigph00t/hermescraft) | 73 | Companheiro AI embutido (mineflayer + MCP) |
| [OGMatrix/mcmodding-mcp](https://github.com/OGMatrix/mcmodding-mcp) | 68 | Acesso do agente à documentação de modding (busca de docs/código), MIT, npm |
| [blockmineJS/blockmine](https://github.com/blockmineJS/blockmine) | 55 | Framework de bots mineflayer + dashboard + MCP |
| [MCDxAI/minecraft-dev-mcp](https://github.com/MCDxAI/minecraft-dev-mcp) | 45 | Java decompiler + mappings (Mojmap/Yarn) para o agente ler mods |
| [sosadly/blockbench-mcp](https://github.com/sosadly/blockbench-mcp) | 34 | Blockbench MCP alternativo (MIT) |
| [enfp-dev-studio/blockbench-mcp](https://github.com/enfp-dev-studio/blockbench-mcp) | 32 | Blockbench MCP alternativo (MIT) |
| [FundamentalLabs/minecraft-mcp](https://github.com/FundamentalLabs/minecraft-mcp) | 77 | MCP server for minecraft (MIT) |
| [gerred/mcpmc](https://github.com/gerred/mcpmc) | 40 | MCP + Minecraft (MIT) |
| [TejasLamba2006/modrinth-kit](https://github.com/TejasLamba2006/modrinth-kit) | 2 | CLI + MCP + GitHub Action do Modrinth |
| [justinscott12/modrinth-mcp](https://github.com/justinscott12/modrinth-mcp) | 0 | Busca/publicação Modrinth (npm + plugin Claude Code) |

⚠️ **Segurança**: `risky_eval` do BlockbenchMCP roda JS arbitrário (só localhost);
RCON com senha em texto; mods de terceiros executam código. Todos caem na política de
permissões HITL do harness — manter allowlist por tool.

### 4.5 Inventário de skills/tools (~20)

Cada item: **nome** — o que faz · *ferramentas* · **MCP**: pronto ou escrever.

**Java Edition**

1. **mod-scaffold-fabric** — projeto Fabric do zero a partir do template CC0 · `git`, Gradle+fabric-loom · escrever (template + file tools).
2. **mod-scaffold-neoforge** — MDK NeoForge com ModDevGradle, `@Mod`, registries, datagen · escrever.
3. **gradle-build** — `build/runClient/runServer/genSources/runData`, parse de erros · Gradle wrapper, JDK 21 · escrever (shell basta).
4. **mc-gametest** — escreve GameTests, roda `runGameTestServer` headless, consolida relatório · escrever (nenhum pronto).
5. **mixin-helper** — gera Mixins com targets corretos via `genSources`/mappings.dev · skill de conhecimento.
6. **recipe-datagen** — recipes/loot/advancements/tags validados contra [misode/mcmeta](https://github.com/misode/mcmeta) · escrever.
7. **worldgen-gen** — biomes/density functions/features/structures com templates · escrever.
8. **mod-multi-version** — N versões num build (1.21.11, 26.1–26.3) · [Stonecutter](https://github.com/kikugie/stonecutter) · escrever.
9. **modrinth-publish** — projeto/versão no Modrinth (Labrinth v2: PAT, User-Agent, 300 req/min) · **MCP pronto** ([modrinth-kit](https://github.com/TejasLamba2006/modrinth-kit), [modrinth-mcp](https://github.com/justinscott12/modrinth-mcp)) ou Minotaur.
10. **curseforge-publish** — consulta `api.curseforge.com` (`x-api-key`); upload via site/CI · escrever. ⚠️ CurseGradle está **arquivado** — Modrinth é o caminho.
11. **mc-docs-lookup** — assinaturas corretas da API por versão (docs.fabricmc.net, neoforged.net, mappings.dev) · escrever.

**Bedrock Edition**

12. **behavior-pack-builder** — behavior+resource pack completo (manifest com UUIDs, entities, blocks, items, recipes, loot, spawn rules) + empacotar `.mcaddon` · zip/python/node · escrever (o terreno mais fácil!).
13. **script-api-dev** — scaffolding de Script API (`@minecraft/server` 2.10.0 com `.d.ts` do npm), manifest, `/reload` em BDS · escrever.
14. **molang-eval** — avalia/depura expressões Molang · intérpretes do Snowstorm/bridge. · escrever.
15. **particle-gen** — `.particle.json` (Molang, materiais, curves) · Snowstorm ou JSON direto · escrever.
16. **bedrock-test** — BDS headless, ativa packs/experiments, `/gametest`, content log · `@minecraft/server-net`/`server-admin` (beta) · escrever.
17. **nbt-inspect/nbt-edit** — NBT/SNBT de mundos e `.nbt` (little-endian no Bedrock) · [nbtlib](https://pypi.org/project/nbtlib/) (CLI `nbt --json --little`), NBTify (JS) · escrever (tool de CLI trivial).
18. **world-edit-amulet** — fill/replace/clone, exportar região, converter Java↔Bedrock · [Amulet](https://github.com/Amulet-Team/Amulet-Map-Editor) (API Python) · escrever.

**Assets e cross-cutting**

19. **blockbench-model / texture-gen** — cria/texturiza/anima modelos via BlockbenchMCP (`add_cubes`, UV, `create_texture`/`paint_faces`, `check_model`, `export_project`) · **MCP pronto** (headless: `npx -y github:jasonjgardner/blockbench-mcp-plugin --root ./models`).
20. **server-rcon / bot-agent** — administra servidor via RCON / controla personagem para testar mods in-game · **MCP pronto** ([minecraft-mcp-server](https://github.com/yuniko-software/minecraft-mcp-server), [blockmine](https://github.com/blockmineJS/blockmine)); RCON: escrever.

*Bônus*: **launcher-mcp** (via [Polymerium](https://github.com/d3ara1n/Polymerium)) e **plugin-scaffold (Paper)** para testes em servidor.

**Arquitetura sugerida** (3 camadas): (1) MCPs prontos plugados via stdio/HTTP;
(2) tools próprias simples (gradle, nbt, zip, RCON) como tools do harness;
(3) skills SKILL.md de "receita" orquestrando as duas, com templates versionados.

### 4.6 Riscos e dificuldades

**Legais / EULA**
- **Assets do jogo não podem ser redistribuídos** em mods/packs — só conteúdo próprio.
  `bedrock-samples` serve como *referência*, não material para embutir.
- **Mappings oficiais da Mojang têm licença restritiva** (uso em dev; redistribuição
  proibida). Yarn é comunitário (CC0). Código deobfuscado não se redistribui.
- **Minecraft EULA + Usage Guidelines**: `minecraft.net` esteve inacessível nesta
  pesquisa — **confirmar manualmente**: (i) bots/automação e uso comercial;
  (ii) cláusulas de **IA/machine learning** (treino/datasets — área cinzenta explorada
  por MineDojo/Voyager); (iii) distribuição de mods. URLs: [EULA](https://www.minecraft.net/en-us/eula) · [Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines).
- **Marketplace Bedrock** exige contrato de parceria; `.mcaddon` grátis em comunidades é o usual.
- **Modrinth valida** que o upload é um mod real; CurseForge exige API key e moderação.

**Técnicos**
- **Versionamento frágil** (1.21.x → 26.x mudou até o esquema de numeração); fixar versão-alvo.
- **Mappings voláteis** — nomes de métodos mudam a cada release; usar `genSources`/mappings.dev.
- **Mixins frágeis** — preferir hooks de API oficial quando existirem.
- **Testes headless pesam** — GameTest baixa cliente/servidor (EULA, cache pesado, minutos/build); Bedrock é mais simples mas menos maduro.
- **MCPs jovens** — bots seguem versões específicas (780★ suporta 1.21.11); BlockbenchMCP exige app aberto (ou headless p/ `.bbmodel`); **repo oficial de plugins do Blockbench proíbe IA** (distribuir por URL direta).
- **Licenças GPL** (Blockbench e blockbench-mcp-plugin) impõem obrigações se embarcar código derivado.

---

## 5. Bedrock e C# — correção de premissa (verificado 2026-10-14)

**Addons do Bedrock NÃO usam C#.** O sistema de Addons é **JSON + Molang +
JavaScript/TypeScript** (Script API `@minecraft/server`, pacotes npm com `.d.ts` —
confirmado na [doc oficial Microsoft Learn](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/)).
O jogo é escrito em **C++**. Não existe API oficial de Addons em C#.

| Camada de um addon | Linguagem |
|---|---|
| Definições (entidades, blocos, itens, recipes, worldgen) | JSON |
| Expressões (animações, render controllers) | Molang |
| Lógica/programação | JavaScript/TS (`@minecraft/server`) |
| Distribuição | ZIP `.mcaddon`/`.mcpack` (sem build) |

**Onde o C# aparece de verdade no ecossistema Bedrock** (verificado via API do GitHub):

| Projeto | ★ | O que é |
|---|---|---|
| [ConcreteMC/Alex](https://github.com/ConcreteMC/Alex) | 603 | Cliente Minecraft em C# (compatível Java **e** Bedrock), MPL-2.0, com suporte a Molang |
| [BedrockSharp/bedrock-protocol](https://github.com/BedrockSharp/bedrock-protocol) | 35 | Implementação C# do protocolo Bedrock (MIT, NuGet, novo em 2026) |
| [OhBlihv/SkyCore-MiNET](https://github.com/OhBlihv/SkyCore-MiNET) | 2 | Core de servidor MiNET (Bedrock server reescrito em C# com plugins C#) |
| Mods de **Minecraft Dungeons** (BepInEx) | — | Outro jogo (Unity/C#) — provável origem da confusão |

Ou seja: C# vive em **ferramentas/servidores/clientes ao redor** do Bedrock (ecossistema
MiNET/Alex/BedrockSharp) e em Dungeons (Unity) — não no sistema de Addons. Para bots/
automação, o caminho JS ([bedrock-protocol](https://github.com/PrismarineJS/bedrock-protocol)
485★ + mineflayer) é mais maduro que o C#.

---

## 6. Mineração independente complementar (verificada por fetch direto)

Dados coletados além dos relatórios das seções anteriores:

- **Bloqueio/risco**: `matthewprenger/CurseGradle` (plugin de upload para CurseForge)
  está **arquivado desde 2021** — tooling do CurseForge parado; Modrinth (Minotaur,
  132★, LGPL-2.1, ativo em 2026) é o canal de publicação vivo.
- **modrinth/code** (2.437★, monorepo Rust, ativo) — a plataforma inteira é open source;
  API pública documentada em [docs.modrinth.com/api](https://docs.modrinth.com/api/).
- **Mojang/bedrock-samples** (1.737★, marcado `mojang-active`, `do-not-archive`,
  atualizado out/2026) — fonte oficial e viva de referência de formatos Bedrock.
- **fabric-example-mod** é GitHub Template (`is_template: true`) com licença **CC0** —
  ideal para scaffolding por agente sem restrições de licença.
- **KubeJS** (479★, LGPL-3.0, branch "2601") — scripting de mods sem Java; caminho
  alternativo de automação para modpacks.
- **Stonecutter** (102★) — multi-versão de mods via pré-processamento; resolve o
  problema do versionamento anual (26.x).
- **NBTify** (73★, MIT) — única biblioteca NBT moderna em TS/JS (npm `nbtify`);
  suporta Java (big-endian) e Bedrock (little-endian).
- **minecraft-data** (953★) — base de dados de blocos/itens usada pelo mineflayer;
  útil para validação em tools.
- **Agent Skills standard** ([agentskills.io](https://agentskills.io), repo
  [agentskills/agentskills](https://github.com/agentskills/agentskills)) — o formato
  `SKILL.md` do nosso engine é **compatível com o open standard** (frontmatter
  `name`/`description`, progressive disclosure em 3 estágios: discovery → activation →
  execution; suporta `scripts/`, `references/`, `assets/`). Adotado por vários clientes
  (ver Client Showcase no site). **Conexão-chave**: o blockbench-mcp-plugin já publica
  agent skills neste formato — o domínio Minecraft é o primeiro onde o Ruby Desktop pode
  provar o ciclo completo skill marketplace + MCP + subagentes.

---

## 7. Fontes consolidadas

**Comparáveis**: repos citados na seção 1 (links nas tabelas) · API do GitHub:
[janhq/jan](https://api.github.com/repos/janhq/jan), [CherryHQ/cherry-studio](https://api.github.com/repos/CherryHQ/cherry-studio), [chatboxai/chatbox](https://api.github.com/repos/chatboxai/chatbox), [anomalyco/opencode](https://api.github.com/repos/anomalyco/opencode), [aaif-goose/goose](https://api.github.com/repos/aaif-goose/goose), [OpenHands/OpenHands](https://api.github.com/repos/OpenHands/OpenHands)

**npm registry**: [electron](https://registry.npmjs.org/electron/latest) · [electron-builder](https://registry.npmjs.org/electron-builder/latest) · [react](https://registry.npmjs.org/react/latest) · [typescript](https://registry.npmjs.org/typescript/latest) · [vite](https://registry.npmjs.org/vite/latest) · [zustand](https://registry.npmjs.org/zustand/latest)

**Minecraft**: [meta.fabricmc.net (versões)](https://meta.fabricmc.net/v2/versions/game) · [Fabric docs](https://docs.fabricmc.net/) · [NeoForge Maven (versões)](https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml) · [Script API Reference (Microsoft Learn)](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/) · [GameTest framework](https://learn.microsoft.com/en-us/minecraft/creator/documents/gametestgettingstarted) · [Scripting BDS](https://learn.microsoft.com/en-us/minecraft/creator/documents/bedrockserver/scripting) · npm [@minecraft/server](https://www.npmjs.com/package/@minecraft/server) / [server-ui](https://www.npmjs.com/package/@minecraft/server-ui) / [server-net](https://www.npmjs.com/package/@minecraft/server-net) / [server-admin](https://www.npmjs.com/package/@minecraft/server-admin) · [bedrock.dev](https://bedrock.dev/) · [mappings.dev](https://mappings.dev/) · [misode.github.io (geradores)](https://misode.github.io/)

**Publicação**: [Modrinth API](https://docs.modrinth.com/api/) · [Minotaur](https://github.com/modrinth/minotaur) · [CurseForge API](https://docs.curseforge.com/rest-api/)

**Ferramentas/MCPs/bots**: links nas seções 4.3/4.4 · [blockbench-mcp-project + agent skills](https://github.com/jasonjgardner/blockbench-mcp-project) · [plugins do Blockbench](https://blockbench.net/plugins)

**Legais (não acessíveis — confirmar manualmente)**: [Minecraft EULA](https://www.minecraft.net/en-us/eula) · [Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines)

**Não verificado / limitações**: `web_search` indisponível (sem API key) — tudo via
`web_fetch`; ChatWise (só home); opencode v2 docs; partes do `sdk.d.ts` (arquivo enorme);
MCP sampling (só navegação da spec); Cherry Studio (features do README/package.json,
implementação não conferida; MCP Marketplace/OCR/TTS são roadmap); goose (formato de
recipes não detalhado); Codex (só README, repo Rust); SIMA/DeepMind e Project
Sid/Altera (sem repo público encontrado); Preprocessor (kikugie/preprocessor não
encontrado); neoforged/ModDevGradle (GitHub API rate limit no momento); itens de infra
Electron (node-pty, cmdk, @electron/fuses) citados do conhecimento do ecossistema.

---

## 8. JSON UI (Bedrock) — módulos visuais e o "JSON UI Studio"

> Pesquisa solicitada a partir de um screenshot do **JSON UI STUDIO** (UI em coreano:
> 프로젝트=projeto, 속성=propriedades, 게임 화면=tela do jogo, 검사 결과=resultado da
> inspeção, "Codex · 연결됨"=Codex conectado, "Minecraft 브리지 미연결"=bridge não
> conectado) e do repo [boredape874/mcbejsonuimasterAI](https://github.com/boredape874/mcbejsonuimasterAI).
> Pergunta: **é possível construir módulos visuais no Ruby Desktop — ver o fluxo de UI
> do Bedrock e montar sistemas nativos em cima disso?**

### 8.1 O que é o repo (verificado 2026-10-14)

[boredape874/mcbejsonuimasterAI](https://github.com/boredape874/mcbejsonuimasterAI)
— 69★, JavaScript, criado 2026-04, atualizado 2026-10-04. "AI를 위한 JSON UI 마스터"
(Mestre de JSON UI para IA): **skills + ferramentas locais + um Studio visual** para
JSON UI, Attachables, GeoUI e integração de resource packs do Bedrock. ⚠️ **Sem
licença declarada** (`license: null`; existe `NOTICE.md`) — uso local ok, redistribuição
requer autorização.

**Estrutura (árvore verificada via API):**

| Camada | Conteúdo | Como se parece com o nosso harness |
|---|---|---|
| `skills/` (26 skills SKILL.md) | `mcbe-json-ui-master`, `-basics`, `-foundations`, `-reference`, `-patterns`, `-logic`, `-hud-and-chat`, `-server-forms`, `-chest-gui`, `-debugging`, `-ir-authoring`, `-texture-design`, `-visual-design`, `-vanilla-assets`, `-vanilla-presets`, `-final-rp-inspection`, `-tooling`, `-tools-runner`, `-research`, `-samples`, `-schemas`, `-self-bootstrap`, `-custom-toggles`, `-addon-integration`, `mcbe-attachables-ui`, `mcbe-geo-ui`, `mcbe-resource-pack-master`, `mcbe-resource-pack-rendering` | **Formato SKILL.md compatível com o Agent Skills standard** — instala em `%USERPROFILE%\.codex\skills\` via `install-skills.ps1` (dry-run por padrão, detecção de drift) |
| `tools/` (~40 CLI .mjs) | `validate`, `render`, `solve`, `run`, `init-project`, `final-rp-render`, `geoui-inspect`, `chest-contract`, `server-form-contract`, `trace-ui-route`, `vanilla-name-check`, `attachable-inspect`, `audit-content-log`, `design-library/search/board`, `skill-lint/doctor/context`, `eval-offline/eval-live`, `sync-bedrock-samples-ui`… | Tools Node puro — podem virar tools do engine ou MCP |
| `tools/studio/` (o Studio da imagem) | `host.mjs` (server), `editor.mjs` (39KB — drag/resize), `codex.mjs` (integração Codex App Server stdio), `mcp.mjs` (15KB — servidor MCP), `workspace.mjs` (cópia A→B transacional), `json-edit.mjs`, `library.mjs`, `native.mjs` (bridge do jogo), `preview-fonts.mjs`, `session.mjs`, `storage.mjs`, `views.mjs`, `fixtures.mjs`, `review.mjs` | Web app local (Node 20+, `npm run studio` → `http://127.0.0.1:47832`) |
| `data/` | `jsonui-spec.json` (19KB), `molang-queries-1.26.50.json` (43KB), `vanilla-screen-profiles.json`, `device-profiles.json`, `design-styles.json`, `presets-catalog.json`, `bedrock-source-patterns.json` (244KB), `ai-tool-registry.json` (135KB) | Bases de conhecimento estruturado |
| `evals/` | goldens com PNGs por **dispositivo × estado** (`preview-pc-default/hover/pressed`, `preview-touch-*`, `contact-sheet`) de 8 cenários (book_quest, casino_reels, daily_rewards, hud_minimap, responsive_shell, server_form_grid, typography_state_gallery) + `eval:offline`/`eval:live` | Padrão de avaliação visual — golden images! |
| `docs/` (~50) | mental model, file roles, bindings, layout units, common failure modes, IR spec, server form examples, vanilla dumper recipes, design catalog | Conhecimento de domínio profundo |

### 8.2 Como o Studio funciona (docs/86 + docs/89 verificados)

- **Server local Node** (porta 47832, configurável via `JSONUI_STUDIO_PORT`); abre no
  navegador — **o painel Browser do Ruby Desktop (http/https) hospeda isso hoje**.
- **Abas Visual / JSON / Jogo**: editor visual com drag/resize, snap 1/4/8/16px,
  alinhamento, grade, multi-seleção, Ctrl+C/V/X/D, undo 60 níveis; JSON tab edita o
  arquivo real com Ctrl+S; aba Jogo mostra a janela do Minecraft compartilhada.
- **Renderizador estático próprio**: interpreta tipos/bindings/factory do JSON UI e
  compõe PNG por dispositivo (PC/touch, `480×270` base) e por estado
  (default/hover/pressed). Fonte bitmap do jogo (`glyph_XX.png`) — sem ela marca
  `FONT_UNAVAILABLE` e usa fonte substituta **declarando a limitação**.
- **Fluxo de dados**: `manifest.json` + `ui/` do RP original (A) → cópia de trabalho B
  (edições em B; sync A→B / B→A transacional com SHA-256, backups e detecção de
  conflito); forms de servidor importados como fixtures (title/body/buttons reais);
  HUD com `#binding` values manuais.
- **Pipeline de layout**: `ir.yaml` → solver (Go ou Node) → `solved.json` → `ui.json` →
  preview PNG. Spec do IR em `docs/41-ir-spec.md`.
- **Integração com IA (Codex App Server stdio)**: `initialize` → `thread/list`/`resume`/
  `start` → `turn/start`; envia ao modelo o elemento selecionado + hash de origem +
  diagnóstico + PNG do preview (2x); quando o AI salva arquivo, o preview re-renderiza.
- **MCP server próprio** (`tools/studio/mcp.mjs`) com ~20 tools `jsonui_*`:
  `jsonui_studio_context`, `jsonui_edit`, `jsonui_batch_edit`, `jsonui_duplicate`,
  `jsonui_read_source`, `jsonui_patch_source`/`write_source` (com `expectedHash`),
  `jsonui_render`, `jsonui_workspace_status/preview/apply`, `jsonui_library`,
  `jsonui_read_reference`/`open_reference`, `jsonui_import_fixtures`/`use_fixture`,
  `jsonui_set_hud_bindings`/`set_hud_scope`, `jsonui_storage_status/cleanup`.
- **Evidência-first**: separa explicitamente "checagem estática/preview local OK" de
  "verificado no runtime do Bedrock" (Content Log, entrada, sync). Resultados trazem
  `ok`/`complete`/`runtimeVerified` distintos.
- **Game bridge** (`native.mjs`): opcional, lê health/review de uma DLL nativa do
  cliente (precisa casar com o build); o "game window share" captura a janela do
  Minecraft via permissão de mídia do navegador (frames ≤1280px a cada 2s).

### 8.3 Viabilidade de módulos visuais no Ruby Desktop

**Veredito: muito viável — e o repo é um roteiro pronto.** Quatro fases:

| Fase | Módulo | O que é | Esforço | Valor |
|---|---|---|---|---|
| **F1 — Consumir pronto** (1 dia) | Studio no BrowserPanel + skills portadas | O Studio é um web app local → abre no `WebContentsView` (http) do Ruby Desktop **hoje**. As skills são SKILL.md → instalar no catálogo do engine | **S** | Alto |
| **F2 — Tools/MCP nativas** (1-2 semanas) | `jsonui_*` como MCP stdio ou tools do engine | Rodar `tools/studio/mcp.mjs` como servidor MCP do engine (já temos MCP stdio!) ou expor `validate/render/trace-ui-route` como tools bash | **S/M** | Alto |
| **F3 — Painel "UI Flow" nativo** (2-4 semanas) | Grafo de fluxo de telas no renderer React | **O diferencial que esse repo NÃO tem**: visualizar o *fluxo* — nós = telas (`ui/*.json`, stacks, route stacks, server forms), arestas = `button_mappings`/push/pop/respostas de form. Base: `trace-ui-route.mjs` + `vanilla-screen-profiles.json`. Renderizar como grafo interativo no painel do Ruby Desktop | **M** | **Muito alto** |
| **F4 — Loop visual fechado** (1 mês+) | Preview PNG → visão do modelo | Renderizar preview → anexar ao turno (M7 vision!) → modelo ajusta → re-renderiza. É o ciclo "AI vê a UI que desenhou" | **M/L** | **Muito alto** |

**Arquitetura sugerida (3 camadas, mesma do repo):**
1. **Renderizador/inspetor** (Node, headless) — portar ou consumir `tools/render.mjs`,
   `validate.mjs`, `trace-ui-route.mjs` via bash/MCP;
2. **Painel visual** — React nativo no renderer (ou o Studio embutido via BrowserPanel);
3. **Skills** — portar as 26 SKILL.md (formato idêntico ao nosso) + as nossas próprias.

### 8.4 Riscos e limitações (sem piedade)

- **⚠️ Sem licença**: `license: null`. Uso local/estudo ok; **embarcar código no Ruby
  Desktop exige autorização do autor**. Estratégia: consumir como ferramenta externa
  (via MCP/bash) em vez de copiar código; ou reimplementar as ideias (que são
  documentadas em `docs/`).
- **Preview estático ≠ runtime**: fontes bitmap, valores hardcoded, renderizadores de
  jogo (GeoUI/actor) não são reproduzidos — o próprio repo marca `FONT_UNAVAILABLE` e
  diagnósticos de controles não suportados. "Sucesso no preview" nunca prova tela real.
- **Docs majoritariamente em coreano** — custo de tradução para manutenção.
- **Forms de servidor exigem fixtures** (dados reais title/body/buttons); HUD exige
  valores de binding manuais — o preview não infere estado do jogo.
- **Versionamento Bedrock**: o repo trava vanilla em `bedrock-samples v1.26.50.4` com
  lock + diff docs (`docs/83`) — mesma disciplina que precisamos (o jogo muda a cada
  minor).
- **Ruby Desktop ainda tem os FIX-1..5 abertos** — não embarcar superfície nova
  (BrowserPanel hospedando app local, MCP novo) antes de fechar os achados altos.

### 8.5 Ecossistema de ferramentas JSON UI (busca 2026-10-14) e o gap de modularidade

Buscas por "jsonui", "ui kit", "components library", "generator template" no GitHub:

| Repo | ★ | Licença | O que é |
|---|---|---|---|
| [xRookieFight/jsonforge](https://github.com/xRookieFight/jsonforge) | 70 | MIT | Editor visual de JSON UI (TypeScript) |
| [CoolLoong/jsonui-lsp](https://github.com/CoolLoong/jsonui-lsp) | 17 | MIT | LSP de JSON UI p/ VS Code (Rust) |
| [Deichor/jsonui-render-mcp](https://github.com/Deichor/jsonui-render-mcp) | 0 | — | MCP server que desenha telas JSON UI (Python) |
| [MyR4YT/MCBE-JsonUI-pt-BR](https://github.com/MyR4YT/MCBE-JsonUI-pt-BR) | 0 | — | **Documentação completa de JSON UI em português** + ferramentas Python |
| [EmirhanOlgn/bedrock-jsonui-live-preview](https://github.com/EmirhanOlgn/bedrock-jsonui-live-preview) | 0 | MIT | Preview ao vivo no navegador ("shared design-system + data-driven examples", Vite+TS) |
| [mmm-2006/NeteaseMinecraftJsonUIEditor](https://github.com/mmm-2006/NeteaseMinecraftJsonUIEditor) | 0 | GPL-3.0 | Editor Vue com edição de bindings em tempo real |
| [RedStoneCraftGG/JSON-Escape](https://github.com/RedStoneCraftGG/JSON-Escape) | 0 | MIT | Encoder/decoder de unicode escapes de JSON UI |

**Gap confirmado (buscas retornaram 0 resultados):** existe ecossistema de **editores**
(jsonforge, studio), **renderizadores** (jsonui-render-mcp, live-preview), **LSP** e
**conhecimento** (mcbejsonuimasterAI) — mas **nenhuma biblioteca de blocos/componentes
parametrizáveis** (ui kit / components / template library). A camada de modularidade é
uma lacuna real e aberta.

**Leitura do IR spec (docs/41 do mcbejsonuimasterAI)** — confirma o desenho: o IR
declara `elements` (panel/image/label/button/stack_h/stack_v/scroll/collection_grid),
`auto_size` (text/image_aspect/collection_grid), `constraints` (symmetric, align,
center_group, same_size, equal_gap, edge_eq/offset) e compila via `tools/compile.mjs`
para `ui.json`. Porém o próprio spec diz: **"bindings, animations, and dynamic data are
out of scope for the IR"** — são adicionados depois como patches JSON manuais. Ou seja:
hoje a reutilização é só de **layout**; o **comportamento** (bindings, button_mappings →
callbacks BP) nunca é parametrizado. É exatamente onde entra a ideia de blocos.

### 8.6 Fontes (seção 8)

- [boredape874/mcbejsonuimasterAI](https://github.com/boredape874/mcbejsonuimasterAI) · [README](https://raw.githubusercontent.com/boredape874/mcbejsonuimasterAI/main/README.md) · [docs/86-json-ui-studio.md](https://raw.githubusercontent.com/boredape874/mcbejsonuimasterAI/main/docs/86-json-ui-studio.md) · árvore do repo via API (`git/trees/main?recursive=1`), `contents/tools`, `contents/skills`, `contents/tools/studio`
- Arquitetura do Studio: `tools/studio/{host,editor,codex,mcp,workspace,json-edit,native,preview-fonts,session,storage,views,fixtures,review}.mjs` (tamanhos verificados via API)
- Relacionados: [bridge-core/bridge.](https://github.com/bridge-core/bridge.) (inspiração de UI do Studio, "bridge. v2"), GeouiStudio (terceiro, citado nos docs), [Mojang/bedrock-samples](https://github.com/Mojang/bedrock-samples) (fonte vanilla pinada)
