import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { assertCan, canManageClients, ForbiddenError } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { findSecrets } from "@/lib/secret-scan";
import { guideLines } from "@/lib/extract-prompt";
import type { User } from "@prisma/client";

// Org brain, decision 3: the extraction guidance, in versions.
//
// Split by role. What the server enforces (a source for every item, no
// overwrites, no secrets, no quotes from a topics-only source, Ankora's
// own documents never confirm) is code, and no version here can loosen
// it. What only guides Claude (what is relevant, what is left out, how to
// phrase, examples) is text, kept here: anybody on the team proposes a
// version, an admin approves it, and every extraction prompt from then on
// carries the latest approved one.

/// The approved guidance in use, or null when none was ever approved (the
/// prompt then carries the guidance it shipped with).
export async function currentGuide() {
  return prisma.extractionGuide.findFirst({ where: { state: "APPROVED" }, orderBy: { version: "desc" }, select: { version: true, body: true } });
}

export async function listGuideVersions(actor: User) {
  assertCan(actor.role, "time_entry.create_self");
  const rows = await prisma.extractionGuide.findMany({ orderBy: { version: "desc" }, take: 30 });
  const ids = [...new Set(rows.flatMap((r) => [r.createdById, r.decidedById]).filter((x): x is string => !!x))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    ...r,
    createdByName: r.createdById ? nameOf.get(r.createdById) ?? null : null,
    decidedByName: r.decidedById ? nameOf.get(r.decidedById) ?? null : null,
  }));
}

export async function proposeGuide(actor: User, input: { body: string; note?: string | null }) {
  assertCan(actor.role, "time_entry.create_self");
  const lines = guideLines(input.body);
  if (lines.length === 0) throw new Error("ההנחיות ריקות.");
  if (input.body.length > 20000) throw new Error("ההנחיות ארוכות מדי.");
  if (findSecrets(input.body).length > 0) throw new Error("בהנחיות יש סיסמה, מפתח או מספר כרטיס.");
  for (let attempt = 0; ; attempt++) {
    const last = await prisma.extractionGuide.findFirst({ orderBy: { version: "desc" }, select: { version: true } });
    try {
      const row = await prisma.extractionGuide.create({
        data: { version: (last?.version ?? 0) + 1, body: lines.join("\n"), note: input.note?.trim() || null, createdById: actor.id },
      });
      await recordAudit({ actorId: actor.id, action: "extraction_guide.propose", entityType: "ExtractionGuide", entityId: row.id, after: { version: row.version, note: row.note } });
      return row;
    } catch (err) {
      if (attempt < 3 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
}

async function findDraft(actor: User, id: string) {
  if (!canManageClients(actor.role)) throw new ForbiddenError("רק מנהל מאשר הנחיות.");
  const row = await prisma.extractionGuide.findUnique({ where: { id } });
  if (!row) throw new Error("הגרסה לא נמצאה.");
  if (row.state !== "DRAFT") throw new Error("כבר הוחלט על הגרסה הזו.");
  return row;
}

export async function approveGuide(actor: User, id: string) {
  const row = await findDraft(actor, id);
  // An older draft approved after a newer one would quietly roll the
  // guidance back. Only a draft newer than the version in use.
  const current = await currentGuide();
  if (current && row.version < current.version) throw new Error(`גרסה ${current.version} כבר בשימוש, והיא חדשה יותר.`);
  const updated = await prisma.extractionGuide.update({ where: { id }, data: { state: "APPROVED", decidedById: actor.id, decidedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "extraction_guide.approve", entityType: "ExtractionGuide", entityId: id, after: { version: row.version } });
  return updated;
}

export async function rejectGuide(actor: User, id: string, reason: string) {
  const row = await findDraft(actor, id);
  const why = reason.trim();
  if (!why) throw new Error("צריך לכתוב בשורה אחת למה.");
  const updated = await prisma.extractionGuide.update({ where: { id }, data: { state: "REJECTED", decidedById: actor.id, decidedAt: new Date(), rejectReason: why } });
  await recordAudit({ actorId: actor.id, action: "extraction_guide.reject", entityType: "ExtractionGuide", entityId: id, after: { version: row.version, reason: why } });
  return updated;
}
