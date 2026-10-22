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

import type { ApprovalPreview } from "@/lib/approvals-preview";
import type { StepOp } from "@/lib/next-steps";

/// 22.10.2026: "process" holds a process's decisions (a date to link, a
/// backup to set, duplicate tasks to close, a review), and "check" what an
/// admin checks (a signed PDF). What used to be "לבדיקה", items not yet
/// confirmed, is no longer a decision of the manager's: it is the file
/// owner's "שאלות ללקוח" (lib/client-questions.ts).
///
/// "internal" (22.10.2026): items of Ankora's own file, uncertain only
/// because Ankora wrote them. There Ankora is the client, so they are a
/// manager's decision, not a question to a client.
export type ApprovalKind = "task" | "exception" | "rule" | "procedure" | "process" | "internal" | "knowledge" | "plan" | "summary" | "guide" | "check";

export type ApprovalTab = "all" | ApprovalKind | "questions";

/// The order of the tabs, most urgent first: somebody is stopped on a
/// signature, then an exception has a date, then the file itself. The
/// questions last: they are work, not decisions, and not in the count.
export const APPROVAL_TABS: { key: ApprovalTab; label: string }[] = [
  { key: "all", label: "הכול" },
  { key: "task", label: "משימות לחתימה" },
  { key: "exception", label: "חריגות" },
  { key: "rule", label: "כללים" },
  { key: "procedure", label: "נהלים" },
  { key: "process", label: "תהליכים" },
  { key: "internal", label: "תיק פנימי" },
  { key: "knowledge", label: "ידע מהחילוץ" },
  { key: "plan", label: "תוכניות משימה" },
  { key: "summary", label: "סיכומים ללקוח" },
  { key: "guide", label: "מדריך חילוץ" },
  { key: "check", label: "לבדיקה" },
  { key: "questions", label: "שאלות ללקוח" },
];

/// The label beside each row in "הכול", and its colour.
export const KIND_LABELS: Record<ApprovalKind, string> = {
  task: "משימה",
  exception: "חריגה",
  rule: "כלל",
  procedure: "נוהל",
  process: "תהליך",
  internal: "תיק פנימי",
  knowledge: "ידע",
  plan: "תוכנית",
  summary: "סיכום",
  guide: "מדריך",
  check: "לבדיקה",
};

export type KindTone = "error" | "warning" | "accent" | "info" | "success" | "neutral";

export const KIND_TONES: Record<ApprovalKind, KindTone> = {
  task: "error",
  exception: "warning",
  rule: "accent",
  procedure: "info",
  process: "warning",
  internal: "neutral",
  knowledge: "success",
  plan: "info",
  summary: "success",
  guide: "neutral",
  check: "neutral",
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
  /// a summary, a guide version. A knowledge row is a batch. A process
  /// decision is "<processId>:<step>".
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
  /// What it says in full, to read before deciding: a procedure's steps
  /// and checks, a rule's whole text, a plan.
  preview?: ApprovalPreview | null;
  /// 22.10.2026: what to do, and why, on every row.
  recommend?: { text: string; why: string | null } | null;
  /// A process decision carried out in one click (lib/next-steps.ts).
  op?: StepOp | null;
  /// A decision whose fix is somewhere else: the button leads there.
  go?: { label: string; href: string } | null;
  /// Stops work until decided: a procedure waiting, a scheduled process
  /// without a date. First in "היום".
  blocking?: boolean;
  /// A date it is tied to: the task's due date, the process's next run.
  deadline?: Date | null;
  /// A knowledge batch: false when it waits on someone else (whoever sent
  /// it, the account manager). Out of the count and "היום", on screen
  /// under "של כולם" and with a client chosen (22.10.2026).
  mine?: boolean;
};

/// What waits on the person: everything but other people's meetings.
export function onlyMine<T extends { mine?: boolean }>(items: T[]): T[] {
  return items.filter((i) => i.mine !== false);
}

/// Oldest first: what has waited longest is what to do first.
export function sortByWaiting<T extends { since: Date; title: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.since.getTime() - b.since.getTime() || a.title.localeCompare(b.title, "he"));
}

export function forClient<T extends { clientId: string | null }>(rows: T[], clientId: string | null): T[] {
  return clientId ? rows.filter((r) => r.clientId === clientId) : rows;
}

/// How many each tab holds. "הכול" is every decision, not the questions
/// for the client: those are work, and are not waiting on a decision. A
/// knowledge batch counts as its proposals, the way the review screen
/// always counted.
export function tabCounts(items: ApprovalItem[], questions: number, knowledgeTotal?: number): Record<ApprovalTab, number> {
  const out = Object.fromEntries(APPROVAL_TABS.map((t) => [t.key, 0])) as Record<ApprovalTab, number>;
  for (const i of items) out[i.kind] += i.weight ?? 1;
  if (knowledgeTotal !== undefined) out.knowledge = knowledgeTotal;
  out.all = (Object.keys(KIND_LABELS) as ApprovalKind[]).reduce((n, k) => n + out[k], 0);
  out.questions = questions;
  return out;
}

/// The tabs a person sees: "הכול" always, the rest only while they hold
/// something, plus the one asked for. "שאלות ללקוח" always, since a
/// manager reaches everyone's questions from there. A person who approves no rules never
/// sees a "כללים" tab with a zero in it.
export function visibleTabs(counts: Record<ApprovalTab, number>, active: ApprovalTab): { key: ApprovalTab; label: string; count: number }[] {
  return APPROVAL_TABS.filter((t) => t.key === "all" || t.key === "questions" || t.key === active || counts[t.key] > 0).map((t) => ({ ...t, count: counts[t.key] }));
}

type Params = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : null;
}

/// `clientId`, the name the review screen always used, and `client` as an
/// alias, so a hand-typed link works too.
export function parseApprovalsParams(params: Params): { tab: ApprovalTab; clientId: string | null } {
  // "review" was the tab of the items not yet confirmed, until 22.10.2026.
  const asked = one(params.tab);
  const tab = asked === "review" ? "questions" : asked;
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

// ---------------------------------------------------------------------------
// The way back to "אישורים" (Ariel, 22.10.2026)
// ---------------------------------------------------------------------------
//
// A row leads to where its item lives: a client's page, a task. Until
// then the way back there was the list that page belongs to ("לקוחות"),
// and the person lost their place in the approvals. The link now carries
// the approvals screen as it was, tab and client, in its own parameter:
// `from` already means the list a client or a task was opened from.

export const APPROVALS_BACK_PARAM = "fromApprovals";
const BACK_KEYS = ["tab", "clientId"] as const;
const MAX_VALUE = 200;

/// The approvals screen's state, as the parameter carries it. "all" for
/// the default view, so the parameter is never empty.
function backValue(tab: ApprovalTab, clientId: string | null): string {
  const q = new URLSearchParams();
  if (tab !== "all") q.set("tab", tab);
  if (clientId) q.set("clientId", clientId);
  return q.toString() || "all";
}

/// `href` with the way back to this approvals view. The hash stays last.
export function withApprovalsBack(href: string, tab: ApprovalTab, clientId: string | null): string {
  if (!href.startsWith("/app/") || href.startsWith("/app/approvals")) return href;
  const hashAt = href.indexOf("#");
  const base = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const hash = hashAt >= 0 ? href.slice(hashAt) : "";
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${APPROVALS_BACK_PARAM}=${encodeURIComponent(backValue(tab, clientId))}${hash}`;
}

/// The way back, from the parameter: the screen's address and its name,
/// "אישורים · כללים". Null when the page was not opened from there. The
/// value is input: only the screen's own keys survive, and the address is
/// always /app/approvals.
export function approvalsBack(value: string | string[] | null | undefined): { href: string; label: string; param: string } | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !raw || raw.length > MAX_VALUE * 2) return null;
  const input = raw === "all" ? new URLSearchParams() : new URLSearchParams(raw);
  const params: Record<string, string> = {};
  for (const key of BACK_KEYS) {
    const v = input.get(key);
    if (v && v.length <= MAX_VALUE) params[key] = v;
  }
  const { tab, clientId } = parseApprovalsParams(params);
  const name = APPROVAL_TABS.find((t) => t.key === tab)?.label;
  return {
    href: approvalsHref(tab, clientId),
    label: tab === "all" || !name ? "אישורים" : `אישורים · ${name}`,
    param: `${APPROVALS_BACK_PARAM}=${encodeURIComponent(backValue(tab, clientId))}`,
  };
}

/// The parameter to keep on a link inside the page (a tab change), or "".
export function approvalsBackParam(value: string | string[] | null | undefined): string {
  return approvalsBack(value)?.param ?? "";
}

/// 22.10.2026: the rules of one client that can be approved together, two
/// or more of them, each one confirmed with the client. A rule still to
/// confirm is never in it.
export function bulkRuleGroups(items: ApprovalItem[]): { clientId: string; clientName: string; ids: string[] }[] {
  const by = new Map<string, { clientId: string; clientName: string; ids: string[] }>();
  for (const i of items) {
    if (i.kind !== "rule" || !i.actions.approve || !i.clientId) continue;
    const g = by.get(i.clientId) ?? { clientId: i.clientId, clientName: i.clientName ?? "", ids: [] };
    g.ids.push(i.id);
    by.set(i.clientId, g);
  }
  return [...by.values()].filter((g) => g.ids.length >= 2).sort((a, b) => b.ids.length - a.ids.length || a.clientName.localeCompare(b.clientName, "he"));
}

/// 22.10.2026: whose a meeting's proposals are. They wait on whoever sent
/// them for extraction and on the client's account manager, not on every
/// manager: Grantor's 59 proposals Hadas sent filled Ariel's count. A
/// batch nobody sent, of a client with no account manager, waits on the
/// managers. Anyone on the client may still approve; this decides only
/// whose count and "היום" they are in.
export function knowledgeBatchIsMine(batch: { createdById: string | null; accountManagerId: string | null }, userId: string, manager: boolean): boolean {
  if (batch.createdById === userId || batch.accountManagerId === userId) return true;
  return manager && !batch.createdById && !batch.accountManagerId;
}
