import crypto from "crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "ankora_admin_session";
const SESSION_DAYS = 7;

function secret() {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error("ADMIN_SESSION_SECRET is not set");
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

// Security review (OWASP A02:2021 - Cryptographic Failures; CWE-208,
// "Observable Timing Discrepancy").
//
// The previous implementation compared the raw bytes and returned early
// when the two lengths differed. crypto.timingSafeEqual itself is
// constant-time, but the `a.length !== b.length` guard in front of it is
// not: it turns the endpoint into an oracle for the admin password's
// LENGTH, which is exactly the parameter that decides how expensive a
// brute-force search is. Hashing both sides first makes every comparison
// run over two fixed-size 32-byte digests, so neither length nor content
// leaks through response timing.
export function checkPassword(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = crypto.createHash("sha256").update(candidate, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

// Security review (OWASP A07:2021 - Identification and Authentication
// Failures; CWE-613, "Insufficient Session Expiration").
//
// The signed payload used to be the expiry timestamp alone. That made
// every issued session survive an ADMIN_PASSWORD rotation: if the
// password leaked and Ariel changed it, every session an attacker had
// already established stayed valid for its full 7 days, and the only way
// to actually revoke them was to rotate ADMIN_SESSION_SECRET too - which
// nothing in the code or the runbook told anyone to do.
//
// Binding a fingerprint of the current password into the signed payload
// makes "change the admin password" mean what an operator reasonably
// assumes it means: every existing session stops validating immediately,
// because its fingerprint no longer matches. The fingerprint is a
// truncated HMAC (keyed with ADMIN_SESSION_SECRET), never the password
// itself, so a stolen cookie still reveals nothing about the password.
function passwordFingerprint(): string {
  const expected = process.env.ADMIN_PASSWORD || "";
  return crypto.createHmac("sha256", secret()).update(expected).digest("hex").slice(0, 16);
}

export function createSessionToken(): string {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${expires}.${passwordFingerprint()}`;
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

export function isValidSessionToken(token: string | undefined | null): boolean {
  if (!token) return false;

  // `expires.fingerprint.signature`. Tokens issued before this change had
  // only two segments and no fingerprint; they are rejected here rather
  // than grandfathered in, which logs out existing admin sessions once on
  // deploy. That is the intended behavior for a session-integrity fix -
  // Ariel just logs in again.
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expires, fingerprint, signature] = parts;
  if (!expires || !fingerprint || !signature) return false;

  let expected: string;
  let currentFingerprint: string;
  try {
    expected = sign(`${expires}.${fingerprint}`);
    currentFingerprint = passwordFingerprint();
  } catch {
    return false;
  }

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  // Signature is authentic - now check it was issued against the password
  // currently in force, and hasn't expired.
  if (fingerprint !== currentFingerprint) return false;
  return Number(expires) > Date.now();
}

export function isAdminConfigured(): boolean {
  return !!(process.env.ADMIN_PASSWORD && process.env.ADMIN_SESSION_SECRET);
}

// Next 15 made cookies() asynchronous. The upgrade codemod's first pass
// reached for the `UnsafeUnwrappedCookies` escape hatch to keep this
// function synchronous, which still works in 15 but is deprecated and is
// removed in 16 - and this is the single gate in front of every blog
// admin endpoint, so it is the last place to leave a shim that will
// silently stop compiling later. Made properly async instead; all four
// call sites are already async route handlers and simply await it.
export async function isRequestAuthorized(): Promise<boolean> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  return isValidSessionToken(token);
}
