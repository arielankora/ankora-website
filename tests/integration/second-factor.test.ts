import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./setup";
import { createTestUser } from "./factories";

// Two-step sign-in (16.10.2026). The device's signatures are the library's
// (@simplewebauthn/server) and are replaced by a switch, as in
// passkeys.test.ts. What is ours, and tested here: who needs the second
// step, that no sign-in completes without it, that a pending sign-in
// answers once and dies in five minutes, that the first passkey can be
// enrolled only when there is none, and the client's own switch.

const verifier = vi.hoisted(() => ({ ok: true, credentialId: "cred-1" }));

vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@simplewebauthn/server")>();
  return {
    ...real,
    verifyRegistrationResponse: vi.fn(async () =>
      verifier.ok
        ? {
            verified: true,
            registrationInfo: {
              credential: { id: verifier.credentialId, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] },
              credentialDeviceType: "multiDevice",
              credentialBackedUp: true,
            },
          }
        : { verified: false },
    ),
    verifyAuthenticationResponse: vi.fn(async () =>
      verifier.ok ? { verified: true, authenticationInfo: { newCounter: 1 } } : { verified: false },
    ),
  };
});

import {
  completePendingLogin,
  enrollmentOptionsForLogin,
  finishLoginEnrollment,
  passkeyOptionsForLogin,
  secondFactorRequired,
  setOwnLoginPasskeyRequired,
  startPendingLogin,
  verifyLoginPasskey,
  SecondFactorError,
  PENDING_LOGIN_TTL_MS,
} from "@/lib/app-auth/second-factor";
import { removeMyPasskey, resetPasskeysByAdmin } from "@/lib/app-auth/passkeys";
import { StepUpFailedError } from "@/lib/app-auth/step-up";

const RP = { rpID: "localhost", origin: "http://localhost:3100" };

beforeEach(() => {
  verifier.ok = true;
  verifier.credentialId = `cred-${Math.random().toString(36).slice(2)}`;
  delete process.env.VERCEL_ENV;
});

function production() {
  process.env.VERCEL_ENV = "production";
}

async function withPasskey(userId: string) {
  await prisma.passkey.create({
    data: { userId, credentialId: verifier.credentialId, publicKey: Buffer.from([1]), name: "Mac", deviceType: "multiDevice" },
  });
}

async function answer(token: string) {
  await passkeyOptionsForLogin(token, RP);
  await verifyLoginPasskey(token, { id: verifier.credentialId } as any, RP);
}

describe("who needs the second step", () => {
  it("staff on the production deployment, and nowhere else", async () => {
    const staff = { role: "ANKORA_EMPLOYEE" as const, loginPasskeyRequired: false };
    expect(secondFactorRequired(staff)).toBe(false);
    process.env.VERCEL_ENV = "preview";
    expect(secondFactorRequired(staff)).toBe(false);
    production();
    expect(secondFactorRequired(staff)).toBe(true);
    expect(secondFactorRequired({ role: "SUPER_ADMIN", loginPasskeyRequired: false })).toBe(true);
  });

  it("a client only when they turned it on", () => {
    production();
    expect(secondFactorRequired({ role: "CLIENT_USER", loginPasskeyRequired: false })).toBe(false);
    expect(secondFactorRequired({ role: "CLIENT_USER", loginPasskeyRequired: true })).toBe(true);
  });
});

describe("staff on production", () => {
  it("cannot complete a sign-in on the password alone", async () => {
    production();
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await withPasskey(user.id);
    const { token, step } = await startPendingLogin(user, "password");
    expect(step).toBe("passkey");
    expect(await completePendingLogin(token)).toBeNull();
    // And the attempt burned it.
    expect(await prisma.pendingLogin.count({ where: { userId: user.id } })).toBe(0);
  });

  it("completes with the passkey, and audits which factor was used", async () => {
    production();
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await withPasskey(user.id);
    const { token } = await startPendingLogin(user, "password");
    await answer(token);
    expect(await completePendingLogin(token)).toMatchObject({ id: user.id });
    const audit = await prisma.auditEvent.findFirst({ where: { action: "login.success", actorId: user.id } });
    expect(audit?.afterJson).toMatchObject({ secondFactor: "passkey" });
  });

  it("a wrong passkey ends the sign-in", async () => {
    production();
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await withPasskey(user.id);
    const { token } = await startPendingLogin(user, "password");
    await passkeyOptionsForLogin(token, RP);
    verifier.ok = false;
    await expect(verifyLoginPasskey(token, { id: verifier.credentialId } as any, RP)).rejects.toBeInstanceOf(SecondFactorError);
    expect(await completePendingLogin(token)).toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "login.passkey_failure", actorId: user.id } })).toBe(1);
  });

  it("does not accept someone else's passkey", async () => {
    production();
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await withPasskey(user.id);
    const { user: other } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.passkey.create({
      data: { userId: other.id, credentialId: "other-cred", publicKey: Buffer.from([1]), name: "x", deviceType: "singleDevice" },
    });
    const { token } = await startPendingLogin(user, "password");
    await passkeyOptionsForLogin(token, RP);
    await expect(verifyLoginPasskey(token, { id: "other-cred" } as any, RP)).rejects.toBeInstanceOf(SecondFactorError);
  });

  it("enrols the first passkey inside the sign-in, and only the first", async () => {
    production();
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const first = await startPendingLogin(user, "password");
    expect(first.step).toBe("enroll");
    await enrollmentOptionsForLogin(first.token, RP);
    await finishLoginEnrollment(first.token, { id: verifier.credentialId } as any, "MacBook", RP);
    expect(await completePendingLogin(first.token)).toMatchObject({ id: user.id });
    expect(await prisma.passkey.count({ where: { userId: user.id } })).toBe(1);

    // With a passkey on file, a password cannot add another one.
    const second = await startPendingLogin(user, "password");
    expect(second.step).toBe("passkey");
    await expect(enrollmentOptionsForLogin(second.token, RP)).rejects.toBeInstanceOf(SecondFactorError);
  });
});

describe("a pending sign-in", () => {
  it("answers once", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { token, step } = await startPendingLogin(user, "password");
    expect(step).toBe("none");
    expect(await completePendingLogin(token)).toMatchObject({ id: user.id });
    expect(await completePendingLogin(token)).toBeNull();
  });

  it("dies after five minutes", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { token } = await startPendingLogin(user, "password");
    await prisma.pendingLogin.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect(PENDING_LOGIN_TTL_MS).toBe(5 * 60_000);
    expect(await completePendingLogin(token)).toBeNull();
  });

  it("is replaced by a new one, so only the latest is alive", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const a = await startPendingLogin(user, "password");
    const b = await startPendingLogin(user, "password");
    expect(await completePendingLogin(a.token)).toBeNull();
    expect(await completePendingLogin(b.token)).toMatchObject({ id: user.id });
  });

  it("does not outlive a suspension", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { token } = await startPendingLogin(user, "password");
    await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
    expect(await completePendingLogin(token)).toBeNull();
  });

  it("re-asks the rule at completion, not only at the start", async () => {
    const { user } = await createTestUser({ role: "CLIENT_USER" });
    const { token, step } = await startPendingLogin(user, "link");
    expect(step).toBe("none");
    await withPasskey(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { loginPasskeyRequired: true } });
    expect(await completePendingLogin(token)).toBeNull();
  });

  it("rejects a token that was never issued", async () => {
    expect(await completePendingLogin("not-a-token")).toBeNull();
    expect(await completePendingLogin("")).toBeNull();
  });
});

describe("a client's own switch", () => {
  it("needs the password both ways, and a passkey to turn on", async () => {
    const { user, password } = await createTestUser({ role: "CLIENT_USER" });
    await expect(setOwnLoginPasskeyRequired(user, true, password)).rejects.toBeInstanceOf(SecondFactorError);
    await withPasskey(user.id);
    await expect(setOwnLoginPasskeyRequired(user, true, "wrong")).rejects.toBeInstanceOf(StepUpFailedError);
    await setOwnLoginPasskeyRequired(user, true, password);
    const on = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(on.loginPasskeyRequired).toBe(true);
    expect((await startPendingLogin(on, "link")).step).toBe("passkey");
    expect(await prisma.auditEvent.count({ where: { action: "user.login_passkey_required", actorId: user.id } })).toBe(1);
  });

  it("goes with the last passkey", async () => {
    const { user } = await createTestUser({ role: "CLIENT_USER" });
    await withPasskey(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { loginPasskeyRequired: true } });
    const pk = await prisma.passkey.findFirstOrThrow({ where: { userId: user.id } });
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await removeMyPasskey(fresh, pk.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).loginPasskeyRequired).toBe(false);
  });

  it("is not for staff, who have it by role", async () => {
    const { user, password } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(setOwnLoginPasskeyRequired(user, false, password)).rejects.toBeInstanceOf(SecondFactorError);
  });
});

describe("an admin reset after a lost device", () => {
  it("clears the passkeys, ends every session, and lets the next sign-in enrol", async () => {
    production();
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await withPasskey(user.id);
    expect(await resetPasskeysByAdmin(admin, user.id)).toBe(1);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.tokenVersion).toBe(user.tokenVersion + 1);
    expect((await startPendingLogin(after, "password")).step).toBe("enroll");
    expect(await prisma.auditEvent.count({ where: { action: "passkey.reset", actorId: admin.id } })).toBe(1);
  });

  it("is an admin's to do", async () => {
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(resetPasskeysByAdmin(employee, user.id)).rejects.toThrow();
  });
});
