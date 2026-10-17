import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { User } from "@prisma/client";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { isProductionDeployment } from "@/lib/env";
import type { AuthenticatedUser } from "@/lib/app-auth/authenticate";
import { sendEmail } from "@/lib/email";
import { appBaseUrl, renderActionEmail } from "@/lib/email-templates";
import {
  DEVICE_LINK_MAX_ATTEMPTS,
  hashDeviceLinkCode,
  normaliseDeviceLinkCode,
  sameHash,
} from "@/lib/app-auth/device-link";
import {
  beginPasskeyEnrollmentAtLogin,
  beginPasskeyLogin,
  finishPasskeyRegistration,
  verifyPasskeyLogin,
  PasskeyError,
  type RelyingParty,
} from "@/lib/app-auth/passkeys";

// Two-step sign-in (16.10.2026, Ariel: staff required, clients optional).
//
// The shape that matters: there is no half-signed-in session. The first
// factor (password, or the emailed link for clients) does not start a
// session; it creates a PendingLogin, five minutes and single use, held by
// the browser as a random token. Auth.js has exactly one provider, and it
// accepts a pending login and nothing else (auth.ts). So a password alone
// can never reach a page, an API route or a server action, and no gate in
// a layout is relied on to keep it out.
//
// Who needs the second step:
//   * Ankora staff, always, on the production deployment. Previews are
//     left out on purpose: a passkey is bound to the host it was made on,
//     every preview has its own host, and previews sit behind Vercel's
//     deployment protection. Locally and in CI the step is off, so the
//     rest of the suite can sign in; the tests here switch production on.
//   * A client who turned it on in their profile.
//
// The second step is a passkey: Touch ID, Face ID, Windows Hello. Phishing
// resistant, nothing to type, and already the vault's identity check.
//
// Someone who must use one and has none (a new employee, or after an
// admin reset for a lost device) enrols one inside the same sign-in,
// right after their password. That is the one moment a password alone is
// enough, and only for the very first passkey; with one already on file,
// a lost device goes through an admin reset, never through enrolment.

export const PENDING_LOGIN_TTL_MS = 5 * 60_000;

export class SecondFactorError extends Error {
  /// False when the pending sign-in is still alive and the person may try
  /// again (a mistyped device code). Everything else ends the sign-in.
  readonly fatal: boolean;
  constructor(message = "פג תוקף הכניסה. התחילו שוב מהסיסמה.", { fatal = true }: { fatal?: boolean } = {}) {
    super(message);
    this.name = "SecondFactorError";
    this.fatal = fatal;
  }
}

export type LoginMethod = "password" | "link";
/// What the browser does next: nothing (sign in now), answer with a
/// passkey, or enrol the first one.
export type SecondStep = "none" | "passkey" | "enroll";

export function secondFactorRequired(user: { role: string; loginPasskeyRequired: boolean }): boolean {
  if (user.role === "CLIENT_USER") return user.loginPasskeyRequired;
  return isProductionDeployment();
}

function hash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/// Called once the first factor is proven. Returns the token the browser
/// carries to the next step, and which step that is.
export async function startPendingLogin(
  user: { id: string; role: string; loginPasskeyRequired: boolean },
  method: LoginMethod,
): Promise<{ token: string; step: SecondStep }> {
  const raw = randomBytes(32).toString("base64url");
  const required = secondFactorRequired(user);
  const step: SecondStep = !required
    ? "none"
    : (await prisma.passkey.count({ where: { userId: user.id } })) > 0
      ? "passkey"
      : "enroll";

  // One pending sign-in per person: a second password entry replaces an
  // abandoned one rather than leaving two tokens alive.
  await prisma.$transaction([
    prisma.pendingLogin.deleteMany({ where: { userId: user.id } }),
    prisma.pendingLogin.create({
      data: {
        userId: user.id,
        tokenHash: hash(raw),
        method,
        verifiedAt: step === "none" ? new Date() : null,
        secondFactor: step === "none" ? "none" : null,
        expiresAt: new Date(Date.now() + PENDING_LOGIN_TTL_MS),
      },
    }),
  ]);
  return { token: raw, step };
}

async function livePending(raw: string) {
  if (!raw || raw.length > 200) throw new SecondFactorError();
  const row = await prisma.pendingLogin.findUnique({ where: { tokenHash: hash(raw) }, include: { user: true } });
  if (!row || row.expiresAt.getTime() < Date.now()) throw new SecondFactorError();
  const user = row.user;
  if (user.deletedAt || (user.status !== "ACTIVE" && user.status !== "INVITED")) throw new SecondFactorError();
  return { row, user };
}

async function abandon(id: string) {
  await prisma.pendingLogin.deleteMany({ where: { id } });
}

// ── The passkey answer ────────────────────────────────────────────────

export async function passkeyOptionsForLogin(raw: string, rp: RelyingParty) {
  const { user } = await livePending(raw);
  return beginPasskeyLogin(user.id, rp);
}

export async function verifyLoginPasskey(raw: string, response: AuthenticationResponseJSON, rp: RelyingParty) {
  const { row, user } = await livePending(raw);
  const ok = await verifyPasskeyLogin(user.id, response, rp);
  if (!ok) {
    // A failed answer ends this sign-in; the next try starts from the
    // password, whose lockout counts the attempts.
    await abandon(row.id);
    await recordAudit({ actorId: user.id, action: "login.passkey_failure", entityType: "User", entityId: user.id, after: { method: row.method } });
    throw new SecondFactorError("ה-passkey לא אומת. התחילו שוב מהסיסמה.");
  }
  await prisma.pendingLogin.update({ where: { id: row.id }, data: { verifiedAt: new Date(), secondFactor: "passkey" } });
}

// ── A new device, vouched for by a signed-in one ──────────────────────
//
// lib/app-auth/device-link.ts issues the code. Here it is typed, right
// after the password, on the device that has no passkey yet.

export async function redeemDeviceLinkCode(raw: string, typed: unknown) {
  const { row, user } = await livePending(raw);
  if (!secondFactorRequired(user)) throw new SecondFactorError();
  const code = normaliseDeviceLinkCode(typed);
  const link = await prisma.deviceLinkCode.findUnique({ where: { userId: user.id } });
  if (!link || link.expiresAt.getTime() < Date.now()) {
    throw new SecondFactorError("אין קוד בתוקף. הפיקו קוד חדש במכשיר שבו אתם מחוברים.", { fatal: false });
  }
  // The try is counted before the answer is looked at, so parallel guesses
  // cannot each see the same count.
  const counted = await prisma.deviceLinkCode.update({ where: { id: link.id }, data: { attempts: { increment: 1 } } });
  const right = code.length === 6 && sameHash(hashDeviceLinkCode(user.id, code), link.codeHash);
  if (!right || counted.attempts > DEVICE_LINK_MAX_ATTEMPTS) {
    const exhausted = counted.attempts >= DEVICE_LINK_MAX_ATTEMPTS;
    await recordAudit({
      actorId: user.id,
      action: "passkey.link_code_failure",
      entityType: "User",
      entityId: user.id,
      after: { attempts: counted.attempts, exhausted },
    });
    if (exhausted) {
      await prisma.deviceLinkCode.deleteMany({ where: { id: link.id } });
      await abandon(row.id);
      throw new SecondFactorError("יותר מדי ניסיונות. הפיקו קוד חדש והתחילו שוב מהסיסמה.");
    }
    throw new SecondFactorError("הקוד שגוי. נסו שוב.", { fatal: false });
  }
  // Single use: only the request that deletes it goes on.
  const used = await prisma.deviceLinkCode.deleteMany({ where: { id: link.id } });
  if (used.count !== 1) throw new SecondFactorError();
  await prisma.pendingLogin.update({ where: { id: row.id }, data: { deviceLinkedAt: new Date() } });
  await recordAudit({ actorId: user.id, action: "passkey.link_code_used", entityType: "User", entityId: user.id });
}

// ── Enrolling a passkey inside the sign-in ────────────────────────────

/// The first passkey, or one more after a signed-in device vouched for
/// this one. With a passkey on file and no code, a password alone never
/// adds another: a lost device goes through an admin reset.
async function assertMayEnroll(user: User, row: { deviceLinkedAt: Date | null }) {
  if (!secondFactorRequired(user)) throw new SecondFactorError();
  if (row.deviceLinkedAt) return;
  if ((await prisma.passkey.count({ where: { userId: user.id } })) > 0) {
    throw new SecondFactorError("כבר יש passkey בחשבון. היכנסו איתו, או הוסיפו את המכשיר הזה עם קוד ממכשיר מחובר.");
  }
}

export async function enrollmentOptionsForLogin(raw: string, rp: RelyingParty) {
  const { row, user } = await livePending(raw);
  await assertMayEnroll(user, row);
  return beginPasskeyEnrollmentAtLogin(user, rp);
}

export async function finishLoginEnrollment(raw: string, response: RegistrationResponseJSON, name: string, rp: RelyingParty) {
  const { row, user } = await livePending(raw);
  await assertMayEnroll(user, row);
  try {
    await finishPasskeyRegistration(user, response, name, rp);
  } catch (err) {
    if (err instanceof PasskeyError) throw new SecondFactorError(err.message);
    throw err;
  }
  // The registration was made with the fingerprint or the device PIN,
  // seconds after the password: that is this sign-in's second factor.
  await prisma.pendingLogin.update({ where: { id: row.id }, data: { verifiedAt: new Date(), secondFactor: "passkey" } });
  if (row.deviceLinkedAt) await notifyDeviceAdded(user, name);
}

/// The person hears about every device added this way, by email, so a
/// device they did not add does not go unnoticed. Best effort: the sign-in
/// does not wait on the mail.
async function notifyDeviceAdded(user: User, name: string) {
  try {
    const label = (name ?? "").trim().slice(0, 60) || "מכשיר חדש";
    const { html, text } = renderActionEmail({
      title: "נוסף מכשיר לחשבון",
      body: [
        `שלום ${user.name},`,
        `המכשיר "${label}" נוסף עכשיו לכניסה לחשבון באנקורה, באישור ממכשיר שכבר היה מחובר.`,
        "אם לא אתם הוספתם אותו, היכנסו לפרופיל, הסירו את המכשיר והחליפו סיסמה, או כתבו לנו ל-security@ankora.co.il.",
      ],
      buttonLabel: "למכשירים שלי",
      url: `${appBaseUrl()}/app/profile#passkeys`,
    });
    await sendEmail({ to: [user.email], subject: "נוסף מכשיר לחשבון באנקורה", text, html });
  } catch (err) {
    console.error("[second-factor] device-added email failed:", err);
  }
}

// ── Completion ────────────────────────────────────────────────────────

/// The only door into a session (auth.ts). Burns the pending sign-in in
/// every case, and lets it through only when the second step was done,
/// or was not needed when the first factor was given.
export async function completePendingLogin(raw: string): Promise<AuthenticatedUser | null> {
  if (!raw || raw.length > 200) return null;
  const row = await prisma.pendingLogin.findUnique({ where: { tokenHash: hash(raw) }, include: { user: true } });
  if (!row) return null;
  // Single use, whatever happens below. deleteMany rather than delete, so
  // two racing completions cannot both see a row: only one deletes it.
  const burned = await prisma.pendingLogin.deleteMany({ where: { id: row.id } });
  if (burned.count !== 1) return null;
  if (row.expiresAt.getTime() < Date.now() || !row.verifiedAt) return null;

  const user = row.user;
  if (user.deletedAt || (user.status !== "ACTIVE" && user.status !== "INVITED")) return null;
  // Re-asked now, not trusted from the start: a client who turned the
  // requirement on in another tab, or staff on a deployment that changed,
  // cannot slip through on a pending row made before.
  const passkey = row.secondFactor === "passkey";
  if (secondFactorRequired(user) && !passkey) return null;

  if (row.method === "password") {
    await recordAudit({
      actorId: user.id,
      action: "login.success",
      entityType: "User",
      entityId: user.id,
      after: { secondFactor: passkey ? "passkey" : "none" },
    });
  } else if (passkey) {
    await recordAudit({ actorId: user.id, action: "login.passkey", entityType: "User", entityId: user.id, after: { method: row.method } });
  }

  return { id: user.id, name: user.name, email: user.email, role: user.role, tokenVersion: user.tokenVersion };
}

// ── A client's own choice ─────────────────────────────────────────────

/// A client turning "ask for a passkey at every sign-in" on or off. Both
/// directions ask for the password, typed now: switching it off is exactly
/// what someone holding a stolen session would want to do.
export async function setOwnLoginPasskeyRequired(actor: User, enabled: boolean, password: string) {
  if (actor.role !== "CLIENT_USER") throw new SecondFactorError("לצוות אנקורה האימות הדו-שלבי תמיד פעיל.");
  const { verifyOwnPassword } = await import("@/lib/app-auth/step-up");
  await verifyOwnPassword(actor, password);
  if (enabled && (await prisma.passkey.count({ where: { userId: actor.id } })) === 0) {
    throw new SecondFactorError("קודם מוסיפים passkey, ואז מפעילים.");
  }
  await prisma.user.update({ where: { id: actor.id }, data: { loginPasskeyRequired: enabled } });
  await recordAudit({
    actorId: actor.id,
    action: "user.login_passkey_required",
    entityType: "User",
    entityId: actor.id,
    before: { loginPasskeyRequired: actor.loginPasskeyRequired },
    after: { loginPasskeyRequired: enabled },
  });
}
