// Will this process run? (Ariel, 25.10.2026: "it feels like something is
// always missing".) Until now a process showed one score out of nine, and
// a process that ran every month still read "5 מתוך 9, חסר". Two different
// questions were one number: does it run, and how well is it written down.
//
// It runs when it has an owner, says what sets it off, has an approved
// procedure (ACTIVE), and, when it runs by a date, has a date ahead of it,
// and when it is only ongoing, a check every N days.
// The first of these that is missing is the one reason shown, in red. The
// documentation is read by documentation() in lib/process-rules.ts and is
// shown quietly. Pure.

export type ReadinessInput = {
  status: string;
  ownerId: string | null;
  triggerKinds: readonly string[];
  triggerText: string | null;
  nextDate: Date | string | null;
  /// How often an ongoing process is checked. Left out by a caller that
  /// does not read it: then it is not judged.
  checkEveryDays?: number | null;
};

export type RunReadiness = { ready: boolean; blocker: string | null };

export const RUNS_LABEL = "רץ";

export const SCHEDULED_NO_DATE_BLOCKER = "לא ירוץ: תהליך לפי מועד בלי מועד";

export const CONTINUOUS_NO_CHECK_BLOCKER = "לא ירוץ: תהליך שוטף בלי תדירות בדיקה";

/// 3.11.2026 (P7 of Grantor, "every workday at 9:00"): a process in force
/// that is only ongoing opens no runs, and with no check every N days it
/// is in nobody's routine and reminds nobody. It read "רץ" and was on no
/// screen. Only when the caller read the field (undefined: not judged).
export function continuousWithoutCheck(p: { status: string; triggerKinds?: readonly string[] | null; checkEveryDays?: number | null }): boolean {
  const kinds = p.triggerKinds ?? [];
  return p.status === "ACTIVE" && kinds.length === 1 && kinds[0] === "CONTINUOUS" && p.checkEveryDays === null;
}

/// A process in force that runs by a date (SCHEDULED) with no date ahead:
/// nothing opens its next run (#318). A draft does not run anyway; it is
/// the approval that makes the missing date matter.
export function scheduledWithoutDate(p: { status: string; triggerKinds?: readonly string[] | null; nextDate?: Date | string | null }): boolean {
  return p.status === "ACTIVE" && (p.triggerKinds ?? []).includes("SCHEDULED") && !p.nextDate;
}

/// Every reason it will not run, the one to fix first leading; empty when
/// it runs (2.11.2026). The screen shows the first only, as above. Claude
/// gets them all: a process in force with no trigger written AND no date
/// read as missing one thing, while "אישורים" listed two. A process that is
/// retired or paused has that reason alone: the rest is moot until then.
export function runBlockers(p: ReadinessInput): string[] {
  if (p.status === "RETIRED") return ["לא ירוץ: התהליך בוטל"];
  if (p.status === "PAUSED") return ["לא ירוץ: התהליך מושהה"];
  const out: string[] = [];
  if (!p.ownerId) out.push("לא ירוץ: אין אחראי");
  if (p.triggerKinds.length === 0 || !p.triggerText?.trim()) out.push("לא ירוץ: לא כתוב מה מפעיל אותו");
  if (p.status !== "ACTIVE") out.push("לא ירוץ: אין נוהל מאושר");
  if (scheduledWithoutDate(p)) out.push(SCHEDULED_NO_DATE_BLOCKER);
  if (continuousWithoutCheck(p)) out.push(CONTINUOUS_NO_CHECK_BLOCKER);
  return out;
}

/// ADR 0006: each reason as a key a screen words in the reader's language
/// (clients.processes.readiness.blockers.<key>). The sentences above stay
/// what Claude, the handover check and the next steps read.
export type RunBlockerKey = "retired" | "paused" | "noOwner" | "noTrigger" | "noProcedure" | "scheduledNoDate" | "continuousNoCheck";

const BLOCKER_KEYS: Record<string, RunBlockerKey> = {
  "לא ירוץ: התהליך בוטל": "retired",
  "לא ירוץ: התהליך מושהה": "paused",
  "לא ירוץ: אין אחראי": "noOwner",
  "לא ירוץ: לא כתוב מה מפעיל אותו": "noTrigger",
  "לא ירוץ: אין נוהל מאושר": "noProcedure",
  [SCHEDULED_NO_DATE_BLOCKER]: "scheduledNoDate",
  [CONTINUOUS_NO_CHECK_BLOCKER]: "continuousNoCheck",
};

/// The key of a reason runBlockers() gave, or null for anything else.
export function runBlockerKey(blocker: string | null | undefined): RunBlockerKey | null {
  return blocker ? BLOCKER_KEYS[blocker] ?? null : null;
}

/// The one reason it will not run, the one to fix first; null when it runs.
export function runBlocker(p: ReadinessInput): string | null {
  return runBlockers(p)[0] ?? null;
}

export function runReadiness(p: ReadinessInput): RunReadiness {
  const blocker = runBlocker(p);
  return { ready: blocker === null, blocker };
}

/// "רץ", or the reason it does not.
export function readinessLabel(r: RunReadiness): string {
  return r.ready ? RUNS_LABEL : r.blocker!;
}
