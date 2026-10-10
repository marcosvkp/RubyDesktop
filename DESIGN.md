# Design System — Ruby Desktop

> Extraído do site `app.rubycli.cloud` para que o app desktop tenha a **mesma identidade visual**.
> Método: tokens lidos do CSS de produção do site + screenshots de referência em `design/`.

Referências salvas:
- `design/ref-home-hero.png` — hero, tipografia display, eyebrow labels, CTA
- `design/ref-home-cards.png` — grid de cards numerados, pill toggle, faixa de features
- `design/ruby-site.tokens.css` — CSS de produção do site (fonte da verdade)

---

## 1. Stack de UI do site (e do app)

O site usa **Tailwind CSS v4 + shadcn/ui** com paleta dark customizada. Evidência: o CSS define exatamente o conjunto de tokens do shadcn (`--background`, `--card`, `--primary`, `--muted`, `--accent`, `--destructive`, `--input`, `--ring`, `--sidebar-*`, `--chart-1..5`) mais primitivas do Tailwind v4 (`--color-*`, `--text-*--line-height`, `--spacing`, `--radius`, `--animate-*`).

**Decisão: o Ruby Desktop usa Tailwind v4 + shadcn/ui com os mesmos nomes de token.** Assim os componentes do shadcn entram sem tradução e a identidade fica idêntica por construção.

---

## 2. Tokens (valores exatos do site)

Todos extraídos do CSS de produção, exceto os marcados *(inferido)*.

### Superfícies e texto

| Token | Valor | Uso |
|---|---|---|
| `--background` | `#050304` | fundo da janela (quase-preto **quente**, não cinza) |
| `--page` | `#0b090c` | fundo de página/scroll area |
| `--foreground` | `#f7eff3` | texto principal (branco **rosado**, não puro) |
| `--card` | `#0f090c` | cards, painéis |
| `--card-foreground` | `#f7eff3` | texto em card |
| `--popover` | `#0f090c` | dropdowns, modais |
| `--popover-foreground` | `#f7eff3` *(inferido)* | texto em popover |
| `--muted` | `#1a1417` | fundo secundário, hover suave |
| `--muted-foreground` | `#a6979d` | texto secundário / legendas |
| `--accent` | `#27181b` | hover/realce |
| `--accent-foreground` | `#f7eff3` | texto sobre accent |
| `--secondary` | `#1a1417` | botão secundário |
| `--secondary-foreground` | `#f1e9ec` | texto em botão secundário |
| `--copy-muted` | `#a9a1a7` | corpo de texto apagado |

### Marca e estados

| Token | Valor | Uso |
|---|---|---|
| `--primary` | `#de0068` | **rosa/magenta da marca** — CTA, ação primária |
| `--primary-foreground` | `#fefbfc` | texto sobre primary |
| `--ring` | `#e83174` | anel de foco |
| `--destructive` | `#df202e` | erro, ação destrutiva |
| `--model-accent` | `#ff638d` | realce de modelo (rosa claro) |
| `--model-glow` | `#d4195229` | glow radial rosa (alpha) |

### Bordas e inputs

| Token | Valor | Uso |
|---|---|---|
| `--border` | `#ffffff1a` | borda padrão (branco 10%) |
| `--line` | `#ffffff17` | divisores de seção (branco 9%) |
| `--input` | `#ffffff1f` | fundo de input (branco 12%) |

### Sidebar (o site já define — usar direto na sidebar do app)

| Token | Valor |
|---|---|
| `--sidebar` | `#0a0608` |
| `--sidebar-foreground` | `#f7eff3` |
| `--sidebar-primary` | `#de0068` |
| `--sidebar-primary-foreground` | `#fefbfc` |
| `--sidebar-accent` | `#1d1218` |
| `--sidebar-accent-foreground` | `#f7eff3` |
| `--sidebar-border` | `#ffffff1a` |
| `--sidebar-ring` | `#e83174` |

### Gráficos (medidor de contexto, custo por agente)

| Token | Valor |
|---|---|
| `--chart-1` | `#e83174` (rosa) |
| `--chart-2` | `#ee6a4a` (coral) |
| `--chart-3` | `#d29922` (âmbar) |
| `--chart-4` | `#7e70ec` (violeta) |
| `--chart-5` | `#00afa9` (teal) |

### Forma e tipografia

| Token | Valor |
|---|---|
| `--radius` | `0.7rem` (11.2px) — cantos suaves, não arredondados demais |
| `--radius-4xl` | `2rem` |
| `--spacing` | `0.25rem` (base 4px do Tailwind) |
| `--font-sans` | **Geist** |
| `--font-mono` | **Geist Mono** |
| `--tracking-tight` | `-0.025em` |
| `--tracking-wide` | `0.025em` |
| `--tracking-widest` | `0.1em` |
| `--leading-tight` | `1.25` |
| `--leading-snug` | `1.375` |
| `--leading-relaxed` | `1.625` |

Fontes: Geist e Geist Mono são self-hosted no site (woff2, pesos 100–900). No app, empacotar os mesmos woff2 ou usar `geist` do npm.

---

## 3. Linguagem visual (regras observadas)

1. **Dark quente, nunca cinza.** O fundo é `#050304` — preto com viés vinho. O texto é `#f7eff3` — branco com viés rosa. Nunca usar `#000` nem `#fff` puros. Isso é o que dá a "temperatura" da marca.
2. **Rosa é acento, não fundo.** `--primary` `#de0068` aparece em CTA, ícones, eyebrows e estado ativo. O resto da UI é neutra. O rosa nunca preenche áreas grandes.
3. **Eyebrow labels.** Texto pequeno, MAIÚSCULO, rosa, com `tracking-widest` (`0.1em`), acima de cada título de seção. Ex.: "FEITO PARA CONSTRUIR", "SALDO TRANSPARENTE".
4. **Títulos display em duas linhas.** Muito grandes, bold, `tracking-tight`. Primeira linha em `--foreground`, segunda em tom apagado/rosado. Ex.: "Encontre o modelo." / "Comece a criar."
5. **Cards com borda sutil.** Fundo `--card`, borda 1px `#ffffff1a`, raio `0.7rem`, padding generoso. Sem sombra pesada — a separação vem da borda e do contraste de fundo.
6. **Cards numerados.** Grid de 3 colunas com `01`/`02`/`03` em `--muted-foreground` no topo-esquerdo e um ícone rosa no topo-direito.
7. **Pill toggle.** Controle segmentado `rounded-full`, fundo escuro, segmento ativo em `--primary` com texto claro (ex.: R$ BRL / US$ USD).
8. **Divisores finos.** Linhas de 1px `--line` separando seções, largura total.
9. **Glow com moderação.** Um glow radial rosa (`--model-glow`) atrás do elemento herói. Usar só em destaques, nunca em listas.
10. **Ícones em quadrados arredondados.** Ícones de destaque ficam dentro de um quadrado `rounded` com fundo rosa translúcido e o ícone em rosa.

---

## 4. Aplicação no app desktop

| Área do app | Como aplicar |
|---|---|
| **Janela / fundo** | `--background`; a área de conteúdo usa `--page` para separar da sidebar |
| **Sidebar de workspaces** | Tokens `--sidebar-*` já prontos. Item ativo = `--sidebar-accent` + barra/indicador `--sidebar-primary` |
| **Chat — mensagem do usuário** | Card `--card` com borda `--border`; ou `--secondary` para diferenciar |
| **Chat — resposta do agente** | Fundo transparente sobre `--page`, texto `--foreground`; markdown com `--copy-muted` para trechos apagados |
| **Tool call (colapsável)** | Card `--card`, header com nome da tool em `--font-mono`, ícone em quadrado rosa, status: `--chart-5` (ok) / `--destructive` (erro) / `--chart-3` (rodando) |
| **Painel de saída (terminal)** | `--font-mono`, fundo mais escuro que `--card`, texto `--copy-muted`, exit code colorido |
| **Medidor de contexto** | Barra usando `--chart-1` → `--chart-3` → `--destructive` conforme enche (o compact dispara em 75%) |
| **Modal de permissão** | `--popover`, borda `--border`, ação primária `--primary`, negar em `--destructive`. Botões com raio `--radius` |
| **Browser integrado** | Chrome do painel em `--card`; a página em si é do site externo |
| **Árvore de subagentes** | Cards aninhados; cor por agente vinda de `--chart-1..5` |
| **Goal banner** | Faixa persistente com borda `--border`, eyebrow rosa "GOAL", texto `--foreground`, notas em `--muted-foreground` |
| **Seletor de modelo** | Pill toggle no estilo do site + lista em `--popover` |
| **Barra de título / logo** | Marca Ruby (diamante rosa) + "Ruby" em `--foreground` e "Desktop" em `--primary`, como o site faz com "RubyCLI" |

---

## 5. Snippet pronto (Tailwind v4 + shadcn)

```css
/* src/renderer/styles/theme.css */
@import "tailwindcss";

@theme {
  --font-sans: "Geist", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --radius: 0.7rem;
}

:root {
  /* superfícies */
  --background: #050304;
  --page: #0b090c;
  --foreground: #f7eff3;
  --card: #0f090c;
  --card-foreground: #f7eff3;
  --popover: #0f090c;
  --popover-foreground: #f7eff3;
  --muted: #1a1417;
  --muted-foreground: #a6979d;
  --accent: #27181b;
  --accent-foreground: #f7eff3;
  --secondary: #1a1417;
  --secondary-foreground: #f1e9ec;

  /* marca e estados */
  --primary: #de0068;
  --primary-foreground: #fefbfc;
  --ring: #e83174;
  --destructive: #df202e;
  --model-accent: #ff638d;
  --model-glow: #d4195229;

  /* bordas */
  --border: #ffffff1a;
  --line: #ffffff17;
  --input: #ffffff1f;
  --copy-muted: #a9a1a7;

  /* sidebar */
  --sidebar: #0a0608;
  --sidebar-foreground: #f7eff3;
  --sidebar-primary: #de0068;
  --sidebar-primary-foreground: #fefbfc;
  --sidebar-accent: #1d1218;
  --sidebar-accent-foreground: #f7eff3;
  --sidebar-border: #ffffff1a;
  --sidebar-ring: #e83174;

  /* gráficos */
  --chart-1: #e83174;
  --chart-2: #ee6a4a;
  --chart-3: #d29922;
  --chart-4: #7e70ec;
  --chart-5: #00afa9;
}
```

---

## 6. Regras de acessibilidade

- `--muted-foreground` (`#a6979d`) sobre `--background` (`#050304`) fica em ~7:1 de contraste — ok para texto normal.
- `--primary` (`#de0068`) sobre `--background` fica em ~4.3:1 — **não usar rosa para corpo de texto pequeno**; só para títulos grandes, ícones e elementos não-textuais. Para texto pequeno, usar `--foreground` ou `--muted-foreground`.
- Texto sobre `--primary` deve ser `--primary-foreground` (`#fefbfc`), nunca branco puro.
- Nunca sinalizar estado só por cor: acompanhar com ícone ou rótulo (ex.: tool call com ✓/✗ além do verde/vermelho).

---

## 7. Marca (assets reais)

Baixados de `app.rubycli.cloud/brand/` para `design/brand/`:

| Arquivo | Dimensões | O que é |
|---|---|---|
| `ruby-mark.png` | 1031×867 | **O símbolo**: diamante facetado com um "R" no espaço negativo. Fundo transparente |
| `rubycli-horizontal-light.png` | 1832×426 | Wordmark para **fundo escuro** (o que o site usa) |
| `rubycli-horizontal-dark.png` | 1838×419 | Wordmark para **fundo claro** |

### Cores da marca (amostradas dos pixels)

**Símbolo — diamante, paleta vermelha facetada:**

| Cor | Papel |
|---|---|
| `#F52037` | faceta clara (topo) |
| `#C1022A` | faceta média |
| `#A40123` | faceta escura (esquerda) |
| `#720624` | faceta mais profunda (base) |

**Wordmark:**

| Variante | "Ruby" | "CLI" |
|---|---|---|
| light (fundo escuro) | `#898E9A` (cinza-slate) | `#DE0C2D` (vermelho) |
| dark (fundo claro) | `#212120` (quase preto) | `#CB102D` (vermelho) |

### ⚠️ Dois vermelhos/magentas diferentes — não confundir

O site usa **duas cores de acento distintas**, e isso é intencional:

| Cor | Onde |
|---|---|
| `#DE0C2D` / `#F52037` — **vermelho da marca** | logo, símbolo, wordmark. Identidade. |
| `#DE0068` — **magenta da UI** (`--primary`) | botões, CTA, links, estado ativo. Interação. |

No hero isso é visível: o logo é vermelho e o botão "Criar conta" é magenta. O app deve manter a mesma separação — **símbolo em vermelho da marca, ações em magenta**.

### ⚠️ O wordmark não é reaproveitável para "Desktop"

`rubycli-horizontal-light.png` tem a palavra **"CLI" rasterizada** dentro da imagem. Não dá para gerar "RubyDesktop" a partir dela. Opções:

1. **Recomendado:** usar `ruby-mark.png` (o símbolo) + compor o texto em **Geist**, no mesmo tratamento do site — "Ruby" em `#898E9A` e o sufixo em vermelho `#DE0C2D`. Assim "Ruby**Desktop**" sai tipograficamente idêntico ao "Ruby**CLI**".
2. Pedir ao designer um `rubycli-horizontal` novo com "Desktop".
3. Usar só o símbolo, sem wordmark (comum em apps desktop).

### Ícones do app

`favicon.ico` (256×256) e `apple-icon.png` (180×180) também estão em `design/`. Para o empacotamento, gerar o `.ico` do Windows a partir de `ruby-mark.png` (que é o símbolo limpo, em alta resolução, com transparência) — não do favicon, que é pequeno.

> Nota: `apple-icon.png` foi servido com extensão `.png` mas não abre como PNG (provável AVIF/WebP renomeado). Usar `ruby-mark.png` como fonte canônica do ícone.
