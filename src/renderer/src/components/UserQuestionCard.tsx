import { useState } from "react";
import { Check, CircleHelp, X } from "lucide-react";
import type { ChatItem } from "../store";
import { useStore } from "../store";
import { cn } from "../lib/utils";

export function UserQuestionCard({ item }: { item: Extract<ChatItem, { kind: "question" }> }): React.JSX.Element {
  const respond = useStore((s) => s.respondUserQuestion);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const pending = item.status === "pending";
  const complete = item.request.questions.every((question) => answers[question.id]?.trim());

  return (
    <section className="rounded-xl border border-primary/30 bg-card p-4 shadow-lg shadow-black/10">
      <header className="mb-3 flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <CircleHelp className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold text-foreground">{item.request.title}</h3>
            <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-muted-foreground">
              {item.request.agentName}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {pending ? "O agente está aguardando sua resposta." : item.status === "answered" ? "Resposta enviada." : "Pergunta cancelada."}
          </p>
        </div>
      </header>

      <div className="space-y-4 pl-9">
        {item.request.questions.map((question) => (
          <fieldset key={question.id} disabled={!pending} className="space-y-2">
            {question.header ? (
              <legend className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {question.header}
              </legend>
            ) : null}
            <p className="text-sm leading-5 text-foreground">{question.question}</p>
            {question.options.length > 0 ? (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {question.options.map((option) => {
                  const selected = answers[question.id] === option.label;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setAnswers((current) => ({ ...current, [question.id]: option.label }))
                      }
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                        selected
                          ? "border-primary/60 bg-primary/10 text-foreground"
                          : "border-line bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground",
                      )}
                    >
                      <span className="font-medium">{option.label}</span>
                      {option.description ? (
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {pending ? (
              <input
                value={answers[question.id] ?? ""}
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                }
                placeholder={question.options.length > 0 ? "Ou escreva outra resposta…" : "Sua resposta…"}
                aria-label={`Resposta: ${question.question}`}
                className="w-full rounded-lg border border-line bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring/60 focus:outline-none"
              />
            ) : item.status === "answered" ? (
              <div className="rounded-lg border border-line bg-background px-3 py-2 text-xs text-foreground">
                {item.answers?.[question.id] ?? "—"}
              </div>
            ) : null}
          </fieldset>
        ))}

        {pending ? (
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => respond(item.id, null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Cancelar
            </button>
            <button
              type="button"
              disabled={!complete}
              onClick={() => respond(item.id, answers)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" />
              Responder
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
