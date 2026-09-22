import "server-only";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { sendEmail } from "@/lib/email";
import { appBaseUrl, renderActionEmail } from "@/lib/email-templates";
import { devOnly } from "@/lib/env";
import type { AuthenticatedUser } from "@/lib/app-auth/authenticate";

// Portal phase 0, "כניסה בקישור חד פעמי". A client opens the portal a few
// times a month; a password they must remember is the single biggest
// reason a portal stays empty. The link does not REPLACE the password -
// both work, and a client who set a password keeps using it.
//
// Deliberately limited to CLIENT_USER. Ankora staff hold the data of
// every client, and for them an emailed session link would turn any
// compromised mailbox into full access to the whole system; they keep
// password sign-in plus the existing lockout rules.

const LOGIN_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes

function hashToken(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/// Always returns normally and says nothing about whether the address
/// exists, is a client user, or is active - spec 20's rule for the
/// password-reset flow, applied here for the same reason. The caller
/// shows one message either way.
///
/// Returns the raw token ONLY outside production, so the flow stays
/// testable end to end without reading a real mailbox (same convention as
/// forgotPasswordAction's devLink).
export async function requestLoginLink(identifier: string): Promise<{ devToken?: string }> {
  const email = identifier.trim().toLowerCase();
  if (!email) return {};

  const user = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      role: "CLIENT_USER",
      status: { in: ["ACTIVE", "INVITED"] },
      OR: [{ email }, { username: email }],
    },
  });
  if (!user) return {};

  const raw = crypto.randomBytes(32).toString("base64url");
  await prisma.portalLoginToken.create({
    data: { userId: user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + LOGIN_LINK_TTL_MS) },
  });

  const url = `${appBaseUrl()}/app/login-link?token=${raw}`;
  const { html, text } = renderActionEmail({
    title: "קישור כניסה לפורטל Ankora",
    body: [
      `שלום ${user.name},`,
      "הקישור הזה מכניס אותך לפורטל בלי סיסמה. הוא תקף ל-15 דקות ולשימוש אחד בלבד.",
    ],
    buttonLabel: "כניסה לפורטל",
    url,
    footnote: "אם לא ביקשת את הקישור, אפשר להתעלם מההודעה. לא בוצע שינוי בחשבון.",
  });

  await sendEmail({ to: [user.email], subject: "קישור כניסה לפורטל Ankora", text, html });
  await recordAudit({
    actorId: user.id,
    action: "login_link.requested",
    entityType: "User",
    entityId: user.id,
  });

  return { devToken: devOnly(raw) };
}

/// Verifies a link and, on success, burns it. Mirrors
/// authenticateWithPassword's contract (an AuthenticatedUser or null) so
/// auth.ts can hand it to a Credentials provider unchanged.
export async function consumeLoginLink(raw: string): Promise<AuthenticatedUser | null> {
  if (!raw) return null;

  const token = await prisma.portalLoginToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: true },
  });

  if (!token || token.usedAt || token.expiresAt.getTime() < Date.now()) return null;

  const user = token.user;
  // Re-checked at consume time, not only at issue time: a user can be
  // suspended, archived or have their role changed in the 15 minutes the
  // link is alive, and the link must not outlive that decision.
  if (user.deletedAt || user.role !== "CLIENT_USER" || (user.status !== "ACTIVE" && user.status !== "INVITED")) {
    return null;
  }

  // The token row is marked used in the same transaction that activates
  // the account, so two clicks on the same link cannot both succeed - the
  // second finds usedAt already set. An INVITED client who signs in this
  // way becomes ACTIVE without ever choosing a password; they can still
  // set one later from the profile screen.
  await prisma.$transaction([
    prisma.portalLoginToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        status: user.status === "INVITED" ? "ACTIVE" : user.status,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    }),
  ]);

  await recordAudit({ actorId: user.id, action: "login_link.success", entityType: "User", entityId: user.id });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    tokenVersion: user.tokenVersion,
  };
}
