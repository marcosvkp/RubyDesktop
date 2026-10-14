import { useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Pencil,
  X,
} from "lucide-react";
import type { UserQuestionAnswer, UserQuestionPrompt } from "@shared/ipc";
import type { ChatItem } from "../store";
import { useStore } from "../store";
import { cn } from "../lib/utils";

function answerValues(answer: UserQuestionAnswer | undefined): string[] {
  if (Array.isArray(answer)) return answer;
  return typeof answer === "string" && answer.trim() ? [answer] : [];
}

function hasAnswer(answer: UserQuestionAnswer | undefined): boolean {
  return Array.isArray(answer)
    ? answer.some((value) => value.trim())
    : Boolean(answer?.trim());
}

export function UserQuestionCard({
  item,
}: {
  item: Extract<ChatItem, { kind: "question" }>;
}): React.JSX.Element | null {
  const respond = useStore((s) => s.respondUserQuestion);
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedOptions, setSelectedOptions] = useState<
    Record<string, string[]>
  >({});
  const [freeform, setFreeform] = useState<Record<string, string>>({});
  const [includeFreeform, setIncludeFreeform] = useState<
    Record<string, boolean>
  >({});
  const questions = item.request.questions;
  const pending = item.status === "pending";
  const pageCount = questions.length;

  if (pageCount === 0) return null;

  const pageIndex = Math.min(currentPage, pageCount - 1);
  const activeQuestion = questions[pageIndex];

  const answerFor = (
    question: UserQuestionPrompt,
  ): UserQuestionAnswer | undefined => {
    const selected = selectedOptions[question.id] ?? [];
    const custom = freeform[question.id]?.trim() ?? "";
    if (question.selectionMode === "multiple") {
      const values = [...selected];
      if (includeFreeform[question.id] && custom && !values.includes(custom))
        values.push(custom);
      return values.length > 0 ? values : undefined;
    }
    return custom || selected[0];
  };

  const currentAnswer = pending ? answerFor(activeQuestion) : undefined;
  const currentAnswered = pending && hasAnswer(currentAnswer);

  const collectAnswers = (
    skippedQuestionId?: string,
  ): Record<string, UserQuestionAnswer> => {
    const answers: Record<string, UserQuestionAnswer> = {};
    for (const question of questions) {
      if (question.id === skippedQuestionId) continue;
      const answer = answerFor(question);
      if (hasAnswer(answer)) answers[question.id] = answer!;
    }
    return answers;
  };

  const advance = (): void => {
    if (!currentAnswered) return;
    if (pageIndex < pageCount - 1) {
      setCurrentPage(pageIndex + 1);
      return;
    }
    respond(item.id, collectAnswers());
  };

  const skipPage = (): void => {
    const questionId = activeQuestion.id;
    setSelectedOptions((current) => ({ ...current, [questionId]: [] }));
    setFreeform((current) => ({ ...current, [questionId]: "" }));
    setIncludeFreeform((current) => ({ ...current, [questionId]: false }));
    if (pageIndex < pageCount - 1) {
      setCurrentPage(pageIndex + 1);
      return;
    }
    respond(item.id, collectAnswers(questionId));
  };

  const selectOption = (question: UserQuestionPrompt, label: string): void => {
    setSelectedOptions((current) => {
      const values = current[question.id] ?? [];
      if (question.selectionMode === "multiple") {
        return {
          ...current,
          [question.id]: values.includes(label)
            ? values.filter((value) => value !== label)
            : [...values, label],
        };
      }
      return { ...current, [question.id]: [label] };
    });
    if (question.selectionMode !== "multiple")
      setFreeform((current) => ({ ...current, [question.id]: "" }));
  };

  const setCustomAnswer = (
    question: UserQuestionPrompt,
    value: string,
  ): void => {
    setFreeform((current) => ({ ...current, [question.id]: value }));
    if (question.selectionMode === "multiple") {
      setIncludeFreeform((current) => ({
        ...current,
        [question.id]: value.trim() ? true : (current[question.id] ?? false),
      }));
    } else if (value.trim()) {
      setSelectedOptions((current) => ({ ...current, [question.id]: [] }));
    }
  };

  const toggleFreeform = (question: UserQuestionPrompt): void => {
    setIncludeFreeform((current) => ({
      ...current,
      [question.id]: !current[question.id],
    }));
  };

  const visibleQuestions = pending ? [activeQuestion] : questions;

  return (
    <section
      data-testid="user-question-card"
      className="rounded-xl border border-primary/30 bg-card p-4 shadow-lg shadow-black/10"
    >
      <header className="mb-4 flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <CircleHelp className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              {item.request.title}
            </h3>
            <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-muted-foreground">
              {item.request.agentName}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {pending
              ? "O agente está aguardando sua resposta."
              : item.status === "answered"
                ? "Resposta enviada."
                : item.status === "interrupted"
                  ? "Pergunta interrompida ao fechar o app."
                  : "Pergunta cancelada."}
          </p>
        </div>
        {pending ? (
          <button
            type="button"
            aria-label="Cancelar perguntas"
            title="Cancelar perguntas"
            onClick={() => respond(item.id, null)}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </header>

      <div className="space-y-5 pl-9">
        {visibleQuestions.map((question) => {
          const multiple = question.selectionMode === "multiple";
          const values = pending
            ? (selectedOptions[question.id] ?? [])
            : answerValues(item.answers?.[question.id]);
          const customAnswers = pending
            ? []
            : answerValues(item.answers?.[question.id]).filter(
                (value) =>
                  !question.options.some((option) => option.label === value),
              );
          const pageNumber =
            questions.findIndex((entry) => entry.id === question.id) + 1;
          const pageHasAnswer = pending
            ? hasAnswer(answerFor(question))
            : hasAnswer(item.answers?.[question.id]);

          return (
            <section
              key={question.id}
              data-testid="user-question-page"
              data-page={pageNumber}
              className="space-y-3"
            >
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground">
                  Página {pageNumber} de {pageCount}
                </p>
                {question.header ? (
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {question.header}
                  </p>
                ) : null}
                <p className="text-sm font-semibold leading-5 text-foreground">
                  {question.question}
                </p>
                {question.options.length > 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    {multiple
                      ? "Selecione todas as opções que se aplicam."
                      : "Selecione uma opção."}
                  </p>
                ) : null}
              </div>

              {question.options.length > 0 ? (
                <div role={multiple ? "group" : "radiogroup"} aria-label={question.question} className="space-y-0.5">
                  {question.options.map((option) => {
                    const selected = values.includes(option.label);
                    return (
                      <button
                        key={option.label}
                        type="button"
                        disabled={!pending}
                        data-testid="user-question-option"
                        role={multiple ? "checkbox" : "radio"}
                        aria-checked={selected}
                        onClick={() => selectOption(question, option.label)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-md px-1 py-2 text-left text-xs transition-colors",
                          pending && "hover:bg-muted/70",
                          !pending && "cursor-default",
                          selected && "text-foreground",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center border transition-colors",
                            multiple ? "rounded-[4px]" : "rounded-full",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground/50 bg-background",
                          )}
                        >
                          {selected ? (
                            multiple ? (
                              <Check className="h-3 w-3" />
                            ) : (
                              <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                            )
                          ) : null}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-medium text-foreground">
                            {option.label}
                          </span>
                          {option.description ? (
                            <span className="text-[11px] text-muted-foreground">
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {pending ? (
                <div className="flex items-center gap-2 rounded-md px-1 py-2">
                  {multiple ? (
                    <button
                      type="button"
                      data-testid="user-question-freeform-toggle"
                      role="checkbox"
                      aria-label="Incluir resposta escrita"
                      aria-checked={Boolean(includeFreeform[question.id])}
                      onClick={() => toggleFreeform(question)}
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                        includeFreeform[question.id]
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/50 bg-background",
                      )}
                    >
                      {includeFreeform[question.id] ? (
                        <Check className="h-3 w-3" />
                      ) : null}
                    </button>
                  ) : (
                    <Pencil
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    />
                  )}
                  <input
                    data-testid="user-question-freeform"
                    value={freeform[question.id] ?? ""}
                    onChange={(event) =>
                      setCustomAnswer(question, event.target.value)
                    }
                    placeholder="Digite sua resposta"
                    aria-label={`Resposta: ${question.question}`}
                    className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                </div>
              ) : customAnswers.length > 0 ? (
                customAnswers.map((answer, index) => (
                  <div
                    key={`${question.id}-custom-${index}`}
                    data-testid="user-question-freeform-answer"
                    className="flex items-center gap-2 rounded-md px-1 py-2 text-xs text-foreground"
                  >
                    {multiple ? (
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-primary bg-primary text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </span>
                    ) : (
                      <Pencil
                        aria-hidden="true"
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      />
                    )}
                    {answer}
                  </div>
                ))
              ) : null}

              {!pending && item.status === "answered" && !pageHasAnswer ? (
                <p
                  data-testid="user-question-skipped"
                  className="text-xs text-muted-foreground"
                >
                  Página pulada.
                </p>
              ) : null}
            </section>
          );
        })}

        {pending ? (
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <button
                type="button"
                aria-label="Página anterior"
                disabled={pageIndex === 0}
                onClick={() => setCurrentPage(pageIndex - 1)}
                className="rounded p-1 transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-8 text-center font-medium text-foreground">
                {pageIndex + 1}/{pageCount}
              </span>
              <button
                type="button"
                aria-label="Próxima página"
                disabled={pageIndex >= pageCount - 1 || !currentAnswered}
                onClick={advance}
                className="rounded p-1 transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="user-question-skip"
                onClick={skipPage}
                className="rounded-lg border border-line px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Pular
              </button>
              <button
                type="button"
                data-testid="user-question-next"
                disabled={!currentAnswered}
                onClick={advance}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pageIndex === pageCount - 1 ? "Enviar" : "Próxima"}
                {pageIndex < pageCount - 1 ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </footer>
        ) : null}
      </div>
    </section>
  );
}
