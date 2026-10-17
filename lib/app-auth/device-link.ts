import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { User } from "@prisma/client";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { beginPasskeyStepUp, finishPasskeyStepUp, type RelyingParty } from "@/lib/app-auth/passkeys";

// "Add a device" (17.10.2026).
//
// The problem it solves: a passkey lives on the device that made it. Ariel
// enrolled on his Mac, then signed in on his iPhone, and the iPhone had no
// passkey to answer with. All iOS could offer was a QR code for another
// device to scan, and a Mac cannot scan its own screen. Sign-in enrolment
// only allows the first passkey (second-factor.ts), and the profile can
// only add one once you are already in, so the phone could never get in.
//
// The fix is the usual one: a device that is already signed in vouches for
// the new one.
//
//   1. On the signed-in device, profile, "add a device": a passkey check
//      there, right now, and a six-digit code appears.
//   2. On the new device: password, then "this is a new device", then the
//      code. That sign-in may now enrol a passkey of its own, and that
//      enrolment is its second factor.
//
// So a new device still needs both factors: the password, and proof from
// a device that already holds a passkey. The code is short, so it is
// bound to one person (the one whose password was just typed), lives ten
// minutes, takes five tries, and dies on use. Every step is audited, and
// the person gets an email when a device is added.

export const DEVICE_LINK_TTL_MS = 10 * 60_000;
export const DEVICE_LINK_MAX_ATTEMPTS = 5;

export function hashDeviceLinkCode(userId: string, code: string): string {
  return createHash("sha256").update(`${userId}:${code}`).digest("hex");
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/// Six digits, as typed. Spaces and dashes a person might add are ignored.
export function normaliseDeviceLinkCode(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "").slice(0, 12);
}

/// Step 1 on the signed-in device: the challenge for the passkey check.
export async function deviceLinkOptions(actor: User, rp: RelyingParty) {
  return beginPasskeyStepUp(actor, rp);
}

/// Step 2 on the signed-in device: the passkey answered, here is the code.
/// A wrong answer counts toward the same lockout as any identity check.
export async function issueDeviceLinkCode(actor: User, response: AuthenticationResponseJSON, rp: RelyingParty) {
  await finishPasskeyStepUp(actor, response, rp);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + DEVICE_LINK_TTL_MS);
  // One live code per person: a new one replaces the last.
  await prisma.deviceLinkCode.upsert({
    where: { userId: actor.id },
    create: { userId: actor.id, codeHash: hashDeviceLinkCode(actor.id, code), expiresAt },
    update: { codeHash: hashDeviceLinkCode(actor.id, code), expiresAt, attempts: 0, createdAt: new Date() },
  });
  await recordAudit({
    actorId: actor.id,
    action: "passkey.link_code",
    entityType: "User",
    entityId: actor.id,
    after: { expiresAt: expiresAt.toISOString() },
  });
  return { code, expiresAt };
}
