import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/app-domain/mcp-connections.ts is what the Claude card on
// /app/integrations and /app/profile reads, and its whole value is that
// "מחובר" on screen means "a token from this grant would still be
// accepted by lib/mcp/auth.ts". Every test here is one way that claim
// could quietly stop being true.
//
// The failure mode this guards against is specific and silent: a grant
// that is dead server-side but still rendered as live. Nobody notices,
// because the screen looks fine — right up until an admin revokes a
// departing employee's sessions, sees "מחובר" next to their name's
// connection count, and concludes access was not actually cut.
//
// Mocking `@/lib/prisma` covers every branch without Postgres and without
// the Prisma engine this sandbox cannot download — same approach, and
// same reason, as tests/unit/mcp/auth.test.ts.

const oAuthTokenFindMany = vi.fn();
const oAuthTokenFindFirst = vi.fn();
const oAuthTokenUpdateMany = vi.fn();
const mcpAccessTokenFindMany = vi.fn();
const mcpAccessTokenUpdateMany = vi.fn();
const userCount = vi.fn();
const auditCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    oAuthToken: {
      findMany: (...args: unknown[]) => oAuthTokenFindMany(...args),
      findFirst: (...args: unknown[]) => oAuthTokenFindFirst(...args),
      updateMany: (...args: unknown[]) => oAuthTokenUpdateMany(...args),
    },
    mcpAccessToken: {
      findMany: (...args: unknown[]) => mcpAccessTokenFindMany(...args),
      updateMany: (...args: unknown[]) => mcpAccessTokenUpdateMany(...args),
    },
    user: { count: (...args: unknown[]) => userCount(...args) },
    auditEvent: { create: (...args: unknown[]) => auditCreate(...args) },
  },
}));

const {
  getMyClaudeConnection,
  getClaudeOrgSummary,
  countClaudeGrantsForUser,
  revokeMyClaudeGrant,
  revokeClaudeGrantsForUser,
} = await import("@/lib/app-domain/mcp-connections");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function actor(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    name: "נועה",
    email: "demo.employee1@ankora.co.il",
    role: "ANKORA_EMPLOYEE",
    status: "ACTIVE",
    deletedAt: null,
    tokenVersion: 3,
    ...overrides,
  } as any;
}

/// A token row as the queries in the module select it, healthy by default.
function oauthRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "oa1",
    clientId: "client-a",
    userId: "u1",
    tokenVersion: 3,
    lastUsedAt: new Date(Date.now() - 2 * HOUR),
    refreshExpiresAt: new Date(Date.now() + 30 * DAY),
    accessExpiresAt: new Date(Date.now() + HOUR),
    client: { clientName: "Claude" },
    user: { id: "u1", status: "ACTIVE", deletedAt: null, tokenVersion: 3 },
    ...overrides,
  };
}

function patRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pat1",
    userId: "u1",
    tokenVersion: 3,
    label: "MacBook Air",
    lastUsedAt: null,
    expiresAt: new Date(Date.now() + 60 * DAY),
    user: { id: "u1", status: "ACTIVE", deletedAt: null, tokenVersion: 3 },
    ...overrides,
  };
}

beforeEach(() => {
  oAuthTokenFindMany.mockReset();
  oAuthTokenFindFirst.mockReset();
  oAuthTokenUpdateMany.mockReset();
  mcpAccessTokenFindMany.mockReset();
  mcpAccessTokenUpdateMany.mockReset();
  userCount.mockReset();
  auditCreate.mockReset();
  auditCreate.mockResolvedValue({});
});

describe("getMyClaudeConnection", () => {
  it("reports not connected when the user has no grants at all", async () => {
    oAuthTokenFindMany.mockResolvedValue([]);
    mcpAccessTokenFindMany.mockResolvedValue([]);

    const result = await getMyClaudeConnection(actor());

    expect(result.connected).toBe(false);
    expect(result.grants).toEqual([]);
    expect(result.lastUsedAt).toBeNull();
  });

  it("reports connected and names the OAuth client", async () => {
    oAuthTokenFindMany.mockResolvedValue([oauthRow()]);
    mcpAccessTokenFindMany.mockResolvedValue([]);

    const result = await getMyClaudeConnection(actor());

    expect(result.connected).toBe(true);
    expect(result.grants).toHaveLength(1);
    expect(result.grants[0].kind).toBe("OAUTH");
    expect(result.grants[0].label).toBe("Claude");
  });

  // The check that matters most: "logout all sessions" bumps
  // User.tokenVersion, which is exactly how lib/mcp/auth.ts kills the
  // grant. A card that ignored the counter would keep saying "מחובר"
  // about a connection that 401s on its next call.
  it("drops a grant whose tokenVersion the user has moved past", async () => {
    oAuthTokenFindMany.mockResolvedValue([
      oauthRow({ tokenVersion: 3, user: { id: "u1", status: "ACTIVE", deletedAt: null, tokenVersion: 4 } }),
    ]);
    mcpAccessTokenFindMany.mockResolvedValue([]);

    const result = await getMyClaudeConnection(actor({ tokenVersion: 4 }));

    expect(result.connected).toBe(false);
  });

  it("drops a grant belonging to a suspended user", async () => {
    oAuthTokenFindMany.mockResolvedValue([
      oauthRow({ user: { id: "u1", status: "SUSPENDED", deletedAt: null, tokenVersion: 3 } }),
    ]);
    mcpAccessTokenFindMany.mockResolvedValue([]);

    expect((await getMyClaudeConnection(actor())).connected).toBe(false);
  });

  it("drops a grant belonging to a soft-deleted user", async () => {
    oAuthTokenFindMany.mockResolvedValue([
      oauthRow({ user: { id: "u1", status: "ACTIVE", deletedAt: new Date(), tokenVersion: 3 } }),
    ]);
    mcpAccessTokenFindMany.mockResolvedValue([]);

    expect((await getMyClaudeConnection(actor())).connected).toBe(false);
  });

  // Two things the SQL itself must do, asserted on the query rather than
  // on a result: without `rotatedToId: null` one connector reads as a
  // growing pile of connections (refresh rotation writes a new row per
  // renewal), and without the refresh-horizon OR the badge would flip to
  // "לא מחובר" an hour after the last call.
  it("queries only current, unrevoked rows on the refresh horizon", async () => {
    oAuthTokenFindMany.mockResolvedValue([]);
    mcpAccessTokenFindMany.mockResolvedValue([]);

    await getMyClaudeConnection(actor());

    const where = oAuthTokenFindMany.mock.calls[0][0].where;
    expect(where.userId).toBe("u1");
    expect(where.revokedAt).toBeNull();
    expect(where.rotatedToId).toBeNull();
    expect(where.OR[0].refreshExpiresAt.gt).toBeInstanceOf(Date);
  });

  it("counts a legacy personal access token as a connection, labelled as the bridge", async () => {
    oAuthTokenFindMany.mockResolvedValue([]);
    mcpAccessTokenFindMany.mockResolvedValue([patRow()]);

    const result = await getMyClaudeConnection(actor());

    expect(result.connected).toBe(true);
    expect(result.grants[0].kind).toBe("PAT");
    expect(result.grants[0].label).toBe("MacBook Air");
  });

  it("reports the most recent use across several grants", async () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000);
    oAuthTokenFindMany.mockResolvedValue([
      oauthRow({ lastUsedAt: new Date(Date.now() - 3 * DAY) }),
      oauthRow({ lastUsedAt: recent, client: { clientName: "Claude Desktop" } }),
    ]);
    mcpAccessTokenFindMany.mockResolvedValue([]);

    const result = await getMyClaudeConnection(actor());

    expect(result.grants).toHaveLength(2);
    expect(result.lastUsedAt?.getTime()).toBe(recent.getTime());
  });

  it("never reads another user's grants", async () => {
    oAuthTokenFindMany.mockResolvedValue([]);
    mcpAccessTokenFindMany.mockResolvedValue([]);

    await getMyClaudeConnection(actor({ id: "someone-else" }));

    expect(oAuthTokenFindMany.mock.calls[0][0].where.userId).toBe("someone-else");
    expect(mcpAccessTokenFindMany.mock.calls[0][0].where.userId).toBe("someone-else");
  });
});

describe("getClaudeOrgSummary", () => {
  it("refuses any role without integration.manage, without querying", async () => {
    for (const role of ["ANKORA_ADMIN", "ANKORA_EMPLOYEE", "CLIENT_USER"]) {
      expect(await getClaudeOrgSummary(actor({ role }))).toBeNull();
    }
    expect(oAuthTokenFindMany).not.toHaveBeenCalled();
    expect(userCount).not.toHaveBeenCalled();
  });

  it("counts people, not grants - one person with three connections is one person", async () => {
    oAuthTokenFindMany.mockResolvedValue([
      oauthRow({ userId: "u1", user: { id: "u1", status: "ACTIVE", deletedAt: null, tokenVersion: 3 } }),
      oauthRow({ userId: "u1", user: { id: "u1", status: "ACTIVE", deletedAt: null, tokenVersion: 3 } }),
      oauthRow({ userId: "u2", user: { id: "u2", status: "ACTIVE", deletedAt: null, tokenVersion: 0 }, tokenVersion: 0 }),
    ]);
    mcpAccessTokenFindMany.mockResolvedValue([
      patRow({ userId: "u1", user: { id: "u1", status: "ACTIVE", deletedAt: null, tokenVersion: 3 } }),
    ]);
    userCount.mockResolvedValue(8);

    const result = await getClaudeOrgSummary(actor({ role: "SUPER_ADMIN" }));

    expect(result).toEqual({ connectedUsers: 2, eligibleUsers: 8 });
  });

  it("excludes CLIENT_USER from the denominator, since they have no MCP surface", async () => {
    oAuthTokenFindMany.mockResolvedValue([]);
    mcpAccessTokenFindMany.mockResolvedValue([]);
    userCount.mockResolvedValue(0);

    await getClaudeOrgSummary(actor({ role: "SUPER_ADMIN" }));

    const where = userCount.mock.calls[0][0].where;
    expect(where.role.in).not.toContain("CLIENT_USER");
    expect(where.status).toBe("ACTIVE");
    expect(where.deletedAt).toBeNull();
  });
});

// Revocation is the half of this module that writes, and the half where a
// mistake is a security bug rather than a display bug. Two properties
// carry the weight: a person can only ever revoke their own grant, and
// "disconnected" has to mean disconnected — including the access token
// that a rotated-away row might still be holding for another hour.
describe("revokeMyClaudeGrant", () => {
  it("rejects a malformed grant id without touching the database", async () => {
    for (const bad of ["", "oauth:", "nonsense", "pat", ":abc"]) {
      const result = await revokeMyClaudeGrant(actor(), bad);
      expect(result.ok).toBe(false);
    }
    expect(oAuthTokenUpdateMany).not.toHaveBeenCalled();
    expect(mcpAccessTokenUpdateMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  // The important one. Ownership lives in the WHERE clause, so a guessed
  // or replayed id belonging to somebody else matches nothing — there is
  // no window where the row is found first and the check comes second.
  it("scopes every write to the acting user", async () => {
    oAuthTokenFindFirst.mockResolvedValue({ clientId: "client-a" });
    oAuthTokenUpdateMany.mockResolvedValue({ count: 1 });

    await revokeMyClaudeGrant(actor({ id: "u1" }), "oauth:someone-elses-row");

    expect(oAuthTokenFindFirst.mock.calls[0][0].where.userId).toBe("u1");
    expect(oAuthTokenUpdateMany.mock.calls[0][0].where.userId).toBe("u1");
  });

  it("refuses an OAuth grant that is not the caller's, and writes nothing", async () => {
    oAuthTokenFindFirst.mockResolvedValue(null);

    const result = await revokeMyClaudeGrant(actor(), "oauth:oa1");

    expect(result.ok).toBe(false);
    expect(oAuthTokenUpdateMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  // Rotation writes a new row per renewal and revokes the one it
  // supersedes, but a row rotated away and not yet revoked would keep a
  // live access token for up to an hour past the click. Revoking by
  // client, not by row, is what closes that window.
  it("revokes every live row for the same OAuth client, not just the named row", async () => {
    oAuthTokenFindFirst.mockResolvedValue({ clientId: "client-a" });
    oAuthTokenUpdateMany.mockResolvedValue({ count: 3 });

    const result = await revokeMyClaudeGrant(actor(), "oauth:oa1");

    expect(result).toEqual({ ok: true, revoked: 3 });
    const where = oAuthTokenUpdateMany.mock.calls[0][0].where;
    expect(where.clientId).toBe("client-a");
    expect(where.revokedAt).toBeNull();
    expect(where.id).toBeUndefined();
    expect(oAuthTokenUpdateMany.mock.calls[0][0].data.revokedAt).toBeInstanceOf(Date);
  });

  it("revokes a personal access token by its own row", async () => {
    mcpAccessTokenUpdateMany.mockResolvedValue({ count: 1 });

    const result = await revokeMyClaudeGrant(actor(), "pat:pat1");

    expect(result).toEqual({ ok: true, revoked: 1 });
    const where = mcpAccessTokenUpdateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: "pat1", userId: "u1", revokedAt: null });
  });

  it("reports failure, and records nothing, when the grant was already revoked", async () => {
    mcpAccessTokenUpdateMany.mockResolvedValue({ count: 0 });

    const result = await revokeMyClaudeGrant(actor(), "pat:pat1");

    expect(result.ok).toBe(false);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("soft-revokes rather than deleting, and leaves an audit row", async () => {
    mcpAccessTokenUpdateMany.mockResolvedValue({ count: 1 });

    await revokeMyClaudeGrant(actor(), "pat:pat1");

    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit.action).toBe("mcp_grant.revoke");
    expect(audit.entityType).toBe("McpGrant");
    expect(audit.actorId).toBe("u1");
  });
});

describe("revokeClaudeGrantsForUser", () => {
  it("refuses a role without user.manage", async () => {
    for (const role of ["ANKORA_ADMIN", "ANKORA_EMPLOYEE", "CLIENT_USER"]) {
      await expect(revokeClaudeGrantsForUser(actor({ role }), "u2")).rejects.toThrow();
    }
    expect(oAuthTokenUpdateMany).not.toHaveBeenCalled();
    expect(mcpAccessTokenUpdateMany).not.toHaveBeenCalled();
  });

  it("revokes both credential kinds for the target user and reports the total", async () => {
    oAuthTokenUpdateMany.mockResolvedValue({ count: 2 });
    mcpAccessTokenUpdateMany.mockResolvedValue({ count: 1 });

    const result = await revokeClaudeGrantsForUser(actor({ role: "SUPER_ADMIN" }), "u2");

    expect(result).toEqual({ ok: true, revoked: 3 });
    expect(oAuthTokenUpdateMany.mock.calls[0][0].where).toMatchObject({ userId: "u2", revokedAt: null });
    expect(mcpAccessTokenUpdateMany.mock.calls[0][0].where).toMatchObject({ userId: "u2", revokedAt: null });
  });

  // "An admin cut this person's Claude access" is worth recording even
  // when there was nothing live to cut — otherwise the absence of a row
  // reads as nobody having tried.
  it("records the attempt even when nothing was live", async () => {
    oAuthTokenUpdateMany.mockResolvedValue({ count: 0 });
    mcpAccessTokenUpdateMany.mockResolvedValue({ count: 0 });

    const result = await revokeClaudeGrantsForUser(actor({ role: "SUPER_ADMIN" }), "u2");

    expect(result).toEqual({ ok: true, revoked: 0 });
    expect(auditCreate.mock.calls[0][0].data.action).toBe("mcp_grant.revoke_all");
  });

  // Distinct from "logout all sessions" on purpose: cutting the
  // integration should not also throw the person out of the app.
  it("does not bump tokenVersion", async () => {
    oAuthTokenUpdateMany.mockResolvedValue({ count: 1 });
    mcpAccessTokenUpdateMany.mockResolvedValue({ count: 0 });

    await revokeClaudeGrantsForUser(actor({ role: "SUPER_ADMIN" }), "u2");

    const written = JSON.stringify([oAuthTokenUpdateMany.mock.calls, mcpAccessTokenUpdateMany.mock.calls]);
    expect(written).not.toContain("tokenVersion");
  });
});

describe("countClaudeGrantsForUser", () => {
  it("refuses a role without user.manage", async () => {
    await expect(countClaudeGrantsForUser(actor({ role: "ANKORA_ADMIN" }), "u2")).rejects.toThrow();
  });

  it("counts live grants of both kinds, applying the same validity checks", async () => {
    oAuthTokenFindMany.mockResolvedValue([
      oauthRow({ userId: "u2", user: { id: "u2", status: "ACTIVE", deletedAt: null, tokenVersion: 3 } }),
      oauthRow({ userId: "u2", user: { id: "u2", status: "SUSPENDED", deletedAt: null, tokenVersion: 3 } }),
    ]);
    mcpAccessTokenFindMany.mockResolvedValue([
      patRow({ userId: "u2", user: { id: "u2", status: "ACTIVE", deletedAt: null, tokenVersion: 3 } }),
    ]);

    expect(await countClaudeGrantsForUser(actor({ role: "SUPER_ADMIN" }), "u2")).toBe(2);
  });
});
