import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/app-auth/session.ts: the one gate every screen, server action and
// route handler goes through to answer "who is this, and are they still
// allowed in". The JWT alone is never trusted: a suspended, archived or
// deleted account, or one whose sessions were all disconnected
// (tokenVersion bumped), must stop working on the very next request,
// even though the browser still holds a validly signed cookie.
//
// Auth.js's auth() and Prisma are both mocked: what is under test is the
// decision this module makes from (session, DB row), not either library.
//
// React's cache(): the module wraps getCurrentUser in it so a layout and
// its page share one DB lookup per request. Next.js ships its own React
// build that has cache(); the react@18 package this repo resolves under
// vitest does NOT export it at all, so importing session.ts here would
// crash with "cache is not a function". The stub below is a passthrough,
// which is also what React does outside a server request scope - every
// call is a fresh lookup, so one test's user cannot leak into the next.

vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return { ...real, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const findUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => findUnique(...args) } },
}));

// next/navigation's real redirect() throws a special NEXT_REDIRECT error
// that only the Next.js runtime knows how to catch. Here it throws a
// recognisable error so the test can assert both that it was called and
// that nothing after it ran.
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));

const { getCurrentUser, requireUser, requireUserOrThrow, UnauthorizedError } = await import(
  "@/lib/app-auth/session"
);

function dbUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    name: "Dana",
    email: "dana@example.com",
    role: "ANKORA_EMPLOYEE",
    status: "ACTIVE",
    deletedAt: null,
    tokenVersion: 3,
    ...overrides,
  };
}

function sessionFor(user: Record<string, unknown>) {
  return { user, expires: new Date(Date.now() + 3600_000).toISOString() };
}

beforeEach(() => {
  authMock.mockReset();
  findUnique.mockReset();
  redirectMock.mockClear();
});

describe("getCurrentUser() - who is making this request", () => {
  it("returns null without touching the database when there is no session", async () => {
    authMock.mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns null for a session object with no user id", async () => {
    // Auth.js can hand back a session shell (e.g. a cookie from before the
    // session callback set `id`). No id means no identity.
    authMock.mockResolvedValue(sessionFor({ name: "Dana" }));
    expect(await getCurrentUser()).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("looks the user up by the JWT's id and returns the FRESH database row", async () => {
    // The session says EMPLOYEE, the database says ADMIN: a role change
    // must apply on the next request, not when the JWT happens to expire.
    authMock.mockResolvedValue(sessionFor({ id: "user-1", role: "ANKORA_EMPLOYEE", tokenVersion: 3 }));
    findUnique.mockResolvedValue(dbUser({ role: "ANKORA_ADMIN" }));

    const user = await getCurrentUser();
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "user-1" } });
    expect(user?.role).toBe("ANKORA_ADMIN");
  });

  it("returns null when the account no longer exists", async () => {
    authMock.mockResolvedValue(sessionFor({ id: "gone", tokenVersion: 0 }));
    findUnique.mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
  });

  it("returns null for a soft-deleted account, even if its status still says ACTIVE", async () => {
    authMock.mockResolvedValue(sessionFor({ id: "user-1", tokenVersion: 3 }));
    findUnique.mockResolvedValue(dbUser({ deletedAt: new Date("2026-10-01T00:00:00Z") }));
    expect(await getCurrentUser()).toBeNull();
  });

  it.each(["SUSPENDED", "INVITED", "ARCHIVED"])("returns null for a %s account", async (status) => {
    // INVITED included on purpose: an invited user has not finished
    // setting up, and a JWT for them (there should be none) must not open
    // the app. The login-link flow flips them to ACTIVE before a session
    // exists, so this never blocks a legitimate first sign-in.
    authMock.mockResolvedValue(sessionFor({ id: "user-1", tokenVersion: 3 }));
    findUnique.mockResolvedValue(dbUser({ status }));
    expect(await getCurrentUser()).toBeNull();
  });

  it("returns null once 'logout all sessions' bumped tokenVersion past the JWT's", async () => {
    authMock.mockResolvedValue(sessionFor({ id: "user-1", tokenVersion: 3 }));
    findUnique.mockResolvedValue(dbUser({ tokenVersion: 4 }));
    expect(await getCurrentUser()).toBeNull();
  });

  it("also refuses a JWT whose tokenVersion is AHEAD of the database (restored backup)", async () => {
    // backup-coverage.ts notes that restoring tokenVersion too low would
    // revive revoked sessions; the check is an inequality, not a "<", so
    // a version mismatch in either direction is refused.
    authMock.mockResolvedValue(sessionFor({ id: "user-1", tokenVersion: 5 }));
    findUnique.mockResolvedValue(dbUser({ tokenVersion: 4 }));
    expect(await getCurrentUser()).toBeNull();
  });

  it("accepts a session whose tokenVersion matches, including version 0", async () => {
    // 0 is falsy: a `if (sessionTokenVersion && ...)` refactor would skip
    // the check for every never-reset account. This pins the typeof check.
    authMock.mockResolvedValue(sessionFor({ id: "user-1", tokenVersion: 0 }));
    findUnique.mockResolvedValue(dbUser({ tokenVersion: 0 }));
    expect((await getCurrentUser())?.id).toBe("user-1");

    authMock.mockResolvedValue(sessionFor({ id: "user-1", tokenVersion: 0 }));
    findUnique.mockResolvedValue(dbUser({ tokenVersion: 1 }));
    expect(await getCurrentUser()).toBeNull();
  });

  // QUESTION (2026-10-07), asserted as current behaviour: a session with
  // NO numeric tokenVersion skips the revocation check entirely, so such a
  // JWT survives "logout all sessions". auth.ts's jwt() callback copies
  // tokenVersion from both sign-in providers (password and login link),
  // and both always return a number, so a fresh JWT always carries one.
  // Only a JWT minted before the claim existed (or by a future provider
  // that forgets it) lacks it. The safer rule is fail-closed (treat a
  // missing claim as a mismatch); flagged in the report rather than
  // marked as a bug because no current sign-in path produces such a JWT.
  it("CURRENTLY accepts a session with no tokenVersion claim, even after a logout-all", async () => {
    authMock.mockResolvedValue(sessionFor({ id: "user-1" }));
    findUnique.mockResolvedValue(dbUser({ tokenVersion: 7 }));
    expect((await getCurrentUser())?.id).toBe("user-1");

    // A non-number (e.g. a string from a hand-edited or foreign token) is
    // treated the same way.
    authMock.mockResolvedValue(sessionFor({ id: "user-1", tokenVersion: "3" }));
    findUnique.mockResolvedValue(dbUser({ tokenVersion: 7 }));
    expect((await getCurrentUser())?.id).toBe("user-1");
  });

  it("does not memoise across calls under vitest (cache() is per-request in Next only)", async () => {
    // Guards the test suite itself: if the cache stub memoised, every
    // later test would silently get the first test's user.
    authMock.mockResolvedValue(sessionFor({ id: "user-1", tokenVersion: 3 }));
    findUnique.mockResolvedValue(dbUser());
    await getCurrentUser();
    authMock.mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
    expect(authMock).toHaveBeenCalledTimes(2);
  });
});

describe("requireUser() - screens and layouts redirect to login", () => {
  it("redirects to /app/login when there is no valid session", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow("REDIRECT:/app/login");
    expect(redirectMock).toHaveBeenCalledWith("/app/login");
  });

  it("redirects a suspended user who still holds a signed cookie", async () => {
    authMock.mockResolvedValue(sessionFor({ id: "user-1", tokenVersion: 3 }));
    findUnique.mockResolvedValue(dbUser({ status: "SUSPENDED" }));
    await expect(requireUser()).rejects.toThrow("REDIRECT:/app/login");
  });

  it("returns the user, without redirecting, when the session is valid", async () => {
    authMock.mockResolvedValue(sessionFor({ id: "user-1", tokenVersion: 3 }));
    findUnique.mockResolvedValue(dbUser());
    expect((await requireUser()).id).toBe("user-1");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe("requireUserOrThrow() - routes and actions get an error, not a redirect", () => {
  it("throws UnauthorizedError when there is no session", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireUserOrThrow()).rejects.toBeInstanceOf(UnauthorizedError);
    // A JSON route must never answer with a redirect to an HTML login page.
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedError after a logout-all", async () => {
    authMock.mockResolvedValue(sessionFor({ id: "user-1", tokenVersion: 3 }));
    findUnique.mockResolvedValue(dbUser({ tokenVersion: 4 }));
    await expect(requireUserOrThrow()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("returns the user when the session is valid", async () => {
    authMock.mockResolvedValue(sessionFor({ id: "user-1", tokenVersion: 3 }));
    findUnique.mockResolvedValue(dbUser());
    expect((await requireUserOrThrow()).email).toBe("dana@example.com");
  });
});
