import { emailDomain, isPublicEmailDomain, normalizeDomain, normalizeEmail } from "@/lib/contact-normalize";

// "התיבות שלי" (27.11.2026): the pure rules of mailbox scanning, unit tested
// without a database (tests/unit/mail-scan-rules.test.ts). What is recorded
// of an email is decided here: whether it is the team talking to itself,
// whether the owner asked not to read it, and which clients it is with.

/// The team's own domain. An email whose every participant is on it, or is
/// one of the team's addresses, is the team talking to itself and is not
/// recorded (as a WhatsApp conversation between two team numbers).
export const TEAM_DOMAINS = ["ankora.co.il"] as const;

export type BlockLike = { kind: "ADDRESS" | "DOMAIN"; value: string; status: "PENDING" | "APPROVED" | "REJECTED" | "REVOKED" };
export type BlockState = "none" | "held" | "blocked";

/// A "לא לקרוא" entry, as typed: an address, or a domain ("@bank.co.il",
/// "bank.co.il", "https://www.bank.co.il"). Null when it is neither.
export function parseBlockTarget(raw: string): { kind: "ADDRESS" | "DOMAIN"; value: string } | null {
  const text = raw.trim();
  if (!text) return null;
  const email = normalizeEmail(text);
  if (email) return { kind: "ADDRESS", value: email };
  const domain = normalizeDomain(text);
  if (domain && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return { kind: "DOMAIN", value: domain };
  return null;
}

function domainMatches(domain: string, blocked: string): boolean {
  return domain === blocked || domain.endsWith(`.${blocked}`);
}

/// What the blocks say about one address. An approved block wins over a
/// pending one; a rejected or revoked one says nothing.
export function blockStateOf(blocks: readonly BlockLike[], address: string): BlockState {
  const email = normalizeEmail(address);
  if (!email) return "none";
  const domain = emailDomain(email)!;
  let state: BlockState = "none";
  for (const b of blocks) {
    if (b.status !== "APPROVED" && b.status !== "PENDING") continue;
    const hit = b.kind === "ADDRESS" ? b.value === email : domainMatches(domain, b.value);
    if (!hit) continue;
    if (b.status === "APPROVED") return "blocked";
    state = "held";
  }
  return state;
}

/// The thread's state: blocked if any participant is, else held if any is.
export function threadBlockState(blocks: readonly BlockLike[], participants: readonly string[]): BlockState {
  let state: BlockState = "none";
  for (const p of participants) {
    const s = blockStateOf(blocks, p);
    if (s === "blocked") return "blocked";
    if (s === "held") state = "held";
  }
  return state;
}

export type Team = { domains: readonly string[]; emails: ReadonlySet<string> };

export function isTeamAddress(address: string, team: Team): boolean {
  const email = normalizeEmail(address);
  if (!email) return false;
  if (team.emails.has(email)) return true;
  const domain = emailDomain(email)!;
  return team.domains.some((d) => domainMatches(domain, d));
}

/// Every address in an email (from, to, cc, bcc, reply-to), lower case,
/// without repeats, in the order first seen.
export function participantsOf(email: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const field of ["from", "to", "cc", "bcc", "reply_to"]) {
    const list = email[field];
    if (!Array.isArray(list)) continue;
    for (const person of list) {
      const raw = person && typeof person === "object" ? (person as { email?: unknown }).email : null;
      const normalized = typeof raw === "string" ? normalizeEmail(raw) : null;
      if (normalized && !out.includes(normalized)) out.push(normalized);
    }
  }
  return out;
}

export function fromOf(email: Record<string, unknown>): string | null {
  const list = email.from;
  if (!Array.isArray(list) || !list.length) return null;
  const raw = (list[0] as { email?: unknown } | null)?.email;
  return typeof raw === "string" ? normalizeEmail(raw) : null;
}

/// Who an outside address belongs to: the clients whose file has its domain
/// (a public mail service names nobody by domain), and the clients whose
/// file has this exact address on a contact.
export type ClientLookup = {
  byDomain: ReadonlyMap<string, readonly string[]>;
  byAddress: ReadonlyMap<string, readonly string[]>;
};

/// Which clients an email in an Ankora mailbox is with. Team addresses are
/// left out; an outside address on a public service counts only when a
/// client's file has that exact address.
export function matchClients(participants: readonly string[], team: Team, lookup: ClientLookup): string[] {
  const found = new Set<string>();
  for (const p of participants) {
    if (isTeamAddress(p, team)) continue;
    for (const id of lookup.byAddress.get(p) ?? []) found.add(id);
    const domain = emailDomain(p);
    if (!domain || isPublicEmailDomain(domain)) continue;
    for (const [d, ids] of lookup.byDomain) {
      if (domainMatches(domain, d)) for (const id of ids) found.add(id);
    }
  }
  return [...found].sort();
}

export type EmailDecision =
  | { record: false; reason: "team" | "blocked" | "no-client" }
  | { record: true; clientIds: string[]; held: boolean };

/// What to do with one email of a mailbox. A client's mailbox (clientId set)
/// is that client's for every email in it; an Ankora mailbox's emails are
/// matched by their participants. The mailbox's own address is not a
/// participant that decides anything.
export function decideEmail(input: {
  participants: readonly string[];
  mailbox: { address: string; clientId: string | null };
  blocks: readonly BlockLike[];
  team: Team;
  lookup: ClientLookup;
}): EmailDecision {
  const others = input.participants.filter((p) => p !== input.mailbox.address);
  const state = threadBlockState(input.blocks, others);
  if (state === "blocked") return { record: false, reason: "blocked" };
  if (input.mailbox.clientId) return { record: true, clientIds: [input.mailbox.clientId], held: state === "held" };
  if (others.every((p) => isTeamAddress(p, input.team))) return { record: false, reason: "team" };
  const clientIds = matchClients(others, input.team, input.lookup);
  if (!clientIds.length) return { record: false, reason: "no-client" };
  return { record: true, clientIds, held: state === "held" };
}

/// "של מי התיבה": a mailbox on the team's domain is Ankora's; any other is
/// probably a client's, and the clients whose file has its domain are
/// offered first.
export function suggestMailboxKind(
  address: string,
  team: Team,
  byDomain: ReadonlyMap<string, readonly string[]>,
): { kind: "ANKORA" } | { kind: "CLIENT"; clientIds: string[] } {
  if (isTeamAddress(address, team)) return { kind: "ANKORA" };
  const domain = emailDomain(address);
  const ids = new Set<string>();
  if (domain && !isPublicEmailDomain(domain)) {
    for (const [d, list] of byDomain) if (domainMatches(domain, d)) for (const id of list) ids.add(id);
  }
  return { kind: "CLIENT", clientIds: [...ids].sort() };
}

/// The most frequent outside senders, for "מה לא לקרוא": the team and the
/// mailbox itself are left out.
export function topSenders(
  emails: ReadonlyArray<{ from: string | null; name: string | null }>,
  exclude: { address: string; team: Team },
  limit = 30,
): Array<{ address: string; name: string | null; count: number }> {
  const counts = new Map<string, { name: string | null; count: number }>();
  for (const e of emails) {
    if (!e.from || e.from === exclude.address || isTeamAddress(e.from, exclude.team)) continue;
    const row = counts.get(e.from) ?? { name: null, count: 0 };
    row.count += 1;
    row.name ??= e.name;
    counts.set(e.from, row);
  }
  return [...counts.entries()]
    .map(([address, r]) => ({ address, name: r.name, count: r.count }))
    .sort((a, b) => b.count - a.count || a.address.localeCompare(b.address))
    .slice(0, limit);
}

// ---------------------------------------------------------------- automatic mail

/// Senders whose name says no person reads the answer.
const NO_REPLY_LOCAL = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|postmaster|bounces?)([-_.+].*)?$/i;

/// Gmail's own tabs for mail sent in bulk. "Updates" is left out: a
/// person's email lands there too.
const BULK_GMAIL_LABELS = new Set(["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"]);

export type AutomatedReason = "list" | "auto-submitted" | "bulk" | "no-reply" | "gmail-category";

/// 28.11.2026 (Ariel): newsletters, notifications and marketing are never
/// work with a client, and a client's own mailbox would otherwise record
/// every one of them as that client's. An email is automatic when its
/// headers say so (a mailing list, an automatic reply, bulk precedence),
/// when its sender is a no-reply address, or when Gmail filed it under
/// Promotions, Social or Forums. A sender who writes from a CRM with an
/// unsubscribe link is left out with them: that is the price of not
/// recording every newsletter.
export function automatedReason(email: { headers?: unknown; from?: string | null; folders?: unknown }): AutomatedReason | null {
  const headers = Array.isArray(email.headers) ? (email.headers as { name?: unknown; value?: unknown }[]) : [];
  const value = (name: string) =>
    headers
      .filter((h) => typeof h?.name === "string" && h.name.toLowerCase() === name)
      .map((h) => (typeof h.value === "string" ? h.value.trim().toLowerCase() : ""));
  if (value("list-unsubscribe").length || value("list-id").length) return "list";
  if (value("auto-submitted").some((v) => v && v !== "no")) return "auto-submitted";
  if (value("precedence").some((v) => v === "bulk" || v === "list" || v === "junk")) return "bulk";
  const local = email.from?.split("@")[0] ?? "";
  if (local && NO_REPLY_LOCAL.test(local)) return "no-reply";
  const folders = Array.isArray(email.folders) ? email.folders : [];
  if (folders.some((f) => typeof f === "string" && BULK_GMAIL_LABELS.has(f))) return "gmail-category";
  return null;
}
