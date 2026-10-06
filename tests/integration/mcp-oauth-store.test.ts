import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { prisma } from "./setup";
import { createTestUser } from "./factories";

// MCP OAuth authorization server (docs/adr/0005), end to end against
// Postgres: the store in lib/mcp/oauth/store.ts and the three routes a
// connection walks through - /authorize (validate, no DB write),
// /consent (a signed-in human approves, a code is minted) and /token
// (the code is exchanged for tokens).
//
// What is at stake: a token from this flow gives Claude standing read
// and write access to the signer's Ankora data. A stolen, replayed or
// redirected code must therefore never become a token, and a code must
// only ever carry the identity of the person who approved it.
//
// Scopes: there are no "portal" and "staff" scopes to keep apart.
// SUPPORTED_SCOPES is just ["mcp", "offline_access"]; what a token may
// do is decided per call from the user's own role (store.ts header).
// The scope tests below therefore check that nothing outside that list
// is ever granted, and that a token carries exactly the scope its code did.

// session.ts wraps getCurrentUser in React's cache(), which the react@18
// package resolved under vitest does not export. Passthrough stub.
vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return { ...real, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});

// The consent route identifies the approver through Auth.js. The session
// is set per test; getCurrentUser still re-checks the user in the DB.
const session = vi.hoisted(() => ({ current: null as null | { user: Record<string, unknown> } }));
vi.mock("@/auth", () => ({ auth: async () => session.current }));

const {
  normalizeScope,
  registerClient,
  getClient,
  createAuthorizationCode,
  consumeAuthorizationCode,
  resolveOAuthAccessToken,
  DEFAULT_SCOPE,
} = await import("@/lib/mcp/oauth/store");
const { deriveS256Challenge } = await import("@/lib/mcp/oauth/pkce");
const tokenRoute = await import("@/app/api/mcp/oauth/token/route");
const consentRoute = await import("@/app/api/mcp/oauth/consent/route");
const authorizeRoute = await import("@/app/api/mcp/oauth/authorize/route");

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

function newVerifier() {
  return crypto.randomBytes(48).toString("base64url"); // 64 chars, RFC 7636 alphabet
}

function signInAs(user: { id: string; tokenVersion: number }) {
  session.current = { user: { id: user.id, tokenVersion: user.tokenVersion } };
}

async function registered(redirectUris = [REDIRECT]) {
  const client = await registerClient({ clientName: "Claude", redirectUris });
  if ("error" in client) throw new Error(client.description);
  return client;
}

async function issueCode(opts: { clientId: string; userId: string; verifier: string; redirectUri?: string; scope?: string }) {
  return createAuthorizationCode({
    clientId: opts.clientId,
    userId: opts.userId,
    redirectUri: opts.redirectUri ?? REDIRECT,
    scope: opts.scope ?? DEFAULT_SCOPE,
    codeChallenge: deriveS256Challenge(opts.verifier),
    codeChallengeMethod: "S256",
    resource: "https://www.ankora.co.il/api/mcp",
  });
}

function tokenRequest(fields: Record<string, string>, ip = crypto.randomUUID()) {
  // A fresh x-forwarded-for per call keeps the route's per-IP rate limit
  // (120/min, in-process) from leaking between tests.
  return new Request("https://www.ankora.co.il/api/mcp/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
    body: new URLSearchParams(fields).toString(),
  });
}

function consentRequest(fields: Record<string, string>) {
  return new Request("https://www.ankora.co.il/api/mcp/oauth/consent", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

/// The consent route hands off with a meta-refresh page; the target URL
/// is in its Continue link.
async function handOffTarget(res: Response): Promise<URL> {
  const html = await res.text();
  const match = html.match(/<a href="([^"]+)">Continue<\/a>/);
  if (!match) throw new Error(`no hand-off link in: ${html.slice(0, 200)}`);
  return new URL(match[1].replace(/&amp;/g, "&"));
}

beforeEach(() => {
  session.current = null;
});

describe("normalizeScope() - only scopes this server knows are ever granted", () => {
  it("defaults to `mcp offline_access` when nothing is requested", () => {
    expect(normalizeScope(null)).toBe(DEFAULT_SCOPE);
    expect(normalizeScope(undefined)).toBe(DEFAULT_SCOPE);
    expect(normalizeScope("")).toBe(DEFAULT_SCOPE);
  });

  it("drops unknown scopes and keeps the known ones", () => {
    expect(normalizeScope("admin mcp staff:write")).toBe("mcp");
    expect(normalizeScope("offline_access portal")).toBe("offline_access");
  });

  it("falls back to plain `mcp` (no refresh) when every requested scope is unknown", () => {
    expect(normalizeScope("admin superuser")).toBe("mcp");
  });

  it("de-duplicates and tolerates extra whitespace", () => {
    expect(normalizeScope("mcp  mcp\toffline_access")).toBe("mcp offline_access");
  });

  it("is case-sensitive, so MCP is not mcp", () => {
    expect(normalizeScope("MCP")).toBe("mcp"); // unknown -> fallback, not a match
    expect(normalizeScope("OFFLINE_ACCESS")).toBe("mcp");
  });
});

describe("registerClient() / getClient() - registration is the redirect-URI gate", () => {
  it("registers a public client and finds it again by client_id", async () => {
    const client = await registered();
    expect(client.clientId).toMatch(/^ank_cli_/);
    expect(client.grantTypes).toEqual(["authorization_code", "refresh_token"]);
    expect(client.scopes).toEqual(["mcp", "offline_access"]);
    expect(await getClient(client.clientId)).toEqual(client);
  });

  it("refuses the whole registration if any one redirect URI is not acceptable", async () => {
    const before = await prisma.oAuthClient.count();
    const result = await registerClient({ redirectUris: [REDIRECT, "http://evil.example/cb"] });
    expect(result).toMatchObject({ error: "invalid_redirect_uri" });
    expect(await prisma.oAuthClient.count()).toBe(before);
  });

  it("keeps only known grant types and known scopes", async () => {
    const result = await registerClient({
      redirectUris: [REDIRECT],
      grantTypes: ["authorization_code", "client_credentials", "password"],
      scopes: "mcp admin",
    });
    if ("error" in result) throw new Error("unexpected");
    expect(result.grantTypes).toEqual(["authorization_code"]);
    expect(result.scopes).toEqual(["mcp"]);
  });

  it("returns null for an empty or unknown client_id", async () => {
    expect(await getClient("")).toBeNull();
    expect(await getClient("ank_cli_doesnotexist")).toBeNull();
  });
});

describe("createAuthorizationCode() / consumeAuthorizationCode() - a code works once, briefly", () => {
  it("stores only a hash, and consumes to the exact binding it was issued with", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const client = await registered();
    const verifier = newVerifier();
    const code = await issueCode({ clientId: client.clientId, userId: user.id, verifier });

    const rows = await prisma.oAuthAuthorizationCode.findMany();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(code);
    // Lifetime well under the RFC's ten-minute ceiling.
    expect(rows[0].expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000 + 1000);

    expect(await consumeAuthorizationCode(code)).toEqual({
      clientId: client.clientId,
      userId: user.id,
      redirectUri: REDIRECT,
      scope: DEFAULT_SCOPE,
      codeChallenge: deriveS256Challenge(verifier),
      codeChallengeMethod: "S256",
      resource: "https://www.ankora.co.il/api/mcp",
    });
  });

  it("is single use: the second consume returns null", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const client = await registered();
    const code = await issueCode({ clientId: client.clientId, userId: user.id, verifier: newVerifier() });

    expect(await consumeAuthorizationCode(code)).not.toBeNull();
    expect(await consumeAuthorizationCode(code)).toBeNull();
  });

  it("is single use under a race: two simultaneous consumes, exactly one wins", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const client = await registered();
    const code = await issueCode({ clientId: client.clientId, userId: user.id, verifier: newVerifier() });

    const results = await Promise.all([consumeAuthorizationCode(code), consumeAuthorizationCode(code)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("refuses an expired code", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const client = await registered();
    const code = await issueCode({ clientId: client.clientId, userId: user.id, verifier: newVerifier() });
    await prisma.oAuthAuthorizationCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect(await consumeAuthorizationCode(code)).toBeNull();
  });

  it("refuses malformed values and other credential kinds without a lookup", async () => {
    expect(await consumeAuthorizationCode("")).toBeNull();
    expect(await consumeAuthorizationCode("ank_oat_" + "a".repeat(43))).toBeNull();
    expect(await consumeAuthorizationCode("ank_cod_" + "a".repeat(43))).toBeNull(); // well-formed, unknown
  });
});

describe("POST /api/mcp/oauth/token (authorization_code) - a code becomes a token only for its own client, URI and verifier", () => {
  async function setup() {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const client = await registered();
    const verifier = newVerifier();
    const code = await issueCode({ clientId: client.clientId, userId: user.id, verifier });
    return { user, client, verifier, code };
  }

  it("exchanges a valid code for a token that resolves to the approving user", async () => {
    const { user, client, verifier, code } = await setup();
    const res = await tokenRoute.POST(
      tokenRequest({ grant_type: "authorization_code", client_id: client.clientId, code, redirect_uri: REDIRECT, code_verifier: verifier }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ token_type: "Bearer", scope: DEFAULT_SCOPE });
    expect((await resolveOAuthAccessToken(body.access_token))?.id).toBe(user.id);
  });

  it("refuses the same code a second time (replay)", async () => {
    const { client, verifier, code } = await setup();
    const fields = { grant_type: "authorization_code", client_id: client.clientId, code, redirect_uri: REDIRECT, code_verifier: verifier };
    expect((await tokenRoute.POST(tokenRequest(fields))).status).toBe(200);
    const replay = await tokenRoute.POST(tokenRequest(fields));
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toBe("invalid_grant");
    expect(await prisma.oAuthToken.count()).toBe(1);
  });

  it("refuses a code presented by a different registered client, and burns it", async () => {
    const { client, verifier, code } = await setup();
    const other = await registered();
    const res = await tokenRoute.POST(
      tokenRequest({ grant_type: "authorization_code", client_id: other.clientId, code, redirect_uri: REDIRECT, code_verifier: verifier }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
    expect(await prisma.oAuthToken.count()).toBe(0);

    // The rightful client cannot use it afterwards either: the first
    // attempt consumes the code whatever its outcome.
    const late = await tokenRoute.POST(
      tokenRequest({ grant_type: "authorization_code", client_id: client.clientId, code, redirect_uri: REDIRECT, code_verifier: verifier }),
    );
    expect(late.status).toBe(400);
  });

  it("refuses a redirect_uri other than the one the code was issued for", async () => {
    const { user, verifier } = await setup();
    const client = await registered([REDIRECT, "https://claude.com/api/mcp/auth_callback"]);
    const code = await issueCode({ clientId: client.clientId, userId: user.id, verifier });
    const res = await tokenRoute.POST(
      tokenRequest({
        grant_type: "authorization_code",
        client_id: client.clientId,
        code,
        redirect_uri: "https://claude.com/api/mcp/auth_callback",
        code_verifier: verifier,
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_description).toMatch(/redirect_uri/);
    expect(await prisma.oAuthToken.count()).toBe(0);
  });

  it("refuses a wrong PKCE verifier (a stolen code without the verifier is useless)", async () => {
    const { client, code } = await setup();
    const res = await tokenRoute.POST(
      tokenRequest({ grant_type: "authorization_code", client_id: client.clientId, code, redirect_uri: REDIRECT, code_verifier: newVerifier() }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_description).toMatch(/PKCE/);
    expect(await prisma.oAuthToken.count()).toBe(0);
  });

  it("refuses an expired code", async () => {
    const { client, verifier, code } = await setup();
    await prisma.oAuthAuthorizationCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await tokenRoute.POST(
      tokenRequest({ grant_type: "authorization_code", client_id: client.clientId, code, redirect_uri: REDIRECT, code_verifier: verifier }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
  });

  it("refuses when the approving user was suspended between consent and exchange", async () => {
    const { user, client, verifier, code } = await setup();
    await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
    const res = await tokenRoute.POST(
      tokenRequest({ grant_type: "authorization_code", client_id: client.clientId, code, redirect_uri: REDIRECT, code_verifier: verifier }),
    );
    expect(res.status).toBe(400);
    expect(await prisma.oAuthToken.count()).toBe(0);
  });

  it("answers 401 invalid_client for an unknown client_id", async () => {
    const res = await tokenRoute.POST(
      tokenRequest({ grant_type: "authorization_code", client_id: "ank_cli_nope", code: "x", code_verifier: "y" }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalid_client");
  });

  it("carries the code's scope into the token, never more", async () => {
    const { user } = await setup();
    const client = await registered();
    const verifier = newVerifier();
    const code = await issueCode({ clientId: client.clientId, userId: user.id, verifier, scope: "mcp" });
    const res = await tokenRoute.POST(
      tokenRequest({
        grant_type: "authorization_code",
        client_id: client.clientId,
        code,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
        scope: "mcp offline_access admin", // ignored at the token endpoint
      }),
    );
    expect((await res.json()).scope).toBe("mcp");
  });
});

describe("POST /api/mcp/oauth/consent - only a signed-in human mints a code, and only for themself", () => {
  async function setup() {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const client = await registered();
    const verifier = newVerifier();
    const fields = {
      client_id: client.clientId,
      redirect_uri: REDIRECT,
      code_challenge: deriveS256Challenge(verifier),
      code_challenge_method: "S256",
      state: "xyz",
      scope: "mcp offline_access",
      decision: "approve",
    };
    return { user, client, verifier, fields };
  }

  it("answers 401 and mints nothing without a session", async () => {
    const { fields } = await setup();
    const res = await consentRoute.POST(consentRequest(fields));
    expect(res.status).toBe(401);
    expect(await prisma.oAuthAuthorizationCode.count()).toBe(0);
  });

  it("answers 401 and mints nothing after the approver's sessions were all disconnected", async () => {
    const { user, fields } = await setup();
    signInAs(user);
    await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
    const res = await consentRoute.POST(consentRequest(fields));
    expect(res.status).toBe(401);
    expect(await prisma.oAuthAuthorizationCode.count()).toBe(0);
  });

  it("binds the code to the signed-in user, ignoring any user_id smuggled in the form", async () => {
    const { user, client, verifier, fields } = await setup();
    const { user: victim } = await createTestUser({ role: "SUPER_ADMIN" });
    signInAs(user);

    const res = await consentRoute.POST(consentRequest({ ...fields, user_id: victim.id, userId: victim.id }));
    const target = await handOffTarget(res);
    expect(`${target.origin}${target.pathname}`).toBe(REDIRECT);
    expect(target.searchParams.get("state")).toBe("xyz");
    const code = target.searchParams.get("code")!;

    const exchanged = await tokenRoute.POST(
      tokenRequest({ grant_type: "authorization_code", client_id: client.clientId, code, redirect_uri: REDIRECT, code_verifier: verifier }),
    );
    const token = (await exchanged.json()).access_token;
    expect((await resolveOAuthAccessToken(token))?.id).toBe(user.id);
    expect(await prisma.auditEvent.count({ where: { action: "mcp.oauth.granted", actorId: user.id } })).toBe(1);
  });

  it("refuses an unregistered redirect_uri with a plain 400 and no redirect", async () => {
    const { user, fields } = await setup();
    signInAs(user);
    const res = await consentRoute.POST(consentRequest({ ...fields, redirect_uri: "https://evil.example/cb" }));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("evil.example");
    expect(await prisma.oAuthAuthorizationCode.count()).toBe(0);
  });

  it("reports a decline as access_denied and mints nothing", async () => {
    const { user, fields } = await setup();
    signInAs(user);
    const target = await handOffTarget(await consentRoute.POST(consentRequest({ ...fields, decision: "deny" })));
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect(target.searchParams.get("code")).toBeNull();
    expect(await prisma.oAuthAuthorizationCode.count()).toBe(0);
  });

  it("refuses the `plain` PKCE method, so PKCE cannot be downgraded at consent", async () => {
    const { user, fields } = await setup();
    signInAs(user);
    const target = await handOffTarget(
      await consentRoute.POST(consentRequest({ ...fields, code_challenge_method: "plain", code_challenge: "a".repeat(43) })),
    );
    expect(target.searchParams.get("error")).toBe("invalid_request");
    expect(await prisma.oAuthAuthorizationCode.count()).toBe(0);
  });

  it("stores only known scopes on the code, whatever the form asked for", async () => {
    const { user, fields } = await setup();
    signInAs(user);
    await consentRoute.POST(consentRequest({ ...fields, scope: "admin mcp" }));
    const row = await prisma.oAuthAuthorizationCode.findFirstOrThrow();
    expect(row.scope).toBe("mcp");
  });
});

describe("GET /api/mcp/oauth/authorize - never redirects to an unvalidated address", () => {
  function authorizeUrl(params: Record<string, string>) {
    return new Request(`https://www.ankora.co.il/api/mcp/oauth/authorize?${new URLSearchParams(params)}`);
  }

  it("shows an error page, not a redirect, for an unknown client", async () => {
    const res = await authorizeRoute.GET(
      authorizeUrl({ client_id: "ank_cli_nope", redirect_uri: "https://evil.example/cb", response_type: "code" }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("shows an error page, not a redirect, for a redirect_uri the client did not register", async () => {
    const client = await registered();
    const res = await authorizeRoute.GET(
      authorizeUrl({ client_id: client.clientId, redirect_uri: "https://evil.example/cb", response_type: "code" }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("sends a valid request to the consent screen and writes nothing to the database", async () => {
    const client = await registered();
    const res = await authorizeRoute.GET(
      authorizeUrl({
        client_id: client.clientId,
        redirect_uri: REDIRECT,
        response_type: "code",
        code_challenge: deriveS256Challenge(newVerifier()),
        code_challenge_method: "S256",
        scope: "mcp admin",
        state: "s1",
      }),
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/app/oauth/consent");
    expect(location.searchParams.get("scope")).toBe("mcp");
    expect(await prisma.oAuthAuthorizationCode.count()).toBe(0);
  });

  it("returns a missing PKCE challenge to the registered client as invalid_request", async () => {
    const client = await registered();
    const res = await authorizeRoute.GET(authorizeUrl({ client_id: client.clientId, redirect_uri: REDIRECT, response_type: "code" }));
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get("error")).toBe("invalid_request");
  });
});
