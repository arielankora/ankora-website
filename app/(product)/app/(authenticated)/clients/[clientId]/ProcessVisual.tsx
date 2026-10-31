"use client";
import { useSyncExternalStore } from "react";
import { buildProcessVisual, dayLabel, type VisualInput, type VisualTick } from "@/lib/process-visual";

// The approved procedure drawn inside the process card (task
// cmvwnr5aw0006jm08tfvrup34, 31.10.2026): a band of the days something
// happens on, and under it a column of steps per day. It is the card's
// default view; "טקסט" switches every card back to the list, and the choice
// is kept in this browser. Read only: it draws what the process holds and
// marks what it lacks.

export type ProcessView = "visual" | "text";
const VIEW_KEY = "ankora:process-view";
const VIEW_EVENT = "ankora:process-view";

function readView(): ProcessView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "text" ? "text" : "visual";
  } catch {
    return "visual";
  }
}

/// The view every process card shows. One choice for all cards, kept per
/// browser, so whoever prefers the list keeps it.
let fallback: ProcessView | null = null;

function subscribe(onChange: () => void) {
  window.addEventListener(VIEW_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(VIEW_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useProcessView(): [ProcessView, (v: ProcessView) => void] {
  const view = useSyncExternalStore(subscribe, () => fallback ?? readView(), () => "visual" as ProcessView);
  const choose = (v: ProcessView) => {
    try {
      window.localStorage.setItem(VIEW_KEY, v);
      fallback = null;
    } catch {
      // Storage refused: the choice holds until the page reloads.
      fallback = v;
    }
    window.dispatchEvent(new Event(VIEW_EVENT));
  };
  return [view, choose];
}

export function ViewSwitch({ view, onChange }: { view: ProcessView; onChange: (v: ProcessView) => void }) {
  const item = (v: ProcessView, label: string) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      aria-pressed={view === v}
      className={`rounded-md px-2.5 py-1 text-[12px] ${view === v ? "bg-app-surface-card font-medium text-app-text-primary shadow-sm" : "text-app-text-secondary hover:text-app-text-primary"}`}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="תצוגת התהליך" className="inline-flex gap-0.5 rounded-lg bg-app-surface-sunken p-0.5" data-testid="process-view-switch">
      {item("visual", "תרשים")}
      {item("text", "טקסט")}
    </div>
  );
}

const TICK_STYLE: Record<VisualTick["marks"][number], string> = {
  start: "border-app-info bg-app-info",
  steps: "border-app-text-secondary bg-app-surface-card",
  sla: "border-app-success bg-app-success",
  late: "border-app-warning bg-app-warning",
};

function tickText(t: VisualTick, dayZero: string, date: string | null): string[] {
  const out: string[] = [];
  if (t.marks.includes("start")) out.push(date ? `${dayZero}: ${date}` : dayZero);
  if (t.stepCount > 0) out.push(t.stepCount === 1 ? "שלב אחד" : `${t.stepCount} שלבים`);
  if (t.marks.includes("sla")) out.push("סוף הזמן המוגדר");
  if (t.marks.includes("late")) out.push("אחרי הזמן המוגדר");
  return out;
}

const COLS: Record<number, string> = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" };

export function ProcessVisual({ nextDate, ...input }: VisualInput & { nextDate?: string | null }) {
  const v = buildProcessVisual(input);
  if (input.steps.length === 0) return null;
  const next = nextDate && v.dayZeroLabel === "המועד" ? new Date(nextDate).toLocaleDateString("he-IL") : null;
  return (
    <div className="mt-3 space-y-3" data-testid="process-visual">
      <div className="overflow-x-auto pb-1">
        <ol
          className="relative grid gap-2 before:absolute before:inset-x-6 before:top-[7px] before:h-0.5 before:bg-app-border"
          style={{ gridTemplateColumns: `repeat(${v.ticks.length}, minmax(5.5rem, 1fr))` }}
          aria-label="ימי העסקים של התהליך"
        >
          {v.ticks.map((t) => {
            const mark = t.marks.includes("start") ? "start" : t.marks.includes("sla") ? "sla" : t.marks.includes("late") ? "late" : "steps";
            return (
              <li key={t.day} className="relative flex flex-col items-center gap-0.5 px-1 text-center">
                <span className={`z-[1] h-4 w-4 rounded-full border-2 ${TICK_STYLE[mark]}`} aria-hidden />
                <span className="text-xs font-bold tabular-nums text-app-text-primary">{dayLabel(t.day)}</span>
                {tickText(t, v.dayZeroLabel, next).map((line) => (
                  <span key={line} className="line-clamp-2 text-[11px] leading-tight text-app-text-secondary">
                    {line}
                  </span>
                ))}
              </li>
            );
          })}
        </ol>
      </div>

      <div className={`grid items-start gap-2.5 ${COLS[Math.min(v.groups.length, 4)] ?? COLS[4]}`}>
        {v.groups.map((g) => (
          <section
            key={g.day ?? "none"}
            className={`min-w-0 space-y-1.5 rounded-xl p-2 ${g.day === null ? "border border-dashed border-app-warning bg-app-warning-soft" : "bg-app-surface-sunken"}`}
          >
            <h4 className={`px-1 text-[11px] font-bold ${g.day === null ? "text-app-warning" : "text-app-text-secondary"}`}>
              {g.day === null ? "בלי יום בנוהל" : dayLabel(g.day)}
            </h4>
            <ol className="space-y-1.5">
              {g.steps.map((st) => (
                <li key={st.n} className="flex items-start gap-2 rounded-lg border border-app-border bg-app-surface-card px-2.5 py-2">
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 text-[11px] font-bold tabular-nums ${
                      st.mode === "MANUAL" ? "border-app-text-tertiary text-app-text-secondary" : "border-app-accent text-app-text-accent"
                    }`}
                  >
                    {st.n}
                  </span>
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-medium leading-snug text-app-text-primary">{st.title}</p>
                    <div className="flex flex-wrap gap-1 text-[10.5px]">
                      <span className={`rounded-full px-1.5 py-0.5 ${st.mode === "MANUAL" ? "bg-app-neutral-soft text-app-text-secondary" : "bg-app-accent-soft text-app-text-accent"}`}>
                        {st.modeLabel}
                      </span>
                      {st.requiresApproval && <span className="rounded-full bg-app-warning-soft px-1.5 py-0.5 text-app-warning">דורש אישור</span>}
                      {st.late && <span className="rounded-full bg-app-warning-soft px-1.5 py-0.5 text-app-warning">אחרי הזמן המוגדר</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
