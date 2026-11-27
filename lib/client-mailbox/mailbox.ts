import "server-only";
import type { ClientConnection, CommsBlockStatus, Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { threadBlockState, type BlockLike } from "@/lib/mail-scan/rules";
import { clientMailboxAccess, roleAccess, type AccessReason, type MailboxAccessLevel } from "./access";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { DomainError } from "@/lib/domain-error";
import { extractDocumentText } from "@/lib/document-text";
import { dayEndInZone, dayStartInZone } from "@/lib/timezone";
import {
  UnipileMailError,
  capabilitiesOf,
  isMailProvider,
  getAttachment,
  getEmail,
  getThread,
  listContacts,
  listEmails,
  listFolders,
  listOutlookCategories,
  listSenders,
  mailboxNeedsReconnect,
  readMailAccount,
  type EmailFilters,
  type RawEmail,
} from "./unipile-mail";
import { attachmentsOf, categoryOf, contactOf, folderOf, fullOf, israelTimeOf, rawAddresses, senderOf, summaryOf } from "./shape";

// A mailbox through the Ankora connector (26.11.2026, Ariel and Hadas:
// "לפי ההרשאות של אנקורה"; 27.11.2026: access by mailbox):
//
// - A client's mailbox, connected on the client's connections screen: the
//   system admins, the account manager and the backup manager by role, and
//   whoever is on the mailbox's list (lib/client-mailbox/access.ts). Seeing
//   the client is still required, but no longer enough.
// - An employee's own mailbox, connected on "התיבות שלי": only its owner.
//   Emails from or to a sender marked "לא לקרוא" there are left out of every
//   answer and refused when asked for by id.
// - A client marked "בלי AI" is refused, for both kinds.
// - Every call is audited ("connection.mail_read" and the rest), with what
//   was read but never the content. A client mailbox's lastUsedAt moves.
// - Stage 2 (26.11.2026): drafts, sending, organising and the calendar are
//   in lib/client-mailbox/write.ts and calendar.ts, with the same rules. They
//   need send access; a person on the list with read only is refused.

export type MailboxSource = "client" | "personal";
export type MailboxNeed = "read" | "write";

export type MailboxRow = {
  /// The ClientConnection's id, or the MailChannel's.
  id: string;
  source: MailboxSource;
  clientId: string | null;
  account: string;
  /// What the connection can do ("mail", "calendar"). A personal mailbox
  /// has none recorded; calendar.ts asks the provider.
  scopes: string[];
  unipileAccountId: string;
  connectedAt: Date;
  lastUsedAt: Date | null;
  access: AccessReason;
  canSend: boolean;
  /// A personal mailbox's "לא לקרוא" entries (pending or approved).
  blocks: BlockLike[];
};

type Candidate = Omit<MailboxRow, "access" | "canSend"> & { level: MailboxAccessLevel | null };

const CONNECTION_FIELDS = { id: true, clientId: true, account: true, scopes: true, unipileAccountId: true, connectedAt: true, lastUsedAt: true } as const;
type ConnectionFields = Pick<ClientConnection, keyof typeof CONNECTION_FIELDS>;

/// The client's live Unipile mailboxes.
async function mailboxesOf(clientId: string): Promise<ConnectionFields[]> {
  return prisma.clientConnection.findMany({
    where: { clientId, kind: "UNIPILE_MAIL", revokedAt: null, unipileAccountId: { not: null } },
    select: CONNECTION_FIELDS,
    orderBy: { connectedAt: "asc" },
  });
}

function clientCandidate(c: ConnectionFields, level: MailboxAccessLevel | undefined): Candidate {
  return {
    id: c.id,
    source: "client",
    clientId: c.clientId,
    account: c.account,
    scopes: c.scopes,
    unipileAccountId: c.unipileAccountId!,
    connectedAt: c.connectedAt,
    lastUsedAt: c.lastUsedAt,
    blocks: [],
    level: level ?? null,
  };
}

const CHANNEL_INCLUDE = {
  blocks: { where: { status: { in: ["PENDING", "APPROVED"] as CommsBlockStatus[] } }, select: { kind: true, value: true, status: true } },
  client: { select: { aiExcluded: true } },
} satisfies Prisma.MailChannelInclude;
type ChannelWithBlocks = Awaited<ReturnType<typeof ownChannels>>[number];

/// The actor's own mailboxes ("התיבות שלי"), except one that is also a
/// client's connected mailbox: that one follows the client's rules.
async function ownChannels(actor: Pick<User, "id">, where: { clientId?: string; address?: string } = {}) {
  const rows = await prisma.mailChannel.findMany({ where: { ownerUserId: actor.id, ...where }, include: CHANNEL_INCLUDE, orderBy: { createdAt: "asc" } });
  if (rows.length === 0) return rows;
  const shared = await prisma.clientConnection.findMany({ where: { kind: "UNIPILE_MAIL", revokedAt: null, unipileAccountId: { in: rows.map((r) => r.accountId) } }, select: { unipileAccountId: true } });
  const taken = new Set(shared.map((s) => s.unipileAccountId));
  return rows.filter((r) => !taken.has(r.accountId));
}

function personalCandidate(c: ChannelWithBlocks): Candidate {
  return {
    id: c.id,
    source: "personal",
    clientId: c.clientId,
    account: c.address,
    scopes: [],
    unipileAccountId: c.accountId,
    connectedAt: c.createdAt,
    lastUsedAt: null,
    blocks: c.blocks as BlockLike[],
    level: { reason: "owner", canSend: true },
  };
}

function noAccess(account: string): DomainError {
  return new DomainError(
    "connections.mailbox.noAccess",
    `אין לך גישה לתיבה ${account}. מנהל מערכת, מנהל התיק או המחליף שלו יכולים להוסיף אותך לתיבה במסך החיבורים של הלקוח באנקורה.`,
    { account },
  );
}

/// The one mailbox of the candidates, the one named or the only one open to
/// the actor, with the access the call needs.
function pick(all: Candidate[], wanted: string | null, need: MailboxNeed): MailboxRow {
  const open = all.filter((r) => r.level);
  const addresses = open.map((r) => r.account).join(", ");
  let row: Candidate | undefined;
  if (wanted) {
    row = all.find((r) => r.account.toLowerCase() === wanted);
    if (!row) {
      throw new DomainError("connections.mailbox.unknown", `לתיבה הזו אין חיבור אצל הלקוח. התיבות המחוברות: ${addresses || "אין"}.`, { addresses: addresses || "-" });
    }
  } else {
    if (open.length === 0) throw noAccess(all.map((r) => r.account).join(", "));
    if (open.length > 1) throw new DomainError("connections.mailbox.which", `ללקוח יש כמה תיבות מחוברות. אומרים מאיזו לקרוא: ${addresses}.`, { addresses });
    row = open[0];
  }
  if (!row.level) throw noAccess(row.account);
  if (need === "write" && !row.level.canSend) {
    throw new DomainError(
      "connections.mailbox.readOnly",
      `יש לך גישת קריאה בלבד לתיבה ${row.account}. כדי לכתוב ממנה (טיוטה, שליחה, סידור או יומן) מנהל מערכת, מנהל התיק או המחליף שלו מעלים את הגישה במסך החיבורים של הלקוח.`,
      { account: row.account },
    );
  }
  const { level, ...rest } = row;
  return { ...rest, access: level.reason, canSend: level.canSend };
}

function aiExcluded(): DomainError {
  return new DomainError("connections.mailbox.aiExcluded", "הלקוח מסומן \"בלי AI\", ולכן התיבה שלו לא נקראת דרך קלוד.");
}

/// The mailbox a call is about. With a client: one of its mailboxes (the
/// only one open to the actor, or the one named), the actor's own mailbox
/// at that client included. Without a client: the mailbox with this
/// address, the actor's own or a client's.
export async function resolveMailbox(actor: User, clientId: string | null, mailbox?: string | null, need: MailboxNeed = "read"): Promise<MailboxRow> {
  const wanted = mailbox?.trim().toLowerCase() || null;
  if (clientId) {
    await assertClientAccess(actor, clientId);
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { aiExcluded: true, accountManagerId: true, backupManagerId: true } });
    if (!client || client.aiExcluded) throw aiExcluded();
    const conns = await mailboxesOf(clientId);
    const access = await clientMailboxAccess(actor, client, conns.map((c) => c.id));
    const all = [...conns.map((c) => clientCandidate(c, access.get(c.id))), ...(await ownChannels(actor, { clientId })).map(personalCandidate)];
    if (all.length === 0) {
      throw new DomainError("connections.mailbox.none", "ללקוח הזה אין תיבת דואר מחוברת. מנהל התיק מחבר אותה במסך החיבורים של הלקוח באנקורה.");
    }
    return pick(all, wanted, need);
  }
  if (!wanted) {
    throw new DomainError("connections.mailbox.whichMine", "מעבירים את כתובת התיבה, או את שם הלקוח. list_my_mailboxes מציג את כל התיבות שלך.");
  }
  const own = (await ownChannels(actor, { address: wanted }))[0];
  if (own) {
    if (own.client?.aiExcluded) throw aiExcluded();
    return pick([personalCandidate(own)], wanted, need);
  }
  const conns = await prisma.clientConnection.findMany({
    where: { kind: "UNIPILE_MAIL", revokedAt: null, unipileAccountId: { not: null }, account: { equals: wanted, mode: "insensitive" } },
    select: { ...CONNECTION_FIELDS, client: { select: { aiExcluded: true, accountManagerId: true, backupManagerId: true } } },
  });
  if (conns.length === 0) {
    throw new DomainError("connections.mailbox.unknownMine", `אין באנקורה חיבור לתיבה ${wanted}. list_my_mailboxes מציג את התיבות שלך.`, { account: wanted });
  }
  if (new Set(conns.map((c) => c.clientId)).size > 1) {
    throw new DomainError("connections.mailbox.whichClient", `התיבה ${wanted} מחוברת אצל יותר מלקוח אחד. מעבירים גם את שם הלקוח.`, { account: wanted });
  }
  const conn = conns[0];
  try {
    await assertClientAccess(actor, conn.clientId);
  } catch (err) {
    if (err instanceof ForbiddenError) throw noAccess(conn.account);
    throw err;
  }
  if (conn.client.aiExcluded) throw aiExcluded();
  const access = await clientMailboxAccess(actor, conn.client, [conn.id]);
  return pick([clientCandidate(conn, access.get(conn.id))], wanted, need);
}

// ---------------------------------------------------------------- personal senders

/// The addresses on an email, for the "לא לקרוא" check.
function participantsOf(e: RawEmail): string[] {
  return [e.from, e.to, e.cc, e.bcc, e.reply_to].flatMap((v) => rawAddresses(v)).map((a) => a.email.toLowerCase());
}

/// Whether a personal mailbox's "לא לקרוא" list keeps this email from Claude.
export function isHidden(row: Pick<MailboxRow, "blocks">, e: RawEmail): boolean {
  if (row.blocks.length === 0) return false;
  return threadBlockState(row.blocks, participantsOf(e)) !== "none";
}

/// Refuses an email the mailbox's "לא לקרוא" list keeps from Claude.
export function assertReadable(row: Pick<MailboxRow, "blocks">, e: RawEmail): void {
  if (isHidden(row, e)) {
    throw new DomainError("connections.mailbox.personalSender", "המייל הזה הוא עם שולח שסומן \"לא לקרוא\" בתיבה, ולכן קלוד לא קורא אותו.");
  }
}

/// The audit row of a use: reading mail or the calendar, or (stage 2)
/// writing to them. What was done and on which item, never the content.
export type MailboxUse = "mail_read" | "mail_write" | "calendar_read" | "calendar_write";

export async function used(actor: User, row: MailboxRow, what: string, details: Record<string, unknown> = {}, use: MailboxUse = "mail_read") {
  if (row.source === "client") await prisma.clientConnection.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  const calendar = use.startsWith("calendar");
  const write = use.endsWith("write");
  await recordAudit({
    actorId: actor.id,
    action: calendar ? (write ? "connection.calendar_write" : "connection.calendar_read") : write ? "connection.mail_write" : "connection.mail_read",
    entityType: row.source === "client" ? "ClientConnection" : "MailChannel",
    entityId: row.id,
    clientId: row.clientId,
    after: { what, account: row.account, access: row.access, ...details },
  });
}

/// Runs a Unipile call. When it fails for a reason other than a missing item
/// or a rate limit, the account's own state says whether the mailbox has to
/// be reconnected, which is what the person can act on.
export async function guarded<T>(row: MailboxRow, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UnipileMailError && err.status !== null && err.status !== 404 && err.status !== 429) {
      const state = await readMailAccount(row.unipileAccountId).catch(() => null);
      if (state && mailboxNeedsReconnect(state.status)) {
        throw new DomainError("connections.mailbox.disconnected", row.source === "client" ? `החיבור לתיבה ${row.account} נפל. מנהל התיק מחבר אותה מחדש במסך החיבורים של הלקוח.` : `החיבור לתיבה ${row.account} נפל. בעל התיבה מחבר אותה מחדש ב"התיבות שלי" באנקורה.`, { account: row.account });
      }
    }
    throw err;
  }
}

/// A day ("2026-11-20", Israel time) or an ISO time, as Unipile wants it.
export function timeFilter(value: string | undefined, edge: "start" | "end"): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = edge === "start" ? dayStartInZone(v) : dayEndInZone(v);
    if (!d) throw new DomainError("connections.mailbox.badDate", `התאריך ${v} לא תקין. כותבים YYYY-MM-DD.`, { value: v });
    return d.toISOString();
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new DomainError("connections.mailbox.badDate", `התאריך ${v} לא תקין. כותבים YYYY-MM-DD.`, { value: v });
  return d.toISOString();
}

// ---------------------------------------------------------------- status

/// The client's mailboxes, and the actor's own mailbox at the client, with
/// what the actor may do in each. A mailbox closed to the actor is listed,
/// so Claude can say who opens it, but its provider is not asked.
export async function mailboxStatus(actor: User, clientId: string) {
  await assertClientAccess(actor, clientId);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { accountManagerId: true, backupManagerId: true } });
  const conns = await mailboxesOf(clientId);
  const access = client ? await clientMailboxAccess(actor, client, conns.map((c) => c.id)) : new Map<string, MailboxAccessLevel>();
  const all = [...conns.map((c) => clientCandidate(c, access.get(c.id))), ...(await ownChannels(actor, { clientId })).map(personalCandidate)];
  const out = [];
  for (const row of all) {
    const base = { mailbox: row.account, kind: row.source, yourAccess: accessWord(row.level), accessReason: row.level?.reason ?? null };
    if (!row.level) {
      out.push({ ...base, howToGetAccess: "A system admin, the account manager or the backup manager adds you on the client's connections screen in Ankora." });
      continue;
    }
    const account = await readMailAccount(row.unipileAccountId).catch(() => null);
    let senders: ReturnType<typeof senderOf>[] = [];
    if (account?.status === "running" && account.provider !== "imap") {
      senders = (await listSenders(row.unipileAccountId).catch(() => [])).map(senderOf).filter(Boolean);
    }
    out.push({
      ...base,
      provider: account?.provider ?? null,
      state: account ? (account.status === "running" ? "connected" : mailboxNeedsReconnect(account.status) ? "needs_reconnect" : account.status) : "unknown",
      can: row.source === "client" ? row.scopes : account && isMailProvider(account.provider) ? capabilitiesOf(account.provider) : ["mail"],
      connectedAt: israelTimeOf(row.connectedAt.toISOString()),
      lastUsedAt: row.lastUsedAt ? israelTimeOf(row.lastUsedAt.toISOString()) : null,
      sendersAvailable: senders,
    });
  }
  return out;
}

function accessWord(level: MailboxAccessLevel | null): "read_and_send" | "read_only" | "none" {
  if (!level) return "none";
  return level.canSend ? "read_and_send" : "read_only";
}

/// Every mailbox the actor may work in through the connector: their own
/// ("התיבות שלי") and the client mailboxes open to them by role or by list.
/// A client marked "בלי AI" is left out. Nothing is asked of the provider.
export async function listMyMailboxes(actor: User) {
  const out: { mailbox: string; kind: MailboxSource; client: string | null; yourAccess: "read_and_send" | "read_only"; accessReason: AccessReason }[] = [];
  const own = await prisma.mailChannel.findMany({ where: { ownerUserId: actor.id }, include: { client: { select: { name: true, aiExcluded: true } } }, orderBy: { createdAt: "asc" } });
  const ownAccounts = new Set(own.map((c) => c.accountId));
  const shared = new Set(
    (await prisma.clientConnection.findMany({ where: { kind: "UNIPILE_MAIL", revokedAt: null, unipileAccountId: { in: [...ownAccounts] } }, select: { unipileAccountId: true } })).map((c) => c.unipileAccountId),
  );
  for (const c of own) {
    if (shared.has(c.accountId) || c.client?.aiExcluded) continue;
    out.push({ mailbox: c.address, kind: "personal", client: c.client?.name ?? null, yourAccess: "read_and_send", accessReason: "owner" });
  }
  const clients = (await listAccessibleClients(actor)).filter((c) => !c.aiExcluded);
  if (clients.length === 0) return out;
  const byId = new Map(clients.map((c) => [c.id, c]));
  const conns = await prisma.clientConnection.findMany({
    where: { clientId: { in: [...byId.keys()] }, kind: "UNIPILE_MAIL", revokedAt: null, unipileAccountId: { not: null } },
    select: { id: true, clientId: true, account: true },
    orderBy: { connectedAt: "asc" },
  });
  const listed = new Map(
    (await prisma.mailboxAccess.findMany({ where: { userId: actor.id, connectionId: { in: conns.map((c) => c.id) } }, select: { connectionId: true, canSend: true } })).map((r) => [r.connectionId, r.canSend]),
  );
  for (const c of conns) {
    const client = byId.get(c.clientId)!;
    const role = roleAccess(actor, client);
    const level: MailboxAccessLevel | null = role ?? (listed.has(c.id) ? { reason: "list", canSend: listed.get(c.id)! } : null);
    if (!level) continue;
    out.push({ mailbox: c.account, kind: "client", client: client.name, yourAccess: level.canSend ? "read_and_send" : "read_only", accessReason: level.reason });
  }
  return out;
}

// ---------------------------------------------------------------- search

export type SearchInput = {
  mailbox?: string;
  text?: string;
  from?: string;
  to?: string;
  participant?: string;
  hasAttachment?: boolean;
  unread?: boolean;
  starred?: boolean;
  after?: string;
  before?: string;
  folderId?: string;
  excludeFolderIds?: string[];
  outlookCategory?: string;
  limit?: number;
  cursor?: string;
};

export async function searchEmails(actor: User, clientId: string | null, input: SearchInput) {
  const row = await resolveMailbox(actor, clientId, input.mailbox);
  const filters: EmailFilters = {
    q: input.text?.trim() || undefined,
    from: input.from?.trim() || undefined,
    to: input.to?.trim() || undefined,
    any_email: input.participant?.trim() || undefined,
    has_attachment: input.hasAttachment,
    is_unread: input.unread,
    is_starred: input.starred,
    after: timeFilter(input.after, "start"),
    before: timeFilter(input.before, "end"),
    exclude_folder: input.excludeFolderIds?.length ? input.excludeFolderIds.join(",") : undefined,
    cursor: input.cursor || undefined,
    limit: Math.min(Math.max(input.limit ?? 25, 1), 100),
  };
  const page = await guarded(row, () => listEmails(row.unipileAccountId, filters, { folderId: input.folderId, outlookCategory: input.outlookCategory }));
  const shown = page.items.filter((e) => !isHidden(row, e));
  const hidden = page.items.length - shown.length;
  await used(actor, row, "search", { filters: Object.keys(filters).filter((k) => filters[k as keyof EmailFilters] !== undefined), count: shown.length, ...(hidden ? { hidden } : {}) });
  return {
    mailbox: row.account,
    emails: shown.map(summaryOf).filter(Boolean),
    ...(hidden ? { hiddenPersonal: hidden } : {}),
    nextCursor: page.nextCursor,
    total: page.total,
  };
}

// ---------------------------------------------------------------- read

export async function readEmail(actor: User, clientId: string | null, input: { mailbox?: string; emailId?: string; threadId?: string }) {
  const row = await resolveMailbox(actor, clientId, input.mailbox);
  if (input.threadId) {
    const thread = await guarded(row, () => getThread(row.unipileAccountId, input.threadId!));
    // Oldest first, as a conversation reads.
    const sorted = [...thread.emails].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
    const emails = sorted.filter((e) => !isHidden(row, e));
    if (emails.length === 0 && sorted.length > 0) assertReadable(row, sorted[0]);
    const hidden = sorted.length - emails.length;
    await used(actor, row, "thread", { threadId: thread.id, emails: emails.length, ...(hidden ? { hidden } : {}) });
    return { mailbox: row.account, threadId: thread.id, emails: fullOf(emails), ...(hidden ? { hiddenPersonal: hidden } : {}) };
  }
  if (!input.emailId) throw new DomainError("connections.mailbox.idRequired", "מעבירים מזהה של מייל או של שרשור.");
  const email = await guarded(row, () => getEmail(row.unipileAccountId, input.emailId!));
  assertReadable(row, email);
  await used(actor, row, "email", { emailId: input.emailId });
  return { mailbox: row.account, emails: fullOf([email]) };
}

export async function readAttachment(actor: User, clientId: string | null, input: { mailbox?: string; emailId: string; attachmentId: string }) {
  const row = await resolveMailbox(actor, clientId, input.mailbox);
  const email = await guarded(row, () => getEmail(row.unipileAccountId, input.emailId));
  assertReadable(row, email);
  const meta = attachmentsOf(email.attachments).find((a) => a.id === input.attachmentId);
  if (!meta) throw new DomainError("connections.mailbox.attachmentNotFound", "אין במייל הזה קובץ מצורף עם המזהה הזה. המזהים מופיעים ב-attachments של המייל.");
  if (meta.unavailable) throw new DomainError("connections.mailbox.attachmentGone", "הקובץ המצורף כבר לא זמין אצל ספק הדואר.");
  const file = await guarded(row, () => getAttachment(row.unipileAccountId, input.emailId, input.attachmentId));
  const mimeType = meta.mimeType ?? file.mimeType;
  const extracted = await extractDocumentText(file.content, mimeType, meta.fileName ?? "");
  await used(actor, row, "attachment", { emailId: input.emailId, attachmentId: input.attachmentId, fileName: meta.fileName });
  const base = { mailbox: row.account, emailId: input.emailId, attachmentId: meta.id, fileName: meta.fileName, mimeType, sizeBytes: file.content.length };
  if (extracted.kind === "text") return { ...base, text: extracted.text, truncated: extracted.truncated, ...(extracted.pages ? { pages: extracted.pages } : {}) };
  if (extracted.kind === "image") return { ...base, text: null, note: "This attachment is an image. Ankora does not extract text from images." };
  return { ...base, text: null, note: extracted.reason };
}

// ---------------------------------------------------------------- setup

export async function mailboxSetup(actor: User, clientId: string | null, input: { mailbox?: string; include?: ("folders" | "contacts" | "categories")[]; contactsCursor?: string }) {
  const row = await resolveMailbox(actor, clientId, input.mailbox);
  const include = new Set(input.include?.length ? input.include : ["folders"]);
  const account = await guarded(row, () => readMailAccount(row.unipileAccountId));
  const out: Record<string, unknown> = { mailbox: row.account, provider: account.provider };
  if (include.has("folders")) {
    const folders = [];
    let cursor: string | undefined;
    // Folders and labels are few; a handful of pages covers any mailbox.
    for (let i = 0; i < 5; i++) {
      const page = await guarded(row, () => listFolders(row.unipileAccountId, cursor));
      folders.push(...page.items.map(folderOf).filter(Boolean));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    out.folders = folders;
  }
  if (include.has("contacts")) {
    const page = await guarded(row, () => listContacts(row.unipileAccountId, input.contactsCursor, 100));
    out.contacts = page.items.map(contactOf).filter(Boolean);
    out.contactsNextCursor = page.nextCursor;
  }
  if (include.has("categories")) {
    out.categories = account.provider === "outlook" ? (await guarded(row, () => listOutlookCategories(row.unipileAccountId))).map(categoryOf).filter(Boolean) : [];
  }
  await used(actor, row, "setup", { include: [...include] });
  return out;
}
