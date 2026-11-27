import "server-only";
import crypto from "node:crypto";
import type { MailChannel, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { canManageClients } from "@/lib/app-auth/permissions";
import { DomainError } from "@/lib/domain-error";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { CHANNEL_PERSON_WHERE } from "@/lib/comms/channel-people";
import { alertAdmins } from "@/lib/comms/admin-alert";
import { addAccountToWebhook } from "@/lib/comms/self-connect";
import {

  createMailboxLink,
  getEmail,
  isMailProvider,
  listEmails,
  mailboxNeedsReconnect,
  readMailAccount,
  removeMailAccount,
} from "@/lib/client-mailbox/unipile-mail";
import { onThreadEmail } from "./waits";
import { SENT_KEEP_DAYS, recipientsOf } from "./wait-rules";
import {
  TEAM_DOMAINS,
  decideEmail,
  fromOf,
  participantsOf,
  suggestMailboxKind,
  threadBlockState,
  topSenders,
  type ClientLookup,
  type Team,
} from "./rules";

// "התיבות שלי" (27.11.2026, Ariel: "יוניפייל גם לתיבות של אנקורה כמו שיש
// לווצאפ"). An employee connects the mailboxes they work from, their own
// Ankora mailbox or a client's (office@grantor.co.il), the way they connect
// their own WhatsApp (lib/comms/self-connect.ts):
//   1. "חיבור תיבת דואר": a Unipile Hosted Auth link; they sign in on
//      Google's or Microsoft's own screen and come back here.
//   2. "של מי התיבה": an Ankora mailbox (several clients), or a client's.
//   3. "מה לא לקרוא", then "הפעלת סריקה".
// From then on Unipile's webhook tells Ankora of each new email, and a
// thread with a client is recorded: who and when, never the content. A
// client's mailbox already connected on the client's connections screen
// is not connected twice: the channel reads the same Unipile account.

export const MAIL_CONNECT_COOKIE = "ankora_mail_connect";
export const MAIL_CONNECT_MINUTES = 30;
/// How far back "מה לא לקרוא" looks for the senders it offers.
const SENDER_DAYS = 30;

export type MailConnectIntent = {
  userId: string;
  /// The mailbox being reconnected, or null for a new one.
  channelId: string | null;
  issuedAt: number;
};

function intentKey(): string {
  const key = process.env.AUTH_SECRET?.trim();
  if (!key) throw new Error("AUTH_SECRET is not set");
  return key;
}

function mac(body: string, key: string): string {
  return crypto.createHmac("sha256", key).update(`mail-connect.${body}`).digest("base64url");
}

export function signMailIntent(intent: MailConnectIntent, key = intentKey()): string {
  const body = Buffer.from(JSON.stringify(intent)).toString("base64url");
  return `${body}.${mac(body, key)}`;
}

/// The intent, when the cookie is ours, untouched and not older than the link.
export function readMailIntent(value: string | undefined, now = Date.now(), key = intentKey()): MailConnectIntent | null {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = mac(body, key);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const intent = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as MailConnectIntent;
    if (typeof intent.userId !== "string" || typeof intent.issuedAt !== "number") return null;
    if (intent.channelId !== null && typeof intent.channelId !== "string") return null;
    if (now - intent.issuedAt > MAIL_CONNECT_MINUTES * 60_000 || intent.issuedAt > now + 60_000) return null;
    return intent;
  } catch {
    return null;
  }
}

type Actor = Pick<User, "id" | "role">;

function isManager(actor: Actor): boolean {
  return canManageClients(actor.role);
}

/// The mailbox, for its owner or a manager; anyone else is refused.
async function channelFor(actor: Actor, channelId: string): Promise<MailChannel> {
  const channel = await prisma.mailChannel.findUnique({ where: { id: channelId } });
  if (!channel) throw new DomainError("mailScan.channelNotFound", "התיבה לא נמצאה.");
  if (channel.ownerUserId !== actor.id && !isManager(actor)) throw new DomainError("mailScan.notYourMailbox", "אפשר לשנות רק תיבה שלך.");
  return channel;
}

/// The team: its domain and every staff member's address.
export async function loadTeam(): Promise<Team> {
  const staff = await prisma.user.findMany({ where: { role: { not: "CLIENT_USER" }, deletedAt: null }, select: { email: true } });
  return { domains: TEAM_DOMAINS, emails: new Set(staff.map((u) => u.email.trim().toLowerCase())) };
}

/// Domain -> clients, from every live client's file.
async function domainsOfClients(): Promise<Map<string, string[]>> {
  const rows = await prisma.clientDomain.findMany({
    where: { deletedAt: null, client: { deletedAt: null } },
    select: { domain: true, clientId: true },
  });
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.domain, [...(map.get(r.domain) ?? []), r.clientId]);
  return map;
}

/// Address -> clients whose file has a contact with that exact address.
async function contactsOf(addresses: readonly string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!addresses.length) return map;
  const people = await prisma.person.findMany({
    where: { emails: { hasSome: [...addresses] } },
    select: { emails: true, contacts: { where: { deletedAt: null, client: { deletedAt: null } }, select: { clientId: true } } },
  });
  for (const person of people) {
    for (const e of person.emails) {
      if (!addresses.includes(e)) continue;
      const ids = new Set([...(map.get(e) ?? []), ...person.contacts.map((c) => c.clientId)]);
      map.set(e, [...ids]);
    }
  }
  return map;
}

// ---------------------------------------------------------------- connecting

/// Step 1: the Hosted Auth link, and the cookie that must come back with it.
/// With a channel id, the reconnect of that mailbox (its owner, or a manager).
export async function createMailConnectLink(
  actor: Actor,
  input: { redirectUri: string; channelId?: string | null },
  now = Date.now(),
): Promise<{ link: string; cookie: string }> {
  const channel = input.channelId ? await channelFor(actor, input.channelId) : null;
  const intent: MailConnectIntent = { userId: actor.id, channelId: channel?.id ?? null, issuedAt: now };
  const cookie = signMailIntent(intent);
  const link = await createMailboxLink({
    redirectUri: input.redirectUri,
    expiresOn: new Date(now + MAIL_CONNECT_MINUTES * 60_000).toISOString(),
    state: cookie,
    reconnectAccountId: channel?.accountId ?? null,
  });
  return { link, cookie };
}

export type MailConnectResult = "connected" | "reconnected" | "reused" | "expired" | "failed" | "wrong-provider" | "taken";

/// Step 1, the way back. The account id in the URL counts only with this
/// user's signed cookie, and a new mailbox must be a mail account Unipile
/// linked after the button was pressed.
export async function completeMailConnect(
  user: Pick<User, "id" | "role" | "name" | "email">,
  intent: MailConnectIntent | null,
  query: { accountId: string | null; errorType: string | null },
): Promise<{ result: MailConnectResult; channelId: string | null }> {
  if (!intent || intent.userId !== user.id) return { result: "expired", channelId: null };
  if (query.errorType || !query.accountId || !/^acc_[A-Za-z0-9_-]+$/.test(query.accountId)) return { result: "failed", channelId: null };
  const accountId = query.accountId;
  const account = await readMailAccount(accountId);
  if (!isMailProvider(account.provider)) return { result: "wrong-provider", channelId: null };

  if (intent.channelId) {
    const channel = await prisma.mailChannel.findUnique({ where: { id: intent.channelId } });
    if (!channel || channel.accountId !== accountId) return { result: "failed", channelId: null };
    if (channel.ownerUserId !== user.id && !isManager(user)) return { result: "failed", channelId: null };
    await recordAudit({ actorId: user.id, action: "mail_channel.reconnected", entityType: "MailChannel", entityId: channel.id });
    return { result: "reconnected", channelId: channel.id };
  }

  const existing = await prisma.mailChannel.findUnique({ where: { accountId } });
  if (existing) return { result: existing.ownerUserId === user.id ? "connected" : "taken", channelId: existing.ownerUserId === user.id ? existing.id : null };
  if (!account.createdAt || Date.parse(account.createdAt) < intent.issuedAt - 5 * 60_000) return { result: "taken", channelId: null };

  const address = (account.name ?? "").trim().toLowerCase();
  if (!address) return { result: "failed", channelId: null };

  // The same mailbox under another account: one connection is enough, and
  // the new account would only be billed. It is removed at Unipile.
  const sameAddress = await prisma.mailChannel.findFirst({ where: { address } });
  if (sameAddress) {
    await dropAccount(accountId);
    return sameAddress.ownerUserId === user.id ? { result: "connected", channelId: sameAddress.id } : { result: "taken", channelId: null };
  }
  const clientMailbox = await prisma.clientConnection.findFirst({
    where: { kind: "UNIPILE_MAIL", account: address, revokedAt: null, unipileAccountId: { not: null } },
    select: { id: true, clientId: true, unipileAccountId: true },
  });

  const team = await loadTeam();
  const ankora = suggestMailboxKind(address, team, new Map()).kind === "ANKORA";
  const channel = await prisma.mailChannel.create({
    data: clientMailbox
      ? { accountId: clientMailbox.unipileAccountId!, address, ownerUserId: user.id, clientId: clientMailbox.clientId, kindChosenAt: new Date() }
      : { accountId, address, ownerUserId: user.id, clientId: null, kindChosenAt: ankora ? new Date() : null },
  });
  if (clientMailbox) await dropAccount(accountId);
  await recordAudit({
    actorId: user.id,
    action: clientMailbox ? "mail_channel.reused" : "mail_channel.connected",
    entityType: "MailChannel",
    entityId: channel.id,
    after: { address, clientId: channel.clientId, clientConnectionId: clientMailbox?.id ?? null, provider: account.provider },
  });

  const owner = user.name || user.email;
  try {
    await addAccountToWebhook(channel.accountId);
  } catch (err) {
    console.error("mail-scan: could not add the account to the webhook", { channelId: channel.id }, err);
    await alertAdmins({
      type: "webhook_account_failed",
      subjectId: channel.id,
      entityType: "MailChannel",
      render: (t) => ({
        title: t("mailWebhookAccountFailed.title", { owner }),
        body: t("mailWebhookAccountFailed.body", { owner, error: err instanceof Error ? err.message : String(err) }),
      }),
    });
  }
  return { result: clientMailbox ? "reused" : "connected", channelId: channel.id };
}

async function dropAccount(accountId: string) {
  try {
    await removeMailAccount(accountId);
  } catch (err) {
    console.error("mail-scan: could not remove a duplicate Unipile account", err);
  }
}

/// Step 2: "של מי התיבה". An Ankora mailbox, or a client's that the actor
/// works with. Not after scanning started on a client's mailbox: changing
/// whose it is would change what was recorded.
export async function chooseMailboxKind(actor: Actor, channelId: string, choice: { kind: "ANKORA" } | { kind: "CLIENT"; clientId: string }) {
  const channel = await channelFor(actor, channelId);
  if (channel.scanEnabled) throw new DomainError("mailScan.kindAfterScan", "אי אפשר לשנות של מי התיבה אחרי שהסריקה הופעלה.");
  let clientId: string | null = null;
  if (choice.kind === "CLIENT") {
    const reachable = await listAccessibleClients(actor as User);
    if (!reachable.some((c) => c.id === choice.clientId)) throw new DomainError("mailScan.clientNotYours", "הלקוח הזה לא ברשימת הלקוחות שלך.");
    clientId = choice.clientId;
  }
  await prisma.mailChannel.update({ where: { id: channel.id }, data: { clientId, kindChosenAt: new Date() } });
  await recordAudit({
    actorId: actor.id,
    action: "mail_channel.kind_chosen",
    entityType: "MailChannel",
    entityId: channel.id,
    before: { clientId: channel.clientId },
    after: { clientId },
  });
}

/// What "של מי התיבה" offers: the clients the actor works with, those whose
/// file has the mailbox's domain first.
export async function kindOptions(actor: Actor, channel: Pick<MailChannel, "address">) {
  const reachable = await listAccessibleClients(actor as User);
  const suggestion = suggestMailboxKind(channel.address, await loadTeam(), await domainsOfClients());
  const suggested = suggestion.kind === "CLIENT" ? suggestion.clientIds.filter((id) => reachable.some((c) => c.id === id)) : [];
  const clients = [...reachable].sort((a, b) => Number(suggested.includes(b.id)) - Number(suggested.includes(a.id)) || a.name.localeCompare(b.name, "he"));
  return { suggestedKind: suggestion.kind, suggested, clients: clients.map((c) => ({ id: c.id, name: c.name })) };
}

// ---------------------------------------------------------------- "מה לא לקרוא"

/// The outside senders of the last 30 days, most frequent first, each with
/// whether a block already covers it.
export async function senderSuggestions(channel: Pick<MailChannel, "id" | "accountId" | "address">, now = new Date()) {
  const after = new Date(now.getTime() - SENDER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const page = await listEmails(channel.accountId, { after, limit: 100 });
  const emails = page.items.map((e) => {
    const from = fromOf(e as Record<string, unknown>);
    const first = Array.isArray(e.from) ? (e.from[0] as { display_name?: unknown } | undefined) : undefined;
    return { from, name: typeof first?.display_name === "string" && first.display_name.trim() ? first.display_name.trim() : null };
  });
  const blocks = await prisma.mailBlock.findMany({ where: { channelId: channel.id } });
  return topSenders(emails, { address: channel.address, team: await loadTeam() }).map((s) => ({
    ...s,
    blocked: threadBlockState(blocks, [s.address]) !== "none",
  }));
}

/// "לא לקרוא". A manager's takes effect at once and deletes what was
/// recorded; the owner's holds it until a manager decides.
export async function requestMailBlock(
  actor: Actor,
  input: { channelId: string; kind: "ADDRESS" | "DOMAIN"; value: string; label: string | null },
) {
  const channel = await channelFor(actor, input.channelId);
  const manager = isManager(actor);
  const status = manager ? "APPROVED" : "PENDING";
  const now = new Date();
  const block = await prisma.mailBlock.upsert({
    where: { channelId_kind_value: { channelId: channel.id, kind: input.kind, value: input.value } },
    create: {
      channelId: channel.id,
      kind: input.kind,
      value: input.value,
      label: input.label,
      status,
      requestedById: actor.id,
      decidedById: manager ? actor.id : null,
      decidedAt: manager ? now : null,
    },
    update: { status, label: input.label, requestedById: actor.id, requestedAt: now, decidedById: manager ? actor.id : null, decidedAt: manager ? now : null },
  });
  const affected = await threadsHitBy(channel.id, block);
  if (manager) await prisma.mailThread.deleteMany({ where: { id: { in: affected } } });
  else await prisma.mailThread.updateMany({ where: { id: { in: affected } }, data: { held: true } });
  await recordAudit({
    actorId: actor.id,
    action: manager ? "mail_block.approved" : "mail_block.requested",
    entityType: "MailBlock",
    entityId: block.id,
    after: { kind: input.kind, deletedThreads: manager ? affected.length : 0 },
  });
  return block;
}

/// The recorded threads one block covers.
async function threadsHitBy(channelId: string, block: { kind: "ADDRESS" | "DOMAIN"; value: string }): Promise<string[]> {
  const threads = await prisma.mailThread.findMany({ where: { channelId }, select: { id: true, participants: true } });
  const one = [{ ...block, status: "APPROVED" as const }];
  return threads.filter((t) => threadBlockState(one, t.participants) !== "none").map((t) => t.id);
}

/// A manager answers an owner's request.
export async function decideMailBlock(actor: Actor, blockId: string, approve: boolean) {
  if (!isManager(actor)) throw new DomainError("mailScan.managerDecides", "רק מנהל מחליט על \"לא לקרוא\".");
  const block = await prisma.mailBlock.findUnique({ where: { id: blockId } });
  if (!block || block.status !== "PENDING") throw new DomainError("mailScan.alreadyHandled", "הבקשה כבר טופלה.");
  await prisma.mailBlock.update({ where: { id: blockId }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: actor.id, decidedAt: new Date() } });
  const affected = await threadsHitBy(block.channelId, block);
  if (approve) await prisma.mailThread.deleteMany({ where: { id: { in: affected } } });
  else await unholdIfFree(block.channelId, affected);
  await recordAudit({
    actorId: actor.id,
    action: approve ? "mail_block.approved" : "mail_block.rejected",
    entityType: "MailBlock",
    entityId: blockId,
    after: { deletedThreads: approve ? affected.length : 0 },
  });
}

/// Threads no pending block holds any more.
async function unholdIfFree(channelId: string, threadIds: string[]) {
  if (!threadIds.length) return;
  const pending = await prisma.mailBlock.findMany({ where: { channelId, status: "PENDING" } });
  const threads = await prisma.mailThread.findMany({ where: { id: { in: threadIds } }, select: { id: true, participants: true } });
  const free = threads.filter((t) => threadBlockState(pending, t.participants) === "none").map((t) => t.id);
  if (free.length) await prisma.mailThread.updateMany({ where: { id: { in: free } }, data: { held: false } });
}

/// Only a manager lifts a block. What was deleted stays deleted.
export async function revokeMailBlock(actor: Actor, blockId: string) {
  if (!isManager(actor)) throw new DomainError("mailScan.managerRevokes", "רק מנהל מבטל \"לא לקרוא\".");
  const block = await prisma.mailBlock.findUnique({ where: { id: blockId } });
  if (!block || block.status !== "APPROVED") throw new DomainError("mailScan.notActive", "הסימון לא פעיל.");
  await prisma.mailBlock.update({ where: { id: blockId }, data: { status: "REVOKED", decidedById: actor.id, decidedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "mail_block.revoked", entityType: "MailBlock", entityId: blockId });
}

// ---------------------------------------------------------------- the switch, and the settings

/// "הפעלת סריקה". Only after "של מי התיבה" was answered.
export async function startScanning(actor: Actor, channelId: string) {
  const channel = await channelFor(actor, channelId);
  if (!channel.kindChosenAt) throw new DomainError("mailScan.kindFirst", "קודם בוחרים של מי התיבה.");
  if (channel.scanEnabled) return;
  await prisma.mailChannel.update({ where: { id: channel.id }, data: { scanEnabled: true, scanStartedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "mail_channel.scan_started", entityType: "MailChannel", entityId: channel.id });
}

/// As on a WhatsApp number: a manager may turn off extraction from a mailbox.
export async function setMailExtractionAllowed(actor: Actor, channelId: string, allowed: boolean) {
  if (!isManager(actor)) throw new DomainError("mailScan.managerOnly", "רק מנהל משנה את זה.");
  const channel = await channelFor(actor, channelId);
  if (channel.extractionAllowed === allowed) return;
  await prisma.mailChannel.update({ where: { id: channel.id }, data: { extractionAllowed: allowed } });
  await recordAudit({
    actorId: actor.id,
    action: "mail_channel.extraction_updated",
    entityType: "MailChannel",
    entityId: channel.id,
    before: { extractionAllowed: channel.extractionAllowed },
    after: { extractionAllowed: allowed },
  });
}

/// A manager hands a mailbox to someone else who can sign in.
export async function changeMailOwner(actor: Actor, channelId: string, ownerUserId: string) {
  if (!isManager(actor)) throw new DomainError("mailScan.managerOnly", "רק מנהל משנה את זה.");
  const channel = await channelFor(actor, channelId);
  const owner = await prisma.user.findFirst({ where: { ...CHANNEL_PERSON_WHERE, id: ownerUserId }, select: { id: true } });
  if (!owner) throw new DomainError("mailScan.ownerMustBeActive", "הבעלים צריך להיות משתמש פעיל בצוות.");
  if (owner.id === channel.ownerUserId) return;
  await prisma.mailChannel.update({ where: { id: channel.id }, data: { ownerUserId: owner.id } });
  await recordAudit({
    actorId: actor.id,
    action: "mail_channel.owner_changed",
    entityType: "MailChannel",
    entityId: channel.id,
    before: { ownerUserId: channel.ownerUserId },
    after: { ownerUserId: owner.id },
  });
}

// ---------------------------------------------------------------- the webhook

export type RecordResult = "recorded" | "updated" | "same" | "not-scanning" | "team" | "blocked" | "no-client" | "no-thread";

/// email.new from Unipile, for a mailbox that scans: the thread is recorded
/// if it is with a client, with who and when, never what was written.
export async function recordMailEvent(accountId: string, emailId: string): Promise<RecordResult> {
  const channel = await prisma.mailChannel.findUnique({ where: { accountId }, include: { blocks: true } });
  if (!channel?.scanEnabled) return "not-scanning";
  const email = (await getEmail(accountId, emailId)) as Record<string, unknown>;
  const threadId = typeof email.thread_id === "string" && email.thread_id ? email.thread_id : null;
  if (!threadId) return "no-thread";
  const participants = participantsOf(email);
  const at = typeof email.date === "string" && !Number.isNaN(Date.parse(email.date)) ? new Date(email.date) : new Date();
  const from = fromOf(email);
  const existing = await prisma.mailThread.findUnique({ where: { channelId_externalThreadId: { channelId: channel.id, externalThreadId: threadId } } });
  if (existing?.lastEmailId === emailId) return "same";

  // Stage 2: a reply in a thread a task follows ends the wait, whatever
  // else is decided below; and a followed thread is always recorded.
  const followed = await onThreadEmail(channel, { externalThreadId: threadId, emailId, from, at });
  const team = await loadTeam();
  const lookup: ClientLookup = { byDomain: await domainsOfClients(), byAddress: await contactsOf(participants) };
  const decision = decideEmail({ participants, mailbox: { address: channel.address, clientId: channel.clientId }, blocks: channel.blocks, team, lookup });
  const sentByOwner = from === channel.address;
  let keepUntil: Date | null = null;
  if (!decision.record) {
    if (decision.reason === "blocked") return "blocked";
    // An email the owner sent to someone who is no client's (a supplier, a
    // colleague) is kept 14 days, to be picked on "ממתינים לתשובה למייל".
    if (!followed && !sentByOwner) return decision.reason;
    if (!followed) keepUntil = new Date(Date.now() + SENT_KEEP_DAYS * 24 * 60 * 60 * 1000);
  }
  const clientIds = decision.record ? decision.clientIds : [];
  const held = decision.record ? decision.held : false;
  const sent = sentByOwner ? { lastSentAt: at, lastSentTo: recipientsOf(participants, channel.address) } : {};

  if (existing) {
    const newer = at >= existing.lastEmailAt;
    const stillTemporary = keepUntil !== null && existing.keepUntil !== null;
    await prisma.mailThread.update({
      where: { id: existing.id },
      data: {
        clientIds: [...new Set([...existing.clientIds, ...clientIds])].sort(),
        participants: [...new Set([...existing.participants, ...participants])],
        senders: from && !existing.senders.includes(from) ? [...existing.senders, from] : existing.senders,
        emailCount: { increment: 1 },
        held: existing.held || held,
        keepUntil: stillTemporary ? keepUntil : null,
        ...(newer ? { lastEmailId: emailId, lastEmailAt: at, lastFromAddress: from, ...sent } : {}),
      },
    });
  } else {
    await prisma.mailThread.create({
      data: {
        channelId: channel.id,
        externalThreadId: threadId,
        clientIds,
        participants,
        lastEmailId: emailId,
        lastEmailAt: at,
        lastFromAddress: from,
        senders: from ? [from] : [],
        held,
        keepUntil,
        ...sent,
      },
    });
  }
  if (decision.record && (!channel.lastEmailAt || at > channel.lastEmailAt)) await prisma.mailChannel.update({ where: { id: channel.id }, data: { lastEmailAt: at } });
  return existing ? "updated" : "recorded";
}

// ---------------------------------------------------------------- what the screens and the connector show

export type MailboxState = "choose-kind" | "not-scanning" | "scanning" | "disconnected" | "unknown";

/// Unipile's state of each mailbox, and the step it is at.
export function mailboxState(channel: Pick<MailChannel, "kindChosenAt" | "scanEnabled">, unipileStatus: string | null): MailboxState {
  if (unipileStatus !== null && mailboxNeedsReconnect(unipileStatus)) return "disconnected";
  if (!channel.kindChosenAt) return "choose-kind";
  if (!channel.scanEnabled) return "not-scanning";
  return unipileStatus === null ? "unknown" : "scanning";
}

async function statusOf(accountId: string): Promise<string | null> {
  try {
    return (await readMailAccount(accountId)).status;
  } catch {
    return null;
  }
}

/// The mailboxes this person may see: their own, or every one for a manager.
export async function visibleMailboxes(actor: Actor, opts: { onlyOwn?: boolean } = {}) {
  const channels = await prisma.mailChannel.findMany({
    where: opts.onlyOwn || !isManager(actor) ? { ownerUserId: actor.id } : {},
    include: {
      owner: { select: { id: true, name: true, email: true } },
      client: { select: { id: true, name: true, aiExcluded: true } },
      blocks: { orderBy: { requestedAt: "desc" } },
      _count: { select: { threads: { where: { clientIds: { isEmpty: false } } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  const statuses = await Promise.all(channels.map((c) => statusOf(c.accountId)));
  const clientCounts = await Promise.all(
    channels.map(async (c) => new Set((await prisma.mailThread.findMany({ where: { channelId: c.id }, select: { clientIds: true } })).flatMap((t) => t.clientIds)).size),
  );
  return channels.map((c, i) => ({ ...c, unipileStatus: statuses[i], state: mailboxState(c, statuses[i]), clientCount: clientCounts[i] }));
}

/// For the connector: each mailbox, whose, whose client, its state and when
/// it last recorded something. Never an email.
export async function mailboxStatusForAi(actor: Actor) {
  const rows = await visibleMailboxes(actor);
  return rows.map((c) => ({
    address: c.address,
    owner: c.owner.name || c.owner.email,
    kind: c.clientId ? "CLIENT" : c.kindChosenAt ? "ANKORA" : null,
    // A client marked "בלי AI" is not named to Claude (lib/ai-exclusion.ts).
    client: c.client && !c.client.aiExcluded ? c.client.name : null,
    clientAiExcluded: c.client?.aiExcluded ? true : undefined,
    state: c.state,
    scanStartedAt: c.scanStartedAt?.toISOString() ?? null,
    lastEmailAt: c.lastEmailAt?.toISOString() ?? null,
    threadsRecorded: c._count.threads,
    clientsInThreads: c.clientCount,
    extractionAllowed: c.extractionAllowed,
    pendingDoNotRead: c.blocks.filter((b) => b.status === "PENDING").length,
    doNotRead: c.blocks
      .filter((b) => b.status === "PENDING" || b.status === "APPROVED")
      .map((b) => ({ value: b.value, kind: b.kind, status: b.status, label: b.label })),
  }));
}



// ---------------------------------------------------------------- the connector

/// The mailbox a connector call is about: the one with this address (the
/// actor's own, or any for a manager), or the actor's only one.
export async function mailboxFor(actor: Actor, address?: string | null): Promise<MailChannel> {
  const own = isManager(actor) && address ? {} : { ownerUserId: actor.id };
  const rows = await prisma.mailChannel.findMany({ where: { ...own, ...(address ? { address: address.trim().toLowerCase() } : {}) }, orderBy: { createdAt: "asc" } });
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new DomainError("mailScan.channelNotFound", "התיבה לא נמצאה.");
  throw new DomainError("mailScan.whichMailbox", "יש לך יותר מתיבה אחת: צריך לציין את כתובת התיבה.");
}

/// A "לא לקרוא" entry of a mailbox, by what it says ("bank.co.il").
export async function blockByValue(channelId: string, value: string) {
  const block = await prisma.mailBlock.findFirst({ where: { channelId, value: value.trim().toLowerCase() }, orderBy: { requestedAt: "desc" } });
  if (!block) throw new DomainError("mailScan.blockNotFound", "אין ברשימת \"לא לקרוא\" של התיבה כתובת או דומיין כאלה.");
  return block;
}
