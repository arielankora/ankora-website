// Questions for the client (Ariel, 22.10.2026).
//
// "לבדיקה" in the approvals screen held every item not yet confirmed, one
// line each: 32 for NUX alone, each a link, and most of them were not the
// manager's to close. An uncertain item is closed by asking the client,
// so the work is a message, not 32 visits: one card per client, for the
// person who owns the file, with the questions numbered and a draft to
// send. Nothing is sent from here.
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
