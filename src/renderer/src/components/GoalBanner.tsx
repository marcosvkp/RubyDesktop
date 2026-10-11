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
  const setGoalStatus = useStore((s) => s.setGoalStatus);
  const clearGoal = useStore((s) => s.clearGoal);
  const pushNotice = useStore((s) => s.pushNotice);

  if (!goal) return null;

  const tone =
    goal.status === "active"
      ? "border-chart-5/40 bg-chart-5/5"
      : goal.status === "paused"
        ? "border-chart-3/40 bg-chart-3/5"
        : "border-line bg-muted/40";

  const label =
    goal.status === "active" ? "Goal" : goal.status === "paused" ? "Goal · paused" : "Goal · done";

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
        {goal.notes.length > 0 ? (
          <button
            type="button"
            onClick={() =>
              pushNotice(
                [`Notes for "${goal.text}":`, ...goal.notes.map((n, i) => `${i + 1}. ${n}`)].join(
                  "\n",
                ),
              )
            }
            className="mt-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {goal.notes.length} note{goal.notes.length === 1 ? "" : "s"}
          </button>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {goal.status === "active" ? (
          <BannerButton onClick={() => setGoalStatus("paused")}>Pause</BannerButton>
        ) : null}
        {goal.status === "paused" ? (
          <BannerButton onClick={() => setGoalStatus("active")}>Resume</BannerButton>
        ) : null}
        {goal.status !== "complete" ? (
          <BannerButton onClick={() => setGoalStatus("complete")}>Complete</BannerButton>
        ) : null}
        <BannerButton onClick={clearGoal} title="Delete this goal">
          Clear
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
