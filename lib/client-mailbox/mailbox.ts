import "server-only";
import type { ClientConnection, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { DomainError } from "@/lib/domain-error";
import { extractDocumentText } from "@/lib/document-text";
import { dayEndInZone, dayStartInZone } from "@/lib/timezone";
import {
  UnipileMailError,
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
} from "./unipile-mail";
import { attachmentsOf, categoryOf, contactOf, folderOf, fullOf, israelTimeOf, senderOf, summaryOf } from "./shape";

// A client's mailbox through the Ankora connector (26.11.2026, Ariel and
// Hadas: "לפי ההרשאות של אנקורה"):
//
// - Everyone who sees the client in Ankora may read its mailbox (Ariel,
//   26.11.2026). A client marked "בלי AI" is refused before this is reached
//   (lookupClient), and refused here again.
// - Every call is audited on the connection ("connection.mail_read"), with
//   what was read but never the content, and lastUsedAt moves.
// - Stage 2 (26.11.2026): drafts, sending, organising and the calendar are
//   in lib/client-mailbox/write.ts and calendar.ts, with the same rules.

export type MailboxRow = Pick<ClientConnection, "id" | "clientId" | "account" | "scopes" | "unipileAccountId" | "connectedAt" | "lastUsedAt">;

/// The client's live Unipile mailboxes.
async function mailboxesOf(clientId: string): Promise<MailboxRow[]> {
  return prisma.clientConnection.findMany({
    where: { clientId, kind: "UNIPILE_MAIL", revokedAt: null, unipileAccountId: { not: null } },
    select: { id: true, clientId: true, account: true, scopes: true, unipileAccountId: true, connectedAt: true, lastUsedAt: true },
    orderBy: { connectedAt: "asc" },
  });
}

/// The mailbox a call is about: the client's only one, or the one named.
export async function resolveMailbox(actor: User, clientId: string, mailbox?: string | null): Promise<MailboxRow & { unipileAccountId: string }> {
  await assertClientAccess(actor, clientId);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { aiExcluded: true } });
  if (!client || client.aiExcluded) {
    throw new DomainError("connections.mailbox.aiExcluded", "הלקוח מסומן \"בלי AI\", ולכן התיבה שלו לא נקראת דרך קלוד.");
  }
  const rows = await mailboxesOf(clientId);
  if (rows.length === 0) {
    throw new DomainError("connections.mailbox.none", "ללקוח הזה אין תיבת דואר מחוברת. מנהל התיק מחבר אותה במסך החיבורים של הלקוח באנקורה.");
  }
  const wanted = mailbox?.trim().toLowerCase();
  const row = wanted ? rows.find((r) => r.account.toLowerCase() === wanted) : rows.length === 1 ? rows[0] : undefined;
  if (!row) {
    const addresses = rows.map((r) => r.account).join(", ");
    throw wanted
      ? new DomainError("connections.mailbox.unknown", `לתיבה הזו אין חיבור אצל הלקוח. התיבות המחוברות: ${addresses}.`, { addresses })
      : new DomainError("connections.mailbox.which", `ללקוח יש כמה תיבות מחוברות. אומרים מאיזו לקרוא: ${addresses}.`, { addresses });
  }
  return row as MailboxRow & { unipileAccountId: string };
}

/// The audit row of a use: reading mail or the calendar, or (stage 2)
/// writing to them. What was done and on which item, never the content.
export type MailboxUse = "mail_read" | "mail_write" | "calendar_read" | "calendar_write";

export async function used(actor: User, row: MailboxRow, what: string, details: Record<string, unknown> = {}, use: MailboxUse = "mail_read") {
  await prisma.clientConnection.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  const calendar = use.startsWith("calendar");
  const write = use.endsWith("write");
  await recordAudit({
    actorId: actor.id,
    action: calendar ? (write ? "connection.calendar_write" : "connection.calendar_read") : write ? "connection.mail_write" : "connection.mail_read",
    entityType: "ClientConnection",
    entityId: row.id,
    clientId: row.clientId,
    after: { what, account: row.account, ...details },
  });
}

/// Runs a Unipile call. When it fails for a reason other than a missing item
/// or a rate limit, the account's own state says whether the mailbox has to
/// be reconnected, which is what the person can act on.
export async function guarded<T>(row: MailboxRow & { unipileAccountId: string }, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UnipileMailError && err.status !== null && err.status !== 404 && err.status !== 429) {
      const state = await readMailAccount(row.unipileAccountId).catch(() => null);
      if (state && mailboxNeedsReconnect(state.status)) {
        throw new DomainError("connections.mailbox.disconnected", `החיבור לתיבה ${row.account} נפל. מנהל התיק מחבר אותה מחדש במסך החיבורים של הלקוח.`, { account: row.account });
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

export async function mailboxStatus(actor: User, clientId: string) {
  await assertClientAccess(actor, clientId);
  const rows = await mailboxesOf(clientId);
  const out = [];
  for (const row of rows) {
    const account = await readMailAccount(row.unipileAccountId!).catch(() => null);
    let senders: ReturnType<typeof senderOf>[] = [];
    if (account?.status === "running" && account.provider !== "imap") {
      senders = (await listSenders(row.unipileAccountId!).catch(() => [])).map(senderOf).filter(Boolean);
    }
    out.push({
      mailbox: row.account,
      provider: account?.provider ?? null,
      state: account ? (account.status === "running" ? "connected" : mailboxNeedsReconnect(account.status) ? "needs_reconnect" : account.status) : "unknown",
      can: row.scopes,
      connectedAt: israelTimeOf(row.connectedAt.toISOString()),
      lastUsedAt: row.lastUsedAt ? israelTimeOf(row.lastUsedAt.toISOString()) : null,
      sendersAvailable: senders,
    });
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

export async function searchEmails(actor: User, clientId: string, input: SearchInput) {
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
  await used(actor, row, "search", { filters: Object.keys(filters).filter((k) => filters[k as keyof EmailFilters] !== undefined), count: page.items.length });
  return {
    mailbox: row.account,
    emails: page.items.map(summaryOf).filter(Boolean),
    nextCursor: page.nextCursor,
    total: page.total,
  };
}

// ---------------------------------------------------------------- read

export async function readEmail(actor: User, clientId: string, input: { mailbox?: string; emailId?: string; threadId?: string }) {
  const row = await resolveMailbox(actor, clientId, input.mailbox);
  if (input.threadId) {
    const thread = await guarded(row, () => getThread(row.unipileAccountId, input.threadId!));
    // Oldest first, as a conversation reads.
    const emails = [...thread.emails].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
    await used(actor, row, "thread", { threadId: thread.id, emails: emails.length });
    return { mailbox: row.account, threadId: thread.id, emails: fullOf(emails) };
  }
  if (!input.emailId) throw new DomainError("connections.mailbox.idRequired", "מעבירים מזהה של מייל או של שרשור.");
  const email = await guarded(row, () => getEmail(row.unipileAccountId, input.emailId!));
  await used(actor, row, "email", { emailId: input.emailId });
  return { mailbox: row.account, emails: fullOf([email]) };
}

export async function readAttachment(actor: User, clientId: string, input: { mailbox?: string; emailId: string; attachmentId: string }) {
  const row = await resolveMailbox(actor, clientId, input.mailbox);
  const email = await guarded(row, () => getEmail(row.unipileAccountId, input.emailId));
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

export async function mailboxSetup(actor: User, clientId: string, input: { mailbox?: string; include?: ("folders" | "contacts" | "categories")[]; contactsCursor?: string }) {
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
