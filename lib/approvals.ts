// One screen for everything waiting on a person's approval, "אישורים"
// (Ariel, 20.10.2026). Until then there were eight kinds of manual
// approval in six places: proposals to the client file on their own
// screen, rules and exceptions and procedures inside each client's page,
// tasks behind a filter on the tasks screen, a task's plan inside the
// task, the monthly summary inside the client, the extraction guide on its
// own page. Finding out what was waiting meant opening every client.
//
// Pure: the page that lists, the nav that counts and the morning email
// all read one definition of what a tab is, what it holds and in what
// order. The rows are read in lib/app-domain/approvals.ts.

export type ApprovalKind = "task" | "exception" | "rule" | "procedure" | "knowledge" | "plan" | "summary" | "guide";

/// Not approvals: things to check, with no approve button. A tab of their
/// own, so the approval tabs stay a list of decisions.
export type ReviewKind = "uncertain" | "process_review" | "lesson" | "assignment" | "signature" | "no_next_date" | "source_confirm" | "covered_task";

export type ApprovalTab = "all" | ApprovalKind | "review";

/// The order of the tabs, most urgent first: somebody is stopped on a
/// signature, then an exception has a date, then the file itself.
export const APPROVAL_TABS: { key: ApprovalTab; label: string }[] = [
  { key: "all", label: "הכול" },
  { key: "task", label: "משימות לחתימה" },
  { key: "exception", label: "חריגות" },
  { key: "rule", label: "כללים" },
  { key: "procedure", label: "נהלים" },
  { key: "knowledge", label: "ידע מהחילוץ" },
  { key: "plan", label: "תוכניות משימה" },
  { key: "summary", label: "סיכומים ללקוח" },
  { key: "guide", label: "מדריך חילוץ" },
  { key: "review", label: "לבדיקה" },
];

/// The label beside each row in "הכול", and its colour.
export const KIND_LABELS: Record<ApprovalKind, string> = {
  task: "משימה",
  exception: "חריגה",
  rule: "כלל",
  procedure: "נוהל",
  knowledge: "ידע",
  plan: "תוכנית",
  summary: "סיכום",
  guide: "מדריך",
};

export const REVIEW_LABELS: Record<ReviewKind, string> = {
  uncertain: "לא ודאי",
  process_review: "תהליך לסקירה",
  lesson: "לקח מריצה",
  assignment: "שיחה לשיוך",
  signature: "חתימה לבדיקה",
  no_next_date: "תהליך בלי מועד הבא",
  source_confirm: "לאשר מול הלקוח",
  covered_task: "משימה שתהליך מכסה",
};

export type KindTone = "error" | "warning" | "accent" | "info" | "success" | "neutral";

export const KIND_TONES: Record<ApprovalKind | "review", KindTone> = {
  task: "error",
  exception: "warning",
  rule: "accent",
  procedure: "info",
  knowledge: "success",
  plan: "info",
  summary: "success",
  guide: "neutral",
  review: "neutral",
};

/// What a row lets the person do in place. `note` means the reject needs a
/// line of why (an exception, the guide), as on the screens they came from.
export type RowActions = {
  approve: string | null;
  reject: { label: string; note: boolean } | null;
};

export type ApprovalItem = {
  kind: ApprovalKind;
  /// The id the decision acts on: a task, an exception, a rule, a process,
  /// a summary, a guide version. A knowledge row is a batch.
  id: string;
  /// A procedure and a plan are decided by version.
  version?: number;
  clientId: string | null;
  clientName: string | null;
  title: string;
  detail?: string | null;
  /// Since when it has waited.
  since: Date;
  /// Who asked, when that is known.
  by?: string | null;
  /// The item where it lives, for the context.
  href: string;
  actions: RowActions;
  /// Why there is no approve button, when there is none on purpose: a rule
  /// that is not yet confirmed with the client.
  blocked?: string | null;
  /// How many it stands for: a knowledge batch counts its proposals.
  weight?: number;
};

export type ReviewItem = {
  kind: ReviewKind;
  id: string;
  clientId: string | null;
  clientName: string | null;
  title: string;
  detail?: string | null;
  since: Date;
  href: string;
};

/// Oldest first: what has waited longest is what to do first.
export function sortByWaiting<T extends { since: Date; title: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.since.getTime() - b.since.getTime() || a.title.localeCompare(b.title, "he"));
}

export function forClient<T extends { clientId: string | null }>(rows: T[], clientId: string | null): T[] {
  return clientId ? rows.filter((r) => r.clientId === clientId) : rows;
}

/// How many each tab holds. "הכול" is every approval, not the things to
/// check: those are not waiting on a decision. A knowledge batch counts
/// as its proposals, the way the review screen always counted.
export function tabCounts(items: ApprovalItem[], review: ReviewItem[], knowledgeTotal?: number): Record<ApprovalTab, number> {
  const out = Object.fromEntries(APPROVAL_TABS.map((t) => [t.key, 0])) as Record<ApprovalTab, number>;
  for (const i of items) out[i.kind] += i.weight ?? 1;
  if (knowledgeTotal !== undefined) out.knowledge = knowledgeTotal;
  out.all = (Object.keys(KIND_LABELS) as ApprovalKind[]).reduce((n, k) => n + out[k], 0);
  out.review = review.length;
  return out;
}

/// The tabs a person sees: "הכול" always, the rest only while they hold
/// something, plus the one asked for. A person who approves no rules never
/// sees a "כללים" tab with a zero in it.
export function visibleTabs(counts: Record<ApprovalTab, number>, active: ApprovalTab): { key: ApprovalTab; label: string; count: number }[] {
  return APPROVAL_TABS.filter((t) => t.key === "all" || t.key === active || counts[t.key] > 0).map((t) => ({ ...t, count: counts[t.key] }));
}

type Params = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : null;
}

/// `clientId`, the name the review screen always used, and `client` as an
/// alias, so a hand-typed link works too.
export function parseApprovalsParams(params: Params): { tab: ApprovalTab; clientId: string | null } {
  const tab = one(params.tab);
  return {
    tab: APPROVAL_TABS.some((t) => t.key === tab) ? (tab as ApprovalTab) : "all",
    clientId: one(params.clientId) ?? one(params.client),
  };
}

export function approvalsHref(tab: ApprovalTab, clientId: string | null): string {
  const q = new URLSearchParams();
  if (tab !== "all") q.set("tab", tab);
  if (clientId) q.set("clientId", clientId);
  const s = q.toString();
  return s ? `/app/approvals?${s}` : "/app/approvals";
}

/// "לפני 3 ימים", for a row's waiting time.
export function waitedLabel(since: Date, now: Date): string {
  const days = Math.floor((now.getTime() - since.getTime()) / 86_400_000);
  if (days <= 0) return "מהיום";
  if (days === 1) return "מאתמול";
  return `כבר ${days} ימים`;
}

/// The morning email's line, or nothing.
export function approvalsLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "דבר אחד מחכה לאישור שלך." : `${count} דברים מחכים לאישור שלך.`;
}
