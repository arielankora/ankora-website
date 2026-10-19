// How we know the org brain works (claude/org-brain-spec-2026-10-12.md,
// section 11): one row per client, and one for all of them, each measure
// beside its first target. Pure, so the screen and the tests read the same
// numbers.
//
// Each measure says what it counts, because a number nobody can explain
// is not a measure. Where the product cannot see the thing itself (how
// long a person spent on a batch), the closest honest proxy is used and
// named as such.

export const UNCERTAIN_STALE_DAYS = 14;
export const COVERAGE_WINDOW_DAYS = 60;
export const RUNS_WINDOW_DAYS = 90;
export const BATCH_WINDOW_DAYS = 30;

const DAY = 86_400_000;

export type ClientMetricsInput = {
  clientId: string;
  clientName: string;
  processes: { status: string; transitionStatus: string; backupOwnerId: string | null; completeness: number }[];
  /// When each item of the file now "uncertain" last changed.
  uncertainSince: Date[];
  systems: { accessStatus: string }[];
  /// Tasks opened by the daily job in the window: from a date, or as a run.
  autoTasks: { processId: string | null }[];
  /// Runs of a process closed in the window.
  runs: { dueDate: Date | null; completedAt: Date | null }[];
  pendingProposalsSince: Date[];
  /// Batches whose proposals were all decided in the window: when the
  /// first and the last decision were made.
  decidedBatches: { firstDecidedAt: Date; lastDecidedAt: Date }[];
};

export type Measure = {
  key: string;
  label: string;
  /// What it counts, in a sentence.
  about: string;
  target: string;
  value: number | null;
  display: string;
  /// Against the target: met, not met, or nothing to measure yet.
  state: "ok" | "off" | "none";
};

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : null);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/// The end of the due day in Israel, so a run closed that evening is on time.
function endOfDueDay(d: Date): number {
  return d.getTime() + DAY + 3 * 3_600_000;
}

export function measures(input: Omit<ClientMetricsInput, "clientId" | "clientName">, now: Date): Measure[] {
  const live = input.processes.filter((p) => p.status !== "RETIRED");
  const planned = live.filter((p) => p.transitionStatus !== "NOT_PLANNED");
  const avg = live.length ? Math.round((live.reduce((a, p) => a + p.completeness, 0) / live.length) * 10) / 10 : null;
  const noBackup = live.filter((p) => !p.backupOwnerId).length;
  const stale = input.uncertainSince.filter((d) => now.getTime() - d.getTime() > UNCERTAIN_STALE_DAYS * DAY).length;
  const noAccess = input.systems.filter((s) => s.accessStatus === "NO_ACCESS" || s.accessStatus === "PENDING").length;
  const fromProcess = input.autoTasks.filter((t) => t.processId).length;
  const coverage = pct(fromProcess, input.autoTasks.length);
  const withAnkora = pct(planned.filter((p) => p.transitionStatus === "WITH_ANKORA").length, planned.length);
  const spans = input.decidedBatches.map((b) => (b.lastDecidedAt.getTime() - b.firstDecidedAt.getTime()) / 60_000);
  const batchMinutes = median(spans);
  const oldest = input.pendingProposalsSince.length ? Math.floor((now.getTime() - Math.min(...input.pendingProposalsSince.map((d) => d.getTime()))) / DAY) : null;
  const dueRuns = input.runs.filter((r) => r.dueDate && r.completedAt);
  const onTime = pct(dueRuns.filter((r) => r.completedAt!.getTime() <= endOfDueDay(r.dueDate!)).length, dueRuns.length);

  const m = (key: string, label: string, about: string, target: string, value: number | null, display: string, ok: (v: number) => boolean): Measure => ({
    key,
    label,
    about,
    target,
    value,
    display: value === null ? "אין עדיין" : display,
    state: value === null ? "none" : ok(value) ? "ok" : "off",
  });
  return [
    m("completeness", "שלמות תהליכים", "ממוצע תשעת השדות של כל תהליך פעיל.", "8 מתוך 9", avg, `${avg} מתוך 9`, (v) => v >= 8),
    m("coverage", "משימות שנפתחו מתהליך", `מהמשימות שהמערכת פתחה לבד ב-${COVERAGE_WINDOW_DAYS} הימים האחרונים, כמה היו ריצה של תהליך ולא מועד בלבד.`, "60%", coverage, `${coverage}%`, (v) => v >= 60),
    m("noBackup", "תהליכים בלי מחליף", "תהליכים פעילים שהידע עליהם אצל אדם אחד.", "0", live.length ? noBackup : null, String(noBackup), (v) => v === 0),
    m("staleUncertain", `לא ודאי מעל ${UNCERTAIN_STALE_DAYS} יום`, `פריטים בתיק שמסומנים לא ודאיים ולא השתנו ${UNCERTAIN_STALE_DAYS} יום.`, "יורד מחודש לחודש", stale, String(stale), (v) => v === 0),
    m("noAccess", "מערכות בלי גישה", "מערכות במפה שאין לנו אליהן גישה, או שהיא ממתינה. מדד ההתקדמות של החפיפה.", "יורד", input.systems.length ? noAccess : null, String(noAccess), (v) => v === 0),
    m("withAnkora", "תהליכים אצלנו", "מהתהליכים שמתוכננים לעבור אלינו, כמה כבר אצלנו.", "100% עד 31.12.2026", withAnkora, `${withAnkora}%`, (v) => v >= 100),
    m("batchMinutes", "זמן אישור לאצווה", `חציון הזמן בין ההחלטה הראשונה לאחרונה באצווה, ב-${BATCH_WINDOW_DAYS} הימים האחרונים. קירוב: הזמן שבו מישהו עבר עליה.`, "פחות מ-5 דקות", batchMinutes === null ? null : Math.round(batchMinutes * 10) / 10, `${Math.round((batchMinutes ?? 0) * 10) / 10} דק׳`, (v) => v < 5),
    m("oldestProposal", "ההצעה הוותיקה בתיבה", "כמה ימים מחכה ההצעה הוותיקה שעוד לא הוחלט עליה.", "פחות מ-3 ימים", oldest, `${oldest} ימים`, (v) => v < 3),
    m("onTime", "ריצות בזמן", `מהריצות שנסגרו ב-${RUNS_WINDOW_DAYS} הימים האחרונים, כמה נסגרו עד יום היעד.`, "95%", onTime, `${onTime}%`, (v) => v >= 95),
  ];
}

export type MetricsReport = {
  all: Measure[];
  clients: { clientId: string; clientName: string; measures: Measure[] }[];
};

export function metricsReport(clients: ClientMetricsInput[], now: Date): MetricsReport {
  const merged: Omit<ClientMetricsInput, "clientId" | "clientName"> = {
    processes: clients.flatMap((c) => c.processes),
    uncertainSince: clients.flatMap((c) => c.uncertainSince),
    systems: clients.flatMap((c) => c.systems),
    autoTasks: clients.flatMap((c) => c.autoTasks),
    runs: clients.flatMap((c) => c.runs),
    pendingProposalsSince: clients.flatMap((c) => c.pendingProposalsSince),
    decidedBatches: clients.flatMap((c) => c.decidedBatches),
  };
  return {
    all: measures(merged, now),
    clients: clients.map((c) => ({ clientId: c.clientId, clientName: c.clientName, measures: measures(c, now) })),
  };
}
