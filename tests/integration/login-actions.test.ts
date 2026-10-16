import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestClientUser, createTestUser } from "./factories";

// The sign-in screens' server actions with two-step sign-in (16.10.2026).
// second-factor.test.ts covers the rules; this covers the doors: a right
// password on production staff hands back a passkey step and never calls
// Auth.js, and everywhere a session does start, it starts through the one
// "pending-login" provider with a pending token, never with a password.

vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return { ...real, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});

const signInMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: async () => null, signIn: signInMock }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.current }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

const { loginAction } = await import("@/app/(product)/app/login/actions");
const { consumeLoginLinkAction } = await import("@/app/(product)/app/login-link/actions");
const { requestLoginLink } = await import("@/lib/app-auth/login-link");

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  signInMock.mockReset();
  delete process.env.VERCEL_ENV;
  // A fresh IP per test, so the per-IP login ceiling is never shared.
  requestHeaders.current = new Headers({
    host: "localhost:3100",
    "x-real-ip": `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  });
});

describe("loginAction", () => {
  it("on production, a right staff password gets a passkey step and no session", async () => {
    process.env.VERCEL_ENV = "production";
    const { user, password } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const state = await loginAction(undefined, form({ identifier: user.email, password }));
    expect(state).toMatchObject({ step: "enroll" });
    expect(typeof state.token).toBe("string");
    expect(signInMock).not.toHaveBeenCalled();
    // The password step does not claim a successful login.
    expect(await prisma.auditEvent.count({ where: { action: "login.success", actorId: user.id } })).toBe(0);
  });

  it("where no second step is needed, signs in through the pending provider, with a token", async () => {
    const { user, password } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await loginAction(undefined, form({ identifier: user.email, password }));
    expect(signInMock).toHaveBeenCalledTimes(1);
    const [provider, args] = signInMock.mock.calls[0];
    expect(provider).toBe("pending-login");
    expect(args).not.toHaveProperty("password");
    expect(typeof args.token).toBe("string");
  });

  it("a wrong password gets the one generic answer", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const state = await loginAction(undefined, form({ identifier: user.email, password: "wrong" }));
    expect(state).toEqual({ error: "פרטי ההתחברות שגויים, או שהחשבון חסום זמנית." });
    expect(signInMock).not.toHaveBeenCalled();
  });
});

describe("consumeLoginLinkAction", () => {
  it("a client who asked for a passkey gets the passkey step after the link", async () => {
    const client = await createTestClient();
    const { user } = await createTestClientUser({ clientId: client.id });
    await prisma.passkey.create({
      data: { userId: user.id, credentialId: "c-link", publicKey: Buffer.from([1]), name: "iPhone", deviceType: "multiDevice" },
    });
    await prisma.user.update({ where: { id: user.id }, data: { loginPasskeyRequired: true } });
    const { devToken } = await requestLoginLink(user.email);
    const state = await consumeLoginLinkAction(undefined, form({ token: devToken! }));
    expect(state).toMatchObject({ step: "passkey", callbackUrl: "/app/portal" });
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("any other client is signed in straight away, through the pending provider", async () => {
    const client = await createTestClient();
    const { user } = await createTestClientUser({ clientId: client.id });
    const { devToken } = await requestLoginLink(user.email);
    await consumeLoginLinkAction(undefined, form({ token: devToken! }));
    expect(signInMock.mock.calls[0][0]).toBe("pending-login");
  });
});
