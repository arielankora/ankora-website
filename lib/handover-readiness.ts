// Is a client ready to be run by Ankora? (spec 3.9 and section 11: "every
// process planned to move to us, with us"). Pure. For each process that is
// planned to move, the four things that have to be true before the person
// who does it today can leave, and what is still missing. The client's
// screen, a meeting with the client and Claude read the same answer.
// 22.10.2026: a backup is no longer one of them (Ariel): what lets someone
// step in is the approved procedure and the access, both checked here.

export type ReadinessSystem = { id: string; name: string; accessStatus: string; permission: string | null };

export type ReadinessProcessInput = {
  id: string;
  code: string;
  title: string;
  status: string;
  transitionStatus: string;
  ownerId: string | null;
  executor: string | null;
  hasApprovedProcedure: boolean;
  /// 25.10.2026: why it will not run, null when it runs
  /// (lib/process-readiness.ts). Without it, an approved procedure is
  /// taken as running.
  runBlocker?: string | null;
  /// How well it is written down, less the fields not relevant. Shown,
  /// never what makes it not ready.
  documentation: { score: number; of: number };
  systems: ReadinessSystem[];
};

export type ReadinessCheckKey = "runs" | "access" | "withUs" | "complete";

/// 25.10.2026: "רץ" replaces "נוהל מאושר" (owner, trigger, an approved
/// procedure and a date when it runs by one), and the documentation is
/// shown but no longer decides whether a process is ready.
export const READINESS_CHECKS: { key: ReadinessCheckKey; label: string }[] = [
  { key: "runs", label: "רץ" },
  { key: "access", label: "גישה לכל המערכות" },
  { key: "withUs", label: "אצלנו" },
  { key: "complete", label: "תיעוד מלא" },
];

/// The checks that decide whether a process is ready.
const DECIDING: ReadinessCheckKey[] = ["runs", "access", "withUs"];

export type ReadinessProcess = ReadinessProcessInput & {
  checks: Record<ReadinessCheckKey, boolean>;
  ready: boolean;
  /// What is missing, in words a person acts on.
  missing: string[];
};

export type Readiness = {
  processes: ReadinessProcess[];
  ready: number;
  total: number;
  /// Systems a planned process needs and we cannot get into, once each.
  systemsWithoutAccess: ReadinessSystem[];
  /// Processes not planned to move, by name: not counted, but not hidden.
  notPlanned: string[];
};

const HAS_ACCESS = (s: ReadinessSystem) => s.accessStatus === "HAS_ACCESS" || s.accessStatus === "NOT_NEEDED";

export function readinessOf(input: ReadinessProcessInput[]): Readiness {
  const live = input.filter((p) => p.status !== "RETIRED");
  const planned = live.filter((p) => p.transitionStatus !== "NOT_PLANNED");
  const processes = planned.map((p): ReadinessProcess => {
    const noAccess = p.systems.filter((s) => !HAS_ACCESS(s));
    const blocker = p.runBlocker !== undefined ? p.runBlocker : p.hasApprovedProcedure ? null : "לא ירוץ: אין נוהל מאושר";
    const checks: Record<ReadinessCheckKey, boolean> = {
      runs: blocker === null,
      access: noAccess.length === 0,
      withUs: p.transitionStatus === "WITH_ANKORA",
      complete: p.documentation.score >= p.documentation.of,
    };
    const missing = [
      blocker && `${blocker}.`,
      !checks.access && `אין לנו גישה ל: ${noAccess.map((s) => (s.permission ? `${s.name} (${s.permission})` : s.name)).join(", ")}.`,
      !checks.withUs && `עוד לא אצלנו${p.executor ? `: היום מבצע ${p.executor}` : ""}.`,
    ].filter((x): x is string => !!x);
    return { ...p, checks, ready: DECIDING.every((k) => checks[k]), missing };
  });
  const seen = new Set<string>();
  const systemsWithoutAccess: ReadinessSystem[] = [];
  for (const p of planned) for (const s of p.systems) if (!HAS_ACCESS(s) && !seen.has(s.id)) (seen.add(s.id), systemsWithoutAccess.push(s));
  // The least ready first: that is where the work is.
  processes.sort((a, b) => b.missing.length - a.missing.length || a.code.localeCompare(b.code, undefined, { numeric: true }));
  return {
    processes,
    ready: processes.filter((p) => p.ready).length,
    total: processes.length,
    systemsWithoutAccess,
    notPlanned: live.filter((p) => p.transitionStatus === "NOT_PLANNED").map((p) => `${p.code} ${p.title}`),
  };
}

/// One line for the top of the screen.
export function readinessLine(r: Readiness): string {
  if (r.total === 0) return "אין עדיין תהליכים שמתוכננים לעבור אלינו.";
  if (r.ready === r.total) return r.total === 1 ? "התהליך מוכן: אפשר להעביר אותו אלינו." : `כל ${r.total} התהליכים מוכנים.`;
  return `${r.ready} מתוך ${r.total} תהליכים מוכנים${r.systemsWithoutAccess.length ? `, ${r.systemsWithoutAccess.length === 1 ? "ומערכת אחת" : `ו-${r.systemsWithoutAccess.length} מערכות`} בלי גישה` : ""}.`;
}
