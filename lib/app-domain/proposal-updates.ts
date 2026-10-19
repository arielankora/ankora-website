import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma, User } from "@prisma/client";
import { readSourceRefs, type SourceRef } from "@/lib/knowledge-sources";
import { proposalHeadline, type ProposalTargetLike } from "@/lib/knowledge-proposals";
import { updateClientContact } from "@/lib/app-domain/client-contacts";
import { updateSystemAccess } from "@/lib/app-domain/system-map";
import { updateRequestType } from "@/lib/app-domain/request-types";
import { updateClientPolicy } from "@/lib/app-domain/client-policies";
import { updateClientEntity } from "@/lib/app-domain/client-entities";
import { saveProcessVersion, updateProcess } from "@/lib/app-domain/processes";

// A proposal that changes an item already in the file (spec 3.1, 5.2):
// not only a fact. The client moved a contact to another role, a system's
// access came through, a rule's amount changed.
//
// Facts keep their own way (a new version beside the old, or an
// alternative). The other items change in place through the file's own
// update functions, so every check they make still runs, the audit log
// keeps the before and after, and a rule goes back to "proposed" until a
// manager approves it again. Only what the proposal says changes; the
// sources it brings are added to the ones the item has.

export const UPDATABLE_TARGETS = ["CONTACT", "SYSTEM", "REQUEST_TYPE", "POLICY", "ENTITY", "PROCESS"] as const;
export type UpdatableTarget = (typeof UPDATABLE_TARGETS)[number];

export function isUpdatable(target: string): target is UpdatableTarget {
  return (UPDATABLE_TARGETS as readonly string[]).includes(target);
}

/// The item as it is now, in one line, for the card; null when it is not
/// in this client's file any more.
export async function currentItem(clientId: string, target: string, id: string): Promise<{ id: string; body: string; sources: unknown } | null> {
  const base = { id, clientId, deletedAt: null };
  const line = (t: ProposalTargetLike, v: Record<string, unknown>) => proposalHeadline(t, v);
  if (target === "CONTACT") {
    const c = await prisma.clientContact.findFirst({ where: base, select: { role: true, sources: true, person: { select: { name: true } } } });
    return c ? { id, body: line("CONTACT", { name: c.person.name, role: c.role }), sources: c.sources } : null;
  }
  if (target === "SYSTEM") {
    const s = await prisma.systemAccess.findFirst({ where: base, select: { systemName: true, purpose: true, accessStatus: true, sources: true } });
    return s ? { id, body: line("SYSTEM", s), sources: s.sources } : null;
  }
  if (target === "REQUEST_TYPE") {
    const r = await prisma.requestType.findFirst({ where: base, select: { title: true, handling: true, sources: true } });
    return r ? { id, body: line("REQUEST_TYPE", r), sources: r.sources } : null;
  }
  if (target === "POLICY") {
    const r = await prisma.clientPolicy.findFirst({ where: { ...base, status: { not: "RETIRED" } }, select: { title: true, statement: true, sources: true } });
    return r ? { id, body: line("POLICY", r), sources: r.sources } : null;
  }
  if (target === "ENTITY") {
    const e = await prisma.clientEntity.findFirst({ where: base, select: { name: true, legalName: true, sources: true } });
    return e ? { id, body: line("ENTITY", e), sources: e.sources } : null;
  }
  if (target === "PROCESS") {
    const p = await prisma.process.findFirst({ where: { ...base, status: { not: "RETIRED" } }, select: { code: true, title: true, purpose: true, sources: true } });
    return p ? { id, body: `${p.code} ${line("PROCESS", p)}`, sources: p.sources } : null;
  }
  return null;
}

/// The sources an item ends with: what it had, and what the proposal adds.
function mergedSources(before: unknown, added: SourceRef[]): SourceRef[] {
  const out = [...readSourceRefs(before)];
  for (const r of added) if (!out.some((o) => o.code === r.code && (o.at ?? null) === (r.at ?? null))) out.push(r);
  return out;
}

/// Only the fields the proposal sets. A field left out stays as it is.
function given<T extends Record<string, unknown>>(v: T): Partial<T> {
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as Partial<T>;
}

export async function applyUpdate(
  actor: User,
  p: { clientId: string; target: UpdatableTarget; targetId: string },
  fields: Record<string, unknown>,
  added: SourceRef[],
  procedure?: { steps: unknown[]; highlights?: string | null; outputs?: string | null } | null
): Promise<string> {
  const now = await currentItem(p.clientId, p.target, p.targetId);
  if (!now) throw new Error("הפריט שההצעה מעדכנת כבר לא בתיק. דוחים את ההצעה.");
  const input = { ...given(fields), sources: mergedSources(now.sources, added) };
  if (p.target === "CONTACT") await updateClientContact(actor, p.targetId, input as Parameters<typeof updateClientContact>[2]);
  if (p.target === "SYSTEM") await updateSystemAccess(actor, p.targetId, input as Parameters<typeof updateSystemAccess>[2]);
  if (p.target === "REQUEST_TYPE") await updateRequestType(actor, p.targetId, input as Parameters<typeof updateRequestType>[2]);
  if (p.target === "POLICY") await updateClientPolicy(actor, p.targetId, input as Parameters<typeof updateClientPolicy>[2]);
  if (p.target === "ENTITY") await updateClientEntity(actor, p.targetId, input as Parameters<typeof updateClientEntity>[2]);
  if (p.target === "PROCESS") {
    await updateProcess(actor, p.targetId, input as Parameters<typeof updateProcess>[2]);
    // A procedure described anew is a new draft version, beside the one in
    // force: it runs only once a manager approves it.
    if (procedure?.steps.length) {
      const latest = await prisma.processVersion.findFirst({ where: { processId: p.targetId }, orderBy: { version: "desc" }, select: { version: true } });
      await saveProcessVersion(actor, p.targetId, {
        steps: procedure.steps as Prisma.InputJsonValue as never,
        highlights: procedure.highlights,
        outputs: procedure.outputs,
        baseVersion: latest?.version ?? 0,
        changeNote: "מהצעה של Claude",
      });
    }
  }
  return p.targetId;
}
