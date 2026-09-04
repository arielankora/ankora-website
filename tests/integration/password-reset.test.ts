import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestUser } from "./factories";
import { requestPasswordReset, consumePasswordResetToken } from "@/lib/app-auth/password-reset";
import { authenticateWithPassword } from "@/lib/app-auth/authenticate";

describe("password reset - spec 4.2 'forgot password via one-time link with expiry'", () => {
  it("returns null for an unknown identifier, without creating a token (no enumeration)", async () => {
    const raw = await requestPasswordReset("nobody@test.ankora.local");
    expect(raw).toBeNull();

    const tokenCount = await prisma.passwordResetToken.count();
    expect(tokenCount).toBe(0);
  });

  it("issues a token for an existing ACTIVE user", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const raw = await requestPasswordReset(user.email);
    expect(raw).toBeTruthy();
  });

  it("completes end-to-end: request -> consume -> new password works -> old password no longer works", async () => {
    const { user, password: oldPassword } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const raw = await requestPasswordReset(user.email);

    const result = await consumePasswordResetToken(raw!, "Br4nd-New-Passw0rd!");
    expect(result.ok).toBe(true);

    const loginWithNew = await authenticateWithPassword(user.email, "Br4nd-New-Passw0rd!");
    expect(loginWithNew).not.toBeNull();

    const loginWithOld = await authenticateWithPassword(user.email, oldPassword);
    expect(loginWithOld).toBeNull();
  });

  it("activates an INVITED user on first successful reset", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "INVITED" });
    const raw = await requestPasswordReset(user.email);
    // requestPasswordReset only matches status: "ACTIVE" users - an
    // invite's token is generated directly by inviteUser() instead. This
    // test exercises consumePasswordResetToken()'s own activation logic
    // by creating the token directly, the way inviteUser() does.
    const crypto = await import("crypto");
    const rawInviteToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(rawInviteToken).digest("hex");
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 60_000) },
    });

    const result = await consumePasswordResetToken(rawInviteToken, "Br4nd-New-Passw0rd!");
    expect(result.ok).toBe(true);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.status).toBe("ACTIVE");
    void raw;
  });

  it("rejects a weak new password without consuming the token", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const raw = await requestPasswordReset(user.email);

    const result = await consumePasswordResetToken(raw!, "short");
    expect(result.ok).toBe(false);

    // Token must still be usable, since the weak-password attempt should
    // never have touched it.
    const secondAttempt = await consumePasswordResetToken(raw!, "Br4nd-New-Passw0rd!");
    expect(secondAttempt.ok).toBe(true);
  });

  it("rejects a token that has already been used", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const raw = await requestPasswordReset(user.email);

    const first = await consumePasswordResetToken(raw!, "Br4nd-New-Passw0rd!");
    expect(first.ok).toBe(true);

    const second = await consumePasswordResetToken(raw!, "Another-New-Passw0rd!");
    expect(second.ok).toBe(false);
  });

  it("rejects an unknown/garbage token", async () => {
    const result = await consumePasswordResetToken("not-a-real-token", "Br4nd-New-Passw0rd!");
    expect(result.ok).toBe(false);
  });

  it("rejects an expired token", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const crypto = await import("crypto");
    const raw = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await consumePasswordResetToken(raw, "Br4nd-New-Passw0rd!");
    expect(result.ok).toBe(false);
  });

  it("bumps tokenVersion on reset, so pre-reset sessions are invalidated", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE", tokenVersion: 3 });
    const raw = await requestPasswordReset(user.email);
    await consumePasswordResetToken(raw!, "Br4nd-New-Passw0rd!");

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.tokenVersion).toBe(4);
  });
});
