// Questions for the client (Ariel, 22.10.2026).
//
// "לבדיקה" in the approvals screen held every item not yet confirmed, one
// line each: 32 for NUX alone, each a link, and most of them were not the
// manager's to close. An uncertain item is closed by asking the client,
// so the work is a message, not 32 visits: one card per client, for the
// person who owns the file, with the questions numbered and a draft to
// send. Nothing is sent from here.
//
// 1.11.2026 (Ariel: "it feels like a nuisance"): the card left
// "אישורים", which is decisions only, for the client's own page. It holds
// only what somebody meant to ask: the file's open questions, and an
// uncertain item someone chose to ask about ("לשאול את הלקוח"). Every
// line can be closed as not relevant, checked by us as a task, or put off
// to a date.
//
// Pure: which items make a question, how it reads, and the message.

/// The reason #318 gives an item that is uncertain only because Ankora
/// wrote its source. As a question it asks whether the line is right.
const ANKORA_SOURCE_PREFIX = "אישור מהלקוח";

export type QuestionItem = {
  id: string;
  /// "פריט", "איש קשר", "מערכת"...
  what: string;
  title: string;
  toResolve: string | null;
  /// An open question in the file (section 13), not an uncertain item.
  isQuestion: boolean;
  /// Not to be put in a message to the client: sensitive, or with a "do
  /// not tell". Listed, left out of the draft.
  internal: boolean;
  href: string;
  askedAt: Date | null;
};

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function clip(s: string, max: number): string {
  const one = clean(s);
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/// The item as one question to the client.
export function questionText(item: Pick<QuestionItem, "title" | "toResolve" | "isQuestion">): string {
  if (item.isQuestion) {
    const body = clean(item.title);
    return /[?？]$/.test(body) ? body : `${body}?`;
  }
  const reason = item.toResolve ? clean(item.toResolve) : "";
  if (reason && !reason.startsWith(ANKORA_SOURCE_PREFIX)) {
    if (/[?？]$/.test(reason)) return `לגבי "${clip(item.title, 90)}": ${reason}`;
    return `לגבי "${clip(item.title, 90)}": ${reason.replace(/\.$/, "")}?`;
  }
  return `האם זה נכון: "${clip(item.title, 140)}"?`;
}

function firstName(name: string | null | undefined): string | null {
  const n = name?.trim();
  return n ? n.split(/\s+/)[0] : null;
}

/// The message, ready to edit and send: a greeting, the questions
/// numbered, and the sender. Only what may go to the client.
export function questionsDraft(input: { contactName: string | null; senderName: string | null; items: Pick<QuestionItem, "title" | "toResolve" | "isQuestion" | "internal">[] }): string {
  const asked = input.items.filter((i) => !i.internal);
  const to = firstName(input.contactName);
  const from = firstName(input.senderName);
  const lines = [
    to ? `היי ${to},` : "היי,",
    "",
    asked.length === 1 ? "כדי שהתיק שלכם אצלנו יהיה מדויק, יש לי שאלה אחת קצרה:" : `כדי שהתיק שלכם אצלנו יהיה מדויק, יש לי ${asked.length} שאלות קצרות:`,
    "",
    ...asked.map((i, n) => `${n + 1}. ${questionText(i)}`),
    "",
    "אפשר לענות בקצרה, גם בהודעה קולית.",
    "תודה,",
    from ?? "",
  ];
  return lines.join("\n").trim();
}

/// "לאורן", and "ל-Oren" for a name in Latin letters.
function toName(name: string): string {
  return /^[A-Za-z]/.test(name) ? `ל-${name}` : `ל${name}`;
}

/// The card's title: "9 שאלות לאורן".
export function cardTitle(count: number, contactName: string | null): string {
  const to = firstName(contactName);
  const n = count === 1 ? "שאלה אחת" : `${count} שאלות`;
  return to ? `${n} ${toName(to)}` : `${n} ללקוח`;
}

/// The task that carries the message, for who sends it.
export function sendTaskTitle(count: number, contactName: string | null): string {
  const to = firstName(contactName);
  const whom = to ? toName(to) : "ללקוח";
  return count === 1 ? `לשלוח ${whom} שאלה אחת לתיק` : `לשלוח ${whom} ${count} שאלות לתיק`;
}

/// Whose card an item is on: its owner, and when it has none, the client's
/// account manager. A question goes to whoever chases it first.
export function cardOwner(item: { ownerId: string | null; assigneeId?: string | null }, accountManagerId: string | null): string | null {
  return item.assigneeId ?? item.ownerId ?? accountManagerId;
}

/// The audit actions that hold a question's state, so no column is added:
/// an uncertain item put on the card or taken off it, and a line put off.
export const ASK_CLIENT = "client_file.ask_client";
export const SNOOZED = "client_file.question_snoozed";

type Event = { afterJson: unknown; createdAt: Date };

function itemIds(after: unknown): string[] {
  const ids = (after as { itemIds?: unknown } | null)?.itemIds;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

/// Which uncertain items are on the card: the latest word on each wins.
/// The events in the order they happened.
export function readAskFlags(events: Event[]): Set<string> {
  const on = new Map<string, boolean>();
  for (const e of events) {
    const flag = (e.afterJson as { on?: unknown } | null)?.on !== false;
    for (const id of itemIds(e.afterJson)) on.set(id, flag);
  }
  return new Set([...on].filter(([, v]) => v).map(([k]) => k));
}

/// Until when each line is put off: the latest word on each wins.
export function readSnoozes(events: Event[]): Map<string, Date> {
  const out = new Map<string, Date>();
  for (const e of events) {
    const raw = (e.afterJson as { until?: unknown } | null)?.until;
    const until = typeof raw === "string" ? new Date(raw) : null;
    if (!until || Number.isNaN(until.getTime())) continue;
    for (const id of itemIds(e.afterJson)) out.set(id, until);
  }
  return out;
}

/// A date to put a question off to: tomorrow at the earliest, a year at
/// most. Null when it is fine.
export function snoozeError(until: Date, now: Date): string | null {
  if (Number.isNaN(until.getTime())) return "צריך לבחור תאריך.";
  if (until.getTime() <= now.getTime()) return "התאריך צריך להיות בעתיד.";
  if (until.getTime() > now.getTime() + 366 * 86_400_000) return "אפשר לדחות עד שנה קדימה.";
  return null;
}

/// The answer a question closed as not relevant keeps, with why.
export function dismissedAnswer(reason: string): string {
  return `לא רלוונטי: ${clean(reason).replace(/\.$/, "")}.`;
}

/// The internal task for an uncertain item we check ourselves.
export function checkTaskTitle(title: string): string {
  return `לבדוק בתיק: ${clip(title, 110)}`;
}
