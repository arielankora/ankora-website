// Stage 3 of "התיבות שלי" (27.11.2026, Ariel: "אפשר להיות יותר פתוחים
// לאוטומציה"): a contact's own details, changed in an email that contact
// wrote (their signature, their address), enter the file on their own,
// though every other change to an item in the file waits for a person.
// The person is the best source there is for their own phone and role.
// Pure, unit tested (tests/unit/mail-own-details.test.ts).

/// The fields a person's own email can update with no one looking.
export const OWN_DETAIL_FIELDS = ["name", "role", "phones", "emails"] as const;
/// Fields every proposal may carry that change nothing about the person.
const META_FIELDS = new Set(["sources", "knowledgeStatus", "importance"]);

export type OwnDetailsInput = {
  target: string;
  action: string;
  payload: Record<string, unknown>;
  flags: Array<{ code: string; block?: boolean }>;
  level: string;
};

/// Whether the proposal only updates a contact's own details, from a thread
/// in which that contact wrote. `contactEmails`: the contact's addresses in
/// the file; `threadSenders`: everyone who wrote in the source thread.
export function isOwnDetailsUpdate(p: OwnDetailsInput, ctx: { contactEmails: readonly string[]; threadSenders: readonly string[] }): boolean {
  if (p.target !== "CONTACT" || p.action !== "SUPERSEDE") return false;
  if (p.level !== "HIGH") return false;
  if (p.flags.some((f) => f.block || f.code === "R6")) return false;
  if (p.payload.sensitivity === "SENSITIVE") return false;
  if (p.payload.knowledgeStatus === "UNCERTAIN" || p.payload.knowledgeStatus === "MISSING") return false;
  const changed = Object.keys(p.payload).filter((k) => !META_FIELDS.has(k) && p.payload[k] !== undefined);
  if (!changed.length || changed.some((k) => !(OWN_DETAIL_FIELDS as readonly string[]).includes(k))) return false;
  const senders = new Set(ctx.threadSenders.map((s) => s.trim().toLowerCase()));
  return ctx.contactEmails.some((e) => senders.has(e.trim().toLowerCase()));
}
