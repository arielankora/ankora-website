import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 13 (MCP server, docs/adr/0005).
//
// lib/mcp/auth.ts is the one module in lib/mcp/ that touches the database,
// and it was the piece PR #50 originally shipped unverified. It turns out
// not to need a real one: its only runtime import from the app is
// `prisma` itself (`@prisma/client` and `@modelcontextprotocol/server` are
// both `import type`, erased at compile time, and `server-only` is already
// aliased in vitest.config.ts). Mocking `@/lib/prisma` therefore covers
// every branch here without Postgres and without the Prisma engine that
// this sandbox cannot download - the same limitation documented in
// tests/unit/reports.test.ts.
//
// What these tests are for: resolveMcpActor() runs the same four checks as
// lib/app-auth/session.ts's getCurrentUser(), and each of them is a
// security control whose absence would be invisible in manual testing. A
// token that still worked after "logout all sessions", or one belonging to
// a suspended user, looks exactly like a working token until it matters.

const findUnique = vi.fn();
const update = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mcpAccessToken: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      update: (...args: unknown[]) => update(...args),
    },
  },
}));

const { resolveMcpActor, verifyMcpBearerToken, actorFromAuthInfo, McpUnauthorizedError } = await import(
  "@/lib/mcp/auth"
);
const { generateMcpToken, hashMcpToken } = await import("@/lib/mcp/token");

const HOUR = 60 * 60 * 1000;

function activeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    name: "נועה",
    email: "demo.employee1@ankora.co.il",
    role: "ANKORA_EMPLOYEE",
    status: "ACTIVE",
    timezone: "Asia/Jerusalem",
    tokenVersion: 3,
    deletedAt: null,
    ...overrides,
  };
}

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    userId: "u1",
    label: "MacBook Air",
    tokenHash: "irrelevant-the-lookup-is-mocked",
    tokenVersion: 3,
    lastUsedAt: new Date(Date.now() - 1000),
    expiresAt: new Date(Date.now() + 30 * 24 * HOUR),
    revokedAt: null,
    user: activeUser(),
    ...overrides,
  };
}

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset();
  update.mockResolvedValue({});
});

describe("resolveMcpActor() - rejections", () => {
  it("rejects a malformed token without touching the database", async () => {
    // The point of the shape check: a scanner spraying bearer values must
    // not reach Postgres at all.
    for (const junk of ["", "not-a-token", "Bearer x", "ank_mcp_short"]) {
      expect(await resolveMcpActor(junk)).toBeNull();
    }
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("looks the token up by its hash, never by the raw value", async () => {
    const raw = generateMcpToken();
    findUnique.mockResolvedValue(null);

    await resolveMcpActor(raw);

    const arg = findUnique.mock.calls[0][0] as { where: { tokenHash: string } };
    expect(arg.where.tokenHash).toBe(hashMcpToken(raw));
    expect(JSON.stringify(arg)).not.toContain(raw);
  });

  it("rejects a token with no matching row", async () => {
    findUnique.mockResolvedValue(null);
    expect(await resolveMcpActor(generateMcpToken())).toBeNull();
  });

  it("rejects a revoked token", async () => {
    findUnique.mockResolvedValue(tokenRow({ revokedAt: new Date(Date.now() - HOUR) }));
    expect(await resolveMcpActor(generateMcpToken())).toBeNull();
  });

  it("rejects an expired token, including one expiring exactly now", async () => {
    findUnique.mockResolvedValue(tokenRow({ expiresAt: new Date(Date.now() - 1) }));
    expect(await resolveMcpActor(generateMcpToken())).toBeNull();

    findUnique.mockResolvedValue(tokenRow({ expiresAt: new Date(Date.now()) }));
    expect(await resolveMcpActor(generateMcpToken())).toBeNull();
  });

  it("rejects a token whose user was soft-deleted", async () => {
    findUnique.mockResolvedValue(tokenRow({ user: activeUser({ deletedAt: new Date() }) }));
    expect(await resolveMcpActor(generateMcpToken())).toBeNull();
  });

  it("rejects a token whose user is no longer ACTIVE", async () => {
    for (const status of ["SUSPENDED", "INVITED", "DISABLED"]) {
      findUnique.mockResolvedValue(tokenRow({ user: activeUser({ status }) }));
      expect(await resolveMcpActor(generateMcpToken())).toBeNull();
    }
  });

  it("rejects a token issued before a 'logout all sessions'", async () => {
    // The control that is easiest to omit and most expensive to miss: an
    // admin revoking a departing employee's sessions bumps
    // User.tokenVersion. If this check were absent, the browser would lock
    // them out while Claude Desktop kept reading client data.
    findUnique.mockResolvedValue(
      tokenRow({ tokenVersion: 3, user: activeUser({ tokenVersion: 4 }) })
    );
    expect(await resolveMcpActor(generateMcpToken())).toBeNull();
  });

  it("does not update lastUsedAt for a token it rejected", async () => {
    findUnique.mockResolvedValue(tokenRow({ revokedAt: new Date() }));
    await resolveMcpActor(generateMcpToken());
    expect(update).not.toHaveBeenCalled();
  });
});

describe("resolveMcpActor() - acceptance", () => {
  it("returns the user when every check passes", async () => {
    findUnique.mockResolvedValue(tokenRow());
    const user = await resolveMcpActor(generateMcpToken());
    expect(user).not.toBeNull();
    expect(user?.id).toBe("u1");
    expect(user?.role).toBe("ANKORA_EMPLOYEE");
  });

  it("accepts a token whose version matches the user's current one", async () => {
    findUnique.mockResolvedValue(tokenRow({ tokenVersion: 7, user: activeUser({ tokenVersion: 7 }) }));
    expect(await resolveMcpActor(generateMcpToken())).not.toBeNull();
  });
});

describe("resolveMcpActor() - lastUsedAt bookkeeping", () => {
  it("skips the write when the timestamp is recent", async () => {
    findUnique.mockResolvedValue(tokenRow({ lastUsedAt: new Date(Date.now() - 60_000) }));
    await resolveMcpActor(generateMcpToken());
    expect(update).not.toHaveBeenCalled();
  });

  it("writes when the timestamp is stale", async () => {
    findUnique.mockResolvedValue(tokenRow({ lastUsedAt: new Date(Date.now() - 20 * 60_000) }));
    await resolveMcpActor(generateMcpToken());
    expect(update).toHaveBeenCalledTimes(1);
    expect((update.mock.calls[0][0] as { where: { id: string } }).where.id).toBe("t1");
  });

  it("writes on first use, when there is no timestamp yet", async () => {
    findUnique.mockResolvedValue(tokenRow({ lastUsedAt: null }));
    await resolveMcpActor(generateMcpToken());
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("still authenticates when the bookkeeping write fails", async () => {
    // A column nobody reads in real time must never fail a user's tool call.
    findUnique.mockResolvedValue(tokenRow({ lastUsedAt: null }));
    update.mockRejectedValue(new Error("connection reset"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const user = await resolveMcpActor(generateMcpToken());

    expect(user?.id).toBe("u1");
    consoleError.mockRestore();
  });
});

describe("verifyMcpBearerToken()", () => {
  function request(authorization?: string): Request {
    return new Request("https://example.org/api/mcp", {
      headers: authorization ? { authorization } : {},
    });
  }

  it("returns undefined when there is no credential at all", async () => {
    expect(await verifyMcpBearerToken(request(), undefined)).toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("falls back to the Authorization header when the SDK passes no token", async () => {
    const raw = generateMcpToken();
    findUnique.mockResolvedValue(tokenRow());

    const info = await verifyMcpBearerToken(request(`Bearer ${raw}`), undefined);

    expect(info).toBeDefined();
    expect(findUnique.mock.calls[0][0].where.tokenHash).toBe(hashMcpToken(raw));
  });

  it("attaches the resolved user for the tools to read", async () => {
    findUnique.mockResolvedValue(tokenRow());
    const info = await verifyMcpBearerToken(request(), generateMcpToken());
    expect((info?.extra?.user as { id: string }).id).toBe("u1");
  });

  it("returns undefined - not a partial AuthInfo - for a rejected token", async () => {
    // withMcpAuth turns undefined into the RFC 9728 401 challenge. Anything
    // truthy here would let the request through with no actor attached.
    findUnique.mockResolvedValue(tokenRow({ revokedAt: new Date() }));
    expect(await verifyMcpBearerToken(request(), generateMcpToken())).toBeUndefined();
  });

  it("answers identically for an unknown token and a revoked one", async () => {
    // Someone holding a stale token must not learn WHY it stopped working.
    findUnique.mockResolvedValue(null);
    const unknown = await verifyMcpBearerToken(request(), generateMcpToken());
    findUnique.mockResolvedValue(tokenRow({ revokedAt: new Date() }));
    const revoked = await verifyMcpBearerToken(request(), generateMcpToken());
    expect(unknown).toEqual(revoked);
  });
});

describe("actorFromAuthInfo()", () => {
  it("returns the user carried by a verified AuthInfo", async () => {
    findUnique.mockResolvedValue(tokenRow());
    const info = await verifyMcpBearerToken(
      new Request("https://example.org/api/mcp"),
      generateMcpToken()
    );
    expect(actorFromAuthInfo(info).id).toBe("u1");
  });

  it("throws rather than running a domain function with no actor", () => {
    // Reaching here with no user means the route was wired without
    // withMcpAuth. Failing loudly at the first tool call beats calling
    // lib/app-domain with undefined.
    expect(() => actorFromAuthInfo(undefined)).toThrow(McpUnauthorizedError);
    expect(() => actorFromAuthInfo({ token: "t", clientId: "c", scopes: [] })).toThrow(
      McpUnauthorizedError
    );
  });
});
