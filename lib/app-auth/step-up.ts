import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/app-auth/password";
import { recordAudit } from "@/lib/app-auth/audit";
import { sendVaultAlert } from "@/lib/vault/alerts";

// "Verify it's you" before a credential is revealed
// (claude/credentials-vault-spec-2026-10-06.md, decisions 2 and 3).
//
// Phase 1 checks the person's own Ankora password again. That protects
// against an unattended laptop, a stolen session cookie and a forgotten
// tab. It does not protect against a leaked password - the same factor
// twice - which is why the spec makes a passkey a condition for the
// first real client password (phase 1a). `method` is stored so the audit
// trail says which kind of check opened each window.
//
// A successful check opens a window of STEP_UP_WINDOW_MS. Every reveal
// inside it is still audited on its own; the window only spares the
// person from typing their password again for the next one.
//
// The window is a database row bound to the user's tokenVersion. The JWT
// has no session id (auth.ts), so tokenVersion is the one lever that
// already closes everything: changing the password, a reset, and
// "disconnect all sessions" all bump it, and every open window dies with
// it.
//
// The lockout counts `credential.stepup_failed` rows in the audit log
// rather than a Redis counter. The audit row has to be written anyway,
// the table is append-only, and it means the lock and the evidence of
// the lock can never disagree.

export const STEP_UP_WINDOW_MS = 5 * 60_000;
export const STEP_UP_FAIL_LIMIT = 5;
export const STEP_UP_FAIL_WINDOW_MS = 15 * 60_000;

export class StepUpLockedError extends Error {
  constructor() {
    super("יותר מדי ניסיונות אימות. אפשר לנסות שוב בעוד רבע שעה.");
    this.name = "StepUpLockedError";
  }
}

export class StepUpFailedError extends Error {
  constructor() {
    super("הסיסמה שגויה.");
    this.name = "StepUpFailedError";
  }
}

export async function activeStepUp(actor: Pick<User, "id" | "tokenVersion">, now = new Date()) {
  return prisma.stepUpGrant.findFirst({
    where: { userId: actor.id, tokenVersion: actor.tokenVersion, expiresAt: { gt: now } },
    orderBy: { expiresAt: "desc" },
    select: { expiresAt: true, method: true },
  });
}

async function recentFailures(userId: string, now: Date): Promise<number> {
  return prisma.auditEvent.count({
    where: {
      actorId: userId,
      action: "credential.stepup_failed",
      createdAt: { gt: new Date(now.getTime() - STEP_UP_FAIL_WINDOW_MS) },
    },
  });
}

/// Checks the password and opens a window. Throws StepUpFailedError on a
/// wrong password and StepUpLockedError once the attempts run out.
export async function stepUpWithPassword(actor: User, password: string, now = new Date()) {
  // Checked before bcrypt runs: a locked-out caller gets no answer about
  // whether the password was right, including when it was.
  if ((await recentFailures(actor.id, now)) >= STEP_UP_FAIL_LIMIT) throw new StepUpLockedError();

  const ok = typeof password === "string" && password.length > 0 && (await verifyPassword(password, actor.passwordHash));

  if (!ok) {
    const failures = (await recentFailures(actor.id, now)) + 1;
    const locked = failures >= STEP_UP_FAIL_LIMIT;
    await recordAudit({
      actorId: actor.id,
      action: "credential.stepup_failed",
      entityType: "User",
      entityId: actor.id,
      after: { method: "password", locked },
    });
    if (locked) {
      // Exactly once: on the attempt that reaches the limit. Attempts
      // after it are refused above without reaching this line.
      await sendVaultAlert("נעילת אימות", [
        `${actor.name} (${actor.email}) הקליד/ה סיסמה שגויה ${STEP_UP_FAIL_LIMIT} פעמים לפני חשיפת גישה.`,
        `החשיפה נעולה למשתמש הזה ל-${STEP_UP_FAIL_WINDOW_MS / 60_000} דקות.`,
      ]);
      throw new StepUpLockedError();
    }
    throw new StepUpFailedError();
  }

  return prisma.stepUpGrant.create({
    data: {
      userId: actor.id,
      tokenVersion: actor.tokenVersion,
      method: "password",
      expiresAt: new Date(now.getTime() + STEP_UP_WINDOW_MS),
    },
    select: { expiresAt: true },
  });
}
