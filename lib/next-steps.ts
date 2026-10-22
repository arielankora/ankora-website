// What to do next about a process, and what to recommend (Ariel,
// 22.10.2026).
//
// Until now a process card listed everything it knew at the same weight:
// the details, red lines of gaps, a box of duplicate tasks, the procedure,
// the sources. "לבדיקה" in the approvals screen did the same across
// clients, a link per line. Every line was a small investigation: what is
// wrong, what should I do, and is there a recommendation.
//
// Here every gap becomes a step: one line that says what waits, a
// recommendation with a short why, and the action that carries it out.
// The order is what stops work first: a scheduled process with no date
// opens no run, so it comes before a missing backup. Pure: the rules and
// the order are read here; lib/app-domain/process-next-steps.ts reads the
// data, and the screens only show.

import { taskCoveredBy, contentWords, sameForm } from "@/lib/process-task-overlap";

/// An action the server carries out in one click.
export type StepOp =
  | { type: "set_backup"; processId: string; userId: string }
  | { type: "link_date"; processId: string; dateId: string }
  | { type: "close_covered"; processId: string; taskIds: string[] }
  | { type: "approve_procedure"; processId: string; version: number }
  | { type: "mark_reviewed"; processId: string };

/// Where the fix is, when it is not one click: the process's own forms,
/// on its card, or the item on the client's page.
export type StepFix = { kind: "op"; op: StepOp; label: string } | { kind: "edit" | "procedure" | "dates" | "open"; label: string };

export type NextStepKind = "no_next_date" | "procedure_draft" | "review" | "covered_tasks" | "backup" | "lessons" | "missing_fields" | "no_access" | "uncertain";

export type NextStep = {
  kind: NextStepKind;
  /// What waits, in one line.
  title: string;
  /// What to do, and why, when there is something to recommend.
  recommend: string | null;
  why: string | null;
  fix: StepFix;
  /// Stops work today: no run opens until it is done.
  blocking: boolean;
};

export type BackupCandidate = { id: string; name: string; why: string };
export type DateCandidate = { id: string; title: string };

export type ProcessFacts = {
  id: string;
  code: string;
  title: string;
  purpose?: string | null;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "RETIRED";
  triggerKinds: string[];
  ownerId: string | null;
  backupOwnerId: string | null;
  hasNextDate: boolean;
  /// The newest version, when it is a draft: whether it passes its checks.
  draft: { version: number; blocked: boolean } | null;
  covered: { taskId: string; title: string }[];
  /// FIELD_LABELS of the fields still missing, "מועד הבא" and the
  /// permissions left out (they have steps of their own).
  missing: string[];
  noAccess: string[];
  /// Why it needs review, in words, and whether it is the periodic kind
  /// (marked reviewed in one click) or the rules (needs a new version).
  review: { label: string; periodic: boolean } | null;
  openLessons: number;
  knowledge: { uncertain: boolean; toResolve: string | null };
  backupCandidate: BackupCandidate | null;
  dateCandidate: DateCandidate | null;
};

const ORDER: NextStepKind[] = ["no_next_date", "procedure_draft", "review", "covered_tasks", "backup", "lessons", "uncertain", "missing_fields", "no_access"];

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many.replace("{n}", String(n));
}

/// Every step the process waits on, the one that stops work first.
/// `manager`: whether the person may carry out the steps only a manager
/// may (approve a procedure, close a task, mark a review); otherwise the
/// step leads to the process instead of a button that would fail.
export function nextSteps(p: ProcessFacts, manager: boolean): NextStep[] {
  const out: NextStep[] = [];
  const scheduled = p.triggerKinds.includes("SCHEDULED");

  if (scheduled && !p.hasNextDate && p.status !== "RETIRED") {
    const active = p.status === "ACTIVE";
    out.push({
      kind: "no_next_date",
      title: active ? "תהליך לפי מועד בלי מועד הבא: לא תיפתח ריצה" : "תהליך לפי מועד בלי מועדים",
      recommend: p.dateCandidate ? `לקשר את המועד "${p.dateCandidate.title}"` : "להוסיף לתהליך את המועדים שלו",
      why: p.dateCandidate ? "המועד כבר בתיק, ושמו מתאר את העבודה של התהליך. מקושר, הוא פותח את הריצה." : "בלי מועד מקושר אף ריצה לא נפתחת לבד.",
      fix: p.dateCandidate ? { kind: "op", op: { type: "link_date", processId: p.id, dateId: p.dateCandidate.id }, label: "לקשר" } : { kind: "dates", label: "להוסיף מועד" },
      blocking: active,
    });
  }

  if (p.draft) {
    if (p.draft.blocked) {
      out.push({
        kind: "procedure_draft",
        title: `טיוטת נוהל, גרסה ${p.draft.version}, לא עוברת את הבדיקות`,
        recommend: "לתקן את הטיוטה, ואז לאשר",
        why: "נוהל שלא עומד בכללים של הלקוח לא מאושר.",
        fix: { kind: "procedure", label: "לתקן" },
        blocking: true,
      });
    } else {
      out.push({
        kind: "procedure_draft",
        title: `טיוטת נוהל, גרסה ${p.draft.version}, מחכה לאישור`,
        recommend: manager ? "לקרוא ולאשר" : "לבקש ממנהל לאשר",
        why: p.status === "ACTIVE" ? "עד האישור הריצות ממשיכות לפי הגרסה הקודמת." : "בלי נוהל מאושר התהליך לא פותח ריצות.",
        fix: manager ? { kind: "op", op: { type: "approve_procedure", processId: p.id, version: p.draft.version }, label: "אישור הנוהל" } : { kind: "open", label: "לנוהל" },
        blocking: true,
      });
    }
  }

  if (p.review) {
    out.push({
      kind: "review",
      title: p.review.label,
      recommend: p.review.periodic ? "לקרוא את הנוהל ולסמן שנסקר" : "לכתוב גרסה חדשה, או לבקש חריגה לכלל",
      why: p.review.periodic ? "כך הנוהל נשאר נכון לאורך זמן." : "הנוהל שבתוקף לא עומד היום בכלל של הלקוח.",
      fix: p.review.periodic && manager ? { kind: "op", op: { type: "mark_reviewed", processId: p.id }, label: "סימון שנסקר" } : { kind: "procedure", label: "לנוהל" },
      blocking: false,
    });
  }

  if (p.covered.length > 0) {
    const n = p.covered.length;
    out.push({
      kind: "covered_tasks",
      title: `${plural(n, "משימה ישנה אחת כפולה", "{n} משימות ישנות כפולות")} לתהליך: ${p.covered.map((t) => `"${t.title}"`).join(", ")}`,
      recommend: plural(n, "לסגור אותה", n === 2 ? "לסגור את שתיהן" : "לסגור את כולן"),
      why: "כל ריצה של התהליך פותחת משימה משלה, אז הישנה היא אותה עבודה פעמיים.",
      fix: manager ? { kind: "op", op: { type: "close_covered", processId: p.id, taskIds: p.covered.map((t) => t.taskId) }, label: n === 1 ? "לסגור" : n === 2 ? "לסגור את שתיהן" : "לסגור את כולן" } : { kind: "open", label: "לתהליך" },
      blocking: false,
    });
  }

  if (!p.backupOwnerId && p.status !== "RETIRED") {
    out.push({
      kind: "backup",
      title: "אין מחליף: הידע אצל אדם אחד",
      recommend: p.backupCandidate ? `לקבוע את ${p.backupCandidate.name}` : "לבחור מחליף",
      why: p.backupCandidate ? p.backupCandidate.why : "אין עוד מישהו מהצוות שעובד על הלקוח.",
      fix: p.backupCandidate ? { kind: "op", op: { type: "set_backup", processId: p.id, userId: p.backupCandidate.id }, label: "לקבוע" } : { kind: "edit", label: "לבחור" },
      blocking: false,
    });
  }

  if (p.openLessons > 0) {
    out.push({
      kind: "lessons",
      title: plural(p.openLessons, "הערה אחת מריצות, לגרסה הבאה", "{n} הערות מריצות, לגרסה הבאה"),
      recommend: "להחליט על כל הערה: נכנסה לנוהל, או לא",
      why: "מי שהריץ את התהליך מצא משהו שכדאי לשנות.",
      fix: { kind: "open", label: "להערות" },
      blocking: false,
    });
  }

  if (p.knowledge.uncertain) {
    out.push({
      kind: "uncertain",
      title: "התהליך עצמו עוד לא ודאי",
      recommend: "לשאול את הלקוח",
      why: p.knowledge.toResolve ?? "לא כתוב מה יסגור את זה.",
      fix: { kind: "edit", label: "לעדכן" },
      blocking: false,
    });
  }

  if (p.missing.length > 0) {
    out.push({
      kind: "missing_fields",
      title: `חסר: ${p.missing.join(", ")}`,
      recommend: "להשלים בתהליך",
      why: "כך מי שמחליף יודע לעשות את זה בלי לשאול.",
      fix: { kind: "edit", label: "להשלים" },
      blocking: false,
    });
  }

  if (p.noAccess.length > 0) {
    out.push({
      kind: "no_access",
      title: `אין לנו גישה ל: ${p.noAccess.join(", ")}`,
      recommend: "לבקש גישה מהלקוח",
      why: "בלי גישה התהליך תלוי במישהו אחר.",
      fix: { kind: "open", label: "למערכות" },
      blocking: false,
    });
  }

  // What stops work first, then the agreed order.
  return out.sort((a, b) => Number(b.blocking) - Number(a.blocking) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

// ---------------------------------------------------------------------------
// The recommendations
// ---------------------------------------------------------------------------

/// What tells us a person already works on the client.
export type StaffSignal = {
  id: string;
  name: string;
  accountManager: boolean;
  /// Open tasks on the client assigned to them.
  openTasks: number;
  /// Processes of the client they own or back up.
  processes: string[];
  /// Processes of the client they back up, a subset of `processes`.
  backs?: string[];
  /// Runs work, rather than only managing it: not a manager, or a manager
  /// who owns or backs up a process somewhere (22.10.2026). Missing reads
  /// as an operator, as before.
  operator?: boolean;
};

/// Someone on the team who could take a process with no one else on the
/// client: an operator, by name.
export type PoolMember = { id: string; name: string };

/// What a person has to do with the client, as nouns, so the line reads
/// the same for anyone (22.10.2026: no "יש לו").
function footprint(s: StaffSignal): string[] {
  const out: string[] = [];
  if (s.accountManager) out.push("ניהול התיק");
  const owns = s.processes.filter((c) => !(s.backs ?? []).includes(c));
  if (owns.length) out.push(`בעלות על ${owns.slice(0, 3).join(", ")}`);
  if ((s.backs ?? []).length) out.push(`גיבוי של ${(s.backs ?? []).slice(0, 3).join(", ")}`);
  if (s.openTasks) out.push(s.openTasks === 1 ? "משימה פתוחה אחת" : `${s.openTasks} משימות פתוחות`);
  return out;
}

const score = (s: StaffSignal) => (s.accountManager ? 3 : 0) + Math.min(s.processes.length, 3) * 2 + Math.min(s.openTasks, 3);

/// The backup to recommend (22.10.2026, after Ariel saw himself suggested
/// everywhere): someone who runs the work, never only the manager.
///   1. Already the backup of other processes of the same client.
///   2. An operator who works on the client: account manager, processes,
///      open tasks.
///   3. Any other operator on the team, when nobody else is on the client.
///   4. A manager who works on the client, only when there is no operator.
/// The owner is never their own backup. Null when there is nobody at all.
export function recommendBackup(ownerId: string | null, staff: StaffSignal[], pool: PoolMember[] = []): BackupCandidate | null {
  const others = staff.filter((s) => s.id !== ownerId);
  const operators = others.filter((s) => s.operator !== false);
  const byScore = (rows: StaffSignal[]) =>
    rows
      .map((s) => ({ s, score: score(s) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name, "he"))
      .map((x) => x.s);

  const backing = operators.filter((s) => (s.backs ?? []).length > 0).sort((a, b) => (b.backs ?? []).length - (a.backs ?? []).length || a.name.localeCompare(b.name, "he"));
  if (backing[0]) {
    const s = backing[0];
    return { id: s.id, name: s.name, why: `${footprint(s).join(", ")} אצל אותו לקוח, ולכן הלקוח כבר מוכר.` };
  }
  const working = byScore(operators)[0];
  if (working) return { id: working.id, name: working.name, why: `${footprint(working).join(", ")} אצל הלקוח, ולכן הלקוח כבר מוכר.` };
  const onClient = new Set(staff.map((s) => s.id));
  const free = pool.filter((m) => m.id !== ownerId && !onClient.has(m.id)).sort((a, b) => a.name.localeCompare(b.name, "he"))[0];
  if (free) return { id: free.id, name: free.name, why: "אין עוד מישהו מצוות התפעול על הלקוח. בעלות על תהליכים אצל לקוחות אחרים." };
  const manager = byScore(others)[0];
  if (manager) return { id: manager.id, name: manager.name, why: `אין מישהו נוסף מצוות התפעול. ${footprint(manager).join(", ")} אצל הלקוח.` };
  return null;
}

/// A date of the client not linked to any process, whose title says it is
/// this process's: the process's code in it ("(P5)"), or most of its words
/// in the process's title or purpose. The first by title when several.
export function matchDateToProcess(process: { code: string; title: string; purpose?: string | null }, dates: { id: string; title: string }[]): DateCandidate | null {
  const code = new RegExp(`(^|[^A-Za-z0-9])${process.code}([^0-9]|$)`);
  const byCode = dates.find((d) => code.test(d.title));
  if (byCode) return { id: byCode.id, title: byCode.title };
  const byWords = dates.filter((d) => taskCoveredBy({ title: d.title }, process));
  if (byWords.length) return { id: byWords[0].id, title: byWords[0].title };
  // A short date title, one or two words, all of them in the title.
  const title = contentWords(process.title);
  const short = dates.find((d) => {
    const w = contentWords(d.title);
    return w.length > 0 && w.length <= 2 && w.every((x) => title.some((t) => sameForm(x, t)));
  });
  return short ? { id: short.id, title: short.title } : null;
}

// ---------------------------------------------------------------------------
// The order of "אישורים"
// ---------------------------------------------------------------------------

export const TODAY_SIZE = 5;
const NEAR_DAYS = 7;

export type Rankable = { since: Date; title: string; blocking?: boolean; deadline?: Date | null };

/// 0: stops work, 1: has a date within a week, 2: the rest.
export function urgency(r: Rankable, now: Date): 0 | 1 | 2 {
  if (r.blocking) return 0;
  if (r.deadline && r.deadline.getTime() - now.getTime() <= NEAR_DAYS * 86_400_000) return 1;
  return 2;
}

/// What stops work first, then what has a date soon (the nearest first),
/// then what has waited longest. The first five are "היום".
export function rankApprovals<T extends Rankable>(rows: T[], now: Date): { today: T[]; rest: T[] } {
  const sorted = [...rows].sort((a, b) => {
    const ua = urgency(a, now);
    const ub = urgency(b, now);
    if (ua !== ub) return ua - ub;
    if (ua === 1) return a.deadline!.getTime() - b.deadline!.getTime();
    return a.since.getTime() - b.since.getTime() || a.title.localeCompare(b.title, "he");
  });
  return { today: sorted.slice(0, TODAY_SIZE), rest: sorted.slice(TODAY_SIZE) };
}
