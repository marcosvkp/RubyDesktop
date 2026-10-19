/**
 * Smoke test: markdown rendering in the transcript.
 *
 *   npx electron scripts/smoke-markdown.cjs
 *
 * The model writes markdown whether or not we render it, so the failure mode here
 * is silent and cosmetic: the user reads `**word**` and pipe characters where a
 * table should be. That is exactly what happened before this existed.
 *
 * It does not call the model. A fixed markdown sample is pushed through the real
 * engine-message channel, so the store, the item reducer and the renderer all run
 * as they do in production — but the assertions are deterministic.
 *
 * Env knobs:
 *   SMOKE_SCREENSHOT  path for a PNG of the rendered output
 *   SMOKE_TIMEOUT_MS  overall budget (default 120000)
 */
const { runScenario, CHANNEL } = require("./smoke-harness.cjs");

const SHOT = process.env.SMOKE_SCREENSHOT;
let sessionLoaded = false;

/** Everything the model actually emits in practice, in one message. */
const SAMPLE = `## O que o mod adiciona

Este é um **mod de Minecraft** para *NeoForge* (1.21.1) com \`zeldaarmor\` como id.

### Conjuntos de armadura

| Set | Bônus |
|---|---|
| Kokiri | Velocidade |
| Goron | Resistência ao fogo |
| Zora | Respiração aquática |

**Armas:** Master Sword (dano bônus contra mortos-vivos), Biggoron's Sword.

### Exemplo de código

\`\`\`java
public class ArmorSetBonusHandler {
    private static final int INTERVAL = 20;

    public static void apply(Player player) {
        // recarrega a cada 20 ticks
    }
}
\`\`\`

Lista de tarefas:

- [x] Registrar os conjuntos
- [ ] Adicionar os escudos

1. Primeiro passo
2. Segundo passo

> Nota: o renderer de escudo é próprio do cliente.

~~Antigo~~ → novo. Veja [a documentação](https://example.com) para mais.

![imagem remota bloqueada](https://example.com/image.png)

<script>window.__rubyMarkdownXss = true</script>
<img src="x" onerror="window.__rubyMarkdownXss = true">

---

Fim.`;

runScenario({
  name: "markdown",
  workspace: process.env.RUBY_DESKTOP_WORKSPACE || process.cwd(),
  timeoutMs: Number(process.env.SMOKE_TIMEOUT_MS || 120_000),
  hooks: {
    async onMessage(message) {
      if (message.type === "sessions") sessionLoaded = true;
    },
    async onReady(_ready, api) {
      try {
        const deadline = Date.now() + 5_000;
        while (!sessionLoaded && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 25));
        if (!sessionLoaded) throw new Error("session transcript did not finish loading");
        await new Promise((resolve) => setTimeout(resolve, 100));
        await check(api);
      } catch (err) {
        api.finish(1, `markdown checks failed: ${err && err.stack ? err.stack : err}`);
      }
    },
  },
});

async function check(api) {
  const send = (message) => api.window.webContents.send(CHANNEL, message);

  // --- Streaming caret ------------------------------------------------------
  // Send text WITHOUT done: the message is still streaming, so the caret must be
  // drawn. It is a CSS pseudo-element, so assert on computed style rather than DOM.
  send({ type: "event", event: { type: "text", text: "escrevendo" } });
  await new Promise((r) => setTimeout(r, 300));
  const caret = await api.readDom(`(() => {
    const roots = [...document.querySelectorAll(".markdown")];
    const root = roots[roots.length - 1];
    if (!root) return { present: false };
    const last = root.lastElementChild;
    if (!last) return { present: false };
    const style = getComputedStyle(last, "::after");
    return {
      present: true,
      rootClass: root.className,
      lastTag: last.tagName,
      lastClass: last.className,
      lastText: last.innerText,
      markdownCount: document.querySelectorAll(".markdown").length,
      messageCount: document.querySelectorAll('[data-testid="assistant-message"]').length,
      messageText: root.parentElement?.innerText,
      content: style.content,
      twContent: getComputedStyle(last).getPropertyValue("--tw-content"),
      bg: style.backgroundColor,
      width: style.width,
    };
  })()`);
  if (!caret.present) throw new Error("no markdown container while streaming");
  // `content: none` is what a missing pseudo-element reports.
  if (!caret.content || caret.content === "none") {
    throw new Error(`the streaming caret was not drawn: ${JSON.stringify(caret)}`);
  }
  if (caret.bg === "rgba(0, 0, 0, 0)") {
    throw new Error("the streaming caret has no background colour");
  }
  api.log(`ok: streaming caret drawn (${caret.width}, ${caret.bg})`);

  // Close that message, or the sample below would be appended to it and the two
  // would be parsed as one document.
  send({ type: "event", event: { type: "done" } });
  await new Promise((r) => setTimeout(r, 200));

  // --- Full markdown sample -------------------------------------------------
  // Push through the real store path: a text event, then done.
  send({ type: "event", event: { type: "text", text: SAMPLE } });
  await new Promise((r) => setTimeout(r, 300));
  send({ type: "event", event: { type: "done" } });
  await new Promise((r) => setTimeout(r, 500));

  // The sample is the LAST message, since the caret probe left one behind.
  const sampleIndex = `[...document.querySelectorAll(".markdown")].length - 1`;

  // Assert on rendered *elements*, not on text: text would match even if the
  // markdown were still being shown literally.
  const dom = await api.readDom(`(() => {
    const all = [...document.querySelectorAll(".markdown")];
    const root = all[${sampleIndex}];
    if (!root) return { present: false, containers: all.length };
    const q = (sel) => root.querySelector(sel);
    return {
      present: true,
      h2: q("h2")?.textContent ?? null,
      h3: q("h3")?.textContent ?? null,
      strong: q("strong")?.textContent ?? null,
      em: q("em")?.textContent ?? null,
      del: q("del")?.textContent ?? null,
      inlineCode: q("p code")?.textContent ?? null,
      codeBlock: q("pre code")?.textContent?.slice(0, 40) ?? null,
      tableRows: root.querySelectorAll("table tr").length,
      tableHeaders: [...root.querySelectorAll("th")].map((th) => th.textContent),
      firstCell: q("td")?.textContent ?? null,
      listItems: root.querySelectorAll("ul li").length,
      orderedItems: root.querySelectorAll("ol li").length,
      taskBoxes: root.querySelectorAll('input[type="checkbox"]').length,
      checkedBoxes: root.querySelectorAll('input[type="checkbox"]:checked').length,
      // GFM task items must not also show a bullet.
      taskListMarker: (() => {
        const list = root.querySelector("ul.contains-task-list") || root.querySelector("ul");
        return list ? getComputedStyle(list).listStyleType : "missing";
      })(),
      quote: q("blockquote")?.textContent?.trim() ?? null,
      link: q("a")?.getAttribute("href") ?? null,
      imagePlaceholder: q('[role="note"]')?.textContent ?? null,
      rawImageCount: root.querySelectorAll("img").length,
      rawScriptCount: root.querySelectorAll("script").length,
      hr: Boolean(q("hr")),
      // The literal markers must be gone — this is what the bug looked like.
      rawMarkers: /\\*\\*|^\\|/m.test(root.innerText),
    };
  })()`);

  if (!dom.present) throw new Error("no .markdown container was rendered");

  const checks = [
    ["h2 heading", dom.h2 === "O que o mod adiciona"],
    ["h3 heading", dom.h3 === "Conjuntos de armadura"],
    ["bold", dom.strong === "mod de Minecraft"],
    ["italic", dom.em === "NeoForge"],
    ["strikethrough", dom.del === "Antigo"],
    ["inline code", dom.inlineCode === "zeldaarmor"],
    ["fenced code block", (dom.codeBlock || "").includes("ArmorSetBonusHandler")],
    ["table has 4 rows (header + 3)", dom.tableRows === 4],
    ["table headers parsed", dom.tableHeaders.join(",") === "Set,Bônus"],
    ["table cell parsed", dom.firstCell === "Kokiri"],
    ["unordered list", dom.listItems >= 2],
    ["ordered list", dom.orderedItems === 2],
    ["task list boxes", dom.taskBoxes === 2],
    ["one task checked", dom.checkedBoxes === 1],
    ["task list has no disc marker", dom.taskListMarker === "none"],
    ["blockquote", (dom.quote || "").includes("renderer de escudo")],
    ["link href", dom.link === "https://example.com"],
    ["remote image placeholder", (dom.imagePlaceholder || "").includes("imagem remota bloqueada")],
    ["raw HTML is inert", dom.rawImageCount === 0 && dom.rawScriptCount === 0],
    ["horizontal rule", dom.hr === true],
    ["no literal markdown markers left", dom.rawMarkers === false],
  ];

  for (const [label, ok] of checks) {
    if (!ok) throw new Error(`markdown check failed: ${label}\nDOM: ${JSON.stringify(dom, null, 2)}`);
    api.log(`ok: ${label}`);
  }
  const xssExecuted = await api.readDom("window.__rubyMarkdownXss === true");
  if (xssExecuted) throw new Error("raw HTML executed inside assistant markdown");
  api.log("ok: assistant raw HTML did not execute");

  // --- Generated image tool result -----------------------------------------
  // Image bytes travel on the UI-only event field, never in the tool result text.
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=";
  send({
    type: "event",
    event: {
      type: "tool_call",
      id: "smoke-image-call",
      name: "image_generate",
      args: { model: "smoke-image-model", prompt: "A single pixel" },
    },
  });
  send({
    type: "event",
    event: {
      type: "tool_result",
      id: "smoke-image-call",
      name: "image_generate",
      result: "1 image generated.",
      images: [{ mimeType: "image/png", base64: png, alt: "Smoke image" }],
    },
  });
  await new Promise((r) => setTimeout(r, 250));
  const imageDom = await api.readDom(`(() => {
    const image = document.querySelector('[data-testid="generated-image-preview"]');
    const download = document.querySelector('[data-testid="generated-image-download"]');
    return {
      source: image?.getAttribute('src') ?? null,
      alt: image?.getAttribute('alt') ?? null,
      download: download?.getAttribute('download') ?? null,
      base64VisibleAsText: document.body.innerText.includes(${JSON.stringify(png)}),
    };
  })()`);
  if (!imageDom.source?.startsWith("data:image/png;base64,"))
    throw new Error(`generated image preview was not rendered: ${JSON.stringify(imageDom)}`);
  if (!imageDom.download || imageDom.base64VisibleAsText)
    throw new Error(`generated image download/privacy UI failed: ${JSON.stringify(imageDom)}`);
  api.log("ok: generated image preview and download rendered without exposing base64 as text");

  const workflowMessage = "fixture workflow phase reached";
  send({
    type: "workflowEvent",
    event: { type: "phase_start", name: "fixture", message: workflowMessage },
  });
  await new Promise((r) => setTimeout(r, 200));
  const workflowRendered = await api.readDom(
    `Boolean([...document.querySelectorAll("span")].find((node) => node.textContent === ${JSON.stringify(`Workflow · ${workflowMessage}`)}))`,
  );
  if (!workflowRendered) throw new Error("workflow progress event did not render in the chat");
  api.log("ok: workflow progress event rendered in the chat");

  const statsReady = await api.readDom(`(() => {
    const ids = ["session", "tokens", "cache", "context"];
    return ids.every((id) => document.querySelector('[data-testid="chat-stat-' + id + '"]'));
  })()`);
  if (!statsReady) throw new Error("one or more selectable chat statistics are missing");
  for (const id of ["session", "tokens", "cache", "context"]) {
    await api.readDom(`document.querySelector('[data-testid="chat-stat-${id}"]').click()`);
    await new Promise((r) => setTimeout(r, 80));
    const dialog = await api.readDom(`document.querySelector('[data-testid="chat-stat-${id}"]')?.getAttribute("aria-expanded") === "true" && Boolean(document.querySelector('[role="dialog"]'))`);
    if (!dialog) throw new Error(`chat statistic '${id}' did not open its details`);
    api.log(`ok: ${id} statistics are selectable`);
    await api.readDom(`document.querySelector('[data-testid="chat-stat-${id}"]').click()`);
  }

  await api.readDom(`(() => [...document.querySelectorAll('button')].find((button) => button.getAttribute("aria-haspopup") === "dialog" && button.textContent.includes("Spark"))?.click())()`);
  await new Promise((r) => setTimeout(r, 80));
  const modelPicker = await api.readDom(`(() => ({
    open: Boolean([...document.querySelectorAll('[role="dialog"]')].find((dialog) => dialog.getAttribute("aria-label") === "Selecionar modelo")),
    options: document.querySelectorAll('[role="listbox"] [role="option"]').length,
  }))()`);
  if (!modelPicker.open || modelPicker.options === 0) {
    throw new Error(`model picker did not open with available models: ${JSON.stringify(modelPicker)}`);
  }
  api.log(`ok: model picker is selectable (${modelPicker.options} models)`);
  await api.readDom(`document.querySelector('[role="dialog"][aria-label="Selecionar modelo"]')?.parentElement?.querySelector('button[aria-haspopup="dialog"]')?.click()`);

  if (SHOT) {
    // Scroll to the top so the screenshot shows the beginning of the message.
    await api.readDom(`document.querySelector('[data-testid="chat-scroll"]')?.scrollTo(0, 0)`);
    await new Promise((r) => setTimeout(r, 300));
    await api.screenshot(SHOT);
  }

  api.finish(0, `all ${checks.length} markdown checks passed`);
}
