import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Regression tests for the blog-admin session hardening in the security
// review. lib/adminAuth.ts reads its secrets from process.env at call
// time, so each test sets them directly rather than through a mock.

const ORIGINAL = { password: process.env.ADMIN_PASSWORD, secret: process.env.ADMIN_SESSION_SECRET };

async function freshModule() {
  // adminAuth has no module-level state, but re-importing keeps each test
  // honest about not depending on import order.
  return import("@/lib/adminAuth");
}

beforeEach(() => {
  process.env.ADMIN_PASSWORD = "correct-horse-battery-staple";
  process.env.ADMIN_SESSION_SECRET = "test-session-secret";
});

afterEach(() => {
  if (ORIGINAL.password === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = ORIGINAL.password;
  if (ORIGINAL.secret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = ORIGINAL.secret;
});

describe("checkPassword (CWE-208, length oracle)", () => {
  it("accepts the configured password", async () => {
    const { checkPassword } = await freshModule();
    expect(checkPassword("correct-horse-battery-staple")).toBe(true);
  });

  it("rejects a wrong password of the SAME length", async () => {
    const { checkPassword } = await freshModule();
    const wrong = "correct-horse-battery-stapleX".slice(0, "correct-horse-battery-staple".length);
    expect(wrong).toHaveLength("correct-horse-battery-staple".length);
    // Differs from the real password only in its final character.
    expect(checkPassword(wrong.slice(0, -1) + "X")).toBe(false);
  });

  it("rejects a wrong password of a DIFFERENT length without throwing", async () => {
    // The old implementation bailed out on a length mismatch before ever
    // reaching timingSafeEqual, which is what leaked the length. Hashing
    // both sides means differing lengths are just another false.
    const { checkPassword } = await freshModule();
    expect(checkPassword("x")).toBe(false);
    expect(checkPassword("x".repeat(500))).toBe(false);
  });

  it("rejects everything when no password is configured", async () => {
    delete process.env.ADMIN_PASSWORD;
    const { checkPassword } = await freshModule();
    expect(checkPassword("")).toBe(false);
    expect(checkPassword("anything")).toBe(false);
  });
});

describe("session tokens (CWE-613, insufficient session expiration)", () => {
  it("accepts a token it just issued", async () => {
    const { createSessionToken, isValidSessionToken } = await freshModule();
    expect(isValidSessionToken(createSessionToken())).toBe(true);
  });

  it("INVALIDATES every live session when the admin password is rotated", async () => {
    const { createSessionToken, isValidSessionToken } = await freshModule();
    const token = createSessionToken();
    expect(isValidSessionToken(token)).toBe(true);

    process.env.ADMIN_PASSWORD = "a-brand-new-password-after-a-leak";
    expect(isValidSessionToken(token)).toBe(false);
  });

  it("rejects legacy two-segment tokens issued before this change", async () => {
    const { isValidSessionToken } = await freshModule();
    expect(isValidSessionToken(`${Date.now() + 100000}.deadbeef`)).toBe(false);
  });

  it("rejects a tampered expiry", async () => {
    const { createSessionToken, isValidSessionToken } = await freshModule();
    const [, fingerprint, signature] = createSessionToken().split(".");
    const forged = `${Date.now() + 10 ** 12}.${fingerprint}.${signature}`;
    expect(isValidSessionToken(forged)).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const { createSessionToken } = await freshModule();
    const token = createSessionToken();
    process.env.ADMIN_SESSION_SECRET = "a-different-secret";
    const { isValidSessionToken } = await freshModule();
    expect(isValidSessionToken(token)).toBe(false);
  });

  it("rejects empty and malformed input", async () => {
    const { isValidSessionToken } = await freshModule();
    expect(isValidSessionToken(undefined)).toBe(false);
    expect(isValidSessionToken(null)).toBe(false);
    expect(isValidSessionToken("")).toBe(false);
    expect(isValidSessionToken("garbage")).toBe(false);
    expect(isValidSessionToken("a.b.c.d")).toBe(false);
  });
});
