import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestUser } from "./factories";
import { authenticateWithPassword } from "@/lib/app-auth/authenticate";

describe("authenticateWithPassword() - spec 22 Auth/Roles acceptance criteria", () => {
  it("succeeds for an ACTIVE user with the correct password, and clears failed attempts", async () => {
    const { user, password } = await createTestUser({ role: "ANKORA_EMPLOYEE", failedLoginAttempts: 2 });

    const result = await authenticateWithPassword(user.email, password);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(user.id);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.failedLoginAttempts).toBe(0);
    expect(fresh.lastLoginAt).not.toBeNull();

    const auditEntry = await prisma.auditEvent.findFirst({ where: { actorId: user.id, action: "login.success" } });
    expect(auditEntry).not.toBeNull();
  });

  it("rejects a SUSPENDED user even with the correct password, without touching lockout counters", async () => {
    const { user, password } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "SUSPENDED" });

    const result = await authenticateWithPassword(user.email, password);

    expect(result).toBeNull();
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.failedLoginAttempts).toBe(0);
  });

  it("rejects an ARCHIVED user", async () => {
    const { user, password } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "ARCHIVED" });
    const result = await authenticateWithPassword(user.email, password);
    expect(result).toBeNull();
  });

  it("rejects a wrong password and records the failed attempt + audit event", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    const result = await authenticateWithPassword(user.email, "definitely-the-wrong-password");

    expect(result).toBeNull();
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.failedLoginAttempts).toBe(1);

    const auditEntry = await prisma.auditEvent.findFirst({ where: { actorId: user.id, action: "login.failure" } });
    expect(auditEntry).not.toBeNull();
  });

  it("returns null (never throws) for an unknown identifier - no account enumeration", async () => {
    const result = await authenticateWithPassword("nobody@test.ankora.local", "whatever-password");
    expect(result).toBeNull();
  });

  it("locks the account out after 5 consecutive failures, then blocks even the correct password", async () => {
    const { user, password } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    for (let i = 0; i < 5; i += 1) {
      await authenticateWithPassword(user.email, "wrong-password");
    }

    const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedUntil).not.toBeNull();
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Even the correct password is blocked while locked out.
    const result = await authenticateWithPassword(user.email, password);
    expect(result).toBeNull();
  });

  it("authenticates by username as well as email", async () => {
    const { user, password } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.user.update({ where: { id: user.id }, data: { username: "unique-username-1" } });

    const result = await authenticateWithPassword("unique-username-1", password);
    expect(result?.id).toBe(user.id);
  });
});
