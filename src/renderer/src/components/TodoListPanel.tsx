import { useState } from "react";
import { Check, ChevronDown, ListTodo } from "lucide-react";
import { useStore } from "../store";
import { cn } from "../lib/utils";

/** Shows the current todo_write snapshot beside the composer, like a live task card. */
export function TodoListPanel(): React.JSX.Element | null {
  const todo = useStore((state) =>
    state.items.find((item) => item.kind === "todo-list"),
  );
  const [expanded, setExpanded] = useState(true);

  if (!todo || todo.kind !== "todo-list" || todo.items.length === 0) return null;

  const completed = todo.items.filter((item) => item.status === "done").length;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-2">
      <section className="overflow-hidden rounded-xl border border-line bg-card">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-white/[0.03]"
        >
          <ListTodo className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="font-semibold text-foreground">To-dos</span>
          <span className="text-muted-foreground">
            {completed} de {todo.items.length} concluídos
          </span>
          <ChevronDown
            className={cn(
              "ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>

        {expanded ? (
          <ol
            aria-label="Progresso da tarefa"
            className="max-h-44 overflow-y-auto px-3 pb-2"
          >
            {todo.items.map((item) => (
              <li key={item.id} className="flex min-h-7 items-center gap-2 text-xs">
                {item.status === "done" ? (
                  <Check
                    aria-label="Concluída"
                    className="h-3.5 w-3.5 shrink-0 text-chart-5"
                  />
                ) : (
                  <span
                    aria-label={
                      item.status === "in_progress" ? "Em andamento" : "Pendente"
                    }
                    className={cn(
                      "ml-1 mr-0.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      item.status === "in_progress"
                        ? "animate-pulse bg-chart-3"
                        : "bg-muted-foreground/50",
                    )}
                  />
                )}
                <span
                  className={cn(
                    "min-w-0 break-words text-foreground/90",
                    item.status === "done" && "text-muted-foreground",
                  )}
                >
                  {item.text}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    </div>
  );
}
