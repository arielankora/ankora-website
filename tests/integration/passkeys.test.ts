import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./setup";
import { createTestUser } from "./factories";

// Vault phase 1a: passkeys for "verify it's you"
// (claude/credentials-vault-spec-2026-10-06.md).
//
// The cryptography is the library's (@simplewebauthn/server) and is not
// re-tested here. What is tested is everything around it that is ours:
// who may enrol, that a challenge answers once, that a passkey answers
// only for its owner, that a failure counts toward the same lockout as a
// wrong password, and that production refuses the password outright. The
// verifier is replaced by a switch so each case can say what the device
// "answered".

const verifier = vi.hoisted(() => ({ ok: true, credentialId: "cred-1", newCounter: 1 }));

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
      verifier.ok ? { verified: true, authenticationInfo: { newCounter: verifier.newCounter } } : { verified: false },
    ),
  };
});

import {
  beginPasskeyRegistration,
  finishPasskeyRegistration,
  beginPasskeyStepUp,
  finishPasskeyStepUp,
  stepUpMethods,
  removeMyPasskey,
  PasskeyError,
} from "@/lib/app-auth/passkeys";
import {
  activeStepUp,
  stepUpWithPassword,
  PasskeyRequiredError,
  StepUpFailedError,
  StepUpLockedError,
  STEP_UP_FAIL_LIMIT,
} from "@/lib/app-auth/step-up";

const RP = { rpID: "localhost", origin: "http://localhost:3100" };

beforeEach(() => {
  verifier.ok = true;
  verifier.credentialId = `cred-${Math.random().toString(36).slice(2)}`;
  delete process.env.VERCEL_ENV;
  delete process.env.VAULT_REQUIRE_PASSKEY;
});

async function enrolled() {
  const { user, password } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await beginPasskeyRegistration(user, password, RP);
  await finishPasskeyRegistration(user, { id: verifier.credentialId } as any, "MacBook", RP);
  return { user, password, credentialId: verifier.credentialId };
}

describe("enrolment", () => {
  it("needs the Ankora password typed now", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(beginPasskeyRegistration(user, "wrong", RP)).rejects.toBeInstanceOf(StepUpFailedError);
    expect(await prisma.webAuthnChallenge.count({ where: { userId: user.id } })).toBe(0);
  });

  it("stores the public key only, and audits it", async () => {
    const { user } = await enrolled();
    const rows = await prisma.passkey.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "MacBook", backedUp: true });
    expect(await prisma.auditEvent.count({ where: { action: "passkey.create", actorId: user.id } })).toBe(1);
  });

  it("uses a challenge once", async () => {
    const { user, password } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await beginPasskeyRegistration(user, password, RP);
    await finishPasskeyRegistration(user, { id: verifier.credentialId } as any, "A", RP);
    verifier.credentialId = "cred-replay";
    await expect(finishPasskeyRegistration(user, { id: "cred-replay" } as any, "B", RP)).rejects.toBeInstanceOf(PasskeyError);
  });

  it("refuses an answer the verifier rejects", async () => {
    const { user, password } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await beginPasskeyRegistration(user, password, RP);
    verifier.ok = false;
    await expect(finishPasskeyRegistration(user, { id: "x" } as any, "A", RP)).rejects.toBeInstanceOf(PasskeyError);
    expect(await prisma.passkey.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("step-up with a passkey", () => {
  it("opens a window marked passkey and advances the counter", async () => {
    const { user, credentialId } = await enrolled();
    await beginPasskeyStepUp(user, RP);
    verifier.newCounter = 7;
    await finishPasskeyStepUp(user, { id: credentialId } as any, RP);
    expect(await activeStepUp(user)).toMatchObject({ method: "passkey" });
    expect((await prisma.passkey.findFirstOrThrow({ where: { userId: user.id } })).counter).toBe(7);
  });

  it("does not accept another person's passkey, and counts it as a failure", async () => {
    const owner = await enrolled();
    const { user: other } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.passkey.create({
      data: { userId: other.id, credentialId: "other-own", publicKey: Buffer.from([1]), name: "x", deviceType: "singleDevice" },
    });
    await beginPasskeyStepUp(other, RP);
    await expect(finishPasskeyStepUp(other, { id: owner.credentialId } as any, RP)).rejects.toBeInstanceOf(StepUpFailedError);
    expect(await activeStepUp(other)).toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "credential.stepup_failed", actorId: other.id } })).toBe(1);
  });

  it("shares the lockout with the password", async () => {
    const { user, credentialId } = await enrolled();
    for (let i = 1; i < STEP_UP_FAIL_LIMIT; i++) {
      await expect(stepUpWithPassword(user, "wrong")).rejects.toBeInstanceOf(StepUpFailedError);
    }
    verifier.ok = false;
    await beginPasskeyStepUp(user, RP);
    await expect(finishPasskeyStepUp(user, { id: credentialId } as any, RP)).rejects.toBeInstanceOf(StepUpLockedError);
    verifier.ok = true;
    await expect(beginPasskeyStepUp(user, RP)).rejects.toBeInstanceOf(StepUpLockedError);
  });

  it("refuses a step-up challenge answered twice", async () => {
    const { user, credentialId } = await enrolled();
    await beginPasskeyStepUp(user, RP);
    await finishPasskeyStepUp(user, { id: credentialId } as any, RP);
    await expect(finishPasskeyStepUp(user, { id: credentialId } as any, RP)).rejects.toBeInstanceOf(PasskeyError);
  });
});

describe("which checks are offered", () => {
  it("offers the password outside production, and never in production", async () => {
    const { user, password } = await enrolled();
    expect(await stepUpMethods(user)).toEqual({ passkey: true, password: true });

    process.env.VERCEL_ENV = "production";
    expect(await stepUpMethods(user)).toEqual({ passkey: true, password: false });
    await expect(stepUpWithPassword(user, password)).rejects.toBeInstanceOf(PasskeyRequiredError);
  });

  it("can require a passkey anywhere with VAULT_REQUIRE_PASSKEY=1", async () => {
    const { user, password } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    process.env.VAULT_REQUIRE_PASSKEY = "1";
    expect(await stepUpMethods(user)).toEqual({ passkey: false, password: false });
    await expect(stepUpWithPassword(user, password)).rejects.toBeInstanceOf(PasskeyRequiredError);
  });

  it("lets a person remove only their own passkey", async () => {
    const owner = await enrolled();
    const { user: other } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const pk = await prisma.passkey.findFirstOrThrow({ where: { userId: owner.user.id } });
    await expect(removeMyPasskey(other, pk.id)).rejects.toBeInstanceOf(PasskeyError);
    await removeMyPasskey(owner.user, pk.id);
    expect(await prisma.passkey.count({ where: { userId: owner.user.id } })).toBe(0);
  });
});
