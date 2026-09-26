import { beforeEach, describe, expect, it, vi } from "vitest";

// Refresh-token rotation under concurrency (lib/mcp/oauth/store.ts).
//
// Claude uses one stored grant from several places at once. When two of
// them refresh at the same moment, the rotation must not (a) kill the
// access token the other one is still using, or (b) read the other one's
// refresh as a breach and revoke the whole grant. Both used to happen and
// left the connector stuck on "needs authorization". Reuse well after the
// rotation must still revoke the grant.
//
// Prisma is mocked, the same approach as tests/unit/mcp/auth.test.ts.

const findUnique = vi.fn();
const updateMany = vi.fn();
const update = vi.fn();
const create = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    oAuthToken: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
      update: (...args: unknown[]) => update(...args),
      create: (...args: unknown[]) => create(...args),
    },
    oAuthClient: {
      update: () => Promise.resolve({}),
    },
  },
}));

const { rotateRefreshToken, resolveOAuthAccessToken, ROTATION_GRACE_SECONDS } = await import(
  "@/lib/mcp/oauth/store"
);
const { newRefreshToken } = await import("@/lib/mcp/oauth/pkce");

const HOUR = 60 * 60 * 1000;

function activeUser() {
  return { id: "u1", status: "ACTIVE", tokenVersion: 2, deletedAt: null };
}

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    clientId: "c1",
    userId: "u1",
    scope: "mcp",
    resource: null,
    tokenVersion: 2,
    accessExpiresAt: new Date(Date.now() + HOUR),
    refreshExpiresAt: new Date(Date.now() + 30 * 24 * HOUR),
    revokedAt: null,
    rotatedToId: null,
    lastUsedAt: null,
    user: activeUser(),
    ...overrides,
  };
}

beforeEach(() => {
  findUnique.mockReset();
  updateMany.mockReset();
  update.mockReset().mockResolvedValue({});
  create.mockReset().mockResolvedValue({});
});

describe("rotateRefreshToken", () => {
  it("rotates without revoking the old row, and caps the old access token to the grace window", async () => {
    findUnique.mockResolvedValueOnce(tokenRow()).mockResolvedValueOnce({ id: "t2" });
    updateMany.mockResolvedValue({ count: 1 });

    const out = await rotateRefreshToken(newRefreshToken(), "c1");

    expect(out.ok).toBe(true);
    const claim = updateMany.mock.calls[0][0];
    expect(claim.data.revokedAt).toBeUndefined();
    expect(claim.data.refreshExpiresAt).toBeInstanceOf(Date);
    const cap = (claim.data.accessExpiresAt as Date).getTime() - Date.now();
    expect(cap).toBeLessThanOrEqual(ROTATION_GRACE_SECONDS * 1000 + 50);
    expect(update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { rotatedToId: "t2" } });
  });

  it("treats a replay inside the grace window as a race, not a breach", async () => {
    findUnique.mockResolvedValueOnce(
      tokenRow({ rotatedToId: "t2", refreshExpiresAt: new Date(Date.now() - 5_000) })
    );

    const out = await rotateRefreshToken(newRefreshToken(), "c1");

    expect(out.ok).toBe(true);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("still revokes the whole grant on a replay after the grace window", async () => {
    findUnique.mockResolvedValueOnce(
      tokenRow({ rotatedToId: "t2", refreshExpiresAt: new Date(Date.now() - (ROTATION_GRACE_SECONDS + 5) * 1000) })
    );
    updateMany.mockResolvedValue({ count: 3 });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await rotateRefreshToken(newRefreshToken(), "c1");

    expect(out.ok).toBe(false);
    expect(updateMany.mock.calls[0][0].data.revokedAt).toBeInstanceOf(Date);
    err.mockRestore();
  });

  it("lets the loser of a simultaneous claim succeed", async () => {
    findUnique.mockResolvedValueOnce(tokenRow());
    updateMany.mockResolvedValue({ count: 0 });

    const out = await rotateRefreshToken(newRefreshToken(), "c1");

    expect(out.ok).toBe(true);
  });

  it("refuses a revoked grant", async () => {
    findUnique.mockResolvedValueOnce(tokenRow({ revokedAt: new Date() }));

    const out = await rotateRefreshToken(newRefreshToken(), "c1");

    expect(out.ok).toBe(false);
  });

  it("refuses when the user's tokenVersion moved on", async () => {
    findUnique.mockResolvedValueOnce(tokenRow({ user: { ...activeUser(), tokenVersion: 3 } }));

    const out = await rotateRefreshToken(newRefreshToken(), "c1");

    expect(out.ok).toBe(false);
  });
});

describe("resolveOAuthAccessToken after rotation", () => {
  it("keeps the previous access token valid inside the grace window", async () => {
    findUnique.mockResolvedValueOnce(
      tokenRow({ rotatedToId: "t2", accessExpiresAt: new Date(Date.now() + 30_000) })
    );
    const user = await resolveOAuthAccessToken("ank_oat_" + "a".repeat(43));
    expect(user?.id).toBe("u1");
  });

  it("rejects it once the grace window has passed", async () => {
    findUnique.mockResolvedValueOnce(
      tokenRow({ rotatedToId: "t2", accessExpiresAt: new Date(Date.now() - 1_000) })
    );
    const user = await resolveOAuthAccessToken("ank_oat_" + "a".repeat(43));
    expect(user).toBeNull();
  });
});
