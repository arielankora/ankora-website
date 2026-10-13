import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan, can, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { canSeeKnowledgeItem } from "@/lib/knowledge";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { assertResolvable, knowledgeData, sourcedFields, type KnowledgeInput } from "@/lib/app-domain/knowledge-items";
import type { User, BillingCycle, SystemAccessStatus, SystemPermission } from "@prisma/client";

// Org brain, phase 2: the client's system map
// (claude/org-brain-spec-2026-10-12.md, 3.6; section 7.1 of Hadas's file).
//
// The vault holds a secret. The map holds the rest: what the system is
// for, which account we use, what we may do there, and what is in the
// way. Systems we have no access to belong here most of all, because the
// list of systems that are not "has access" is the handover's gap list,
// and nobody has to keep it by hand.
//
// Nothing secret is stored here. A card is four digits; an account is a
// name. A field that looks like more than that is refused.

export interface SystemAccessInput extends KnowledgeInput {
  clientId: string;
  systemName: string;
  purpose?: string | null;
  entityLabel?: string | null;
  url?: string | null;
  accountUsed?: string | null;
  ourPermission?: SystemPermission;
  accessStatus?: SystemAccessStatus;
  blocker?: string | null;
  clientAdmin?: string | null;
  credentialId?: string | null;
  billingCycle?: BillingCycle | null;
  billingCostMinor?: number | null;
  billingCurrency?: string | null;
  cardLast4?: string | null;
  invoiceTo?: string | null;
  notes?: string | null;
}

function clean(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function cleanUrl(value: string | null | undefined): string | null {
  const v = clean(value);
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    return u.toString();
  } catch {
    throw new Error("כתובת המערכת לא תקינה.");
  }
}

/// Four digits, nothing else. A full card number typed here by mistake is
/// refused rather than trimmed, so it is never stored, not even in the
/// audit trail.
function cleanLast4(value: string | null | undefined): string | null {
  const v = clean(value);
  if (!v) return null;
  if (!/^\d{4}$/.test(v)) throw new Error("רק ארבע הספרות האחרונות של הכרטיס.");
  return v;
}

/// A password typed into the account field is the one secret this map is
/// most likely to receive by accident. Refuse what reads like
/// "user / password" or "password: ...".
function assertNoSecret(...values: (string | null | undefined)[]) {
  for (const v of values) {
    if (!v) continue;
    if (/(password|סיסמ|passwd|pwd)\s*[:=]/i.test(v)) {
      throw new Error("סיסמאות נשמרות בכספת, לא במפת המערכות.");
    }
  }
}

async function assertCredentialBelongs(clientId: string, credentialId: string | null | undefined) {
  if (!credentialId) return;
  const found = await prisma.clientCredential.count({ where: { id: credentialId, clientId, deletedAt: null } });
  if (!found) throw new Error("הרשומה בכספת לא נמצאה אצל הלקוח.");
}

function systemData(input: Partial<SystemAccessInput>) {
  const has = (k: keyof SystemAccessInput) => Object.prototype.hasOwnProperty.call(input, k);
  if (input.billingCostMinor != null && (!Number.isInteger(input.billingCostMinor) || input.billingCostMinor < 0)) {
    throw new Error("עלות לא תקינה.");
  }
  return {
    systemName: has("systemName") ? clean(input.systemName) ?? undefined : undefined,
    purpose: has("purpose") ? clean(input.purpose) : undefined,
    entityLabel: has("entityLabel") ? clean(input.entityLabel) : undefined,
    url: has("url") ? cleanUrl(input.url) : undefined,
    accountUsed: has("accountUsed") ? clean(input.accountUsed) : undefined,
    ourPermission: input.ourPermission ?? undefined,
    accessStatus: input.accessStatus ?? undefined,
    blocker: has("blocker") ? clean(input.blocker) : undefined,
    clientAdmin: has("clientAdmin") ? clean(input.clientAdmin) : undefined,
    credentialId: has("credentialId") ? input.credentialId || null : undefined,
    billingCycle: has("billingCycle") ? input.billingCycle ?? null : undefined,
    billingCostMinor: has("billingCostMinor") ? input.billingCostMinor ?? null : undefined,
    billingCurrency: has("billingCurrency") ? clean(input.billingCurrency) : undefined,
    cardLast4: has("cardLast4") ? cleanLast4(input.cardLast4) : undefined,
    invoiceTo: has("invoiceTo") ? clean(input.invoiceTo) : undefined,
    notes: has("notes") ? clean(input.notes) : undefined,
  };
}

export async function addSystemAccess(actor: User, input: SystemAccessInput) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, input.clientId);
  const systemName = clean(input.systemName);
  if (!systemName) throw new Error("צריך שם מערכת.");
  assertResolvable(input.knowledgeStatus, input.toResolve);
  assertNoSecret(input.accountUsed, input.notes, input.blocker);
  await assertCredentialBelongs(input.clientId, input.credentialId);

  // The same system twice is usually the same system typed twice. Two
  // accounts in one system are two rows, so the account is part of it.
  const account = clean(input.accountUsed);
  const duplicate = await prisma.systemAccess.findFirst({
    where: {
      clientId: input.clientId,
      deletedAt: null,
      systemName: { equals: systemName, mode: "insensitive" },
      accountUsed: account ? { equals: account, mode: "insensitive" } : null,
    },
  });
  if (duplicate) throw new Error(`${systemName}${account ? ` (${account})` : ""} כבר במפת המערכות.`);

  const sourced = await sourcedFields(input.clientId, input, [input.notes]);
  const row = await prisma.systemAccess.create({
    data: {
      ...systemData(input),
      systemName,
      clientId: input.clientId,
      createdById: actor.id,
      ...knowledgeData(input),
      ...sourced,
    },
  });
  await recordAudit({
    actorId: actor.id,
    action: "system_access.add",
    entityType: "SystemAccess",
    entityId: row.id,
    clientId: input.clientId,
    after: row,
  });
  return row;
}

export async function updateSystemAccess(actor: User, id: string, input: Partial<Omit<SystemAccessInput, "clientId">>) {
  assertCan(actor.role, "time_entry.create_self");
  const before = await prisma.systemAccess.findUnique({ where: { id } });
  if (!before || before.deletedAt) throw new Error("המערכת לא נמצאה.");
  await assertClientAccess(actor, before.clientId);
  if (input.systemName !== undefined && !clean(input.systemName)) throw new Error("צריך שם מערכת.");
  assertResolvable(input.knowledgeStatus ?? before.knowledgeStatus, input.toResolve !== undefined ? input.toResolve : before.toResolve);
  assertNoSecret(input.accountUsed, input.notes, input.blocker);
  if (input.credentialId !== undefined) await assertCredentialBelongs(before.clientId, input.credentialId);
  const sourced = await sourcedFields(before.clientId, input, [input.notes !== undefined ? input.notes : before.notes], before);

  const updated = await prisma.systemAccess.update({
    where: { id },
    data: { ...systemData(input), ...knowledgeData(input), ...sourced },
  });
  await recordAudit({
    actorId: actor.id,
    action: "system_access.update",
    entityType: "SystemAccess",
    entityId: id,
    clientId: before.clientId,
    before,
    after: updated,
  });
  return updated;
}

export async function removeSystemAccess(actor: User, id: string) {
  assertCan(actor.role, "time_entry.create_self");
  const row = await prisma.systemAccess.findUnique({ where: { id } });
  if (!row || row.deletedAt) throw new Error("המערכת לא נמצאה.");
  await assertClientAccess(actor, row.clientId);
  const removed = await prisma.systemAccess.update({ where: { id }, data: { deletedAt: new Date() } });
  await recordAudit({
    actorId: actor.id,
    action: "system_access.remove",
    entityType: "SystemAccess",
    entityId: id,
    clientId: row.clientId,
    before: row,
  });
  return removed;
}

/// Gaps first (pending, then no access), then the rest, by name. The vault
/// entry is named only for people who may open the vault.
export async function listSystemMap(actor: User, clientId: string) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, clientId);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { accountManagerId: true } });
  const viewer = { id: actor.id, isManager: canManageClients(actor.role) };
  const rows = await prisma.systemAccess.findMany({
    where: { clientId, deletedAt: null },
    include: { credential: { select: { id: true, systemName: true, deletedAt: true } } },
  });
  const seesVault = can(actor.role, "credential.view");
  const order: Record<SystemAccessStatus, number> = { PENDING: 0, NO_ACCESS: 1, HAS_ACCESS: 2, NOT_NEEDED: 3 };
  return rows
    .filter((r) => canSeeKnowledgeItem(r, viewer, client?.accountManagerId ?? null))
    .sort((a, b) => order[a.accessStatus] - order[b.accessStatus] || a.systemName.localeCompare(b.systemName, "he"))
    .map((r) => ({
      ...r,
      credential: seesVault && r.credential && !r.credential.deletedAt ? { id: r.credential.id, systemName: r.credential.systemName } : null,
    }));
}
