import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "./setup";
import { createTestClient, createTestClientUser, createTestUser } from "./factories";

// Route-level gates in front of three sensitive flows, against Postgres:
//
//  - requestLoginLink: an unauthenticated "email me a sign-in link" form.
//    It must not reveal which addresses are clients, must never email a
//    link to staff (a mailbox would become a key to every client's data)
//    or to a suspended/archived/deleted account, and is rate limited.
//  - openJsonRoute: the shared front door of the passkey JSON routes.
//  - /api/step-up and /api/credentials/[id]/reveal: the only path a
//    client's password leaves the server.
//
// tests/integration/credentials.test.ts and passkeys.test.ts already
// cover the domain rules (who may reveal, the five-minute window, the
// lockout, the audit rows). What is tested here is the HTTP layer they
// do not reach: the same-origin check, the session gate, the role check
// in the step-up route, and the status codes the browser acts on.

vi.mock("react", async (importOriginal) => {
  // session.ts uses React's cache(), which react@18 under vitest lacks.
  const real = await importOriginal<typeof import("react")>();
  return { ...real, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});

const session = vi.hoisted(() => ({ current: null as null | { user: Record<string, unknown> } }));
const signInMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: async () => session.current, signIn: signInMock }));
// The login-link action imports AuthError from next-auth, whose ESM build
// cannot be loaded outside Next's bundler. Only the class is needed.
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));

const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.current }));

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
import { sendEmail } from "@/lib/email";

const { requestLoginLink } = await import("@/lib/app-auth/login-link");
const { requestLoginLinkAction } = await import("@/app/(product)/app/login-link/actions");
const { openJsonRoute, json } = await import("@/lib/app-auth/json-route");
const stepUpRoute = await import("@/app/api/step-up/route");
const revealRoute = await import("@/app/api/credentials/[id]/reveal/route");
const { createCredential } = await import("@/lib/app-domain/credentials");

const ORIGIN = "https://www.ankora.co.il";
const SECRET = { username: "dana@example.com", password: "S3cret pass ", notes: "note" };

function signInAs(user: { id: string; tokenVersion: number }) {
  session.current = { user: { id: user.id, tokenVersion: user.tokenVersion } };
}

function jsonPost(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, host: "www.ankora.co.il", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ORIGINAL_ENV = { NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV };

beforeEach(() => {
  session.current = null;
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue({ ok: true, providerMessageId: "test" } as never);
  signInMock.mockReset();
  delete process.env.GCP_VAULT_KMS_KEY;
  delete process.env.VERCEL_ENV;
  delete process.env.VAULT_REQUIRE_PASSKEY;
  process.env.VAULT_KEK = process.env.VAULT_KEK ?? randomBytes(32).toString("base64");
});

afterEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  if (ORIGINAL_ENV.VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = ORIGINAL_ENV.VERCEL_ENV;
});

describe("requestLoginLink() - one answer for everyone, a link only for a live client user", () => {
  it("emails an ACTIVE client user a link, to their own address only", async () => {
    const client = await createTestClient();
    const { user } = await createTestClientUser({ clientId: client.id, email: "client@example.com" });

    const result = await requestLoginLink("  Client@Example.com ");
    expect(result.devToken).toBeTruthy();
    expect(sendEmail).toHaveBeenCalledOnce();
    const mail = vi.mocked(sendEmail).mock.calls[0][0] as { to: string[]; text: string };
    expect(mail.to).toEqual(["client@example.com"]);
    expect(mail.text).toContain(`/app/login-link?token=${result.devToken}`);
    expect(await prisma.portalLoginToken.count({ where: { userId: user.id } })).toBe(1);
  });

  it("also emails an INVITED client user (consuming the link is how they activate)", async () => {
    // By design (login-link.ts: "An INVITED client who signs in this way
    // becomes ACTIVE"). Pinned so a change to ACTIVE-only is deliberate.
    const client = await createTestClient();
    const { user } = await createTestClientUser({ clientId: client.id });
    await prisma.user.update({ where: { id: user.id }, data: { status: "INVITED" } });

    await requestLoginLink(user.email);
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it.each(["SUSPENDED", "ARCHIVED"] as const)("sends nothing and writes nothing for a %s client user", async (status) => {
    const client = await createTestClient();
    const { user } = await createTestClientUser({ clientId: client.id });
    await prisma.user.update({ where: { id: user.id }, data: { status } });

    expect(await requestLoginLink(user.email)).toEqual({});
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await prisma.portalLoginToken.count()).toBe(0);
  });

  it("sends nothing for a soft-deleted client user", async () => {
    const client = await createTestClient();
    const { user } = await createTestClientUser({ clientId: client.id });
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });

    expect(await requestLoginLink(user.email)).toEqual({});
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each(["SUPER_ADMIN", "ANKORA_ADMIN", "ANKORA_EMPLOYEE"] as const)(
    "never emails a sign-in link to staff (%s)",
    async (role) => {
      const { user } = await createTestUser({ role });
      expect(await requestLoginLink(user.email)).toEqual({});
      expect(sendEmail).not.toHaveBeenCalled();
      expect(await prisma.portalLoginToken.count()).toBe(0);
    },
  );

  it("answers an unknown address exactly like a known one in production", async () => {
    // Outside production a real match returns devToken so the flow can be
    // walked locally; in a production build devOnly() strips it, and the
    // two answers must be indistinguishable.
    (process.env as Record<string, string>).NODE_ENV = "production";
    const client = await createTestClient();
    const { user } = await createTestClientUser({ clientId: client.id });

    const known = await requestLoginLink(user.email);
    const unknown = await requestLoginLink("nobody@nowhere.example");
    expect(known).toEqual({});
    expect(unknown).toEqual(known);
    expect(sendEmail).toHaveBeenCalledOnce(); // only the real client got mail
  });

  it("returns quietly for an empty identifier", async () => {
    expect(await requestLoginLink("   ")).toEqual({});
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("requestLoginLinkAction() - rate limited per IP, with the same answer when throttled", () => {
  it("stops sending after 5 requests from one IP in 15 minutes, without saying so", async () => {
    const client = await createTestClient();
    const { user } = await createTestClientUser({ clientId: client.id });
    // A unique IP so the in-process bucket is this test's alone.
    requestHeaders.current = new Headers({ "x-real-ip": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

    const form = new FormData();
    form.set("identifier", user.email);
    const answers = [];
    for (let i = 0; i < 6; i++) answers.push(await requestLoginLinkAction(undefined, form));

    expect(sendEmail).toHaveBeenCalledTimes(5);
    expect(answers[5]).toEqual({ submitted: true });
    // A different IP is not affected by the first one's bucket.
    requestHeaders.current = new Headers({ "x-real-ip": "10.250.250.250" });
    await requestLoginLinkAction(undefined, form);
    expect(sendEmail).toHaveBeenCalledTimes(6);
  });
});

describe("openJsonRoute() - same-origin JSON, a live session, an object body", () => {
  it("refuses a cross-origin POST with 400 before looking at the session", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    signInAs(user);
    const opened = await openJsonRoute(jsonPost("/api/passkeys/register/options", {}, { origin: "https://evil.example" }));
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.response.status).toBe(400);
  });

  it("refuses a form-encoded POST (what a cross-site HTML form can send) with 400", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    signInAs(user);
    const opened = await openJsonRoute(jsonPost("/x", "a=1", { "content-type": "application/x-www-form-urlencoded" }));
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.response.status).toBe(400);
  });

  it("answers 401 with no session, and 401 for a suspended user's still-signed cookie", async () => {
    let opened = await openJsonRoute(jsonPost("/x", {}));
    expect(!opened.ok && opened.response.status).toBe(401);

    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "SUSPENDED" });
    signInAs(user);
    opened = await openJsonRoute(jsonPost("/x", {}));
    expect(!opened.ok && opened.response.status).toBe(401);
    if (!opened.ok) expect(opened.response.headers.get("cache-control")).toContain("no-store");
  });

  it.each([["malformed JSON", "{"], ["JSON null", "null"], ["a JSON string", '"hi"']])("answers 400 for %s", async (_l, body) => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    signInAs(user);
    const opened = await openJsonRoute(jsonPost("/x", body));
    expect(!opened.ok && opened.response.status).toBe(400);
  });

  it("hands back the fresh user and the parsed body", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    signInAs(user);
    const opened = await openJsonRoute(jsonPost("/x", { a: 1 }));
    expect(opened.ok && opened.user.id).toBe(user.id);
    expect(opened.ok && opened.body).toEqual({ a: 1 });
  });

  it("json() marks every answer no-store", () => {
    const res = json({ ok: true }, 200);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(res.headers.get("pragma")).toBe("no-cache");
  });
});

async function vaultSetup() {
  const clientA = await createTestClient({ name: "לקוח א" });
  const clientB = await createTestClient({ name: "לקוח ב" });
  const onA = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: onA.user.id, clientId: clientA.id } });
  const onB = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: onB.user.id, clientId: clientB.id } });
  const { id } = await createCredential(onA.user, { clientId: clientA.id, systemName: "בנק", url: "bank.example", ...SECRET });
  return { clientA, clientB, onA, onB, id };
}

function reveal(id: string, body: unknown = {}, headers: Record<string, string> = {}) {
  return revealRoute.POST(jsonPost(`/api/credentials/${id}/reveal`, body, headers), { params: Promise.resolve({ id }) });
}

function stepUp(password: unknown, headers: Record<string, string> = {}) {
  return stepUpRoute.POST(jsonPost("/api/step-up", { password }, headers));
}

describe("POST /api/step-up - verify it's you", () => {
  it("answers 401 without a session and opens no window", async () => {
    const res = await stepUp("anything");
    expect(res.status).toBe(401);
    expect(await prisma.stepUpGrant.count()).toBe(0);
  });

  it("refuses a cross-origin POST with 400, even with the right password", async () => {
    const { onA } = await vaultSetup();
    signInAs(onA.user);
    const res = await stepUp(onA.password, { origin: "https://evil.example" });
    expect(res.status).toBe(400);
    expect(await prisma.stepUpGrant.count()).toBe(0);
  });

  it("refuses a client user with 403 before checking the password", async () => {
    const client = await createTestClient();
    const { user, password } = await createTestClientUser({ clientId: client.id, role: "ADMIN" });
    signInAs(user);
    const res = await stepUp(password);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(await prisma.stepUpGrant.count()).toBe(0);
    // Not counted toward a lockout either: the password was never examined.
    expect(await prisma.auditEvent.count({ where: { action: "credential.stepup_failed" } })).toBe(0);
  });

  it("answers 401 wrong_password and opens no window", async () => {
    const { onA } = await vaultSetup();
    signInAs(onA.user);
    const res = await stepUp("not-my-password");
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("wrong_password");
    expect(await prisma.stepUpGrant.count()).toBe(0);
  });

  it("answers 400 for a non-string or oversized password", async () => {
    const { onA } = await vaultSetup();
    signInAs(onA.user);
    expect((await stepUp(12345)).status).toBe(400);
    expect((await stepUp("x".repeat(1025))).status).toBe(400);
  });

  it("opens a window bound to the caller and returns only its expiry", async () => {
    const { onA } = await vaultSetup();
    signInAs(onA.user);
    const res = await stepUp(onA.password);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "ok"]);
    const grant = await prisma.stepUpGrant.findFirstOrThrow();
    expect(grant.userId).toBe(onA.user.id);
  });

  it("answers 403 passkey_required on the production deployment, where the password is not accepted", async () => {
    const { onA } = await vaultSetup();
    signInAs(onA.user);
    process.env.VERCEL_ENV = "production";
    const res = await stepUp(onA.password);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("passkey_required");
    expect(await prisma.stepUpGrant.count()).toBe(0);
  });
});

describe("POST /api/credentials/[id]/reveal - session, step-up and client access, in that order", () => {
  it("answers 401 without a session, and the secret never appears", async () => {
    const { id } = await vaultSetup();
    const res = await reveal(id);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("S3cret");
  });

  it("refuses a cross-origin POST with 400 even inside an open step-up window", async () => {
    const { onA, id } = await vaultSetup();
    signInAs(onA.user);
    expect((await stepUp(onA.password)).status).toBe(200);
    const res = await reveal(id, {}, { origin: "https://evil.example" });
    expect(res.status).toBe(400);
    expect(await prisma.auditEvent.count({ where: { action: "credential.reveal" } })).toBe(0);
  });

  it("answers 403 step_up_required with the methods on offer, before any step-up", async () => {
    const { onA, id } = await vaultSetup();
    signInAs(onA.user);
    const res = await reveal(id);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "step_up_required", methods: { passkey: false, password: true } });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("reveals after a step-up through the route, with no-store", async () => {
    const { onA, id } = await vaultSetup();
    signInAs(onA.user);
    expect((await stepUp(onA.password)).status).toBe(200);
    const res = await reveal(id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(await res.json()).toEqual(SECRET);
  });

  it("answers 404 to an employee of another client, even after their own step-up", async () => {
    const { onB, id } = await vaultSetup();
    signInAs(onB.user);
    expect((await stepUp(onB.password)).status).toBe(200);
    const res = await reveal(id);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("S3cret");
  });

  it("answers 404 to the client's own portal user", async () => {
    const { clientA, id } = await vaultSetup();
    const { user } = await createTestClientUser({ clientId: clientA.id, role: "ADMIN" });
    signInAs(user);
    const res = await reveal(id);
    expect(res.status).toBe(404);
  });

  it("after 'logout all sessions': the old cookie gets 401, and a fresh sign-in needs a fresh step-up", async () => {
    const { onA, id } = await vaultSetup();
    signInAs(onA.user);
    expect((await stepUp(onA.password)).status).toBe(200);

    await prisma.user.update({ where: { id: onA.user.id }, data: { tokenVersion: { increment: 1 } } });
    expect((await reveal(id)).status).toBe(401);

    // Signing in again yields a JWT with the new version. The window
    // opened under the old one must not carry over to it.
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: onA.user.id } });
    signInAs(fresh);
    const res = await reveal(id);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("step_up_required");
  });

  it("ignores an over-long or non-string taskId rather than failing the reveal", async () => {
    const { onA, id } = await vaultSetup();
    signInAs(onA.user);
    await stepUp(onA.password);
    expect((await reveal(id, { taskId: "x".repeat(200) })).status).toBe(200);
    expect((await reveal(id, { taskId: 42 })).status).toBe(200);
  });
});
