import "server-only";
import type { User } from "@prisma/client";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { SITE_URL } from "@/lib/site";
import { isProductionDeployment } from "@/lib/env";
import {
  assertNotLocked,
  openStepUpWindow,
  passwordStepUpAllowed,
  recordStepUpFailure,
  verifyOwnPassword,
} from "@/lib/app-auth/step-up";

// Passkeys for "verify it's you" before a credential is revealed
// (claude/credentials-vault-spec-2026-10-06.md, phase 1a, approved
// 6.10.2026). Touch ID on a Mac, Face ID on an iPhone, Windows Hello, or a
// hardware key.
//
// What this adds over typing the Ankora password again: a second factor.
// The private key never leaves the person's device and is unlocked by
// their fingerprint or face, so a leaked Ankora password alone no longer
// opens anyone's client logins. That was the one gap the spec named in the
// password-only step-up.
//
// Scope, deliberately narrow: passkeys answer the vault's step-up and
// nothing else. Signing in to Ankora is unchanged.
//
// Three rules:
//
//   1. Adding a passkey needs the Ankora password, typed now. Otherwise a
//      stolen session could enrol the thief's own passkey and pass every
//      check after it.
//   2. A challenge is issued by the server, bound to one person and one
//      purpose, valid for five minutes, and consumed on first use.
//   3. User verification is required. A passkey that answers without the
//      fingerprint or the device PIN is refused.

const CHALLENGE_TTL_MS = 5 * 60_000;
const RP_NAME = "Ankora";

export class PasskeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasskeyError";
  }
}

/// Who the passkey belongs to, as the browser sees it. Production pins the
/// canonical host (lib/site.ts), so a passkey made there works there and
/// nowhere else. Every other environment uses the host it was reached on:
/// a preview deployment or 127.0.0.1 in CI gets passkeys of its own.
export interface RelyingParty {
  rpID: string;
  origin: string;
}

export function relyingPartyFor(headers: Headers): RelyingParty {
  if (isProductionDeployment()) {
    const url = new URL(SITE_URL);
    return { rpID: url.hostname, origin: url.origin };
  }
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost";
  const proto = headers.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return { rpID: host.replace(/:\d+$/, ""), origin: `${proto}://${host}` };
}

// ── Reading ───────────────────────────────────────────────────────────

export async function listMyPasskeys(actor: Pick<User, "id">) {
  return prisma.passkey.findMany({
    where: { userId: actor.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, createdAt: true, lastUsedAt: true, backedUp: true },
  });
}

/// What the step-up prompt may offer this person.
export async function stepUpMethods(actor: Pick<User, "id">) {
  const passkeys = await prisma.passkey.count({ where: { userId: actor.id } });
  return { passkey: passkeys > 0, password: passwordStepUpAllowed() };
}

// ── Challenges ────────────────────────────────────────────────────────

type ChallengePurpose = "register" | "step-up" | "login";

async function issueChallenge(userId: string, purpose: ChallengePurpose, challenge: string) {
  // One open challenge per person and purpose. A second request replaces
  // the first, so an abandoned prompt does not leave answers lying around.
  await prisma.$transaction([
    prisma.webAuthnChallenge.deleteMany({ where: { userId, purpose } }),
    prisma.webAuthnChallenge.create({
      data: { userId, purpose, challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
    }),
  ]);
}

/// Returns the open challenge and deletes it in the same step, so it can
/// be answered exactly once, whatever happens next.
async function consumeChallenge(userId: string, purpose: ChallengePurpose): Promise<string> {
  const rows = await prisma.webAuthnChallenge.findMany({ where: { userId, purpose } });
  await prisma.webAuthnChallenge.deleteMany({ where: { userId, purpose } });
  const live = rows.find((r) => r.expiresAt.getTime() > Date.now());
  if (!live) throw new PasskeyError("פג תוקף הבקשה. נסו שוב.");
  return live.challenge;
}

// ── Registration ──────────────────────────────────────────────────────

export async function beginPasskeyRegistration(actor: User, password: string, rp: RelyingParty) {
  await verifyOwnPassword(actor, password);
  return registrationOptions(actor, rp);
}

/// The same options, for the first passkey enrolled during sign-in
/// (lib/app-auth/second-factor.ts). The password was typed seconds ago, at
/// the first step of that same sign-in, and that step is what this relies
/// on; it is not reachable from a session.
export async function beginPasskeyEnrollmentAtLogin(actor: User, rp: RelyingParty) {
  return registrationOptions(actor, rp);
}

async function registrationOptions(actor: User, rp: RelyingParty) {
  const existing = await prisma.passkey.findMany({
    where: { userId: actor.id },
    select: { credentialId: true, transports: true },
  });
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: actor.email,
    userDisplayName: actor.name,
    userID: new TextEncoder().encode(actor.id),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  await issueChallenge(actor.id, "register", options.challenge);
  return options;
}

export async function finishPasskeyRegistration(
  actor: User,
  response: RegistrationResponseJSON,
  name: string,
  rp: RelyingParty,
) {
  const expectedChallenge = await consumeChallenge(actor.id, "register");
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
  } catch {
    throw new PasskeyError("ה-passkey לא אומת. נסו שוב.");
  }
  if (!verification.verified) throw new PasskeyError("ה-passkey לא אומת. נסו שוב.");

  const info = verification.registrationInfo;
  const label = (name ?? "").trim().slice(0, 60) || "Passkey";
  const created = await prisma.passkey.create({
    data: {
      userId: actor.id,
      credentialId: info.credential.id,
      publicKey: Buffer.from(info.credential.publicKey),
      counter: info.credential.counter,
      transports: info.credential.transports ?? [],
      name: label,
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
    },
    select: { id: true },
  });
  await recordAudit({
    actorId: actor.id,
    action: "passkey.create",
    entityType: "Passkey",
    entityId: created.id,
    after: { name: label, deviceType: info.credentialDeviceType, backedUp: info.credentialBackedUp },
  });

  // Employee lifecycle: a passkey may be the second half of the
  // onboarding signature step. Best effort; the passkey is already saved
  // and nothing here may undo or delay that.
  try {
    const { onPasskeyRegistered } = await import("@/lib/app-domain/employee-lifecycle");
    await onPasskeyRegistered(actor.id);
  } catch (err) {
    console.error("[passkeys] onboarding hook failed:", err);
  }
  return created;
}

export async function removeMyPasskey(actor: User, id: string) {
  const row = await prisma.passkey.findFirst({ where: { id, userId: actor.id }, select: { id: true, name: true } });
  if (!row) throw new PasskeyError("ה-passkey לא נמצא.");
  await prisma.passkey.delete({ where: { id } });
  // A client who asked for a passkey at every sign-in and just removed the
  // last one would otherwise be sent to enrol one at the next sign-in; the
  // choice goes with the last passkey, and the screen says so.
  if ((await prisma.passkey.count({ where: { userId: actor.id } })) === 0 && actor.loginPasskeyRequired) {
    await prisma.user.update({ where: { id: actor.id }, data: { loginPasskeyRequired: false } });
  }
  await recordAudit({
    actorId: actor.id,
    action: "passkey.delete",
    entityType: "Passkey",
    entityId: id,
    before: { name: row.name },
  });
}

// ── Step-up ───────────────────────────────────────────────────────────

export async function beginPasskeyStepUp(actor: User, rp: RelyingParty) {
  await assertNotLocked(actor.id);
  const passkeys = await prisma.passkey.findMany({
    where: { userId: actor.id },
    select: { credentialId: true, transports: true },
  });
  if (passkeys.length === 0) throw new PasskeyError("לא הוגדר passkey.");
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: passkeys.map((p) => ({ id: p.credentialId, transports: p.transports as any })),
    userVerification: "required",
  });
  await issueChallenge(actor.id, "step-up", options.challenge);
  return options;
}

export async function finishPasskeyStepUp(actor: User, response: AuthenticationResponseJSON, rp: RelyingParty) {
  await assertNotLocked(actor.id);
  const expectedChallenge = await consumeChallenge(actor.id, "step-up");

  // Only this person's own passkeys. Someone else's credential id is
  // treated exactly like a wrong answer.
  const passkey = await prisma.passkey.findFirst({ where: { credentialId: response?.id ?? "", userId: actor.id } });
  if (!passkey) return recordStepUpFailure(actor, "passkey");

  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports as any,
      },
      requireUserVerification: true,
    });
  } catch {
    return recordStepUpFailure(actor, "passkey");
  }
  if (!result.verified) return recordStepUpFailure(actor, "passkey");

  await prisma.passkey.update({
    where: { id: passkey.id },
    data: { counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() },
  });
  return openStepUpWindow(actor, "passkey");
}

// ── Sign-in ───────────────────────────────────────────────────────────
//
// The passkey as the second step of signing in (lib/app-auth/second-
// factor.ts). Its own challenge purpose, so a step-up answer cannot be
// replayed as a sign-in and the reverse. A failure here is not counted
// toward the step-up lockout: the sign-in that failed is thrown away and
// has to start again from the password, whose own lockout governs.

export async function beginPasskeyLogin(userId: string, rp: RelyingParty) {
  const passkeys = await prisma.passkey.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });
  if (passkeys.length === 0) throw new PasskeyError("לא הוגדר passkey.");
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: passkeys.map((p) => ({ id: p.credentialId, transports: p.transports as any })),
    userVerification: "required",
  });
  await issueChallenge(userId, "login", options.challenge);
  return options;
}

/// True when the answer came from one of this person's own passkeys,
/// with the fingerprint or the device PIN.
export async function verifyPasskeyLogin(userId: string, response: AuthenticationResponseJSON, rp: RelyingParty): Promise<boolean> {
  let expectedChallenge: string;
  try {
    expectedChallenge = await consumeChallenge(userId, "login");
  } catch {
    return false;
  }
  const passkey = await prisma.passkey.findFirst({ where: { credentialId: response?.id ?? "", userId } });
  if (!passkey) return false;
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports as any,
      },
      requireUserVerification: true,
    });
  } catch {
    return false;
  }
  if (!result.verified) return false;
  await prisma.passkey.update({
    where: { id: passkey.id },
    data: { counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() },
  });
  return true;
}

/// An admin clearing someone's passkeys after a lost device. The person
/// enrols a new one at their next sign-in, after their password.
export async function resetPasskeysByAdmin(actor: User, userId: string) {
  const { assertCan } = await import("@/lib/app-auth/permissions");
  assertCan(actor.role, "user.manage");
  const removed = await prisma.passkey.deleteMany({ where: { userId } });
  await prisma.pendingLogin.deleteMany({ where: { userId } });
  // Whoever holds the lost device may also hold a live session on it.
  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  await recordAudit({
    actorId: actor.id,
    action: "passkey.reset",
    entityType: "User",
    entityId: userId,
    after: { removed: removed.count },
  });
  return removed.count;
}
