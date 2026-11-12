import "server-only";
import { DomainError } from "@/lib/domain-error";
import { Prisma, type ConnectionKind, type User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { createCredential, deleteCredential, openConnectionSecret } from "@/lib/app-domain/credentials";
import { accessTokenFrom, revokeToken, type OAuthPurpose } from "@/lib/google-oauth";
import { rtlMimeMessage } from "@/lib/rtl-mail";

// Client connections (ADR 0001 section 24, task cmvtivumj000pjs08q9qj4t67,
// Ariel 4.11.2026): a client's mailbox and Drive that its procedures read
// from or write to, and the account manager's mailbox they send from.
//
// - Only a manager or the client's account manager connects or disconnects.
// - The secret goes to the vault (ClientCredential); this row never holds it.
// - Every use is audited before the secret is opened (openConnectionSecret).
// - Disconnecting revokes at Google, deletes the vault row, and keeps this
//   row with revokedAt, so the history still says what was connected.

export type ConnectionView = {
  id: string;
  kind: ConnectionKind;
  account: string;
  scopes: string[];
  ownerUserId: string | null;
  consentText: string | null;
  connectedAt: Date;
  connectedByName: string | null;
  lastUsedAt: Date | null;
  usedBy: number;
};

export const CONNECTION_KIND_LABELS: Record<ConnectionKind, string> = {
  GOOGLE_OAUTH: "Google של הלקוח",
  MAIL_APP_PASSWORD: "מייל של הלקוח, בסיסמת אפליקציה",
  MANAGER_SEND: "שליחה מהתיבה של מנהל התיק",
};

async function assertManagesConnections(actor: User, clientId: string) {
  await assertClientAccess(actor, clientId);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { accountManagerId: true } });
  if (!canManageClients(actor.role) && client?.accountManagerId !== actor.id) {
    throw new DomainError("connections.managersOnly", "רק מנהל או מנהל התיק של הלקוח מחברים מערכות של הלקוח.");
  }
}

export async function listConnections(actor: User, clientId: string): Promise<ConnectionView[]> {
  await assertClientAccess(actor, clientId);
  const rows = await prisma.clientConnection.findMany({ where: { clientId, revokedAt: null }, orderBy: { connectedAt: "asc" } });
  const people = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.connectedById) } }, select: { id: true, name: true } });
  // Which live procedures name each connection, so a disconnect says what stops.
  const versions = await prisma.processVersion.findMany({
    where: { status: { in: ["APPROVED", "DRAFT"] }, process: { clientId, deletedAt: null }, NOT: { flow: { equals: Prisma.DbNull } } },
    select: { processId: true, flow: true },
  });
  const uses = (id: string) => new Set(versions.filter((v) => JSON.stringify(v.flow).includes(`"${id}"`)).map((v) => v.processId)).size;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    account: r.account,
    scopes: r.scopes,
    ownerUserId: r.ownerUserId,
    consentText: r.consentText,
    connectedAt: r.connectedAt,
    connectedByName: people.find((p) => p.id === r.connectedById)?.name ?? null,
    lastUsedAt: r.lastUsedAt,
    usedBy: uses(r.id),
  }));
}

/// After Google's consent screen: the refresh token into the vault, and
/// the connection on the client's file.
export async function addGoogleConnection(
  actor: User,
  input: { clientId: string; purpose: OAuthPurpose; account: string; refreshToken: string; scopes: string[] }
): Promise<{ id: string }> {
  await assertManagesConnections(actor, input.clientId);
  const kind: ConnectionKind = input.purpose === "SEND" ? "MANAGER_SEND" : "GOOGLE_OAUTH";
  const cred = await createCredential(actor, {
    clientId: input.clientId,
    systemName: `חיבור לנהלים: ${input.account}`,
    username: input.account,
    password: input.refreshToken,
    notes: "נשמר אוטומטית בחיבור Google של הנהלים. לא עורכים כאן: מנתקים ומחברים מחדש במסך החיבורים.",
  });
  const row = await prisma.clientConnection.create({
    data: {
      clientId: input.clientId,
      kind,
      account: input.account,
      scopes: input.scopes,
      credentialId: cred.id,
      ownerUserId: kind === "MANAGER_SEND" ? actor.id : null,
      consentText: kind === "MANAGER_SEND" ? "מנהל התיק חיבר את התיבה שלו" : `אושר במסך של Google בידי ${input.account}`,
      connectedById: actor.id,
    },
  });
  await recordAudit({ actorId: actor.id, action: "connection.add", entityType: "ClientConnection", entityId: row.id, clientId: input.clientId, after: { kind, account: input.account, scopes: input.scopes } });
  return { id: row.id };
}

/// A client mailbox by app password (Ariel, 4.11.2026: the client handing
/// over access is their approval). Mail only; Drive has no password access.
export async function addAppPasswordConnection(
  actor: User,
  input: { clientId: string; account: string; appPassword: string; consentText: string }
): Promise<{ id: string }> {
  await assertManagesConnections(actor, input.clientId);
  const account = input.account.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) throw new DomainError("connections.invalidEmail", "כתובת המייל לא תקינה.");
  const password = input.appPassword.replace(/\s+/g, "");
  if (password.length < 8) throw new DomainError("connections.appPasswordTooShort", "סיסמת האפליקציה קצרה מדי.");
  if (!input.consentText.trim()) throw new DomainError("connections.consentRequired", "כותבים מי אצל הלקוח מסר את הגישה, ומתי.");
  const cred = await createCredential(actor, {
    clientId: input.clientId,
    systemName: `חיבור לנהלים: ${account}`,
    username: account,
    password,
    notes: "סיסמת אפליקציה לקריאת מייל בנהלים. לא עורכים כאן: מנתקים ומחברים מחדש במסך החיבורים.",
  });
  const row = await prisma.clientConnection.create({
    data: { clientId: input.clientId, kind: "MAIL_APP_PASSWORD", account, scopes: ["imap"], credentialId: cred.id, consentText: input.consentText.trim().slice(0, 300), connectedById: actor.id },
  });
  await recordAudit({ actorId: actor.id, action: "connection.add", entityType: "ClientConnection", entityId: row.id, clientId: input.clientId, after: { kind: "MAIL_APP_PASSWORD", account } });
  return { id: row.id };
}

export async function disconnect(actor: User, id: string): Promise<void> {
  const row = await prisma.clientConnection.findUnique({ where: { id } });
  if (!row || row.revokedAt) throw new DomainError("connections.notFound", "החיבור לא נמצא.");
  await assertManagesConnections(actor, row.clientId);
  if (row.credentialId) {
    if (row.kind !== "MAIL_APP_PASSWORD") {
      const token = await openConnectionSecret({ credentialId: row.credentialId, connectionId: row.id, actorId: actor.id, purpose: "ביטול ההרשאה ב-Google" }).catch(() => null);
      if (token) await revokeToken(token);
    }
    await deleteCredential(actor, row.credentialId);
  }
  await prisma.clientConnection.update({ where: { id }, data: { revokedAt: new Date(), revokedById: actor.id, credentialId: null } });
  await recordAudit({ actorId: actor.id, action: "connection.revoke", entityType: "ClientConnection", entityId: id, clientId: row.clientId, before: { kind: row.kind, account: row.account } });
}

/// "בדיקת חיבור" on the screen: proves the connection works without
/// reading any content. Mail: how many threads Google reports (metadata
/// only). Drive: how many files the folder holds, when a folder is given.
/// Send: a short mail to the manager's own mailbox.
/// ADR 0006: what the test found, for the screen to word in the reader's
/// language (connections/actions.ts). Each kind is one of the sentences
/// this used to return.
export type ConnectionTestResult =
  | { kind: "appPassword" }
  | { kind: "sent"; account: string }
  | { kind: "mail"; threads: number | null; driveFiles: number | null };

export async function testConnection(actor: User, id: string, opts: { folderId?: string | null } = {}): Promise<ConnectionTestResult> {
  const row = await prisma.clientConnection.findUnique({ where: { id } });
  if (!row || row.revokedAt || !row.credentialId) throw new DomainError("connections.notFound", "החיבור לא נמצא.");
  await assertManagesConnections(actor, row.clientId);
  if (row.kind === "MAIL_APP_PASSWORD") return { kind: "appPassword" };
  const refresh = await openConnectionSecret({ credentialId: row.credentialId, connectionId: row.id, actorId: actor.id, purpose: "בדיקת חיבור" });
  const token = await accessTokenFrom(refresh);
  const auth = { authorization: `Bearer ${token}` };
  await prisma.clientConnection.update({ where: { id }, data: { lastUsedAt: new Date() } });

  if (row.kind === "MANAGER_SEND") {
    const raw = rtlMimeMessage({ to: row.account, subject: "בדיקת חיבור מאנקורה", text: "זה מייל בדיקה ממסך החיבורים של אנקורה. אפשר למחוק אותו." });
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url") }),
    });
    if (!res.ok) throw new DomainError("connections.sendFailed", "השליחה נכשלה. אולי ההרשאה בוטלה ב-Google.");
    await recordAudit({ actorId: actor.id, action: "connection.test", entityType: "ClientConnection", entityId: id, clientId: row.clientId, after: { kind: row.kind, sentTo: row.account } });
    return { kind: "sent", account: row.account };
  }

  const mail = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: auth });
  if (!mail.ok) throw new DomainError("connections.noMailAccess", "אין גישה למייל. אולי ההרשאה בוטלה ב-Google.");
  const profile = (await mail.json()) as { threadsTotal?: number };
  let driveFiles: number | null = null;
  const folder = opts.folderId?.trim();
  if (folder) {
    if (!/^[A-Za-z0-9_-]{10,100}$/.test(folder)) throw new DomainError("connections.invalidFolderId", "מזהה התיקייה לא תקין.");
    const q = new URLSearchParams({ q: `'${folder}' in parents and trashed = false`, fields: "files(id)", pageSize: "100" });
    const drive = await fetch(`https://www.googleapis.com/drive/v3/files?${q}`, { headers: auth });
    if (!drive.ok) throw new DomainError("connections.noDriveAccess", "אין גישה לתיקייה בדרייב.");
    driveFiles = ((await drive.json()) as { files?: unknown[] }).files?.length ?? 0;
  }
  await recordAudit({ actorId: actor.id, action: "connection.test", entityType: "ClientConnection", entityId: id, clientId: row.clientId, after: { kind: row.kind, folder: folder ?? null } });
  return { kind: "mail", threads: profile.threadsTotal ?? null, driveFiles };
}
