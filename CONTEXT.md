# CONTEXT.md — o que falta

> Documento de passagem. Responde a uma pergunta só: **o que ainda não está feito, e o que
> quem continuar precisa saber para não repetir trabalho nem tropeçar nos mesmos erros.**
>
> Para o _porquê_ das decisões e o histórico completo, ver [`PLANO.md`](PLANO.md).
> Para convenções de código, ver [`AGENTS.md`](AGENTS.md).

**Estado:** M0–M6, M3.5–M3.7, M4.1–M4.4 e o M8 (Skills de modding Minecraft) estão implementados.
A hardening pass de `FIX.md` também foi implementada no Desktop. A release `v0.1.4` fixa o RubyCLI
em `b02ca4e9ca744cea007258cc454479e179020a41` e inclui 41 Skills embutidas. Ela foi publicada em
2026-10-17 com os três instaladores Windows; os artefatos macOS/Linux ainda não foram gerados para
esta versão. O workflow permite publicar Windows/macOS sem assinatura, com verificação de
assinatura/notarização quando os certificados forem configurados. A próxima etapa de produto
planejada é M7 (anexos de imagem e geração de imagens). O workflow compila a engine do repositório
próprio no GitHub, sem depender da publicação no npm.

### Verificação atual — 2026-10-17

- RubyCLI: typecheck, ESLint, Prettier e build passaram. O commit `70e9e2d` adiciona 28 Skills de
  Minecraft e `read_skills`; `9eb5139` corrige caminhos Windows nos runners POSIX; `b02ca4e` dá
  margem para iniciar o shell sob carga no Windows. O bundle contém 41 Skills e não deixa imports
  npm em runtime.
- RubyDesktop: `npm run build` passou com o novo pin; o bundle contém as mesmas 41 Skills. O build
  sem elevação foi bloqueado pelo sandbox ao resolver `browser-tools.ts` e passou ao repetir com a
  permissão de build necessária.
- A CI do candidato `c722d9b` passou nos três runners (Windows, Linux e macOS), incluindo testes
  da engine, build, smokes determinísticos e verificação do pacote. Ela valida as correções das
  falhas anteriores de shell. O hook local executou o Vitest completo: 1165 passaram, 70 foram
  ignorados e os 21 casos live terminaram com erro `3221226505` no Windows.
- A CI agora empacota e verifica o diretório instalado em Windows, macOS e Linux; quando o secret
  `RUBY_API_KEY` existe, executa os seis smoke scripts em cada runner (Linux via Xvfb).
- A release aceita builds unsigned de Windows/macOS, emite aviso e omite os feeds dessas plataformas;
  quando os certificados estão configurados, valida assinatura/notarização e os feeds. Linux mantém
  seu feed. O coletor limpa o staging e só inclui assets da versão atual.
- `RUBYCLI_REF` agora é obrigatório e deve ser o SHA completo de 40 caracteres do commit RubyCLI;
  CI e release falham cedo se a variável faltar ou divergir do `ruby-engine.lock.json`.
- A blocklist catastrófica também é aplicada em `decideConfirmation` no RubyCLI; grants `bash:*`
  e grants exatos não liberam comandos catastróficos. Confirmação manual permite só uma execução.
- `tool_call` e `tool_result` agora podem carregar IDs do provider. O Desktop usa esses IDs para
  correlacionar chamadas concorrentes e mantém fallback para sessões/eventos antigos sem ID.
- Smokes determinísticos adicionados à CI: snapshot/diff/apply/cleanup de worktrees, proteção do
  diff revisado contra alterações posteriores, staging de releases sem assets antigos/feed quebrado,
  os caminhos de update automático/fallback/instalação e o modo Node stdio do executável empacotado
  em Windows/macOS/Linux (caminho usado por subprocessos MCP).
- `RUBYCLI_REF` foi atualizado para o SHA novo. Não há segredos de code signing/notarização no
  repositório; o workflow agora pode publicar instaladores unsigned de Windows/macOS, que podem
  mostrar avisos do sistema e não terão update automático. Ainda falta rodar os seis smokes com
  provider disponível e validar os instaladores abrindo/instalando em Windows/macOS/Linux (incluindo
  MCP stdio no pacote).
- `npm run dist` passou localmente em Windows e gerou os instaladores x64, ARM64 e combinado da
  `v0.1.4`. `scripts/verify-package.cjs release` confirmou a engine e as 41 Skills nos dois pacotes
  descompactados. Os seis assets Windows foram publicados diretamente no GitHub Releases; não há
  assets macOS/Linux para esta versão. A CI `39001578839` foi iniciada no push, mas não foi aguardada
  para publicar, conforme pedido.

### Histórico de validação — 2026-10-13

- RubyCLI: build, typecheck, ESLint e Prettier passaram. O teste de sessões teve **43 aprovados e 1
  ignorado**. No Vitest completo, **1159 passaram e 70 foram ignorados**; os 21 casos restantes da
  matriz live receberam `Invalid OpenAI API key` e acionaram a assertion de libuv no Node 24/Windows
  (`3221226505`).
- RubyDesktop: `npm run build` passou com o verificador de atualizações. Os jobs de release para
  Windows, Linux e macOS passaram; `v0.1.3` foi publicada com **19 artefatos**.
- Na validação local desta rodada, `smoke-markdown`, `smoke-session-history` e `smoke-browser`
  passaram. `smoke-main` recebeu erro HTTP 502 do provider; `smoke-permissions` não concluiu a
  segunda chamada ao provider e `smoke-mcp` não foi repetido. A suíte completa de smokes havia
  passado na validação M6 anterior; repetir os fluxos dependentes de provider quando ele estiver
  disponível.
- Ainda falta validar os instaladores executando em Windows, macOS e Linux. No Windows/macOS, a
  instalação automática de updates também depende de certificados de assinatura; sem eles o app
  oferece abrir a página de downloads.

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

### M4.1–M4.4 — Subagentes, perguntas, revisão e workflows ✅

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
- O histórico JSONL preserva cada segmento de fala do assistant e registra eventos versionados dos
  cartões de configuração/sub-agent e perguntas. Ao reabrir, as opções Sim/Não reaparecem com a
  escolha marcada; itens que ficaram pendentes viram interrompidos. Sessões antigas recuperam esses
  cartões a partir dos argumentos e resultados de `task`/`ask_user` quando há dados suficientes.
- Ferramentas de arquivo são limitadas à raiz do worker e mantêm o predicado original de aprovação;
  cada operação no worktree pode pedir confirmação. Toda chamada de shell do worker também exige
  aprovação, pois um comando pode referenciar caminhos absolutos fora do diretório atual.
- Verificação desta rodada: Desktop build/typecheck e os seis smokes Electron passaram. RubyCLI
  build/typecheck/lint/format passaram; o teste de sessões teve 43 aprovados e 1 ignorado. No Vitest
  completo, 1159 testes passaram e os 21 casos da matriz live receberam `Invalid OpenAI API key` e
  terminaram com assertion libuv do Node no Windows (`3221226505`).
- A DSL `workflow` aceita `agent()`, `parallel()`, `pipeline()`, `phase()` e `log()`. O parser não
  avalia JavaScript arbitrário, paralelismo tem limite, workers exigem confirmação e worktree, e
  resultados estruturados são validados por JSON Schema.

---

## 1. Marcos entregues e próximos passos

### M4 — Sub-agentes + orquestração ✅

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
- Tool `workflow`: DSL restrita com `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()` e
  validação de saída por JSON Schema. Scripts são analisados sem `eval`; workers mostram a
  configuração para aprovação e nunca aplicam o diff sem revisão.

**M4.3 — Acompanhamento e revisão (Desktop) ✅**

- Cartões no chat mostram progresso, status, modelo, effort, papel, instruções e tokens/tools por
  agente. Perguntas/respostas aparecem no mesmo chat.
- O diff do worktree aparece antes da ação **Aplicar diff**. Conflitos mantêm a revisão aberta e não
  alteram os arquivos; o usuário pode tentar de novo ou descartar.

### M5 — Empacotamento + release

- `electron-builder` 26 empacota NSIS x64, arm64 e um instalador combinado que detecta a arquitetura;
  o engine vai em `resources/engine` fora do ASAR para `utilityProcess` abrir um arquivo real.
- `electron-updater` está incluído como dependência de runtime. Pacotes com feed e assinatura
  compatíveis usam download e instalação automáticos; builds sem esse caminho consultam a última
  release pública no GitHub e oferecem abrir a página de download. A verificação de assinatura do
  instalador Windows continua habilitada.
- GitHub Actions tem CI e workflow de release em runners Windows, Linux e macOS. A CI compila e
  verifica o pacote nas três plataformas, além dos testes determinísticos do RubyCLI. A release mais
  recente, `v0.1.3`, foi publicada; os três builds de plataforma passaram e 19 artefatos foram anexados.
- Linux publica AppImage/deb com feed de atualização. Esta release também inclui os metadados
  `latest*.yml` das três plataformas. Linux usa o feed automático; Windows e macOS sem assinatura
  verificam releases no GitHub e encaminham para o download manual. O auto-update instalável do
  Windows/macOS depende da configuração de assinatura. Windows pode mostrar alerta de editor
  desconhecido.
- A release `v0.1.3` contém instaladores Windows x64/arm64 e combinado, Linux AppImage/deb e macOS
  x64/arm64 DMG/ZIP. Os builds passaram na CI, mas macOS/Linux ainda não foram executados
  interativamente neste host.

#### Build e release

```powershell
# O engine local precisa estar compilado antes do Desktop.
cd G:\VSCodeProjects\RubyCLI ; npm run build
cd G:\VSCodeProjects\RubyDesktop ; npm run dist

# Apenas diretório instalado, útil para inspeção sem gerar instaladores.
npm run package:dir
```

No GitHub, configure `RUBYCLI_REF` como Actions variable obrigatória: SHA completo de 40 caracteres
igual ao commit aprovado em `ruby-engine.lock.json`. `RUBYCLI_REPOSITORY` é opcional e, por padrão,
a CI clona `marcosvkp/rubycli`. A engine deve estar commitada e enviada ao seu próprio repositório;
a CI não espera publicação no npm. A tag deve corresponder a `package.json` (por exemplo, `v0.1.3`).
O workflow por tag cria um draft; `workflow_dispatch` também só atualiza um draft e recusa alterar
uma release publicada.

O workflow de release publica instaladores unsigned de Windows/macOS quando os certificados não
estão configurados; esses pacotes podem exibir avisos do sistema e não têm update automático. Para
assiná-los e publicar os feeds correspondentes, configure `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD`
(ou `WIN_CSC_NAME`) e, no macOS, `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` e `APPLE_TEAM_ID`. Configure `RUBY_API_KEY` para os smokes que chamam
o provider. Builds locais sem publicação também continuam possíveis sem certificados.

### M7 planejado — Anexos e geração de imagens (não implementado)

O composer atual envia texto. O indicador `supportsVision` do catálogo só descreve capacidade do
modelo; ele não significa que o Desktop envie imagens. A tool `browser_screenshot` salva PNG na
pasta de dados do app e retorna texto, sem anexar a imagem à conversa.

- **M7.1 — Anexos de entrada:** escolher imagem, colar da área de transferência ou arrastar e soltar;
  mostrar prévia e permitir remoção antes do envio. Validar MIME e tamanho no processo principal e
  transportar bytes/referências pelo IPC sem dar acesso geral ao filesystem ao renderer.
- **M7.2 — Visão no chat:** enviar texto e imagens no mesmo turno por um payload multimodal real do
  engine; explicar ou impedir o envio quando o modelo escolhido não aceitar imagens. Persistir
  referências dos anexos na sessão e restaurá-las ao reabrir, sem gravar base64 no JSONL.
- **M7.3 — Tool de geração:** criar uma tool do agente que use a chave Ruby já configurada e permita
  escolher explicitamente um modelo de geração. Separar entrada visual (`supportsVision`) de geração:
  conferir catálogo, endpoint, autenticação e limites do provider antes de expor a tool. Mostrar o
  resultado como anexo no chat, persistir a referência e oferecer salvar/exportar.
- **M7.4 — Verificação:** cobrir validação de anexos, roteamento para modelos compatíveis, persistência
  e restauração, erros de provider e geração nos testes determinísticos.

**Decisões técnicas pendentes:** formatos e limite de tamanho dos anexos; quantidade de imagens por
turno; modelos/endpoints de geração disponíveis no catálogo Ruby; pasta de saída e aprovação antes
de gravar imagens no workspace.

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

### ✅ 2.4 Goal com continuação automática limitada

O engine armazena limite configurável de 1–100 rodadas, progresso e motivo de bloqueio. `runAutoGoal`
continua uma rodada por vez, pausa em cancelamento, conclui quando o agente sinaliza `GOAL_DONE` e
marca `blocked` quando o limite ou uma falha exige revisão. O Desktop oferece controle no banner e
os comandos `/goal auto [rodadas]`, `/goal stop` e `/goal max-rounds <1-100>`; a execução é opt-in.

### ✅ 2.5 Realce de código entregue

Blocos têm realce lexical leve para linguagens comuns e botão de copiar. O realce não é um parser
completo de gramática; Shiki continua sendo uma opção se a fidelidade de sintaxe virar prioridade.

### 🟢 2.6 `AgentEvent` não enriquecido (dívida do M1)

A union do engine ainda não tem `usage`, `approval_request`, `approval_resolved`, `turn_start`,
`goal_updated`, `compact_start`/`done`, `subagent_*`, `mcp_status`. `tool_call` e `tool_result`
já incluem IDs opcionais para pareamento; registros antigos e providers sem IDs usam fallback FIFO.

**Não bloqueia**: o Desktop contorna com mensagens de IPC próprias (`approvalRequest`,
`approvalResult`, `metric`, `goal`, `mcp`, `browserState`). A desvantagem é que o engine deixa
de ser a fonte da verdade desses eventos — qualquer outro host teria de reinventar o mesmo
protocolo.

### ✅ 2.7 Workspaces recentes

Os oito workspaces mais recentes são persistidos em armazenamento do app, validados como diretórios e
acessíveis pela sidebar; a troca reinicia o engine no diretório selecionado.

### ✅ 2.8 Browser com múltiplas abas

Cada aba tem seu próprio `WebContentsView` sandboxed e compartilha a partição persistente. A UI permite
criar, selecionar e fechar abas; trocar de aba invalida refs CDP obsoletas. Ainda não há UI para limpar
cookies nem tratamento de downloads.

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

### ✅ 2.13 Paths de coverage atualizados

O `coverage.exclude` agora aponta para `src/providers/types.ts` e `src/core/agent.ts`, que são os
caminhos existentes; os excludes de ferramentas e CLI permanecem alinhados com a cobertura desejada.

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
.\node_modules\electron\dist\electron.exe scripts/smoke-session-history.cjs
```

Os seis devem terminar com `RESULT PASS` e **exit code 0**. `scripts/smoke-harness.cjs` é o
bootstrap compartilhado — **toda nova mensagem de IPC precisa ser ligada lá também**, senão o
teste passa enquanto o app real está quebrado.

### Gate do engine

```powershell
cd G:\VSCodeProjects\RubyCLI
npm run typecheck && npm run lint && npm run format:check && npm test
```

Verificação atual: **1159 testes passaram e 70 foram ignorados**; os 21 testes live falharam porque a
credencial OpenAI configurada foi rejeitada e o subprocesso Node encerrou com assertion nativa. Use
`npm run eval` com uma chave válida para validar a matriz contra providers reais.

---

## 4. Decisões em aberto

| Questão                           | Por que importa                                                                                 | Recomendação                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Code signing no Windows/macOS** | Sem certificado, instalações podem gerar avisos e a atualização é manual nessas plataformas | Configurar os segredos antes de distribuir amplamente; o verificador do GitHub já oferece o link de download |
| **Release multiplataforma**       | `v0.1.4` tem apenas os três instaladores Windows; builds sem assinatura exibem avisos do sistema e não recebem update automático | Gerar e publicar os targets Linux/macOS em uma próxima versão; configurar certificados antes de distribuir amplamente |
| **CI/smokes live**                | Os smokes live dependem do provider e da chave; assinaturas são opcionais no fluxo atual       | `RUBYCLI_REF` está atualizado; adicionar `RUBY_API_KEY` para executar os smokes live |

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
- **Vite externaliza dependências em builds SSR por padrão.** O engine precisa de
  `ssr.noExternal: true`; sem isso, o app empacotado pode encerrar com `ERR_MODULE_NOT_FOUND`
  embora os smokes locais encontrem o pacote no `node_modules` do workspace. O build executa
  `scripts/verify-engine-bundle.cjs` para impedir imports npm externos.

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

1. Executar `npm run eval` e os smokes que dependem do provider quando houver uma chave válida e o
   serviço estiver respondendo; investigar a assertion nativa do Node se continuar após autenticar.
2. Iniciar M7 com uma verificação técnica do catálogo Ruby, endpoint de geração e contrato multimodal
   do engine; depois implementar anexos de imagem e a tool de geração.
3. Validar os instaladores empacotados em Windows, macOS e Linux. Windows é o teste local disponível;
   macOS/Linux dependem de máquinas desses sistemas.
4. Configurar certificados Windows/macOS caso se queira reduzir alertas do instalador e habilitar
   instalação automática nessas plataformas; a verificação com link para downloads já funciona sem
   assinatura.
5. Considerar testes unitários para reducers e componentes do renderer se o volume de UI continuar
   crescendo; hoje o Desktop usa os seis smokes Electron.
