import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { approveClientPolicy } from "@/lib/app-domain/client-policies";
import { resolveInternalClient } from "@/lib/app-domain/employee-lifecycle";
import { confirmSourceWithClient } from "@/lib/app-domain/source-confirmation";
import { SECONDARY_ONLY_TO_RESOLVE } from "@/lib/knowledge-sources";

// Ankora's own file, "Ankora פנימי" (22.10.2026). Its items come from
// Ankora's own documents, so R14 marks them "not yet confirmed with the
// client". But here Ankora is the client: there is nobody else to ask, and
// "לשאול את הלקוח" on these rows sent Ariel to ask himself. A manager
// confirms them as a decision, with the same audit as a confirmation with
// any client, and a rule is confirmed and approved in one click.

export const INTERNAL_NOTE = "לקוח פנימי: אנקורה היא הלקוח";

/// The internal clients among `clients`: the flag, and the one the
/// employee lifecycle names (by env or by name), in case the flag was
/// never set on it.
export async function internalClientIds(clients: { id: string; isInternal?: boolean | null }[]): Promise<Set<string>> {
  const out = new Set(clients.filter((c) => c.isInternal).map((c) => c.id));
  const named = await resolveInternalClient().catch(() => null);
  if (named && clients.some((c) => c.id === named.id)) out.add(named.id);
  return out;
}

async function assertInternal(clientId: string): Promise<void> {
  const client = await prisma.client.findFirst({ where: { id: clientId, deletedAt: null }, select: { id: true, isInternal: true } });
  if (!client) throw new Error("הלקוח לא נמצא.");
  if (!(await internalClientIds([client])).has(client.id)) throw new Error("רק בתיק הפנימי של אנקורה מאשרים כך. אצל לקוח, מאמתים מולו.");
}

/// A proposed rule of the internal file, uncertain only because Ankora
/// wrote it: confirmed, then approved, in one step. Manager only.
export async function approveInternalRule(actor: User, policyId: string) {
  if (!canManageClients(actor.role)) throw new Error("רק מנהל מאשר כלל.");
  const rule = await prisma.clientPolicy.findFirst({ where: { id: policyId, deletedAt: null } });
  if (!rule) throw new Error("הכלל לא נמצא.");
  await assertClientAccess(actor, rule.clientId);
  await assertInternal(rule.clientId);
  if (rule.status !== "PROPOSED") throw new Error("רק כלל מוצע מאשרים.");
  if (rule.knowledgeStatus !== "CONFIRMED") {
    if (rule.knowledgeStatus !== "UNCERTAIN" || rule.toResolve !== SECONDARY_ONLY_TO_RESOLVE) {
      throw new Error("הכלל לא ודאי מסיבה אחרת. קודם סוגרים את מה שחסר בו.");
    }
    const after = await prisma.clientPolicy.update({ where: { id: rule.id }, data: { knowledgeStatus: "CONFIRMED", toResolve: null } });
    await recordAudit({
      actorId: actor.id,
      action: "client_policy.internal_confirm",
      entityType: "ClientPolicy",
      entityId: rule.id,
      clientId: rule.clientId,
      before: { knowledgeStatus: rule.knowledgeStatus, toResolve: rule.toResolve },
      after: { knowledgeStatus: after.knowledgeStatus, toResolve: null, note: INTERNAL_NOTE },
    });
  }
  return approveClientPolicy(actor, rule.id);
}

/// A rule decided on "אישורים": a confirmed rule is approved as it always
/// was; a rule of the internal file, uncertain only because Ankora wrote
/// it, is confirmed and approved. Anything else is refused, as before.
export async function approveRuleDecision(actor: User, policyId: string) {
  const rule = await prisma.clientPolicy.findFirst({ where: { id: policyId, deletedAt: null }, select: { knowledgeStatus: true, client: { select: { id: true, isInternal: true } } } });
  if (rule && rule.knowledgeStatus !== "CONFIRMED" && (await internalClientIds([rule.client])).has(rule.client.id)) return approveInternalRule(actor, policyId);
  return approveClientPolicy(actor, policyId);
}

/// Every item of the internal file lowered only by this source,
/// confirmed in one step. The same function a manager uses for a client,
/// with the internal note.
export async function confirmInternalSource(actor: User, clientId: string, code: string): Promise<{ confirmed: number }> {
  await assertInternal(clientId);
  return confirmSourceWithClient(actor, clientId, code, INTERNAL_NOTE);
}
