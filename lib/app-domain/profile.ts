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

/// App redesign, Profile screen (screen 18): the prototype's editable "שם
/// לתצוגה" field had no backing capability before this - every prior
/// phase's Profile screen only ever let a user touch their own timezone
/// and password. Same self-service shape as updateOwnTimezone: scoped to
/// the caller's own row, trimmed, and audited. A generous but bounded
/// length cap (not enforced by the prototype, which has none) is the only
/// real-world validation this needs - there's no format constraint on a
/// display name.
export async function updateOwnName(actor: User, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("יש להזין שם.");
  if (trimmed.length > 100) throw new Error("השם ארוך מדי (100 תווים לכל היותר).");

  await prisma.user.update({ where: { id: actor.id }, data: { name: trimmed } });
  await recordAudit({
    actorId: actor.id,
    action: "profile.name_update",
    entityType: "User",
    entityId: actor.id,
    before: { name: actor.name },
    after: { name: trimmed },
  });
}

/// App redesign, Profile screen (screen 18): backs the prototype's
/// "עודכנה לפני X" password-last-changed line with a real value instead of
/// the prototype's fabricated "לפני 3 חודשים" example text. There's no
/// dedicated timestamp column for this (User.updatedAt touches on *any*
/// field change, including a timezone or name update, so it can't be
/// trusted to mean "password changed") - the accurate source is the audit
/// trail changeOwnPassword already writes on every real password change,
/// queried by its indexed (actorId, createdAt) shape. Returns null for a
/// user who has never changed their password through this screen (e.g. it
/// was set once at invitation time and never touched since) rather than
/// guessing.
export async function getLastPasswordChangeAt(actor: User): Promise<Date | null> {
  const event = await prisma.auditEvent.findFirst({
    where: { actorId: actor.id, action: "profile.password_change" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return event?.createdAt ?? null;
}

/// App redesign, Profile screen (screen 18): backs the one real toggle in
/// the redesigned "התראות אישיות" card - see the field-level comment on
/// User.notifyLongRunningTimerByEmail (schema.prisma) and
/// notifyLongRunningTimers() (lib/app-domain/notifications.ts) for what it
/// actually gates. The prototype's full toggle *list* (several rows of
/// notification categories) isn't reproduced - this is the only one with
/// a real, currently-existing notification behind it.
export async function updateLongRunningTimerEmailPreference(actor: User, enabled: boolean): Promise<void> {
  await prisma.user.update({
    where: { id: actor.id },
    data: { notifyLongRunningTimerByEmail: enabled },
  });
  await recordAudit({
    actorId: actor.id,
    action: "profile.notification_preference_update",
    entityType: "User",
    entityId: actor.id,
    after: { notifyLongRunningTimerByEmail: enabled },
  });
}
