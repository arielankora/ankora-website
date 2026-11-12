import "server-only";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword, validatePasswordPolicy } from "@/lib/app-auth/password";
import { recordAudit } from "@/lib/app-auth/audit";
import { sendEmail } from "@/lib/email";
import { appBaseUrl, renderActionEmail } from "@/lib/email-templates";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h for a self-service forgot-password request

function hashToken(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/// Spec 4.2: "Forgot password באמצעות link חד-פעמי עם expiry." Always
/// returns normally (never reveals whether the email exists) - the raw
/// token is only returned to the caller when a matching, active user was
/// found, so tests and the dev screen can follow the link. The link is
/// also mailed to the account's work address.
export async function requestPasswordReset(identifier: string): Promise<string | null> {
  const email = identifier.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    // INVITED belongs here as much as ACTIVE. Someone who never used
    // their invite has no password to forget, but this is the door they
    // will try, and refusing them quietly - the same "check your inbox"
    // message with no mail behind it - was a dead end that ended in an
    // admin deleting and recreating the account (22.9.2026).
    // consumePasswordResetToken already promotes INVITED to ACTIVE on use,
    // so the flow completes correctly from here.
    where: { deletedAt: null, status: { in: ["ACTIVE", "INVITED"] }, OR: [{ email }, { username: email }] },
  });
  if (!user) return null;

  const raw = crypto.randomBytes(32).toString("base64url");
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });

  // 12.11.2026: until today this function minted the link and nothing
  // ever mailed it. The screen said "check your inbox" over an empty
  // inbox, in production, for every staff member who forgot a password
  // and for every invitee who tried this door. sendEmail never throws, so
  // a mail-provider outage still leaves the same neutral screen.
  const { html, text } = renderActionEmail({
    title: "בחירת סיסמה חדשה למערכת Ankora",
    body: [
      `שלום ${user.name},`,
      "התקבלה בקשה לבחור סיסמה חדשה לחשבון שלך. הקישור תקף לשעה ולשימוש אחד בלבד.",
    ],
    buttonLabel: "בחירת סיסמה",
    url: `${appBaseUrl()}/app/reset-password?token=${raw}`,
    footnote: "אם לא ביקשת את הקישור, אפשר להתעלם מההודעה. הסיסמה הנוכחית לא השתנתה.",
  });
  const mail = await sendEmail({ to: [user.email], subject: "בחירת סיסמה חדשה למערכת Ankora", text, html });

  await recordAudit({
    actorId: user.id,
    action: "password_reset.requested",
    entityType: "User",
    entityId: user.id,
    after: { emailSent: mail.ok },
  });
  return raw;
}

/// ADR 0006: why a reset was refused, so the screen can say it in the
/// reader's language. `error` stays the Hebrew sentence.
export type PasswordResetErrorCode = "password_too_short" | "password_too_common" | "link_invalid" | "account_inactive";

export async function consumePasswordResetToken(
  raw: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string; code: PasswordResetErrorCode }> {
  const policy = validatePasswordPolicy(newPassword);
  if (!policy.valid) {
    return { ok: false, error: policy.reason!, code: policy.code === "too_common" ? "password_too_common" : "password_too_short" };
  }

  const tokenHash = hashToken(raw);
  const token = await prisma.passwordResetToken.findUnique({ where: { tokenHash }, include: { user: true } });

  if (!token || token.usedAt || token.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "הקישור אינו תקין או שפג תוקפו.", code: "link_invalid" };
  }
  if (token.user.deletedAt || token.user.status === "ARCHIVED") {
    return { ok: false, error: "החשבון אינו פעיל.", code: "account_inactive" };
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
