import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { readSteps } from "@/lib/process-rules";
import { isReviewDue, readReviewReason, REVIEW_REASON_LABELS } from "@/lib/process-review";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { holdsApproval, processChecks, ruleContext } from "@/lib/app-domain/processes";

// Org brain: when the client's rules change, look at the procedures again
// (claude/org-brain-spec-2026-10-12.md, 7.3), and review each procedure
// every so often (5.4).
//
// Two ways a process comes to need review:
//
// 1. **Its rules moved.** A rule written, changed, approved or retired, an
//    exception that ended: every approved procedure of the client is
//    checked again. One that no longer passes is marked, its owner is
//    told, and each open run gets a comment, because the people working
//    the run are the ones about to act on the old procedure. One that
//    passes again is unmarked. The daily job does the same for every
//    client, which is how an exception that ended overnight, or a change
//    to Ankora's own rules in code, is noticed.
// 2. **Its period came.** `reviewEveryDays` after the last review, the
//    process is marked and the owner told. A manager marks it reviewed,
//    or approves a new version.
//
// What a rule a person may not see says is not copied into a run or a
// notification: only rules meant for everyone on the client are named.

export const RULES_CHANGED = "process.rules_changed";
export const REVIEW_DUE = "process.review_due";

const OPEN_RUN = { notIn: ["DONE", "ARCHIVED"] as ("DONE" | "ARCHIVED")[] };

async function notifyOwner(p: { clientId: string; ownerId: string | null; backupOwnerId: string | null }, type: string, title: string, body: string) {
  const userId = p.ownerId ?? p.backupOwnerId;
  if (!userId) return false;
  await prisma.notification.create({ data: { userId, type, title: title.slice(0, 200), body: body.slice(0, 2000), entityType: "ClientProcesses", entityId: p.clientId } });
  return true;
}

/// Check every approved procedure of a client against its rules now.
/// `cause` is one line for the comment and the notification ("הכלל
/// \"ספק חדש\" אושר").
export async function rescanClientProcesses(clientId: string, cause: string, now = new Date()): Promise<{ flagged: number; cleared: number }> {
  const ctx = await ruleContext(clientId, { now, canSee: (r) => r.audience === "ALL_STAFF" });
  const rows = await prisma.process.findMany({
    where: { clientId, deletedAt: null, status: { in: ["ACTIVE", "PAUSED"] } },
    include: { versions: { where: { status: "APPROVED" }, take: 1 } },
  });
  let flagged = 0;
  let cleared = 0;
  for (const p of rows) {
    const v = p.versions[0];
    if (!v) continue;
    const failing = holdsApproval(processChecks({ steps: readSteps(v.steps), highlights: v.highlights, outputs: v.outputs }, p, ctx));
    const reason = readReviewReason(p.reviewReason);
    if (failing.length && reason !== "RULES") {
      await prisma.process.update({ where: { id: p.id }, data: { needsReview: true, reviewReason: "RULES" } });
      const lines = failing.map((c) => `- ${c.message}`).join("\n");
      const runs = await prisma.task.findMany({ where: { processId: p.id, parentId: null, deletedAt: null, status: OPEN_RUN }, select: { id: true } });
      if (runs.length) {
        await prisma.taskComment.createMany({
          data: runs.map((r) => ({
            taskId: r.id,
            authorId: null,
            body: `${cause}. הנוהל שהריצה הזו נפתחה ממנו (${p.code}, גרסה ${v.version}) כבר לא עומד בכללי הלקוח:\n${lines}\nלפני שממשיכים: לבדוק מול הכלל, ולבקש חריגה אם צריך.`,
          })),
        });
      }
      await notifyOwner(p, RULES_CHANGED, `דורש סקירה: ${p.code} ${p.title}`, `${cause}. הנוהל שבתוקף כבר לא עומד בכללי הלקוח.\n${lines}`);
      await recordAudit({ actorId: null, action: "process.needs_review", entityType: "Process", entityId: p.id, clientId, after: { reason: "RULES", cause, checks: failing.map((c) => c.code), runsCommented: runs.length } });
      flagged++;
    } else if (!failing.length && reason === "RULES") {
      // The rule that held it back is gone or excepted: nothing to review
      // on its account. A periodic review that also fell due is the job's.
      await prisma.process.update({ where: { id: p.id }, data: { needsReview: false, reviewReason: null } });
      await recordAudit({ actorId: null, action: "process.review_cleared", entityType: "Process", entityId: p.id, clientId, after: { cause } });
      cleared++;
    }
  }
  return { flagged, cleared };
}

/// After a person changed a rule or an exception: never let the check fail
/// the change itself. A rescan that fails is logged, and the daily job
/// does it again.
export async function rescanAfterRuleChange(clientId: string, cause: string) {
  try {
    await rescanClientProcesses(clientId, cause);
  } catch (err) {
    console.error("rescanClientProcesses failed:", err);
  }
}

/// The daily job: every client with approved procedures, against its rules
/// today (an exception that ended, Ankora's rules in code), and every
/// procedure whose periodic review fell due.
export async function reviewProcessesDaily(now = new Date()): Promise<{ flagged: number; cleared: number; due: number }> {
  const clients = await prisma.process.findMany({
    where: { deletedAt: null, status: { in: ["ACTIVE", "PAUSED"] } },
    distinct: ["clientId"],
    select: { clientId: true },
  });
  let flagged = 0;
  let cleared = 0;
  for (const { clientId } of clients) {
    const r = await rescanClientProcesses(clientId, "בבדיקה היומית", now);
    flagged += r.flagged;
    cleared += r.cleared;
  }
  const periodic = await prisma.process.findMany({
    where: { deletedAt: null, status: { in: ["ACTIVE", "PAUSED"] }, reviewEveryDays: { not: null }, needsReview: false },
    select: { id: true, clientId: true, code: true, title: true, ownerId: true, backupOwnerId: true, reviewEveryDays: true, lastReviewedAt: true },
  });
  let due = 0;
  for (const p of periodic) {
    if (!isReviewDue(p, now)) continue;
    await prisma.process.update({ where: { id: p.id }, data: { needsReview: true, reviewReason: "PERIODIC" } });
    await notifyOwner(p, REVIEW_DUE, `הגיע מועד הסקירה: ${p.code} ${p.title}`, `סקירה כל ${p.reviewEveryDays} ימים. עוברים על הנוהל מול מה שקורה בפועל, ומסמנים "נסקר", או כותבים גרסה חדשה.`);
    await recordAudit({ actorId: null, action: "process.needs_review", entityType: "Process", entityId: p.id, clientId: p.clientId, after: { reason: "PERIODIC" } });
    due++;
  }
  return { flagged, cleared, due };
}

/// A manager looked at the procedure and it stands. Not while it fails the
/// client's rules: that takes a new version or an exception.
export async function markProcessReviewed(actor: User, processId: string, now = new Date()) {
  if (!canManageClients(actor.role)) throw new Error("רק מנהל מסמן נוהל כנסקר.");
  const p = await prisma.process.findUnique({ where: { id: processId }, include: { versions: { where: { status: "APPROVED" }, take: 1 } } });
  if (!p || p.deletedAt) throw new Error("התהליך לא נמצא.");
  await assertClientAccess(actor, p.clientId);
  const v = p.versions[0];
  if (!v) throw new Error("לתהליך עוד אין נוהל מאושר לסקור.");
  const failing = holdsApproval(processChecks({ steps: readSteps(v.steps), highlights: v.highlights, outputs: v.outputs }, p, await ruleContext(p.clientId, { now })));
  if (failing.length) throw new Error(`${REVIEW_REASON_LABELS.RULES}. כותבים גרסה חדשה, או מבקשים חריגה לכלל.`);
  await prisma.process.update({ where: { id: processId }, data: { needsReview: false, reviewReason: null, lastReviewedAt: now } });
  await recordAudit({ actorId: actor.id, action: "process.reviewed", entityType: "Process", entityId: processId, clientId: p.clientId, after: { version: v.version } });
}
