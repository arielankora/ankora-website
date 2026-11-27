import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { DomainError } from "@/lib/domain-error";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { extractDocumentText } from "@/lib/document-text";
import { isExtractionAccount } from "@/lib/comms/extraction-account";
import { getAttachment, getEmail, getThread } from "@/lib/client-mailbox/unipile-mail";
import { attachmentsOf, fullOf } from "@/lib/client-mailbox/shape";
import { fromOf } from "./rules";
import { loadTeam } from "./channels";
import { isTeamAddress } from "./rules";

// Stage 3 of "התיבות שלי" (27.11.2026, Ariel): knowledge extraction from the
// emails recorded in scanned mailboxes, through the connector. What it reads:
//
// - threads with a client, in mailboxes that scan and whose extraction a
//   manager did not turn off, not held by a "לא לקרוא" request, of clients
//   the reader works with and not marked "בלי AI";
// - only the emails after where the extraction last read the thread
//   (extractedThroughAt), and never one from before scanning was turned on
//   (Ariel: no old emails);
// - who may: the extraction account (Ankora Ops, lib/comms/
//   extraction-account.ts), or the mailbox's own owner. Nobody else reads a
//   colleague's mailbox through here.
//
// The content is read from the mailbox at the moment it is asked for, and
// is never kept. Text is extracted from attachments; images and scans are
// not read in this stage (Ariel, 27.11.2026).

type Actor = Pick<User, "id" | "email" | "role">;

/// The threads this reader may extract from, with what is new in each.
async function readableThreads(actor: Actor, filter: { clientId?: string; threadId?: string } = {}) {
  const clients = (await listAccessibleClients(actor as User)).filter((c) => !c.aiExcluded);
  const allowed = new Set(clients.map((c) => c.id));
  if (filter.clientId && !allowed.has(filter.clientId)) return { rows: [], clients };
  const extraction = isExtractionAccount(actor.email);
  const rows = await prisma.mailThread.findMany({
    where: {
      ...(filter.threadId ? { id: filter.threadId } : {}),
      held: false,
      clientIds: filter.clientId ? { has: filter.clientId } : { hasSome: [...allowed] },
      channel: { scanEnabled: true, extractionAllowed: true, ...(extraction ? {} : { ownerUserId: actor.id }) },
    },
    include: { channel: { select: { accountId: true, address: true, scanStartedAt: true } } },
    orderBy: { lastEmailAt: "asc" },
  });
  // A thread that touches a client marked "בלי AI" is not read at all, even
  // when it is also another client's.
  const marked = new Set(
    (await prisma.client.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => r.clientIds))] }, aiExcluded: true }, select: { id: true } })).map((c) => c.id),
  );
  return { rows: rows.filter((r) => r.clientIds.some((id) => allowed.has(id)) && !r.clientIds.some((id) => marked.has(id))), clients };
}

/// "מה חדש לחילוץ": the threads with emails after the last extraction.
export async function threadsToExtract(actor: Actor, filter: { clientId?: string; limit?: number } = {}) {
  const { rows, clients } = await readableThreads(actor, { clientId: filter.clientId });
  const nameOf = new Map(clients.map((c) => [c.id, c.name]));
  return rows
    .filter((r) => !r.extractedThroughAt || r.lastEmailAt > r.extractedThroughAt)
    .slice(0, filter.limit ?? 50)
    .map((r) => ({
      thread: r.id,
      clients: r.clientIds.map((id) => nameOf.get(id)).filter((n): n is string => !!n),
      mailbox: r.channel.address,
      participants: r.participants,
      lastEmailAt: r.lastEmailAt.toISOString(),
      readThrough: r.extractedThroughAt?.toISOString() ?? null,
    }));
}

async function oneThread(actor: Actor, threadId: string) {
  const { rows, clients } = await readableThreads(actor, { threadId });
  const row = rows[0];
  if (!row) throw new DomainError("mailExtraction.threadNotFound", "השרשור לא נמצא, או שאין לך גישה לחלץ ממנו.");
  return { row, clients };
}

/// The new emails of one thread, oldest first: who wrote (and whether it is
/// the team), when, the text, and the attachments' ids. `all` reads the
/// emails already extracted too, for context, but never one from before
/// scanning started.
export async function readThreadForExtraction(actor: Actor, threadId: string, opts: { all?: boolean } = {}) {
  const { row, clients } = await oneThread(actor, threadId);
  const thread = await getThread(row.channel.accountId, row.externalThreadId);
  const floor = row.channel.scanStartedAt?.getTime() ?? 0;
  const since = opts.all ? floor : Math.max(floor, row.extractedThroughAt?.getTime() ?? 0);
  const dated = thread.emails
    .map((e) => ({ e, at: typeof e.date === "string" ? Date.parse(e.date) : Number.NaN }))
    .filter((x) => !Number.isNaN(x.at) && x.at >= floor && (opts.all ? true : x.at > since))
    .sort((a, b) => a.at - b.at);
  const team = await loadTeam();
  const full = fullOf(dated.map((x) => x.e));
  const emails = full.map((f, i) => {
    const from = fromOf(dated[i].e as Record<string, unknown>);
    return { ...f, sentAt: new Date(dated[i].at).toISOString(), fromTeam: from ? isTeamAddress(from, team) : false };
  });
  const nameOf = new Map(clients.map((c) => [c.id, c.name]));
  await recordAudit({ actorId: actor.id, action: "mail_thread.extraction_read", entityType: "MailThread", entityId: row.id, after: { emails: emails.length } });
  return {
    thread: row.id,
    clients: row.clientIds.map((id) => nameOf.get(id)).filter((n): n is string => !!n),
    mailbox: row.channel.address,
    readThrough: row.extractedThroughAt?.toISOString() ?? null,
    newestAt: dated.length ? new Date(dated[dated.length - 1].at).toISOString() : null,
    emails,
  };
}

/// The text of an attachment in a thread the reader may extract from.
/// Images and scans are not read in this stage.
export async function readThreadAttachment(actor: Actor, input: { thread: string; emailId: string; attachmentId: string }) {
  const { row } = await oneThread(actor, input.thread);
  const email = await getEmail(row.channel.accountId, input.emailId);
  if (email.thread_id !== row.externalThreadId) throw new DomainError("mailExtraction.notInThread", "המייל הזה לא שייך לשרשור.");
  const meta = attachmentsOf(email.attachments).find((a) => a.id === input.attachmentId);
  if (!meta) throw new DomainError("connections.mailbox.attachmentNotFound", "אין במייל הזה קובץ מצורף עם המזהה הזה. המזהים מופיעים ב-attachments של המייל.");
  if (meta.unavailable) throw new DomainError("connections.mailbox.attachmentGone", "הקובץ המצורף כבר לא זמין אצל ספק הדואר.");
  const file = await getAttachment(row.channel.accountId, input.emailId, input.attachmentId);
  const mimeType = meta.mimeType ?? file.mimeType;
  const extracted = await extractDocumentText(file.content, mimeType, meta.fileName ?? "");
  await recordAudit({ actorId: actor.id, action: "mail_thread.extraction_attachment", entityType: "MailThread", entityId: row.id, after: { fileName: meta.fileName } });
  const base = { thread: row.id, emailId: input.emailId, attachmentId: meta.id, fileName: meta.fileName, mimeType };
  if (extracted.kind === "text") return { ...base, text: extracted.text, truncated: extracted.truncated };
  if (extracted.kind === "image") return { ...base, text: null, note: "An image or a scan: not read in this stage." };
  return { ...base, text: null, note: extracted.reason };
}

/// The extraction read the thread up to `through`: the next run starts
/// after it. Never moves back.
export async function markThreadsExtracted(actor: Actor, items: Array<{ thread: string; through: string }>) {
  const done: string[] = [];
  for (const item of items) {
    const at = new Date(item.through);
    if (Number.isNaN(at.getTime())) throw new DomainError("mailExtraction.badTime", "`through` צריך להיות זמן ISO, כמו newestAt שחזר מקריאת השרשור.");
    const { row } = await oneThread(actor, item.thread);
    if (!row.extractedThroughAt || at > row.extractedThroughAt) {
      await prisma.mailThread.update({ where: { id: row.id }, data: { extractedThroughAt: at > row.lastEmailAt ? row.lastEmailAt : at } });
    }
    done.push(row.id);
  }
  return done;
}

/// Whether a thread belongs to a client, for a source in its register.
export async function threadOfClient(threadId: string, clientId: string): Promise<boolean> {
  const row = await prisma.mailThread.findUnique({ where: { id: threadId }, select: { clientIds: true } });
  return Boolean(row?.clientIds.includes(clientId));
}

/// Whether this reader may extract from the thread for this client.
export async function canExtractThread(actor: Actor, threadId: string, clientId: string): Promise<boolean> {
  const { rows } = await readableThreads(actor, { threadId, clientId });
  return rows.length > 0;
}
