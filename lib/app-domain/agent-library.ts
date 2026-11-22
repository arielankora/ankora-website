import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma, type User } from "@prisma/client";
import { assertCan, canManageClients, ForbiddenError } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { findSecrets } from "@/lib/secret-scan";
import { DomainError } from "@/lib/domain-error";
import { BLOCK_KINDS, parseBlocks, type AgentBlock } from "@/lib/agents/model";

// Agents, phase 3 (23.11.2026): the shared block library and lessons.
//
// A library block is written once ("כתיבה בעברית בלי מקפים") and copied into
// the agents that use it. Approving a new version of it writes the new text
// into every one of them as a new approved version of that agent, in the
// same approval: the manager sees which agents it reaches before approving.
// The copy is what an agent version holds, so a version still never
// changes after it was approved, and installations get the change through
// the same update road as any other.

const PROPOSE = "time_entry.create_self" as const;
const DASHES = /[\u2013\u2014]/;

const keyOf = (title: string) =>
  title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 50) || `block-${Date.now().toString(36)}`;

export async function listSharedBlocks(actor: User) {
  assertCan(actor.role, PROPOSE);
  const blocks = await prisma.sharedBlock.findMany({ orderBy: { title: "asc" }, include: { versions: { orderBy: { version: "desc" } } } });
  const users = await usersOf(blocks.flatMap((b) => b.versions.flatMap((v) => [v.createdById, v.decidedById])));
  const usage = await agentsUsing();
  return blocks.map((b) => {
    const versions = b.versions.map((v) => ({ ...v, createdByName: v.createdById ? users.get(v.createdById) ?? null : null, decidedByName: v.decidedById ? users.get(v.decidedById) ?? null : null }));
    return {
      ...b,
      versions,
      approved: versions.find((v) => v.state === "APPROVED") ?? null,
      pending: versions.find((v) => v.state === "PENDING") ?? null,
      usedBy: usage.get(b.key) ?? [],
    };
  });
}

async function usersOf(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = unique.length ? await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }) : [];
  return new Map(rows.map((u) => [u.id, u.name]));
}

/// Library key to the agents whose version in use copies it.
async function agentsUsing(): Promise<Map<string, { slug: string; name: string }[]>> {
  const agents = await prisma.agent.findMany({ where: { archivedAt: null }, select: { slug: true, name: true, versions: { where: { state: "APPROVED", faultyAt: null }, orderBy: { version: "desc" }, take: 1, select: { blocks: true } } } });
  const out = new Map<string, { slug: string; name: string }[]>();
  for (const a of agents) {
    const keys = new Set(parseBlocks(a.versions[0]?.blocks).map((b) => b.sharedKey).filter((k): k is string => !!k));
    for (const k of keys) out.set(k, [...(out.get(k) ?? []), { slug: a.slug, name: a.name }]);
  }
  return out;
}

export async function proposeSharedBlock(actor: User, input: { key?: string | null; title: string; kind: string; body: string; changeNote?: string | null }) {
  assertCan(actor.role, PROPOSE);
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) throw new DomainError("agents.libraryEmpty", "לקטע בספרייה צריך כותרת וטקסט.");
  if (!BLOCK_KINDS.includes(input.kind as AgentBlock["kind"])) throw new DomainError("agents.libraryKind", "סוג הקטע לא מוכר.");
  if (body.length > 20000) throw new DomainError("agents.valueTooLong", "הערך ארוך מדי.");
  if (findSecrets(body).length > 0) throw new DomainError("agents.hasSecret", "יש בטקסט סיסמה, מפתח או טוקן. סודות לא נכתבים בסוכן.");
  if (DASHES.test(title + body + (input.changeNote ?? ""))) throw new DomainError("agents.libraryDash", "יש בטקסט מקף ארוך או בינוני.");
  let block = input.key ? await prisma.sharedBlock.findUnique({ where: { key: input.key } }) : null;
  if (input.key && !block) throw new DomainError("agents.libraryNotFound", "הקטע לא נמצא בספרייה.");
  if (!block) {
    let key = keyOf(title);
    if (await prisma.sharedBlock.findUnique({ where: { key }, select: { id: true } })) key = `${key}-${Date.now().toString(36)}`;
    block = await prisma.sharedBlock.create({ data: { key, title, kind: input.kind, createdById: actor.id } });
  }
  if (await prisma.sharedBlockVersion.findFirst({ where: { sharedBlockId: block.id, state: "PENDING" }, select: { id: true } })) {
    throw new DomainError("agents.libraryPending", "יש לקטע הזה גרסה שממתינה לאישור. צריך לאשר או לדחות אותה קודם.");
  }
  const last = await prisma.sharedBlockVersion.findFirst({ where: { sharedBlockId: block.id }, orderBy: { version: "desc" }, select: { version: true } });
  const row = await prisma.sharedBlockVersion.create({ data: { sharedBlockId: block.id, version: (last?.version ?? 0) + 1, body, changeNote: input.changeNote?.trim() || null, createdById: actor.id } });
  if (title !== block.title || input.kind !== block.kind) await prisma.sharedBlock.update({ where: { id: block.id }, data: { title, kind: input.kind } });
  await recordAudit({ actorId: actor.id, action: "agent.library_propose", entityType: "SharedBlock", entityId: block.id, after: { key: block.key, version: row.version } });
  return { block, version: row };
}

async function pendingShared(actor: User, versionId: string) {
  if (!canManageClients(actor.role)) throw new ForbiddenError("רק מנהל מאשר קטע בספרייה.");
  const v = await prisma.sharedBlockVersion.findUnique({ where: { id: versionId }, include: { sharedBlock: true } });
  if (!v) throw new DomainError("agents.versionNotFound", "הגרסה לא נמצאה.");
  if (v.state !== "PENDING") throw new DomainError("agents.alreadyDecided", "הגרסה לא ממתינה לאישור.");
  return v;
}

/// Approves a library version and writes it into every agent that copies
/// the block: a new approved version of each, and the open draft too.
export async function approveSharedVersion(actor: User, versionId: string) {
  const v = await pendingShared(actor, versionId);
  const now = new Date();
  const key = v.sharedBlock.key;
  const note = `קטע הספרייה "${v.sharedBlock.title}" עודכן לגרסה ${v.version}${v.changeNote ? `: ${v.changeNote}` : ""}`;
  const touched: string[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.sharedBlockVersion.update({ where: { id: v.id }, data: { state: "APPROVED", decidedById: actor.id, decidedAt: now } });
    const agents = await tx.agent.findMany({ where: { archivedAt: null }, select: { id: true, slug: true } });
    for (const a of agents) {
      const current = await tx.agentVersion.findFirst({ where: { agentId: a.id, state: "APPROVED", faultyAt: null }, orderBy: { version: "desc" } });
      const open = await tx.agentVersion.findFirst({ where: { agentId: a.id, state: { in: ["DRAFT", "PENDING"] } } });
      const swap = (raw: Prisma.JsonValue) => {
        let changed = false;
        const blocks = parseBlocks(raw).map((b) => {
          if (b.sharedKey !== key || (b.body === v.body && b.sharedVersion === v.version)) return b;
          changed = true;
          return { ...b, body: v.body, sharedVersion: v.version, kind: v.sharedBlock.kind as AgentBlock["kind"], title: v.sharedBlock.title };
        });
        return { blocks, changed };
      };
      const fromCurrent = current ? swap(current.blocks) : { blocks: [], changed: false };
      const fromOpen = open ? swap(open.blocks) : { blocks: [], changed: false };
      if (!fromCurrent.changed && !fromOpen.changed) continue;
      const last = await tx.agentVersion.findFirst({ where: { agentId: a.id }, orderBy: { version: "desc" }, select: { version: true } });
      if (current && fromCurrent.changed) {
        // An open draft keeps being the newest: the new version takes its
        // number, and the draft moves one up.
        const next = open ? open.version : (last?.version ?? 0) + 1;
        if (open) await tx.agentVersion.update({ where: { id: open.id }, data: { version: (last?.version ?? 0) + 1 } });
        await tx.agentVersion.create({
          data: { agentId: a.id, version: next, state: "APPROVED", actionLevel: current.actionLevel, blocks: fromCurrent.blocks as Prisma.InputJsonValue, params: current.params as Prisma.InputJsonValue, requirements: current.requirements as Prisma.InputJsonValue, changeNote: note, createdById: actor.id, submittedAt: now, decidedById: actor.id, decidedAt: now },
        });
      }
      if (open && fromOpen.changed) await tx.agentVersion.update({ where: { id: open.id }, data: { blocks: fromOpen.blocks as Prisma.InputJsonValue } });
      touched.push(a.slug);
    }
  });
  await recordAudit({ actorId: actor.id, action: "agent.library_approve", entityType: "SharedBlock", entityId: v.sharedBlockId, after: { key, version: v.version, agents: touched } });
  return { touched };
}

export async function rejectSharedVersion(actor: User, versionId: string, reason: string) {
  const v = await pendingShared(actor, versionId);
  const why = reason.trim();
  if (!why) throw new DomainError("agents.reasonRequired", "צריך לכתוב בשורה אחת למה.");
  await prisma.sharedBlockVersion.update({ where: { id: v.id }, data: { state: "REJECTED", decidedById: actor.id, decidedAt: new Date(), rejectReason: why } });
  await recordAudit({ actorId: actor.id, action: "agent.library_reject", entityType: "SharedBlock", entityId: v.sharedBlockId, after: { version: v.version, reason: why } });
}

/// The block an agent copies from the library, at its approved version.
export async function sharedBlockForAgent(key: string): Promise<AgentBlock> {
  const b = await prisma.sharedBlock.findUnique({ where: { key }, include: { versions: { where: { state: "APPROVED" }, orderBy: { version: "desc" }, take: 1 } } });
  const v = b?.versions[0];
  if (!b || !v) throw new DomainError("agents.libraryNotApproved", "לקטע הזה עוד אין גרסה מאושרת בספרייה.");
  return { key: `lib-${b.key}`.slice(0, 40).replace(/[^\p{L}\p{N}_]/gu, "_"), kind: b.kind as AgentBlock["kind"], title: b.title, body: v.body, sharedKey: b.key, sharedVersion: v.version, why: null, clientId: null, safety: false };
}

export async function isSharedBlockVersion(id: string): Promise<boolean> {
  return (await prisma.sharedBlockVersion.count({ where: { id } })) > 0;
}

// --- Lessons ------------------------------------------------------------------

export async function proposeLesson(actor: User, installationId: string, input: { text: string; blockKey?: string | null }) {
  const inst = await prisma.agentInstallation.findUnique({ where: { id: installationId }, select: { id: true, userId: true, agentId: true, status: true } });
  if (!inst || inst.status !== "ACTIVE") throw new DomainError("agents.installationNotFound", "ההתקנה לא נמצאה או שהוסרה.");
  if (inst.userId !== actor.id) throw new DomainError("agents.installationNotYours", "ההתקנה הזו שייכת למישהו אחר.");
  const text = input.text.trim().slice(0, 2000);
  if (!text) throw new DomainError("agents.lessonEmpty", "צריך לכתוב מה כדאי לשנות.");
  if (findSecrets(text).length > 0) throw new DomainError("agents.hasSecret", "יש בטקסט סיסמה, מפתח או טוקן. סודות לא נכתבים בסוכן.");
  const row = await prisma.agentLesson.create({ data: { agentId: inst.agentId, installationId: inst.id, blockKey: input.blockKey?.trim() || null, text, createdById: actor.id } });
  await recordAudit({ actorId: actor.id, action: "agent.lesson_propose", entityType: "Agent", entityId: inst.agentId, after: { lessonId: row.id } });
  return row;
}

export async function listLessons(actor: User, agentId: string) {
  assertCan(actor.role, PROPOSE);
  return prisma.agentLesson.findMany({ where: { agentId, status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 30 });
}

export async function decideLesson(actor: User, lessonId: string, status: "USED" | "DISMISSED") {
  assertCan(actor.role, PROPOSE);
  const row = await prisma.agentLesson.findUnique({ where: { id: lessonId } });
  if (!row || row.status !== "OPEN") throw new DomainError("agents.lessonNotOpen", "ההצעה כבר טופלה.");
  await prisma.agentLesson.update({ where: { id: row.id }, data: { status, decidedById: actor.id, decidedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "agent.lesson_decide", entityType: "Agent", entityId: row.agentId, after: { lessonId: row.id, status } });
}
