/**
 * Smoke test: rebuilding a conversation with sub-agent and ask-user UI events.
 *
 * It seeds a private session log, starts the real engine and renderer, then checks
 * that reopening preserves text boundaries, sub-agent cards, question choices and
 * the selected answer. No provider turn is sent by this smoke.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runScenario } = require("./smoke-harness.cjs");

const WORKSPACE = process.env.RUBY_DESKTOP_WORKSPACE || process.cwd();
const SANDBOX_HOME = fs.mkdtempSync(
  path.join(os.tmpdir(), "ruby-smoke-history-"),
);
const SESSION_ID = new Date().toISOString().slice(0, 23).replace(/[:.]/g, "-");
const SESSION_DIR = path.join(
  SANDBOX_HOME,
  "projects",
  Buffer.from(WORKSPACE).toString("base64url"),
);
const SESSION_PATH = path.join(SESSION_DIR, `${SESSION_ID}.jsonl`);
const CONFIG_ID = "smoke-config-1";
const AGENT_ID = "smoke-agent-1";
const QUESTION_ID = "smoke-question-1";

process.once("exit", () => {
  fs.rmSync(SANDBOX_HOME, { recursive: true, force: true });
});

function apiKeyFromConfig() {
  if (process.env.RUBY_API_KEY) return process.env.RUBY_API_KEY;
  try {
    return (
      JSON.parse(
        fs.readFileSync(
          path.join(os.homedir(), ".rubycli", "config.json"),
          "utf8",
        ),
      ).rubyApiKey || ""
    );
  } catch {
    return "";
  }
}

function writeFixtureSession() {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  const entries = [];
  const add = (entry) =>
    entries.push({ ...entry, timestamp: new Date().toISOString() });
  const ui = (kind, id, data) =>
    add({ type: "ui_event", event: { version: 1, kind, id, data } });

  add({ type: "session_start", cwd: WORKSPACE });
  add({
    type: "user",
    content: "Chame um sub-agent e depois me faça uma pergunta.",
  });
  add({ type: "assistant", content: "Chamando sub-agent." });
  add({
    type: "tool_call",
    name: "task",
    args: {
      prompt: "Diga oi de volta, de forma breve e amigável.",
      role: "explorer",
      title: "Dizer oi",
    },
  });
  const configRequest = {
    id: CONFIG_ID,
    title: "Dizer oi",
    prompt: "Diga oi de volta, de forma breve e amigável.",
    role: "explorer",
    proposedModel: "muse-spark-1.3-contributor",
    proposedInstructions: "Seja breve.",
  };
  ui("subagent-config", CONFIG_ID, {
    request: configRequest,
    status: "pending",
  });
  ui("subagent-config", CONFIG_ID, {
    request: configRequest,
    status: "started",
    resolved: {
      model: "muse-spark-1.3-contributor",
      instructions: "Responda em português.",
    },
  });
  const agent = {
    id: AGENT_ID,
    title: "Dizer oi",
    prompt: configRequest.prompt,
    role: "explorer",
    model: "muse-spark-1.3-contributor",
    instructions: "Responda em português.",
    status: "completed",
    progress: "Investigação concluída",
    output: "Oi! Tudo bem por aí?",
    usage: {
      inputTokens: 120,
      outputTokens: 12,
      cachedTokens: 0,
      llmCalls: 1,
      toolCalls: 0,
    },
  };
  ui("subagent", AGENT_ID, { agent });
  add({
    type: "tool_result",
    name: "task",
    result: "Sub-agent: Dizer oi (explorer)\n\nOi! Tudo bem por aí?",
  });
  add({
    type: "assistant",
    content: "Sub-agent chamado. Ele respondeu: ‘Oi! Tudo bem por aí?’",
  });

  add({ type: "user", content: "Me faça uma pergunta de múltipla escolha." });
  add({
    type: "assistant",
    content: "Vou perguntar quais linguagens você usa.",
  });
  const questionRequest = {
    id: QUESTION_ID,
    agentId: "main",
    agentName: "Ruby",
    title: "Linguagens favoritas",
    questions: [
      {
        id: "languages",
        header: "Preferências",
        question: "Quais linguagens você usa no dia a dia?",
        selectionMode: "multiple",
        options: [
          { label: "JavaScript / TypeScript" },
          { label: "Python" },
          { label: "C# / .NET" },
        ],
      },
    ],
  };
  add({
    type: "tool_call",
    name: "ask_user",
    args: { questions: questionRequest.questions },
  });
  ui("user-question", QUESTION_ID, {
    request: questionRequest,
    status: "pending",
  });
  ui("user-question", QUESTION_ID, {
    request: questionRequest,
    status: "answered",
    answers: { languages: ["JavaScript / TypeScript", "Python"] },
  });
  add({
    type: "tool_result",
    name: "ask_user",
    result: '{"answers":{"languages":["JavaScript / TypeScript","Python"]}}',
  });
  add({
    type: "assistant",
    content: "Você selecionou JavaScript / TypeScript e Python.",
  });

  fs.writeFileSync(
    SESSION_PATH,
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8",
  );
}

writeFixtureSession();

const API_KEY = apiKeyFromConfig();
runScenario({
  name: "session-history",
  workspace: WORKSPACE,
  timeoutMs: 60_000,
  env: {
    RUBYCLI_HOME: SANDBOX_HOME,
    ...(API_KEY ? { RUBY_API_KEY: API_KEY } : {}),
  },
  hooks: {
    async onMessage(message, api) {
      if (message.type !== "sessions" || !message.transcript) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
      const restored = await api.readDom(`(() => {
        const text = (selector) => [...document.querySelectorAll(selector)].map((el) => el.innerText.trim());
        const options = [...document.querySelectorAll('[data-testid="user-question-option"]')].map((button) => ({
          label: button.querySelector('span.font-medium')?.textContent?.trim(),
          pressed: button.getAttribute('aria-pressed'),
          disabled: button.disabled,
        }));
        return {
          assistants: text('[data-testid="assistant-message"]'),
          config: text('[data-testid="subagent-config-card"]'),
          agents: text('[data-testid="subagent-card"]'),
          questions: text('[data-testid="user-question-card"]'),
          options,
          transcriptCount: document.querySelectorAll('[data-testid="assistant-message"]').length,
        };
      })()`);

      const expectedAssistant = [
        "Chamando sub-agent.",
        "Sub-agent chamado. Ele respondeu: ‘Oi! Tudo bem por aí?’",
        "Vou perguntar quais linguagens você usa.",
        "Você selecionou JavaScript / TypeScript e Python.",
      ];
      const ordered = expectedAssistant.every((text, index) =>
        restored.assistants[index]?.includes(text),
      );
      if (!ordered)
        return api.finish(
          1,
          `assistant segments were merged or reordered: ${JSON.stringify(restored.assistants)}`,
        );
      if (!restored.config[0]?.includes("Responda em português."))
        return api.finish(1, "sub-agent configuration was not restored");
      if (restored.config[0]?.includes("aguardando início"))
        return api.finish(
          1,
          "restored sub-agent configuration still appears pending",
        );
      if (!restored.agents[0]?.includes("Oi! Tudo bem por aí?"))
        return api.finish(1, "sub-agent summary was not restored");
      if (!restored.questions[0]?.includes("Resposta enviada."))
        return api.finish(1, "answered question card was not restored");
      if (
        restored.options.map((option) => option.label).join(",") !==
        "JavaScript / TypeScript,Python,C# / .NET"
      )
        return api.finish(1, "multi-select options were not restored");
      if (
        restored.options[0].pressed !== "true" ||
        restored.options[1].pressed !== "true" ||
        restored.options[2].pressed !== "false"
      )
        return api.finish(
          1,
          "the saved array answer was not shown as multiple selected options",
        );
      if (!restored.options.every((option) => option.disabled))
        return api.finish(
          1,
          "restored answer buttons should be visible and read-only",
        );
      api.sendEngineMessage({
        type: "userQuestionRequest",
        request: {
          id: "smoke-live-question",
          agentId: "main",
          agentName: "Ruby",
          title: "Pergunta em andamento",
          questions: [
            {
              id: "live-languages",
              header: "Página 1 de teste",
              question: "Quais linguagens você usa?",
              selectionMode: "multiple",
              options: [
                { label: "JavaScript / TypeScript" },
                { label: "Python" },
                { label: "C# / .NET" },
              ],
            },
            {
              id: "live-framework",
              header: "Página 2 de teste",
              question: "Qual opção você recomenda?",
              selectionMode: "single",
              options: [{ label: "A (recomendado)" }, { label: "B" }],
            },
            {
              id: "live-other",
              header: "Página 3 de teste",
              question: "Qual sistema você usa?",
              selectionMode: "multiple",
              options: [{ label: "Windows" }, { label: "Linux" }],
            },
          ],
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 150));

      const pending = await api.readDom(`(() => {
        const cards = [...document.querySelectorAll('[data-testid="user-question-card"]')];
        const card = cards.at(-1);
        if (!card) return null;
        const options = [...card.querySelectorAll('[data-testid="user-question-option"]')];
        const input = card.querySelector('[data-testid="user-question-freeform"]');
        return {
          page: card.querySelector('[data-testid="user-question-page"]')?.innerText,
          labels: options.map((button) => button.querySelector('span.font-medium')?.textContent.trim()),
          roles: options.map((button) => button.getAttribute('role')),
          pressed: options.map((button) => button.getAttribute('aria-pressed')),
          disabled: options.map((button) => button.disabled),
          inputValue: input?.value,
          placeholder: input?.placeholder,
          freeformToggle: card.querySelector('[data-testid="user-question-freeform-toggle"]')?.getAttribute('aria-checked'),
          nextDisabled: card.querySelector('[data-testid="user-question-next"]')?.disabled,
          skipButton: card.querySelector('[data-testid="user-question-skip"]')?.textContent.trim(),
        };
      })()`);
      if (!pending || pending.labels.length !== 3)
        return api.finish(
          1,
          "page one did not render all multiple-choice options",
        );
      if (
        pending.labels.join(",") !== "JavaScript / TypeScript,Python,C# / .NET"
      )
        return api.finish(
          1,
          "page one choice labels are missing or out of order",
        );
      if (
        pending.roles.some((role) => role !== "checkbox") ||
        pending.pressed.some((value) => value !== "false") ||
        pending.disabled.some(Boolean)
      )
        return api.finish(
          1,
          "multiple-choice controls should be enabled checkboxes",
        );
      if (
        pending.inputValue !== "" ||
        pending.placeholder !== "Type your answer" ||
        pending.freeformToggle !== "false"
      )
        return api.finish(
          1,
          "multiple-choice page should have a separate, unchecked freeform option",
        );
      if (!pending.nextDisabled || pending.skipButton !== "Pular")
        return api.finish(
          1,
          "next and skip controls should be visible on the page",
        );

      await api.readDom(`(() => {
        const card = [...document.querySelectorAll('[data-testid="user-question-card"]')].at(-1);
        const options = [...card.querySelectorAll('[data-testid="user-question-option"]')];
        options[0].click();
        options[1].click();
        return true;
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const selected = await api.readDom(`(() => {
        const card = [...document.querySelectorAll('[data-testid="user-question-card"]')].at(-1);
        return {
          pressed: [...card.querySelectorAll('[data-testid="user-question-option"]')].map((button) => button.getAttribute('aria-pressed')),
          inputValue: card.querySelector('[data-testid="user-question-freeform"]').value,
          nextDisabled: card.querySelector('[data-testid="user-question-next"]').disabled,
        };
      })()`);
      if (
        selected.pressed.join(",") !== "true,true,false" ||
        selected.inputValue !== "" ||
        selected.nextDisabled
      )
        return api.finish(
          1,
          "multiple options should toggle independently from the freeform input",
        );

      await api.clickButton("Próxima");
      await new Promise((resolve) => setTimeout(resolve, 50));
      const singleChoice = await api.readDom(`(() => {
        const card = [...document.querySelectorAll('[data-testid="user-question-card"]')].at(-1);
        const options = [...card.querySelectorAll('[data-testid="user-question-option"]')];
        return {
          page: card.querySelector('[data-testid="user-question-page"]')?.innerText,
          labels: options.map((button) => button.querySelector('span.font-medium')?.textContent.trim()),
          roles: options.map((button) => button.getAttribute('role')),
          inputCount: card.querySelectorAll('[data-testid="user-question-freeform"]').length,
        };
      })()`);
      if (
        !singleChoice.page?.includes("Página 2 de 3") ||
        singleChoice.labels.join(",") !== "A (recomendado),B" ||
        singleChoice.roles.some((role) => role !== "radio") ||
        singleChoice.inputCount !== 1
      )
        return api.finish(
          1,
          "page two should render single-choice radio controls and a freeform field",
        );

      await api.readDom(`(() => {
        const card = [...document.querySelectorAll('[data-testid="user-question-card"]')].at(-1);
        card.querySelector('[data-testid="user-question-option"]').click();
        return true;
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 40));
      const radioSelected = await api.readDom(`(() => {
        const card = [...document.querySelectorAll('[data-testid="user-question-card"]')].at(-1);
        return [...card.querySelectorAll('[data-testid="user-question-option"]')].map((button) => button.getAttribute('aria-pressed'));
      })()`);
      if (radioSelected.join(",") !== "true,false")
        return api.finish(
          1,
          "single-choice page should select only one option",
        );

      await api.readDom(`(() => {
        document.querySelector('[aria-label="Página anterior"]').click();
        return true;
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 40));
      const previousRetained = await api.readDom(`(() => {
        const card = [...document.querySelectorAll('[data-testid="user-question-card"]')].at(-1);
        return [...card.querySelectorAll('[data-testid="user-question-option"]')].map((button) => button.getAttribute('aria-pressed'));
      })()`);
      if (previousRetained.join(",") !== "true,true,false")
        return api.finish(
          1,
          "going back should retain previously selected multiple answers",
        );
      await api.clickButton("Próxima");
      await new Promise((resolve) => setTimeout(resolve, 40));

      await api.clickButton("Pular");
      await new Promise((resolve) => setTimeout(resolve, 50));
      const thirdPage = await api.readDom(`(() => {
        const card = [...document.querySelectorAll('[data-testid="user-question-card"]')].at(-1);
        return {
          page: card.querySelector('[data-testid="user-question-page"]')?.innerText,
          labels: [...card.querySelectorAll('[data-testid="user-question-option"]')].map((button) => button.querySelector('span.font-medium')?.textContent.trim()),
        };
      })()`);
      if (
        !thirdPage.page?.includes("Página 3 de 3") ||
        thirdPage.labels.length !== 2
      )
        return api.finish(1, "skip should advance to the next question page");

      await api.readDom(`(() => {
        const card = [...document.querySelectorAll('[data-testid="user-question-card"]')].at(-1);
        const options = [...card.querySelectorAll('[data-testid="user-question-option"]')];
        options[1].click();
        const input = card.querySelector('[data-testid="user-question-freeform"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'Rust');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const customReady = await api.readDom(`(() => {
        const card = [...document.querySelectorAll('[data-testid="user-question-card"]')].at(-1);
        return {
          selected: [...card.querySelectorAll('[data-testid="user-question-option"]')].map((button) => button.getAttribute('aria-pressed')),
          inputValue: card.querySelector('[data-testid="user-question-freeform"]').value,
          customIncluded: card.querySelector('[data-testid="user-question-freeform-toggle"]').getAttribute('aria-checked'),
          submitDisabled: card.querySelector('[data-testid="user-question-next"]').disabled,
        };
      })()`);
      if (
        customReady.inputValue !== "Rust" ||
        customReady.selected.join(",") !== "false,true" ||
        customReady.customIncluded !== "true" ||
        customReady.submitDisabled
      )
        return api.finish(
          1,
          "custom text should be an included choice alongside multiple selections",
        );

      await api.clickButton("Enviar");
      await new Promise((resolve) => setTimeout(resolve, 75));
      const answered = await api.readDom(`(() => {
        const card = [...document.querySelectorAll('[data-testid="user-question-card"]')].at(-1);
        const pages = [...card.querySelectorAll('[data-testid="user-question-page"]')];
        return {
          pageCount: pages.length,
          pageOptions: pages.map((page) => [...page.querySelectorAll('[data-testid="user-question-option"]')].map((button) => ({
            label: button.querySelector('span.font-medium')?.textContent.trim(),
            pressed: button.getAttribute('aria-pressed'),
            disabled: button.disabled,
          }))),
          customAnswer: pages[2]?.querySelector('[data-testid="user-question-freeform-answer"]')?.textContent.trim(),
          skipped: pages[1]?.querySelector('[data-testid="user-question-skipped"]')?.textContent.trim(),
          inputCount: card.querySelectorAll('[data-testid="user-question-freeform"]').length,
        };
      })()`);
      if (
        answered.pageCount !== 3 ||
        answered.pageOptions[0].map((option) => option.pressed).join(",") !==
          "true,true,false" ||
        answered.pageOptions.flat().some((option) => !option.disabled) ||
        answered.skipped !== "Página pulada." ||
        answered.pageOptions[2].map((option) => option.pressed).join(",") !==
          "false,true" ||
        answered.customAnswer !== "Rust" ||
        answered.inputCount !== 0
      )
        return api.finish(
          1,
          "submitted pages did not preserve selections, skipped state and the custom multiple-choice answer",
        );

      api.finish(
        0,
        `restored ${message.transcript.length} entries with saved multi-select answers and verified three-page single/multiple selection, skip and custom answer`,
      );
    },
  },
});
