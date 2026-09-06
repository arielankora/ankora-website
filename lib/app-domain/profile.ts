import "server-only";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword, validatePasswordPolicy } from "@/lib/app-auth/password";
import { recordAudit } from "@/lib/app-auth/audit";
import type { User } from "@prisma/client";

// Phase 9 gap-fix (docs/adr/0001 section 17.2, spec §11): self-service
// Profile screen - before this phase the only password-change path was
// the unauthenticated forgot-password -> reset-password flow
// (lib/app-auth/password-reset.ts); there was no way for an already
// logged-in user to change their own password or set a timezone
// preference. Strictly self-service, same as notifications.ts: every
// function here only ever acts on the caller's own row.

export class WrongPasswordError extends Error {
  constructor() {
    super("The current password is incorrect.");
    this.name = "WrongPasswordError";
  }
}

/// Verifies the caller's current password before hashing and saving the
/// new one - unlike the forgot-password flow (which has no "old password"
/// to check because the whole point is the user can't log in), a logged-in
/// user changing their own password must prove they still know it, same
/// as any standard "change password" screen.
///
/// Increments tokenVersion, same as consumePasswordResetToken - this
/// invalidates every session (including the current one) per spec 4.2's
/// "logout all sessions" semantics on any password change, so the caller
/// must redirect to /app/login afterward (lib/app-auth/session.ts's
/// getCurrentUser re-checks tokenVersion against the DB on every request).
export async function changeOwnPassword(
  actor: User,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const matches = await verifyPassword(currentPassword, actor.passwordHash);
  if (!matches) return { ok: false, error: "הסיסמה הנוכחית שגויה." };

  const policy = validatePasswordPolicy(newPassword);
  if (!policy.valid) return { ok: false, error: policy.reason! };

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: actor.id },
    data: { passwordHash, tokenVersion: { increment: 1 } },
  });

  await recordAudit({
    actorId: actor.id,
    action: "profile.password_change",
    entityType: "User",
    entityId: actor.id,
  });

  return { ok: true };
}

export async function updateOwnTimezone(actor: User, timezone: string): Promise<void> {
  const trimmed = timezone.trim();
  if (!trimmed) throw new Error("יש לבחור אזור זמן.");

  await prisma.user.update({ where: { id: actor.id }, data: { timezone: trimmed } });
  await recordAudit({
    actorId: actor.id,
    action: "profile.timezone_update",
    entityType: "User",
    entityId: actor.id,
    after: { timezone: trimmed },
  });
}
