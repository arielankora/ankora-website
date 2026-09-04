import "server-only";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword, validatePasswordPolicy } from "@/lib/app-auth/password";
import { recordAudit } from "@/lib/app-auth/audit";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h for a self-service forgot-password request

function hashToken(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/// Spec 4.2: "Forgot password באמצעות link חד-פעמי עם expiry." Always
/// returns normally (never reveals whether the email exists) - the raw
/// token is only returned to the caller when a matching, active user was
/// found. Same limitation as invites (see lib/app-domain/users.ts): no
/// email provider yet, so the caller is responsible for surfacing this
/// link out-of-band until Phase 4.
export async function requestPasswordReset(identifier: string): Promise<string | null> {
  const email = identifier.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: { deletedAt: null, status: "ACTIVE", OR: [{ email }, { username: email }] },
  });
  if (!user) return null;

  const raw = crypto.randomBytes(32).toString("base64url");
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });

  await recordAudit({ actorId: user.id, action: "password_reset.requested", entityType: "User", entityId: user.id });
  return raw;
}

export async function consumePasswordResetToken(
  raw: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const policy = validatePasswordPolicy(newPassword);
  if (!policy.valid) return { ok: false, error: policy.reason! };

  const tokenHash = hashToken(raw);
  const token = await prisma.passwordResetToken.findUnique({ where: { tokenHash }, include: { user: true } });

  if (!token || token.usedAt || token.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "הקישור אינו תקין או שפג תוקפו." };
  }
  if (token.user.deletedAt || token.user.status === "ARCHIVED") {
    return { ok: false, error: "החשבון אינו פעיל." };
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: token.userId },
      data: {
        passwordHash,
        // Activates an invited user's first login, and - just as
        // importantly - invalidates any sessions issued before the
        // password change (e.g. if the reset was triggered because of a
        // compromised account).
        status: token.user.status === "INVITED" ? "ACTIVE" : token.user.status,
        tokenVersion: { increment: 1 },
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    }),
    prisma.passwordResetToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
  ]);

  await recordAudit({
    actorId: token.userId,
    action: "password_reset.completed",
    entityType: "User",
    entityId: token.userId,
  });

  return { ok: true };
}
