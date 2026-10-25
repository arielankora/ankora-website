// Will this process run? (Ariel, 25.10.2026: "it feels like something is
// always missing".) Until now a process showed one score out of nine, and
// a process that ran every month still read "5 מתוך 9, חסר". Two different
// questions were one number: does it run, and how well is it written down.
//
// It runs when it has an owner, says what sets it off, has an approved
// procedure (ACTIVE), and, when it runs by a date, has a date ahead of it.
// The first of these that is missing is the one reason shown, in red. The
// documentation is read by documentation() in lib/process-rules.ts and is
// shown quietly. Pure.

export type ReadinessInput = {
  status: string;
  ownerId: string | null;
  triggerKinds: readonly string[];
  triggerText: string | null;
  nextDate: Date | string | null;
};

export type RunReadiness = { ready: boolean; blocker: string | null };

export const RUNS_LABEL = "רץ";

export const SCHEDULED_NO_DATE_BLOCKER = "לא ירוץ: תהליך לפי מועד בלי מועד";

/// A process in force that runs by a date (SCHEDULED) with no date ahead:
/// nothing opens its next run (#318). A draft does not run anyway; it is
/// the approval that makes the missing date matter.
export function scheduledWithoutDate(p: { status: string; triggerKinds?: readonly string[] | null; nextDate?: Date | string | null }): boolean {
  return p.status === "ACTIVE" && (p.triggerKinds ?? []).includes("SCHEDULED") && !p.nextDate;
}

/// The one reason it will not run, the one to fix first; null when it runs.
export function runBlocker(p: ReadinessInput): string | null {
  if (p.status === "RETIRED") return "לא ירוץ: התהליך בוטל";
  if (p.status === "PAUSED") return "לא ירוץ: התהליך מושהה";
  if (!p.ownerId) return "לא ירוץ: אין אחראי";
  if (p.triggerKinds.length === 0 || !p.triggerText?.trim()) return "לא ירוץ: לא כתוב מה מפעיל אותו";
  if (p.status !== "ACTIVE") return "לא ירוץ: אין נוהל מאושר";
  if (scheduledWithoutDate(p)) return SCHEDULED_NO_DATE_BLOCKER;
  return null;
}

export function runReadiness(p: ReadinessInput): RunReadiness {
  const blocker = runBlocker(p);
  return { ready: blocker === null, blocker };
}

/// "רץ", or the reason it does not.
export function readinessLabel(r: RunReadiness): string {
  return r.ready ? RUNS_LABEL : r.blocker!;
}
