# CONTEXT.md — o que falta

> Documento de passagem. Responde a uma pergunta só: **o que ainda não está feito, e o que
> quem continuar precisa saber para não repetir trabalho nem tropeçar nos mesmos erros.**
>
> Para o *porquê* das decisões e o histórico completo, ver [`PLANO.md`](PLANO.md).
> Para convenções de código, ver [`AGENTS.md`](AGENTS.md).

**Estado:** M0–M5 implementados neste checkout; a release `v0.1.0` foi publicada com artefatos
Windows, macOS e Linux. O Desktop está em `51765aa`; a engine RubyCLI foi enviada ao repositório
próprio em `5d6b987`, e o workflow de release a compila diretamente do GitHub (sem depender da
publicação no npm). RubyCLI: **1133 testes determinísticos passaram e 71 foram ignorados**; a matriz
live teve 21 falhas de subprocesso no Windows (`3221226505`). O build multiplataforma da release
passou. O Electron local encerra com `STATUS_BREAKPOINT` antes de iniciar o smoke harness, então o
runtime empacotado ainda precisa de validação nesta máquina.

### Etapa entregue — M3.5 UX

- `task` agora executa um explorer read-only no Desktop; não cria workers nem worktrees.
- Conversas persistem em sessões do engine; a última é restaurada ao abrir, com lista de recentes,
  nova conversa e retomada pela sidebar.
- A UI de configurações salva a chave com `safeStorage` do Electron e reinicia o engine; env e
  configuração antiga do CLI continuam como fallback.
- Chat preserva a posição de rolagem e oferece atalho para o fim; blocos de código têm cópia e
  realce lexical leve para linguagens comuns.
- Sidebar e controles foram reorganizados, com rótulos em português e diagnósticos recolhidos.
- Verificação feita em artefatos buildados: `npm run build` e os cinco `smoke-*.cjs` passaram.

### Última etapa entregue — M3.6 métricas no chat

- Seletor de modelo saiu da barra global e foi para o composer; abre uma lista pesquisável com
  contexto e capacidades, e fica indisponível durante um turno ativo.
- Turnos, etapas de ferramenta, tokens, cache e uso da janela aparecem como chips clicáveis com
  popovers explicativos. Também exibem tempo LLM/tool, TTFT e velocidade de geração quando há dados.
- `cachedTokens` já exposto pelo engine agora atravessa o contrato IPC e entra nos totais.
- Os totais de token/cache começam na execução atual. Sessões restauradas preservam conversa e
  turnos/etapas, mas métricas antigas não são persistidas. A janela usa a estimativa de mensagens
  disponível no engine; system prompt e ferramentas não são separados.
- `smoke-markdown.cjs` verifica os quatro popovers e o seletor de modelo; build e smoke suite
  completos passaram.

### Nova etapa entregue — M3.7 autocomplete de comandos e criação de Skills

- O composer sugere comandos locais e Skills descobertas enquanto o usuário digita `/`;
  setas navegam, Tab completa, Enter seleciona ou executa e Escape fecha a lista.
- A lista vem do catálogo do engine e se atualiza após cada turno, incluindo Skills criadas na
  conversa.
- `/new-skill` ativa diretamente a Skill builtin do engine. Ela entrevista o usuário, apresenta o
  rascunho e grava a Skill do projeto com a confirmação normal da ferramenta `write`.
- O contrato IPC e o smoke harness foram atualizados para encaminhar a ativação explícita.
- `npm run typecheck` e `npm run build` passaram nesta etapa.
- Os cinco smoke scripts terminaram em PASS. `smoke-permissions` passou em workspace temporário
  isolado após uma primeira execução no workspace compartilhado responder sem chamar ferramenta.
- Uma checagem no renderer buildado confirmou sugestões para `/new-skill` e `/goal`.

### M4.1–M4.3 — Subagentes, perguntas e revisão de workers ✅

- `task` aceita papel, modelo do catálogo, reasoning effort, título e instruções por agente. Antes
  de cada lançamento, o usuário pode iniciar com a configuração proposta pela IA ou abrir o formulário
  para editar modelo, effort e instruções. Alternativas ficam identificadas antes de iniciar.
- `ask_user` emite perguntas estruturadas com opções e resposta livre. O cartão identifica o agente;
  resposta, cancelamento, abort, reset e shutdown resolvem as esperas.
- Explorers ficam read-only. Workers recebem worktrees Git próprios, criados de um snapshot que
  inclui alterações locais não commitadas sem mexer no índice do usuário. Concorrência limitada a
  três; cancelamento descarta o worktree.
- Cada worker mostra progresso, modelo, effort, orientações e tokens/tools. O diff só é aplicado após
  aprovação explícita; conflito mantém o cartão em revisão. Descarte e falha limpam branch/worktree.
- Ferramentas de arquivo são limitadas à raiz do worker e mantêm o predicado original de aprovação;
  cada operação no worktree pode pedir confirmação. Toda chamada de shell do worker também exige
  aprovação, pois um comando pode referenciar caminhos absolutos fora do diretório atual.
- Verificação: Desktop `npm run build` passou; RubyCLI typecheck/lint/format e 80 arquivos de teste
  (1133 testes) passaram; o ciclo de worktree foi verificado em um repositório Git temporário. A
  matriz live teve 21 falhas externas e o Electron encerrou com `STATUS_BREAKPOINT` antes dos smoke
  tests, portanto não houve aprovação de UI em Electron.
- A DSL `workflow` com `parallel()`/`pipeline()` continua pendente e deve ser planejada como etapa
  própria depois do fluxo básico de subagentes.

---

## 1. Marcos entregues e próximos passos

### M4 — Sub-agentes + orquestração ✅ (workflow DSL pendente)

**M4.1 — Configuração e perguntas no chat ✅**
- Catálogo de modelos e reasoning efforts compatíveis alimentam a configuração inline; modelos ou
  efforts indisponíveis geram uma alternativa identificada, sem troca silenciosa.
- O usuário pode pedir papéis, modelos, efforts e orientações em linguagem natural. O orquestrador
  propõe a divisão e, para cada agente, o usuário escolhe iniciar com a recomendação ou revisar e
  editar os parâmetros.
- Cada subagente recebe instruções próprias de papel, contexto, limites, ferramentas e formato de
  saída, formando um harness por agente.
- `ask_user` mostra perguntas estruturadas inline, com opções e resposta livre. O cartão identifica
  o agente que perguntou; resposta, cancelamento, reset, abort e encerramento resolvem a espera sem
  confundir esclarecimentos com aprovações de ferramentas.

**M4.2 — Workers isolados (Core / RubyCLI) ✅**
- Cada worker recebe branch e **git worktree isolado** criado de um snapshot de arquivos tracked,
  alterações locais e novos arquivos. A aplicação do diff é sempre aprovada pelo usuário.
- `explorer` é read-only; `worker` edita no próprio worktree. Concorrência limitada a três; falha,
  descarte e cancelamento limpam worktree e branch.
- Tool `workflow`: script JS com `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`,
  e resultado estruturado por schema JSON — **ainda pendente**, separada do fluxo básico entregue.

**M4.3 — Acompanhamento e revisão (Desktop) ✅**
- Cartões no chat mostram progresso, status, modelo, effort, papel, instruções e tokens/tools por
  agente. Perguntas/respostas aparecem no mesmo chat.
- O diff do worktree aparece antes da ação **Aplicar diff**. Conflitos mantêm a revisão aberta e não
  alteram os arquivos; o usuário pode tentar de novo ou descartar.

### M5 — Empacotamento + release

- `electron-builder` 26 empacota NSIS x64, arm64 e um instalador combinado que detecta a arquitetura;
  o engine vai em `resources/engine` fora do ASAR para `utilityProcess` abrir um arquivo real.
- `electron-updater` está incluído como dependência de runtime. O updater só inicia quando o pacote
  contém `app-update.yml`; verificação de assinatura do instalador Windows continua habilitada.
- GitHub Actions tem CI Windows (inclui build/testes determinísticos do RubyCLI, typecheck/build e
  verificação do pacote) e workflow de release em runners Windows, Linux e macOS. A release
  `v0.1.0` foi publicada com sucesso; os três builds de plataforma e a coleta dos artefatos passaram.
- Linux publica AppImage/deb com feed de atualização. Esta release também inclui os metadados
  `latest*.yml` das três plataformas, mas Windows e macOS estão sem assinatura de código; o
  funcionamento do auto-update nesses sistemas não deve ser considerado validado. Windows pode
  mostrar alerta de editor desconhecido.
- Foram publicados instaladores Windows x64/arm64 e combinado, Linux AppImage/deb e macOS x64/arm64
  DMG/ZIP. Os builds macOS/Linux passaram na CI, mas não foram executados interativamente neste host.

#### Build e release

```powershell
# O engine local precisa estar compilado antes do Desktop.
cd G:\VSCodeProjects\RubyCLI ; npm run build
cd G:\VSCodeProjects\RubyDesktop ; npm run dist

# Apenas diretório instalado, útil para inspeção sem gerar instaladores.
npm run package:dir
```

No GitHub, configure `RUBYCLI_REPOSITORY` e `RUBYCLI_REF` como Actions variables se a release
precisar de uma branch/commit específico do engine; o padrão é `marcosvkp/rubycli` em `main`. A
engine deve estar commitada e enviada ao seu próprio repositório antes de iniciar os builds; a CI a
clona diretamente do GitHub e não espera o npm. A tag deve corresponder à versão do `package.json`
(por exemplo, `v0.1.0`). O workflow acionado pela tag cria um draft para revisão; `workflow_dispatch`
com `release_tag` também pode atualizar uma release já publicada e substituir os artefatos.

Segredos opcionais de assinatura: `WIN_CSC_LINK` e `WIN_CSC_KEY_PASSWORD` para Windows;
`CSC_LINK` e `CSC_KEY_PASSWORD` para macOS. Para notarização macOS, também configure `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` e `APPLE_TEAM_ID`. Não são necessários para gerar os pacotes, mas
Windows/macOS ficam sem atualização automática quando a assinatura não está configurada.

---

## 2. Lacunas e status do que já está construído

Os itens concluídos registram mudanças recentes para evitar retrabalho; os demais são lacunas
pendentes, ordenadas por impacto.

### ✅ 2.1 A tool `task` — explorer e worker entregues

O Desktop fornece `spawnSubAgent` ao registry. `explorer` usa tools read-only; `worker` ganha
worktree isolado e o diff aguarda aprovação explícita. Ambos não delegam recursivamente.

### ✅ 2.2 Persistência e navegação de conversas entregues

O Desktop usa `Session` e `Agent.restoreMessages()`: retoma a última sessão não vazia ao abrir e
permite iniciar ou retomar conversas pela sidebar. A lista é por workspace.

### ✅ 2.3 Configuração de chave via `safeStorage` entregue; legado segue suportado

Configurações permite salvar a chave em armazenamento criptografado pelo SO via Electron
`safeStorage`. O engine mantém compatibilidade com `RUBY_API_KEY` e com o `config.json` do CLI
quando nenhuma chave foi salva pela UI. A chave salva pelo Desktop é passada ao processo do engine
por variável de ambiente, sem expô-la ao renderer.

### 🟡 2.4 Goal sem auto-continuação

`src/state/goal.ts` **não tem** `maxRounds`, `round` nem status `blocked`. O goal hoje é
puramente manual: banner + `/goal` + pause/resume/complete/clear.

O plano do M2 previa auto-continuação com `maxRounds` e o comando `/auto`. Não foi feito.
Consequência: o agente não continua sozinho em direção ao objetivo — cada turno precisa de
um humano.

### ✅ 2.5 Realce de código entregue

Blocos têm realce lexical leve para linguagens comuns e botão de copiar. O realce não é um parser
completo de gramática; Shiki continua sendo uma opção se a fidelidade de sintaxe virar prioridade.

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

### 🟡 2.11 Runtime macOS e Linux ainda não foi verificado neste host

Os builds macOS e Linux passaram na CI e os instaladores estão publicados, mas a execução
interativa e os smoke tests dessas plataformas ainda não foram verificados neste host. O código tem
caminhos próprios (`bwrap` no Linux, `sandbox-exec` no macOS, resolução de shell por plataforma).
Tratar empacotamento como verificado e runtime como pendente.

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
| **Code signing no Windows/macOS** | Sem certificado, instalações podem gerar avisos e Windows/macOS não recebem feed de atualização | Configurar os segredos antes de publicar uma release distribuível |
| **Ref do RubyCLI na CI** | Desktop usa `file:../RubyCLI`; CI clona um checkout irmão para compilar o engine | Fixar `RUBYCLI_REF` numa branch/commit que contenha as mudanças de engine desejadas |
| **DSL de workflows (M4)** | Composição programática de agentes aumenta o alcance da orquestração | Planejar depois do fluxo básico de workers; inclui `parallel`, `pipeline` e schema de saída |

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

1. **DSL de workflow:** `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()` e resultado por schema.
2. **Auto-continuação de goal:** limite de rodadas, estado `blocked` e recuperação após falha.
3. **Polimento da UX:** workspaces recentes, múltiplas abas do browser e uma revisão de acessibilidade
   em tamanhos menores. São melhorias separadas da persistência de conversas já entregue.
4. Corrigir os paths do coverage da configuração Vitest do RubyCLI (§2.13).
5. Verificar a execução e os smoke tests da aplicação empacotada em Windows, macOS e Linux; o Electron
   local interrompe antes do harness com `STATUS_BREAKPOINT`.
