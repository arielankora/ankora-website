import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/app-auth/password";
import { recordAudit } from "@/lib/app-auth/audit";
import { sendVaultAlert } from "@/lib/vault/alerts";
import { isProductionDeployment } from "@/lib/env";

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

/// Whether the password is an acceptable way to verify, here. Production
/// requires a passkey (decision 2, 6.10.2026: a passkey is the condition
/// for real client passwords); every other environment also accepts the
/// password, so preview, CI and local work do not need an authenticator.
/// VAULT_REQUIRE_PASSKEY=1 turns the production rule on anywhere.
export function passwordStepUpAllowed(): boolean {
  if (isProductionDeployment()) return false;
  return process.env.VAULT_REQUIRE_PASSKEY !== "1";
}

export class PasskeyRequiredError extends Error {
  constructor() {
    super("צפייה בגישות דורשת passkey (Touch ID). אפשר להגדיר אותו ב\"הפרופיל שלי\".");
    this.name = "PasskeyRequiredError";
  }
}

/// Throws StepUpLockedError while this person is locked out. Checked
/// before any password or passkey is examined, so a locked-out caller
/// learns nothing about whether an answer was right.
export async function assertNotLocked(userId: string, now = new Date()) {
  if ((await recentFailures(userId, now)) >= STEP_UP_FAIL_LIMIT) throw new StepUpLockedError();
}

/// Records one failed identity check (password or passkey) and throws the
/// matching error. The fifth within the window locks and alerts, once.
export async function recordStepUpFailure(actor: User, method: "password" | "passkey", now = new Date()): Promise<never> {
  const failures = (await recentFailures(actor.id, now)) + 1;
  const locked = failures >= STEP_UP_FAIL_LIMIT;
  await recordAudit({
    actorId: actor.id,
    action: "credential.stepup_failed",
    entityType: "User",
    entityId: actor.id,
    after: { method, locked },
  });
  if (locked) {
    await sendVaultAlert("נעילת אימות", [
      `${actor.name} (${actor.email}) נכשל/ה באימות זהות ${STEP_UP_FAIL_LIMIT} פעמים לפני חשיפת גישה.`,
      `החשיפה נעולה למשתמש הזה ל-${STEP_UP_FAIL_WINDOW_MS / 60_000} דקות.`,
    ]);
    throw new StepUpLockedError();
  }
  throw new StepUpFailedError();
}

/// The person's own Ankora password, checked again, with the lockout.
/// Used for step-up where the password is allowed, and always before a
/// new passkey is added: otherwise a stolen session could enrol the
/// thief's own passkey and walk through every check after it.
export async function verifyOwnPassword(actor: User, password: string, now = new Date()) {
  await assertNotLocked(actor.id, now);
  const ok = typeof password === "string" && password.length > 0 && (await verifyPassword(password, actor.passwordHash));
  if (!ok) await recordStepUpFailure(actor, "password", now);
}

export async function openStepUpWindow(actor: User, method: "password" | "passkey", now = new Date()) {
  return prisma.stepUpGrant.create({
    data: {
      userId: actor.id,
      tokenVersion: actor.tokenVersion,
      method,
      expiresAt: new Date(now.getTime() + STEP_UP_WINDOW_MS),
    },
    select: { expiresAt: true },
  });
}

/// Checks the password and opens a window. Throws StepUpFailedError on a
/// wrong password, StepUpLockedError once the attempts run out, and
/// PasskeyRequiredError where the password is not accepted at all.
export async function stepUpWithPassword(actor: User, password: string, now = new Date()) {
  if (!passwordStepUpAllowed()) throw new PasskeyRequiredError();
  await verifyOwnPassword(actor, password, now);
  return openStepUpWindow(actor, "password", now);
}
