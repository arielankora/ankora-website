import "server-only";
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan, can, ForbiddenError, type Permission } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { activeStepUp } from "@/lib/app-auth/step-up";
import { credentialAad, generateDataKey, openSecret, sealSecret, ENC_VERSION, type CredentialSecret } from "@/lib/vault/crypto";
import { unwrapDataKey, wrapDataKey } from "@/lib/vault/keys";
import { sendVaultAlert } from "@/lib/vault/alerts";

// Credentials vault, the rules (claude/credentials-vault-spec-2026-10-06.md,
// approved by Ariel 6.10.2026). Every rule lives here, not in a screen.
//
// The four that matter most:
//
//   1. Plain text leaves the server through revealCredential() only, and
//      revealCredential() is called from one route handler only
//      (app/api/credentials/[id]/reveal). listCredentials() selects no
//      secret column at all, so no screen can leak one by passing a row
//      to a client component - the mistake that once shipped password
//      hashes to the browser (claude/qa-runs-browser-e2e.md, #84).
//
//   2. No log, no secret. The `credential.reveal` audit row is written
//      and awaited BEFORE the data key is unwrapped. If the write fails,
//      the reveal fails.
//
//   3. Not assigned means not found. A credential on a client the actor
//      is not assigned to is reported as missing, never as forbidden, so
//      the answer does not confirm it exists. The attempt itself is
//      still audited, because it is exactly the event an audit is for.
//
//   4. Editing is not revealing. Updating a credential never returns its
//      current values; an empty field means "unchanged".

export class CredentialNotFoundError extends Error {
  constructor() {
    super("הגישה לא נמצאה.");
    this.name = "CredentialNotFoundError";
  }
}

export class StepUpRequiredError extends Error {
  constructor() {
    super("נדרש אימות זהות לפני הצגת פרטי הגישה.");
    this.name = "StepUpRequiredError";
  }
}

export class RevealRateLimitedError extends Error {
  constructor() {
    super("הגעת למספר החשיפות המרבי לשעה. אפשר להמשיך בשעה הבאה.");
    this.name = "RevealRateLimitedError";
  }
}

export const REVEAL_LIMIT_PER_HOUR = 30;
export const DISTINCT_REVEAL_ALERT_THRESHOLD = 10;
const HOUR_MS = 60 * 60_000;

const LIMITS = {
  systemName: 120,
  url: 2048,
  username: 256,
  password: 1024,
  notes: 4000,
} as const;

// ── Access ────────────────────────────────────────────────────────────

async function assertClientAssigned(actor: User, clientId: string, permission: Permission) {
  assertCan(actor.role, permission);
  const accessible = await listAccessibleClients(actor);
  if (!accessible.some((c) => c.id === clientId)) throw new CredentialNotFoundError();
}

/// The clients whose vault this person may open. Same list as everywhere
/// else in the product; the vault adds no assignment of its own.
export async function listVaultClients(actor: User) {
  if (!can(actor.role, "credential.view")) return [];
  return listAccessibleClients(actor);
}

// ── Validation ────────────────────────────────────────────────────────

function cleanText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${label}: ערך לא תקין.`);
  const v = value.trim();
  if (v.length === 0) return null;
  if (v.length > max) throw new Error(`${label}: עד ${max} תווים.`);
  return v;
}

/// Secrets are not trimmed: a trailing space can be part of a password.
function cleanSecret(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${label}: ערך לא תקין.`);
  if (value.length === 0) return null;
  if (value.length > max) throw new Error(`${label}: עד ${max} תווים.`);
  return value;
}

/// http and https only. The link is rendered as an anchor that people
/// click, so `javascript:` or `data:` here would be stored XSS.
export function cleanUrl(value: unknown): string | null {
  const v = cleanText(value, LIMITS.url, "קישור");
  if (!v) return null;
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
  } catch {
    throw new Error("הקישור אינו כתובת תקינה.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("הקישור חייב להתחיל ב-http או https.");
  }
  return parsed.toString();
}

// ── Sealing ───────────────────────────────────────────────────────────

async function seal(id: string, clientId: string, secret: CredentialSecret) {
  const aad = credentialAad(id, clientId);
  const dek = generateDataKey();
  try {
    const sealed = sealSecret(secret, dek, aad);
    const { wrapped, kekRef } = await wrapDataKey(dek, aad);
    return {
      secretCiphertext: sealed.ciphertext,
      secretIv: sealed.iv,
      secretTag: sealed.tag,
      wrappedDek: wrapped,
      kekRef,
      encVersion: ENC_VERSION,
      hasUsername: secret.username !== null,
      hasPassword: secret.password !== null,
      hasNotes: secret.notes !== null,
    };
  } finally {
    dek.fill(0);
  }
}

async function unseal(row: {
  id: string;
  clientId: string;
  secretCiphertext: Uint8Array | null;
  secretIv: Uint8Array | null;
  secretTag: Uint8Array | null;
  wrappedDek: Uint8Array | null;
  kekRef: string | null;
}): Promise<CredentialSecret> {
  if (!row.secretCiphertext || !row.secretIv || !row.secretTag || !row.wrappedDek || !row.kekRef) {
    return { username: null, password: null, notes: null };
  }
  const aad = credentialAad(row.id, row.clientId);
  const dek = await unwrapDataKey(Buffer.from(row.wrappedDek), row.kekRef, aad);
  try {
    return openSecret(
      { ciphertext: Buffer.from(row.secretCiphertext), iv: Buffer.from(row.secretIv), tag: Buffer.from(row.secretTag) },
      dek,
      aad,
    );
  } finally {
    dek.fill(0);
  }
}

// ── Read ──────────────────────────────────────────────────────────────

/// The safe projection. Not one secret column is selected here, and no
/// screen may select one itself.
const SAFE_SELECT = {
  id: true,
  clientId: true,
  systemName: true,
  url: true,
  hasUsername: true,
  hasPassword: true,
  hasNotes: true,
  secretUpdatedAt: true,
  updatedAt: true,
  lastRevealedAt: true,
  lastRevealedBy: { select: { id: true, name: true } },
} as const;

export async function listCredentials(actor: User, clientId: string) {
  await assertClientAssigned(actor, clientId, "credential.view");
  return prisma.clientCredential.findMany({
    where: { clientId, deletedAt: null },
    orderBy: { systemName: "asc" },
    select: SAFE_SELECT,
  });
}

// ── Write ─────────────────────────────────────────────────────────────

export interface CredentialInput {
  clientId: string;
  systemName: string;
  url?: string | null;
  username?: string | null;
  password?: string | null;
  notes?: string | null;
}

export async function createCredential(actor: User, input: CredentialInput) {
  await assertClientAssigned(actor, input.clientId, "credential.manage");
  const systemName = cleanText(input.systemName, LIMITS.systemName, "שם המערכת");
  if (!systemName) throw new Error("חסר שם מערכת.");
  const url = cleanUrl(input.url);
  const secret: CredentialSecret = {
    username: cleanSecret(input.username, LIMITS.username, "שם משתמש"),
    password: cleanSecret(input.password, LIMITS.password, "סיסמה"),
    notes: cleanSecret(input.notes, LIMITS.notes, "הערות"),
  };

  // The id is chosen here, before the insert, because the ciphertext's
  // AAD names it.
  const id = randomUUID();
  const sealed = await seal(id, input.clientId, secret);
  const now = new Date();

  await prisma.clientCredential.create({
    data: {
      id,
      clientId: input.clientId,
      systemName,
      url,
      ...sealed,
      secretUpdatedAt: now,
      createdById: actor.id,
      updatedById: actor.id,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "credential.create",
    entityType: "ClientCredential",
    entityId: id,
    clientId: input.clientId,
    // Names and yes/no only. Never a value, never ciphertext.
    after: { systemName, url, hasUsername: sealed.hasUsername, hasPassword: sealed.hasPassword, hasNotes: sealed.hasNotes },
  });

  return { id };
}

export interface CredentialUpdate {
  systemName?: string;
  url?: string | null;
  /// Empty or missing means unchanged. The form is never pre-filled.
  username?: string | null;
  password?: string | null;
  notes?: string | null;
  /// Explicitly remove a stored value.
  clear?: ("username" | "password" | "notes")[];
}

async function findLive(id: string) {
  const row = await prisma.clientCredential.findFirst({ where: { id, deletedAt: null } });
  if (!row) throw new CredentialNotFoundError();
  return row;
}

export async function updateCredential(actor: User, id: string, patch: CredentialUpdate) {
  const row = await findLive(id);
  await assertClientAssigned(actor, row.clientId, "credential.manage");

  const changed: string[] = [];
  const data: Record<string, unknown> = { updatedById: actor.id };

  if (patch.systemName !== undefined) {
    const systemName = cleanText(patch.systemName, LIMITS.systemName, "שם המערכת");
    if (!systemName) throw new Error("חסר שם מערכת.");
    if (systemName !== row.systemName) {
      data.systemName = systemName;
      changed.push("systemName");
    }
  }
  if (patch.url !== undefined) {
    const url = cleanUrl(patch.url);
    if (url !== row.url) {
      data.url = url;
      changed.push("url");
    }
  }

  const next = {
    username: cleanSecret(patch.username, LIMITS.username, "שם משתמש"),
    password: cleanSecret(patch.password, LIMITS.password, "סיסמה"),
    notes: cleanSecret(patch.notes, LIMITS.notes, "הערות"),
  };
  const clear = new Set(patch.clear ?? []);
  const secretFields = (["username", "password", "notes"] as const).filter((f) => next[f] !== null || clear.has(f));

  if (secretFields.length > 0) {
    // Server-side merge. The current values are opened here to be
    // re-sealed under a fresh data key and never leave this function -
    // which is why this is not a reveal and is not audited as one.
    const current = await unseal(row);
    const merged: CredentialSecret = { ...current };
    for (const f of secretFields) merged[f] = clear.has(f) ? null : next[f];
    Object.assign(data, await seal(row.id, row.clientId, merged), { secretUpdatedAt: new Date() });
    for (const f of secretFields) changed.push(f);
  }

  if (changed.length === 0) return { id, changed };

  await prisma.clientCredential.update({ where: { id }, data });
  await recordAudit({
    actorId: actor.id,
    action: "credential.update",
    entityType: "ClientCredential",
    entityId: id,
    clientId: row.clientId,
    before: { systemName: row.systemName, url: row.url },
    // For secret fields, that they changed. Nothing more.
    after: {
      systemName: (data.systemName as string | undefined) ?? row.systemName,
      url: data.url !== undefined ? data.url : row.url,
      changed,
    },
  });
  return { id, changed };
}

export async function deleteCredential(actor: User, id: string) {
  const row = await findLive(id);
  await assertClientAssigned(actor, row.clientId, "credential.manage");
  // The secret goes now, not at some later purge. The row stays so the
  // audit trail still has a name; the database CHECK constraint refuses
  // a deleted row that still holds ciphertext.
  await prisma.clientCredential.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      updatedById: actor.id,
      secretCiphertext: null,
      secretIv: null,
      secretTag: null,
      wrappedDek: null,
      kekRef: null,
      hasUsername: false,
      hasPassword: false,
      hasNotes: false,
    },
  });
  await recordAudit({
    actorId: actor.id,
    action: "credential.delete",
    entityType: "ClientCredential",
    entityId: id,
    clientId: row.clientId,
    before: { systemName: row.systemName, url: row.url },
  });
}

// ── Reveal ────────────────────────────────────────────────────────────

async function deny(actor: User, credentialId: string, clientId: string | null, reason: string) {
  await recordAudit({
    actorId: actor.id,
    action: "credential.reveal_denied",
    entityType: "ClientCredential",
    entityId: credentialId,
    clientId,
    after: { reason },
  });
}

/// The only function that returns plain text. Call it from the reveal
/// route only.
export async function revealCredential(
  actor: User,
  id: string,
  opts: { taskId?: string | null } = {},
  now = new Date(),
): Promise<CredentialSecret & { systemName: string }> {
  const row = await prisma.clientCredential.findFirst({ where: { id, deletedAt: null } });
  if (!row) throw new CredentialNotFoundError();

  if (!can(actor.role, "credential.reveal")) {
    await deny(actor, id, row.clientId, "no_permission");
    throw new CredentialNotFoundError();
  }
  const accessible = await listAccessibleClients(actor);
  if (!accessible.some((c) => c.id === row.clientId)) {
    await deny(actor, id, row.clientId, "not_assigned");
    throw new CredentialNotFoundError();
  }

  if (!(await activeStepUp(actor, now))) {
    await deny(actor, id, row.clientId, "no_step_up");
    throw new StepUpRequiredError();
  }

  const hourAgo = new Date(now.getTime() - HOUR_MS);
  const recent = await prisma.auditEvent.findMany({
    where: { actorId: actor.id, action: "credential.reveal", createdAt: { gt: hourAgo } },
    select: { entityId: true },
  });
  if (recent.length >= REVEAL_LIMIT_PER_HOUR) {
    const alreadyAlerted = await prisma.auditEvent.count({
      where: {
        actorId: actor.id,
        action: "credential.reveal_denied",
        createdAt: { gt: hourAgo },
        afterJson: { path: ["reason"], equals: "rate_limit" },
      },
    });
    await deny(actor, id, row.clientId, "rate_limit");
    if (alreadyAlerted === 0) {
      await sendVaultAlert("חריגה ממכסת חשיפות", [
        `${actor.name} (${actor.email}) הגיע/ה ל-${REVEAL_LIMIT_PER_HOUR} חשיפות גישה בשעה האחרונה.`,
        "חשיפות נוספות נחסמו עד שהשעה תתחלף.",
      ]);
    }
    throw new RevealRateLimitedError();
  }

  // A task named in the trail must belong to this credential's client. A
  // trace that is wrong is worse than a trace that is missing
  // (recordClientMessage, 26.9.2026).
  let taskId: string | null = null;
  if (opts.taskId) {
    const task = await prisma.task.findFirst({
      where: { id: opts.taskId, clientId: row.clientId, deletedAt: null },
      select: { id: true },
    });
    if (!task) throw new ForbiddenError("המשימה הזו אינה של הלקוח הזה.");
    taskId = task.id;
  }

  // No log, no secret: awaited before anything is decrypted.
  await recordAudit({
    actorId: actor.id,
    action: "credential.reveal",
    entityType: "ClientCredential",
    entityId: id,
    clientId: row.clientId,
    after: { systemName: row.systemName, taskId },
  });

  const secret = await unseal(row);

  await prisma.clientCredential.update({
    where: { id },
    data: { lastRevealedAt: now, lastRevealedById: actor.id },
  });

  // Counted after this reveal, so the alert fires on the eleventh
  // distinct credential and only then.
  const distinctBefore = new Set(recent.map((r) => r.entityId));
  if (!distinctBefore.has(id) && distinctBefore.size === DISTINCT_REVEAL_ALERT_THRESHOLD) {
    await sendVaultAlert("חשיפות רבות בזמן קצר", [
      `${actor.name} (${actor.email}) צפה/תה ב-${DISTINCT_REVEAL_ALERT_THRESHOLD + 1} גישות שונות בשעה האחרונה.`,
    ]);
  }

  return { ...secret, systemName: row.systemName };
}
