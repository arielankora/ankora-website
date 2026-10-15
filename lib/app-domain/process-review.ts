import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isExceptionInForce, ruleInForce } from "@/lib/client-policies";
import { blockingChecks, readSteps, ruleChecks, type CheckResult, type ProcessStep, type RuleFinding } from "@/lib/process-rules";

// Org brain: when a client's rule changes, its procedures are checked
// again (claude/org-brain-spec-2026-10-12.md, 7.2, 7.3).
//
// A procedure was approved against the rules of the day it was approved.
// A rule added, tightened, approved or retired afterwards, or an exception
// that ran out, can make an approved procedure wrong without anyone
// touching it. So every such change rescans the client's processes, and
// the nightly job rescans everyone (an exception ends by the calendar,
// not by a click):
//
// - A procedure that now fails is marked "needs review", with what it
//   fails. Its owner is told, and each open run gets a note in its thread.
// - One that passes again is cleared.
// - The run itself is not stopped. A payment run that stops because a
//   rule changed is a missed payment; the person running it sees the note
//   and decides.
//
// The same checks block a new version's approval: R1 to R4 as before,
// and now the client's rules (R7, R8, R9, R10, R15) unless an exception
// to the rule is in force.

export const NEEDS_REVIEW = "process.needs_review";

const CHECKED_KINDS = ["FORBIDDEN", "REQUIRED_STEP", "TIMING", "COMMUNICATION", "SEPARATION"] as const;

export type ReviewContext = {
  thresholds: string[];
  rules: Parameters<typeof ruleChecks>[2];
  excepted: Set<string>;
};

/// The client's rules as they apply now: approval rules for R2, checked
/// rules for the rest, and the rules with an exception in force.
export async function reviewContext(clientId: string, now = new Date()): Promise<ReviewContext> {
  const [policies, exceptions] = await Promise.all([
    prisma.clientPolicy.findMany({
      where: { clientId, deletedAt: null, status: { not: "RETIRED" } },
      select: {
        id: true,
        kind: true,
        title: true,
        status: true,
        statement: true,
        interimStatement: true,
        checkTags: true,
        requiredTags: true,
        channels: true,
        minLeadBusinessDays: true,
      },
    }),
    prisma.policyException.findMany({ where: { clientId, status: "APPROVED" }, select: { policyId: true, status: true, validUntil: true } }),
  ]);
  return {
    thresholds: policies.filter((p) => (p.kind === "THRESHOLD" || p.kind === "APPROVAL_REQUIRED") && ruleInForce(p)).map((p) => p.title),
    // A proposed rule binds as written when it restricts (client-policies.ts,
    // ruleInForce), so it is checked too.
    rules: policies.filter((p) => (CHECKED_KINDS as readonly string[]).includes(p.kind)),
    excepted: new Set(exceptions.filter((e) => isExceptionInForce(e, now)).map((e) => e.policyId)),
  };
}

export type ProcedureCheck = {
  /// What stops an approval and marks an approved procedure for review.
  failing: CheckResult[];
  /// Findings against a rule that has an exception in force: shown, not counted.
  excepted: RuleFinding[];
};

export function checkProcedure(
  ctx: ReviewContext,
  process: { entityId: string | null },
  version: { steps: ProcessStep[]; highlights?: string | null; outputs?: string | null }
): ProcedureCheck {
  const findings = ruleChecks(version.steps, process, ctx.rules, ctx.excepted);
  return {
    failing: [...blockingChecks(version, ctx.thresholds), ...findings.filter((f) => !f.excepted).map(({ code, message, step }) => ({ code, message, step }))],
    excepted: findings.filter((f) => f.excepted),
  };
}

function sameFindings(a: unknown, b: CheckResult[]): boolean {
  const key = (xs: { code: string; message: string }[]) => xs.map((x) => `${x.code}|${x.message}`).sort().join("\n");
  return Array.isArray(a) && key(a as CheckResult[]) === key(b);
}

export function readFindings(v: unknown): CheckResult[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .filter((x) => typeof x.code === "string" && typeof x.message === "string")
    .map((x) => ({ code: x.code as string, message: x.message as string, step: typeof x.step === "number" ? x.step : undefined }));
}

/// Rescans every approved procedure of one client. `cause` is said in the
/// note and the notification ("הכלל X אושר").
export async function rescanClientProcesses(clientId: string, cause: string, now = new Date()): Promise<{ flagged: number; cleared: number }> {
  const processes = await prisma.process.findMany({
    where: { clientId, deletedAt: null, status: { not: "RETIRED" }, versions: { some: { status: "APPROVED" } } },
    include: { versions: { where: { status: "APPROVED" }, take: 1 } },
  });
  if (processes.length === 0) return { flagged: 0, cleared: 0 };
  const ctx = await reviewContext(clientId, now);
  let flagged = 0;
  let cleared = 0;
  for (const p of processes) {
    const v = p.versions[0];
    const { failing } = checkProcedure(ctx, p, { steps: readSteps(v.steps), highlights: v.highlights, outputs: v.outputs });
    if (failing.length === 0) {
      if (p.needsReview && readFindings(p.reviewFindings).length) {
        await prisma.process.update({ where: { id: p.id }, data: { needsReview: false, reviewFindings: [] } });
        cleared++;
      }
      continue;
    }
    if (p.needsReview && sameFindings(p.reviewFindings, failing)) continue;
    await prisma.process.update({
      where: { id: p.id },
      data: { needsReview: true, reviewFindings: failing as unknown as Prisma.InputJsonValue },
    });
    flagged++;
    const lines = failing.map((f) => `- ${f.message}`).join("\n");
    const recipient = p.ownerId ?? p.backupOwnerId;
    if (recipient) {
      await prisma.notification.create({
        data: {
          userId: recipient,
          type: NEEDS_REVIEW,
          title: `הנוהל של ${p.code} ${p.title} דורש סקירה`.slice(0, 200),
          body: `${cause}. ${failing.map((f) => f.message).join(" ")}`.slice(0, 500),
          entityType: "ClientProcesses",
          entityId: clientId,
        },
      });
    }
    // Each open run hears it where its people already are: the thread.
    const runs = await prisma.task.findMany({
      where: { processId: p.id, parentId: null, deletedAt: null, status: { notIn: ["DONE", "ARCHIVED"] } },
      select: { id: true },
    });
    for (const run of runs) {
      await prisma.taskComment.create({
        data: { taskId: run.id, authorId: null, body: `**הנוהל דורש סקירה.** ${cause}. מה לא עובר עכשיו:\n${lines}\n\nהריצה ממשיכה. לפני כל שלב שמופיע כאן, לבדוק מול הכלל.` },
      });
    }
  }
  return { flagged, cleared };
}

/// The nightly pass: every client with an approved procedure.
export async function rescanAllProcesses(now = new Date()): Promise<{ flagged: number; cleared: number }> {
  const rows = await prisma.process.findMany({
    where: { deletedAt: null, status: { not: "RETIRED" }, versions: { some: { status: "APPROVED" } } },
    select: { clientId: true },
    distinct: ["clientId"],
  });
  let flagged = 0;
  let cleared = 0;
  for (const { clientId } of rows) {
    const r = await rescanClientProcesses(clientId, "בדיקה לילית מול כללי הלקוח", now);
    flagged += r.flagged;
    cleared += r.cleared;
  }
  return { flagged, cleared };
}
