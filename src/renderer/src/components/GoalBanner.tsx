import { useStore } from "../store";
import { cn } from "../lib/utils";

/**
 * The workspace goal, shown above the transcript.
 *
 * A goal is the one piece of state that should never be off-screen: it is what the
 * agent is working toward across many turns, and it persists on disk per workspace
 * (`~/.rubycli/goals/`). It renders only when a goal exists, so a session without
 * one pays no visual cost.
 */
export function GoalBanner(): React.JSX.Element | null {
  const goal = useStore((s) => s.goal);
  const autoRunning = useStore((s) => s.goalAutoRunning);
  const setGoalStatus = useStore((s) => s.setGoalStatus);
  const setGoalMaxRounds = useStore((s) => s.setGoalMaxRounds);
  const startAutoGoal = useStore((s) => s.startAutoGoal);
  const stopAutoGoal = useStore((s) => s.stopAutoGoal);
  const clearGoal = useStore((s) => s.clearGoal);
  const pushNotice = useStore((s) => s.pushNotice);

  if (!goal) return null;

  const tone =
    goal.status === "active"
      ? "border-chart-5/40 bg-chart-5/5"
      : goal.status === "paused"
        ? "border-chart-3/40 bg-chart-3/5"
        : goal.status === "blocked"
          ? "border-destructive/40 bg-destructive/5"
          : "border-line bg-muted/40";

  const label =
    goal.status === "active"
      ? autoRunning
        ? "Meta · executando"
        : "Meta · ativa"
      : goal.status === "paused"
        ? "Meta · pausada"
        : goal.status === "blocked"
          ? "Meta · bloqueada"
          : "Meta · concluída";
  const roundOptions = [
    ...new Set([1, 3, 5, 10, 20, 50, 100, goal.maxRounds]),
  ].sort((a, b) => a - b);

  return (
    <div
      data-testid="goal-banner"
      className={cn("flex items-start gap-3 border-b px-5 py-2.5", tone)}
    >
      <span className="mt-0.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {label}
      </span>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm text-foreground/90",
            goal.status === "complete" && "text-muted-foreground line-through",
          )}
        >
          {goal.text}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Rodadas automáticas: {goal.rounds}/{goal.maxRounds}
        </p>
        {goal.blockedReason ? (
          <p className="mt-1 text-xs text-destructive">{goal.blockedReason}</p>
        ) : null}
        {goal.notes.length > 0 ? (
          <button
            type="button"
            onClick={() =>
              pushNotice(
                [
                  `Notas de "${goal.text}":`,
                  ...goal.notes.map((n, i) => `${i + 1}. ${n}`),
                ].join("\n"),
              )
            }
            className="mt-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {goal.notes.length} {goal.notes.length === 1 ? "nota" : "notas"}
          </button>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        {goal.status === "active" && autoRunning ? (
          <BannerButton
            onClick={stopAutoGoal}
            title="Interromper e pausar a meta"
          >
            Parar
          </BannerButton>
        ) : null}
        {goal.status === "active" && !autoRunning ? (
          <>
            <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
              Limite
              <select
                aria-label="Limite de rodadas automáticas"
                value={goal.maxRounds}
                onChange={(event) =>
                  setGoalMaxRounds(Number(event.target.value))
                }
                className="rounded-md border border-line bg-background px-1.5 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                {roundOptions.map((rounds) => (
                  <option key={rounds} value={rounds}>
                    {rounds}
                  </option>
                ))}
              </select>
            </label>
            <BannerButton
              onClick={() => startAutoGoal(goal.maxRounds)}
              title="Executar a meta com limite de rodadas"
            >
              Continuar
            </BannerButton>
            <BannerButton onClick={() => setGoalStatus("paused")}>
              Pausar
            </BannerButton>
          </>
        ) : null}
        {goal.status === "paused" || goal.status === "blocked" ? (
          <BannerButton onClick={() => setGoalStatus("active")}>
            Retomar
          </BannerButton>
        ) : null}
        {goal.status !== "complete" && !autoRunning ? (
          <BannerButton onClick={() => setGoalStatus("complete")}>
            Concluir
          </BannerButton>
        ) : null}
        <BannerButton onClick={clearGoal} title="Apagar esta meta">
          Apagar
        </BannerButton>
      </div>
    </div>
  );
}

function BannerButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
    >
      {children}
    </button>
  );
}
