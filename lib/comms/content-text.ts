// ADR 0006: the words the communications screens write INTO records, not
// onto the screen. A client file's source and open question, a document's
// title on a task and the audit log keep one language whoever is reading,
// so they stay in Hebrew and live here, apart from the screens' own words
// (messages/*.json, comms.*).

/// What the audit log records as the recipient of a message sent to a group.
export const AUDIT_GROUP_RECIPIENT = "קבוצה";

/// The client file's source for a number assigned from the communications
/// screen: one per person, per client, per day.
export function assignSourceTitle(by: string): string {
  return `שיוך מספר ממסך התקשורת, בידי ${by}`;
}

/// What would confirm a contact that came from the communications screen.
export const ASSIGNED_NUMBER_TO_RESOLVE = "המספר שויך ממסך התקשורת. לאשר מול הלקוח.";

/// The title of an image from WhatsApp filed on a task.
export function whatsappImageTitle(who: string | null, at: Date): string {
  const when = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }).format(at);
  return `תמונה מוואטסאפ: ${who || "איש קשר"}, ${when}`;
}
