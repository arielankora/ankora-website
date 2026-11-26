import "server-only";
import crypto from "node:crypto";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { assertManagesConnections } from "@/lib/app-domain/connections";
import { DomainError } from "@/lib/domain-error";
import { capabilitiesOf, createMailboxLink, isMailProvider, readMailAccount, removeMailAccount } from "./unipile-mail";

// Connecting a client's mailbox and calendar through Unipile (26.11.2026,
// Ariel and Hadas), the way an employee connects their own WhatsApp
// (lib/comms/self-connect.ts):
//   1. On the client's connections screen, a manager or the account manager
//      presses "חיבור תיבת דואר ויומן". Ankora asks Unipile for a Hosted
//      Auth link and sends them to it, or copies it to send to the client.
//   2. Whoever holds the mailbox signs in on Google's (or Microsoft's) own
//      screen. No password ever reaches Ankora.
//   3. Unipile sends the browser back here with the account id, and the
//      mailbox is added to the client's connections.
//
// The way back carries only an account id, which anyone could type. It
// counts only with the signed intent made when the button was pressed,
// which Unipile hands back as `state` (the link is often opened in the
// client's browser, where nobody is signed in to Ankora), and a new mailbox
// must be a mail account Unipile linked after that and that no client has
// yet.
/// A link sent to the client may wait a while before they open it.
export const MAILBOX_LINK_HOURS = 24;

export type MailboxIntent = {
  userId: string;
  clientId: string;
  /// The connection being reconnected, or null for a new mailbox.
  connectionId: string | null;
  issuedAt: number;
};

function intentKey(): string {
  const key = process.env.AUTH_SECRET?.trim();
  if (!key) throw new Error("AUTH_SECRET is not set");
  return key;
}

function mac(body: string, key: string): string {
  return crypto.createHmac("sha256", key).update(`mailbox-connect.${body}`).digest("base64url");
}

export function signMailboxIntent(intent: MailboxIntent, key = intentKey()): string {
  const body = Buffer.from(JSON.stringify(intent)).toString("base64url");
  return `${body}.${mac(body, key)}`;
}

/// The intent, when it is ours, untouched and not older than the link.
export function readMailboxIntent(value: string | null | undefined, now = Date.now(), key = intentKey()): MailboxIntent | null {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = mac(body, key);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const intent = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as MailboxIntent;
    if (typeof intent.userId !== "string" || typeof intent.clientId !== "string" || typeof intent.issuedAt !== "number") return null;
    if (now - intent.issuedAt > MAILBOX_LINK_HOURS * 3_600_000 || intent.issuedAt > now + 60_000) return null;
    return intent;
  } catch {
    return null;
  }
}

/// Step 1: the Hosted Auth link, and the signed intent that must come back.
export async function createMailboxConnectLink(
  actor: User,
  input: { clientId: string; connectionId?: string | null; redirectUri: string },
  now = Date.now(),
): Promise<{ link: string; intent: string }> {
  await assertManagesConnections(actor, input.clientId);
  let reconnectAccountId: string | null = null;
  if (input.connectionId) {
    const row = await prisma.clientConnection.findUnique({ where: { id: input.connectionId } });
    if (!row || row.revokedAt || row.clientId !== input.clientId || row.kind !== "UNIPILE_MAIL" || !row.unipileAccountId) {
      throw new DomainError("connections.notFound", "החיבור לא נמצא.");
    }
    reconnectAccountId = row.unipileAccountId;
  }
  const intent = signMailboxIntent({ userId: actor.id, clientId: input.clientId, connectionId: input.connectionId ?? null, issuedAt: now });
  const link = await createMailboxLink({
    redirectUri: input.redirectUri,
    expiresOn: new Date(now + MAILBOX_LINK_HOURS * 3_600_000).toISOString(),
    state: intent,
    reconnectAccountId,
  });
  return { link, intent };
}

export type MailboxConnectResult = "connected" | "reconnected" | "expired" | "failed" | "wrongProvider" | "taken";

/// Step 3, the way back. Whoever's browser came back (the person who made
/// the link, or the client it was sent to), the connection is recorded as
/// made by the person who made the link, who must still be allowed to.
export async function completeMailboxConnect(
  intent: MailboxIntent | null,
  query: { accountId: string | null; error: string | null },
): Promise<{ result: MailboxConnectResult; clientId: string | null }> {
  if (!intent) return { result: "expired", clientId: null };
  const clientId = intent.clientId;
  if (query.error || !query.accountId || !/^acc_[A-Za-z0-9_-]+$/.test(query.accountId)) return { result: "failed", clientId };
  const maker = await prisma.user.findFirst({ where: { id: intent.userId, deletedAt: null, status: "ACTIVE" } });
  if (!maker) return { result: "expired", clientId };
  // The person who made the link must still be allowed to connect.
  await assertManagesConnections(maker, clientId);

  const accountId = query.accountId;
  const account = await readMailAccount(accountId);
  if (!isMailProvider(account.provider)) return { result: "wrongProvider", clientId };
  const provider = account.provider;
  const address = (account.name ?? accountId).trim().toLowerCase();

  if (intent.connectionId) {
    const row = await prisma.clientConnection.findUnique({ where: { id: intent.connectionId } });
    if (!row || row.revokedAt || row.clientId !== clientId || row.unipileAccountId !== accountId) return { result: "failed", clientId };
    await recordAudit({
      actorId: maker.id,
      action: "connection.reconnect",
      entityType: "ClientConnection",
      entityId: row.id,
      clientId,
      after: { kind: "UNIPILE_MAIL", account: row.account },
    });
    return { result: "reconnected", clientId };
  }

  const existing = await prisma.clientConnection.findUnique({ where: { unipileAccountId: accountId } });
  if (existing) return { result: existing.clientId === clientId && !existing.revokedAt ? "connected" : "taken", clientId };
  // A new mailbox is one Unipile linked after the link was made, so an
  // account id typed into the URL cannot claim an older account (the
  // WhatsApp numbers, or another client's mailbox).
  if (!account.createdAt || Date.parse(account.createdAt) < intent.issuedAt - 5 * 60_000) return { result: "taken", clientId };

  const row = await prisma.clientConnection.create({
    data: {
      clientId,
      kind: "UNIPILE_MAIL",
      account: address,
      scopes: capabilitiesOf(provider),
      unipileAccountId: accountId,
      consentText: `אושר במסך ההתחברות של ${provider === "google" ? "Google" : provider === "outlook" ? "Microsoft" : "ספק הדואר"} בידי ${address}`,
      connectedById: maker.id,
    },
  });
  await recordAudit({
    actorId: maker.id,
    action: "connection.add",
    entityType: "ClientConnection",
    entityId: row.id,
    clientId,
    after: { kind: "UNIPILE_MAIL", account: address, provider, capabilities: row.scopes },
  });
  return { result: "connected", clientId };
}

/// Disconnecting a Unipile mailbox: the account is removed at Unipile (its
/// tokens dropped, its billing stopped) before the row is closed.
export async function removeUnipileMailbox(unipileAccountId: string): Promise<void> {
  await removeMailAccount(unipileAccountId);
}
