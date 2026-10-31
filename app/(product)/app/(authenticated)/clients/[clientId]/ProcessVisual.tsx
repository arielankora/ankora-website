"use client";
import { buildProcessVisual, dayLabel, type VisualInput, type VisualTick } from "@/lib/process-visual";

// Prototype (task cmvtitlhs0001js08dzotqd6r, 31.10.2026): the approved
// procedure drawn as a band of days over a flow of steps. Read only; it
// draws what the process already holds and marks what it lacks.

const TICK_STYLE: Record<VisualTick["marks"][number], string> = {
  start: "border-app-info bg-app-info",
  steps: "border-app-text-secondary bg-app-surface-card",
  sla: "border-app-success bg-app-success",
  late: "border-app-warning bg-app-warning",
};

function tickText(t: VisualTick): string[] {
  const out: string[] = [];
  if (t.marks.includes("start")) out.push("התחלה");
  if (t.stepCount > 0) out.push(t.stepCount === 1 ? "שלב אחד" : `${t.stepCount} שלבים`);
  if (t.marks.includes("sla")) out.push("סוף הזמן המוגדר");
  if (t.marks.includes("late")) out.push("אחרי הזמן המוגדר");
  return out;
}

export function ProcessVisual({ nextDate, ...input }: VisualInput & { nextDate?: string | null }) {
  const v = buildProcessVisual(input);
  if (input.steps.length === 0) {
    return <p className="text-sm text-app-text-secondary">אין עדיין נוהל מאושר, ולכן אין מה לצייר.</p>;
  }
  return (
    <div className="space-y-5" data-testid="process-visual">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-app-text-secondary">
        <span>
          מה מפעיל: <b className="font-medium text-app-text-primary">{v.startLabel}</b>
        </span>
        <span>
          זמן מוגדר: <b className="font-medium text-app-text-primary">{v.sla !== null ? `${v.sla} ימי עסקים` : "חסר"}</b>
        </span>
        {nextDate && (
          <span>
            מועד הבא: <b className="font-medium text-app-text-primary tabular-nums">{new Date(nextDate).toLocaleDateString("he-IL")}</b>
          </span>
        )}
      </div>

      <div className="overflow-x-auto pb-1">
        <ol
          className="relative grid gap-2 before:absolute before:inset-x-6 before:top-[7px] before:h-0.5 before:bg-app-border"
          style={{ gridTemplateColumns: `repeat(${v.ticks.length}, minmax(5.5rem, 1fr))` }}
          aria-label="ימי העסקים של התהליך"
        >
          {v.ticks.map((t) => {
            const mark = t.marks.includes("start") ? "start" : t.marks.includes("sla") ? "sla" : t.marks.includes("late") ? "late" : "steps";
            return (
              <li key={t.day} className="relative flex flex-col items-center gap-1 px-1 text-center">
                <span className={`z-[1] h-4 w-4 rounded-full border-2 ${TICK_STYLE[mark]}`} aria-hidden />
                <span className="text-xs font-bold tabular-nums text-app-text-primary">{dayLabel(t.day)}</span>
                {tickText(t).map((line) => (
                  <span key={line} className="line-clamp-2 text-[11px] leading-tight text-app-text-secondary">
                    {line}
                  </span>
                ))}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="space-y-3">
        {v.groups.map((g) => (
          <section key={g.day ?? "none"}>
            <h4 className={`mb-1.5 text-xs font-bold ${g.day === null ? "text-app-warning" : "text-app-text-secondary"}`}>
              {g.day === null ? "בלי יום בנוהל" : dayLabel(g.day)}
            </h4>
            <ol className="space-y-0">
              {g.steps.map((st, i) => (
                <li key={st.n} className="relative grid grid-cols-[2.25rem_1fr] gap-3 pb-3">
                  {i < g.steps.length - 1 && <span className="absolute top-9 bottom-0 start-[17px] w-0.5 bg-app-border" aria-hidden />}
                  <span
                    className={`grid h-9 w-9 place-items-center rounded-full border-2 bg-app-surface-card text-sm font-bold tabular-nums ${
                      st.mode === "MANUAL" ? "border-app-text-tertiary text-app-text-secondary" : "border-app-accent text-app-text-accent"
                    }`}
                  >
                    {st.n}
                  </span>
                  <div className="min-w-0 space-y-1 pt-1">
                    <p className="text-sm font-medium text-app-text-primary">{st.title}</p>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      <span className={`rounded-full px-2 py-0.5 ${st.mode === "MANUAL" ? "bg-app-neutral-soft text-app-text-secondary" : "bg-app-accent-soft text-app-text-accent"}`}>
                        {st.modeLabel}
                      </span>
                      {st.requiresApproval && <span className="rounded-full bg-app-warning-soft px-2 py-0.5 text-app-warning">דורש אישור</span>}
                      {g.day === null && <span className="rounded-full bg-app-warning-soft px-2 py-0.5 text-app-warning">חסר יום</span>}
                      {st.late && <span className="rounded-full bg-app-warning-soft px-2 py-0.5 text-app-warning">אחרי הזמן המוגדר</span>}
                      {st.verification && <span className="rounded-full bg-app-success-soft px-2 py-0.5 text-app-success">בדיקה: {st.verification}</span>}
                      {st.output && <span className="rounded-full bg-app-info-soft px-2 py-0.5 text-app-info">תוצר: {st.output}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      {(v.undated > 0 || v.late > 0) && (
        <p className="rounded-lg bg-app-warning-soft px-3 py-2 text-xs text-app-warning">
          {[v.undated > 0 && (v.undated === 1 ? "לשלב אחד אין יום בנוהל" : `ל-${v.undated} שלבים אין יום בנוהל`), v.late > 0 && (v.late === 1 ? "שלב אחד אחרי הזמן המוגדר" : `${v.late} שלבים אחרי הזמן המוגדר`)]
            .filter(Boolean)
            .join(". ")}
          . אפשר להשלים בגרסה הבאה של הנוהל.
        </p>
      )}
    </div>
  );
}
