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
// opens no run, so it comes first. 22.10.2026: the backup is no longer a
// step (Ariel: with two operators it said the same thing on every card;
// what lets someone else step in is an approved procedure and access).
// Pure: the rules and
// the order are read here; lib/app-domain/process-next-steps.ts reads the
// data, and the screens only show.

import { taskCoveredBy, contentWords, sameForm } from "@/lib/process-task-overlap";
import { SCHEDULED_NO_DATE_BLOCKER } from "@/lib/process-readiness";

/// An action the server carries out in one click.
export type StepOp =
  | { type: "link_date"; processId: string; dateId: string }
  | { type: "close_covered"; processId: string; taskIds: string[] }
  | { type: "approve_procedure"; processId: string; version: number }
  | { type: "mark_reviewed"; processId: string }
  // 25.10.2026: a documentation field not relevant to this process, and a
  // system or a contact its own words name, linked in one click.
  | { type: "mark_not_applicable"; processId: string; field: string }
  | { type: "link_system"; processId: string; systemId: string }
  | { type: "link_contact"; processId: string; contactId: string };

/// Where the fix is, when it is not one click: the process's own forms,
/// on its card, or the item on the client's page.
export type StepFix = { kind: "op"; op: StepOp; label: string } | { kind: "edit" | "procedure" | "dates" | "open"; label: string };

export type NextStepKind =
  | "not_ready"
  | "no_next_date"
  | "procedure_draft"
  | "review"
  | "covered_tasks"
  | "lessons"
  | "link_mention"
  | "missing_fields"
  | "doc_field"
  | "no_access"
  | "uncertain";

export type NextStep = {
  kind: NextStepKind;
  /// What waits, in one line.
  title: string;
  /// What to do, and why, when there is something to recommend.
  recommend: string | null;
  why: string | null;
  fix: StepFix;
  /// A second way out, quieter: "לא רלוונטי" on a documentation field.
  alt?: StepFix;
  /// Stops work today: no run opens until it is done.
  blocking: boolean;
  /// Its own key, when a kind repeats on one process (one row per field).
  key?: string;
};

export type DateCandidate = { id: string; title: string };

export type ProcessFacts = {
  id: string;
  code: string;
  title: string;
  purpose?: string | null;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "RETIRED";
  triggerKinds: string[];
  ownerId: string | null;
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
  dateCandidate: DateCandidate | null;
  /// 25.10.2026: why it will not run, when it will not
  /// (lib/process-readiness.ts).
  readiness?: { ready: boolean; blocker: string | null };
  /// The documentation fields still missing, each its own quiet row with
  /// "לא רלוונטי" beside it. When given, it replaces `missing`.
  doc?: { field: string; label: string }[];
  /// Systems and contacts its own words name and it does not link yet.
  suggestions?: { systems: { id: string; name: string }[]; contacts: { id: string; name: string }[] };
  /// Whether this person may mark a field not relevant (a manager or the
  /// process's owner).
  canMarkNotApplicable?: boolean;
};

const ORDER: NextStepKind[] = ["not_ready", "no_next_date", "procedure_draft", "review", "covered_tasks", "lessons", "uncertain", "link_mention", "missing_fields", "doc_field", "no_access"];

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

  // Why it will not run, when the steps below do not already say it: no
  // owner, nothing that sets it off, or no procedure written yet.
  const blocker = p.readiness && !p.readiness.ready ? p.readiness.blocker : null;
  const saidBelow = (scheduled && !p.hasNextDate) || !!p.draft;
  if (blocker && !saidBelow) {
    const noOwnerOrTrigger = /אחראי|מפעיל/.test(blocker);
    const noProcedure = /נוהל/.test(blocker);
    out.push({
      kind: "not_ready",
      title: blocker,
      recommend: noOwnerOrTrigger ? (/אחראי/.test(blocker) ? "לקבוע מי אחראי" : "לכתוב מה מפעיל את התהליך") : noProcedure ? "לכתוב את הנוהל ולשלוח לאישור" : "להחליט אם לחדש אותו",
      why: "עד אז התהליך לא פותח ריצות לבד.",
      fix: noOwnerOrTrigger ? { kind: "edit", label: "להשלים" } : noProcedure ? { kind: "procedure", label: "לכתוב נוהל" } : { kind: "open", label: "לתהליך" },
      blocking: true,
    });
  }

  if (scheduled && !p.hasNextDate && p.status !== "RETIRED") {
    const active = p.status === "ACTIVE";
    out.push({
      kind: "no_next_date",
      title: active ? SCHEDULED_NO_DATE_BLOCKER : "תהליך לפי מועד בלי מועדים",
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

  for (const x of p.suggestions?.systems ?? []) {
    out.push({
      kind: "link_mention",
      key: `system:${x.id}`,
      title: `${x.name} מוזכרת בתהליך ולא מקושרת`,
      recommend: "לקשר את המערכת",
      why: "כך התהליך יודע לאיזו מערכת צריך גישה.",
      fix: { kind: "op", op: { type: "link_system", processId: p.id, systemId: x.id }, label: "לקשר" },
      blocking: false,
    });
  }
  for (const x of p.suggestions?.contacts ?? []) {
    out.push({
      kind: "link_mention",
      key: `contact:${x.id}`,
      title: `${x.name} מוזכר/ת בתהליך ולא מקושר/ת כגורם חיצוני`,
      recommend: "לקשר כגורם חיצוני",
      why: "כך ברור מי בחוץ שותף לתהליך.",
      fix: { kind: "op", op: { type: "link_contact", processId: p.id, contactId: x.id }, label: "לקשר" },
      blocking: false,
    });
  }

  if (p.doc) {
    // Quiet: how well it is written down, never what stops it.
    for (const f of p.doc) {
      out.push({
        kind: "doc_field",
        key: f.field,
        title: `תיעוד: חסר ${f.label}`,
        recommend: null,
        why: null,
        fix: { kind: "edit", label: "להשלים" },
        ...(p.canMarkNotApplicable && f.field !== "permissions" ? { alt: { kind: "op" as const, op: { type: "mark_not_applicable" as const, processId: p.id, field: f.field }, label: "לא רלוונטי" } } : {}),
        blocking: false,
      });
    }
  } else if (p.missing.length > 0) {
    out.push({
      kind: "missing_fields",
      title: `חסר: ${p.missing.join(", ")}`,
      recommend: "להשלים בתהליך",
      why: "כך כל מי שנכנס לתהליך יודע לעשות אותו בלי לשאול.",
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
