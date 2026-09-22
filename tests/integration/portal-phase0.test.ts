import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { prisma } from "./setup";
import { createTestUser, createTestClient, createTestClientUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";

// Portal phase 0. Three things this phase adds that are only provable end
// to end: which client a portal user resolves to when they have several,
// that an Ankora manager's preview is read-only, and that a one-time
// sign-in link is genuinely one-time.
//
// The cookie that carries the selection is read through next/headers, so
// every test that needs one mocks that module. The mock is per-file and
// the domain code falls back to "no selection" when the module throws,
// which is exactly what it does in production outside a request.

let cookieJar: Record<string, string> = {};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar[name] ? { name, value: cookieJar[name] } : undefined),
  }),
}));

// Imported after the mock is registered so the module under test picks it up.
const {
  resolvePortalClient,
  updatePortalScheduleRecipients,
  PORTAL_CLIENT_COOKIE,
  PORTAL_PREVIEW_COOKIE,
} = await import("@/lib/app-domain/client-portal");
const { consumeLoginLink } = await import("@/lib/app-auth/login-link");

beforeEach(() => {
  cookieJar = {};
});
afterEach(() => {
  cookieJar = {};
});

function hashToken(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function issueLoginToken(userId: string, overrides: { expiresAt?: Date; usedAt?: Date } = {}) {
  const raw = crypto.randomBytes(32).toString("base64url");
  await prisma.portalLoginToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000),
      usedAt: overrides.usedAt ?? null,
    },
  });
  return raw;
}

describe("resolvePortalClient() - more than one membership", () => {
  it("defaults to the oldest membership when no client is selected", async () => {
    const first = await createTestClient({ name: "Client Alpha" });
    const second = await createTestClient({ name: "Client Beta" });
    const { user } = await createTestClientUser({ clientId: first.id });
    await prisma.clientUser.create({ data: { clientId: second.id, userId: user.id, role: "VIEWER" } });

    const ctx = await resolvePortalClient(user);

    expect(ctx.client.id).toBe(first.id);
    expect(ctx.isStaffPreview).toBe(false);
    expect(ctx.memberships.map((m) => m.clientId).sort()).toEqual([first.id, second.id].sort());
  });

  it("honours the selected client when the user belongs to it", async () => {
    const first = await createTestClient({ name: "Client Alpha" });
    const second = await createTestClient({ name: "Client Beta" });
    const { user } = await createTestClientUser({ clientId: first.id });
    await prisma.clientUser.create({ data: { clientId: second.id, userId: user.id, role: "ADMIN" } });

    cookieJar[PORTAL_CLIENT_COOKIE] = second.id;
    const ctx = await resolvePortalClient(user);

    expect(ctx.client.id).toBe(second.id);
    expect(ctx.clientUserRole).toBe("ADMIN");
  });

  // The cookie is a request, not an authorisation. A hand-edited value
  // naming a client the user has no membership in must fall back to their
  // own list rather than resolve - this is spec 21.2's rule restated for
  // the one new way a client id can now enter the resolution.
  it("ignores a selected client the user does not belong to", async () => {
    const mine = await createTestClient({ name: "Client Mine" });
    const someoneElses = await createTestClient({ name: "Client Theirs" });
    const { user } = await createTestClientUser({ clientId: mine.id });

    cookieJar[PORTAL_CLIENT_COOKIE] = someoneElses.id;
    const ctx = await resolvePortalClient(user);

    expect(ctx.client.id).toBe(mine.id);
  });

  it("skips an archived (soft-deleted) client and resolves a live one", async () => {
    const archived = await createTestClient({ name: "Client Gone" });
    const live = await createTestClient({ name: "Client Live" });
    const { user } = await createTestClientUser({ clientId: archived.id });
    await prisma.clientUser.create({ data: { clientId: live.id, userId: user.id, role: "VIEWER" } });
    await prisma.client.update({ where: { id: archived.id }, data: { deletedAt: new Date() } });

    const ctx = await resolvePortalClient(user);

    expect(ctx.client.id).toBe(live.id);
    expect(ctx.memberships).toHaveLength(1);
  });
});

describe("resolvePortalClient() - staff preview", () => {
  it("resolves the previewed client for an admin and marks it read-only", async () => {
    const client = await createTestClient({ name: "Client Preview" });
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });

    cookieJar[PORTAL_PREVIEW_COOKIE] = client.id;
    const ctx = await resolvePortalClient(admin);

    expect(ctx.client.id).toBe(client.id);
    expect(ctx.isStaffPreview).toBe(true);
    expect(ctx.clientUserId).toBeNull();
    expect(ctx.clientUserRole).toBe("VIEWER");
  });

  it("refuses the preview to a role without report.internal.view", async () => {
    const client = await createTestClient({ name: "Client Preview" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    cookieJar[PORTAL_PREVIEW_COOKIE] = client.id;

    await expect(resolvePortalClient(employee)).rejects.toBeInstanceOf(ForbiddenError);
  });

  // The preview exists so a manager can see what a client sees. If it
  // could also WRITE, the audit trail would show a client action no
  // client took - so every portal write refuses in preview, before the
  // role check that would happen to refuse it today anyway.
  it("refuses a portal write while previewing", async () => {
    const client = await createTestClient({ name: "Client Preview" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const schedule = await prisma.reportSchedule.create({
      data: {
        clientId: client.id,
        reportType: "MONTHLY_DETAILED",
        frequency: "MONTHLY",
        recipients: ["before@example.com"],
        enabled: true,
      },
    });

    cookieJar[PORTAL_PREVIEW_COOKIE] = client.id;

    await expect(
      updatePortalScheduleRecipients(admin, schedule.id, ["after@example.com"])
    ).rejects.toBeInstanceOf(ForbiddenError);

    const unchanged = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(unchanged.recipients).toEqual(["before@example.com"]);
  });
});

describe("consumeLoginLink()", () => {
  it("signs a client user in and burns the token", async () => {
    const client = await createTestClient({ name: "Client Link" });
    const { user } = await createTestClientUser({ clientId: client.id });
    const raw = await issueLoginToken(user.id);

    const authed = await consumeLoginLink(raw);
    expect(authed?.id).toBe(user.id);

    const second = await consumeLoginLink(raw);
    expect(second).toBeNull();
  });

  it("activates an invited client on first use", async () => {
    const client = await createTestClient({ name: "Client Invited" });
    const { user } = await createTestClientUser({ clientId: client.id });
    await prisma.user.update({ where: { id: user.id }, data: { status: "INVITED" } });
    const raw = await issueLoginToken(user.id);

    expect(await consumeLoginLink(raw)).not.toBeNull();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.lastLoginAt).not.toBeNull();
  });

  it("rejects an expired token", async () => {
    const client = await createTestClient({ name: "Client Expired" });
    const { user } = await createTestClientUser({ clientId: client.id });
    const raw = await issueLoginToken(user.id, { expiresAt: new Date(Date.now() - 1000) });

    expect(await consumeLoginLink(raw)).toBeNull();
  });

  // The link is issued only to a CLIENT_USER, but the account can change
  // in the fifteen minutes it stays alive - and a token row could also be
  // created by a future caller that forgets the rule. Both are re-checked
  // at consume time rather than trusted from issue time.
  it("rejects a token whose account is no longer a client user", async () => {
    const client = await createTestClient({ name: "Client Promoted" });
    const { user } = await createTestClientUser({ clientId: client.id });
    const raw = await issueLoginToken(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { role: "ANKORA_ADMIN" } });

    expect(await consumeLoginLink(raw)).toBeNull();
  });

  it("rejects a token for a suspended account", async () => {
    const client = await createTestClient({ name: "Client Suspended" });
    const { user } = await createTestClientUser({ clientId: client.id });
    const raw = await issueLoginToken(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });

    expect(await consumeLoginLink(raw)).toBeNull();
  });
});
