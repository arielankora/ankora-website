import "server-only";
import type { CommsAccessLevel, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { hasSignedCurrent } from "@/lib/agreements";
import { readPocConfig } from "@/lib/whatsapp-poc/unipile";
import { COMMS_LEVELS, checkCommsGrant } from "@/lib/comms/grant-rules";
import { lineOwnerEmails } from "@/lib/comms/grants";
import { DomainError } from "@/lib/domain-error";

// Giving access to the communications screen from the person's page
// (12.11.2026, Ariel: "it makes no sense that this is a manual process for
// every new person"). Until today it took an edit to Vercel's environment
// and a redeploy. The rules are in lib/comms/grant-rules.ts.

export async function confidentialitySignedBothChannels(userId: string): Promise<boolean> {
  const [app, pdf] = await Promise.all([
    hasSignedCurrent(userId, "CONFIDENTIALITY", "APP"),
    hasSignedCurrent(userId, "CONFIDENTIALITY", "EMAIL_PDF"),
  ]);
  return app && pdf;
}

/// The person's level and lines, as one save from their page. `lines` is
/// every Aloha line that should be theirs; a line of theirs left out is
/// set to nobody in particular.
export async function setCommsAccess(actor: User, userId: string, input: { level: string; lines: string[] }) {
  assertCan(actor.role, "user.manage");
  const level = input.level as CommsAccessLevel;
  if (!COMMS_LEVELS.includes(level)) throw new DomainError("commsAccess.unknownLevel", "רמת גישה לא מוכרת.");

  const target = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, role: true, commsAccessLevel: true, email: true },
  });
  if (!target) throw new DomainError("commsAccess.userNotFound", "משתמש לא נמצא.");

  const known = new Set(readPocConfig().lineNumbers);
  const wanted = [...new Set(input.lines)];
  if (wanted.some((l) => !known.has(l))) throw new DomainError("commsAccess.unknownLine", "קו טלפון לא מוכר.");
  if (wanted.length > 0 && target.role === "CLIENT_USER") throw new DomainError("commsAccess.lineStaffOnly", "קו טלפון שייך רק לאיש צוות של אנקורה.");

  if (level !== target.commsAccessLevel) {
    const check = checkCommsGrant({
      level,
      targetRole: target.role,
      confidentialitySigned: await confidentialitySignedBothChannels(target.id),
    });
    // Each code written out, so tests/unit/i18n-domain-errors.test.ts can check it.
    if (!check.ok)
      throw check.code === "commsAccess.staffOnly"
        ? new DomainError("commsAccess.staffOnly", check.error)
        : new DomainError("commsAccess.needsConfidentiality", check.error);
  }

  const owners = await lineOwnerEmails();
  const email = target.email.trim().toLowerCase();
  const before = [...owners].filter(([, e]) => e === email).map(([l]) => l).sort();
  const add = wanted.filter((l) => !before.includes(l));
  const remove = before.filter((l) => !wanted.includes(l));

  if (level === target.commsAccessLevel && add.length === 0 && remove.length === 0) return;

  await prisma.$transaction([
    prisma.user.update({ where: { id: target.id }, data: { commsAccessLevel: level } }),
    ...add.map((line) =>
      prisma.commsLineOwner.upsert({ where: { line }, create: { line, userId: target.id }, update: { userId: target.id } }),
    ),
    ...remove.map((line) =>
      prisma.commsLineOwner.upsert({ where: { line }, create: { line, userId: null }, update: { userId: null } }),
    ),
  ]);

  await recordAudit({
    actorId: actor.id,
    action: "user.comms_access",
    entityType: "User",
    entityId: target.id,
    before: { commsAccessLevel: target.commsAccessLevel, lines: before },
    after: { commsAccessLevel: level, lines: wanted.sort() },
  });
}
