// A process drawn rather than listed (task cmvtitlhs0001js08dzotqd6r,
// 31.10.2026, prototype): a band of the days something happens on, and
// under it the procedure's steps grouped by their business day. Pure, so
// the screen and the tests read a process the same way. Nothing here is
// new data: the days come from each step's offsetBusinessDays and the
// process's slaBusinessDays.

import { STEP_MODE_LABELS, TRIGGER_LABELS, type ProcessStep, type StepModeLike, type TriggerLike } from "@/lib/process-rules";

export type VisualInput = {
  triggerKinds: TriggerLike[];
  triggerText: string | null;
  slaBusinessDays: number | null;
  steps: ProcessStep[];
};

export type VisualTick = {
  day: number;
  /// What happens that day, in the order a reader needs it.
  marks: ("start" | "steps" | "sla" | "late")[];
  stepCount: number;
};

export type VisualStep = {
  /// 1-based, as the procedure numbers it.
  n: number;
  title: string;
  mode: StepModeLike;
  modeLabel: string;
  requiresApproval: boolean;
  verification: string | null;
  output: string | null;
  /// After the time the process allows (slaBusinessDays).
  late: boolean;
};

export type VisualGroup = { day: number | null; steps: VisualStep[] };

export type ProcessVisual = {
  /// "כשמשהו קורה: פתיחת משתמש..." or the kinds alone.
  startLabel: string;
  /// What day 0 is: the date itself for a process that runs by one,
  /// otherwise the moment it starts.
  dayZeroLabel: "המועד" | "התחלה";
  sla: number | null;
  ticks: VisualTick[];
  groups: VisualGroup[];
  /// Steps with no business day: drawn apart, as a gap.
  undated: number;
  late: number;
};

export function dayLabel(day: number): string {
  if (day === 0) return "יום 0";
  return day > 0 ? `יום ${day}` : `${-day} ימים לפני`;
}

export function buildProcessVisual(input: VisualInput): ProcessVisual {
  const sla = input.slaBusinessDays !== null && input.slaBusinessDays >= 0 ? input.slaBusinessDays : null;
  const kinds = input.triggerKinds.map((k) => TRIGGER_LABELS[k]).join(", ");
  const text = input.triggerText?.trim() ?? "";
  const startLabel = [kinds, text].filter(Boolean).join(": ") || "לא כתוב מה מפעיל אותו";

  const steps: (VisualStep & { day: number | null })[] = input.steps.map((st, i) => ({
    n: i + 1,
    title: st.title,
    mode: st.mode,
    modeLabel: STEP_MODE_LABELS[st.mode],
    requiresApproval: st.requiresApproval,
    verification: st.verification,
    output: st.output,
    day: st.offsetBusinessDays,
    late: sla !== null && st.offsetBusinessDays !== null && st.offsetBusinessDays > sla,
  }));

  // Groups keep the procedure's order inside a day; days ascend, and the
  // steps with no day come last.
  const byDay = new Map<number | null, VisualStep[]>();
  for (const { day, ...st } of steps) {
    const list = byDay.get(day) ?? [];
    list.push(st);
    byDay.set(day, list);
  }
  const days = [...byDay.keys()].filter((d): d is number => d !== null).sort((a, b) => a - b);
  const groups: VisualGroup[] = days.map((day) => ({ day, steps: byDay.get(day)! }));
  if (byDay.has(null)) groups.push({ day: null, steps: byDay.get(null)! });

  // The band shows only the days something happens on: the start, every
  // day a step falls on, and the last day the process allows.
  const tickDays = new Set<number>([0, ...days]);
  if (sla !== null) tickDays.add(sla);
  const ticks: VisualTick[] = [...tickDays]
    .sort((a, b) => a - b)
    .map((day) => {
      const stepCount = byDay.get(day)?.length ?? 0;
      const marks: VisualTick["marks"] = [];
      if (day === 0) marks.push("start");
      if (stepCount > 0) marks.push("steps");
      if (sla !== null && day === sla) marks.push("sla");
      if (sla !== null && day > sla && stepCount > 0) marks.push("late");
      return { day, marks, stepCount };
    });

  return {
    startLabel,
    dayZeroLabel: input.triggerKinds.includes("SCHEDULED") ? "המועד" : "התחלה",
    sla,
    ticks,
    groups,
    undated: byDay.get(null)?.length ?? 0,
    late: steps.filter((s) => s.late).length,
  };
}
