import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { consumePasswordResetToken } from "@/lib/app-auth/password-reset";
import type { User, UserRole } from "@prisma/client";

// User administration (lib/app-domain/users.ts). Everything here is
// "user.manage", which is SUPER_ADMIN only: the person who can change
// roles, kill sessions and grant client access is the person who could
// otherwise lock the company out of its own system or hand a stranger a
// client's data. So every write below is checked twice: that it does
// what the admin screen promises, and that the three other roles are
// refused AND leave the database exactly as it was.

// The invite is mailed (issueInvite -> sendEmail). Mocked so the tests can
// assert who receives which link, and so a failed send can be simulated.
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ ok: true })),
}));
import { sendEmail } from "@/lib/email";

const {
  inviteUser,
  resendInvite,
  updateUserRoleStatus,
  logoutAllSessions,
  listUsers,
  setUserClientAccess,
} = await import("@/lib/app-domain/users");

const sendEmailMock = vi.mocked(sendEmail);

beforeEach(() => {
  sendEmailMock.mockReset();
  sendEmailMock.mockResolvedValue({ ok: true } as any);
});

// Every test here hashes several passwords (bcrypt) and runs a dozen
// queries; on a loaded runner that brushes the 5s default.
vi.setConfig({ testTimeout: 20_000 });

const NON_SUPER_ADMIN_ROLES: UserRole[] = ["ANKORA_ADMIN", "ANKORA_EMPLOYEE", "CLIENT_USER"];

/// Everything a refused write could have touched, captured before and
/// compared after. A permission check that throws AFTER a partial write
/// would still pass a bare `rejects.toBeInstanceOf(ForbiddenError)`; this
/// is what proves "nothing changed".
async function snapshot() {
  const [users, access, memberships, tokens, audits] = await Promise.all([
    prisma.user.findMany({
      orderBy: { id: "asc" },
      select: { id: true, role: true, status: true, tokenVersion: true, deletedAt: true },
    }),
    prisma.userClientAccess.findMany({ orderBy: [{ userId: "asc" }, { clientId: "asc" }], select: { userId: true, clientId: true } }),
    prisma.clientUser.count(),
    prisma.passwordResetToken.findMany({ orderBy: { id: "asc" }, select: { id: true, usedAt: true } }),
    prisma.auditEvent.count(),
  ]);
  return { users, access, memberships, tokens, audits };
}

async function expectRefusedAndUnchanged(run: () => Promise<unknown>) {
  const before = await snapshot();
  await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
  expect(await snapshot()).toEqual(before);
  expect(sendEmailMock).not.toHaveBeenCalled();
}

async function actorWithRole(role: UserRole): Promise<User> {
  return (await createTestUser({ role })).user;
}

function tokenFromEmail(callIndex: number) {
  const input = sendEmailMock.mock.calls[callIndex][0] as { text: string; html: string };
  const match = input.text.match(/reset-password\?token=([A-Za-z0-9_-]+)/);
  return match?.[1];
}

describe("updateUserRoleStatus() - the last active SUPER_ADMIN can never be removed", () => {
  // An org with one SUPER_ADMIN that demotes/suspends/archives itself has
  // nobody left who can manage users, and only direct DB access recovers it.
  it.each([
    ["demote to ANKORA_ADMIN", { role: "ANKORA_ADMIN" as const }],
    ["suspend", { status: "SUSPENDED" as const }],
    ["archive", { status: "ARCHIVED" as const }],
  ])("refuses to let the only SUPER_ADMIN %s themselves, and changes nothing", async (_label, input) => {
    const { user: onlySuper } = await createTestUser({ role: "SUPER_ADMIN" });
    const before = await snapshot();

    await expect(updateUserRoleStatus(onlySuper, onlySuper.id, input)).rejects.toThrow("מנהל העל האחרון");

    expect(await snapshot()).toEqual(before);
  });

  it("does not count a SUSPENDED or soft-deleted SUPER_ADMIN as the 'other' one", async () => {
    // Both of these accounts exist but cannot log in - leaning on them
    // would still leave the org with zero usable SUPER_ADMINs.
    const { user: onlyActive } = await createTestUser({ role: "SUPER_ADMIN" });
    await createTestUser({ role: "SUPER_ADMIN", status: "SUSPENDED" });
    const { user: deletedSuper } = await createTestUser({ role: "SUPER_ADMIN" });
    await prisma.user.update({ where: { id: deletedSuper.id }, data: { deletedAt: new Date() } });

    await expect(updateUserRoleStatus(onlyActive, onlyActive.id, { status: "SUSPENDED" })).rejects.toThrow(
      "מנהל העל האחרון"
    );
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: onlyActive.id } });
    expect(fresh.status).toBe("ACTIVE");
  });

  it("allows demoting a SUPER_ADMIN while another ACTIVE one remains, and audits role before/after", async () => {
    const { user: superA } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: superB } = await createTestUser({ role: "SUPER_ADMIN" });

    const updated = await updateUserRoleStatus(superA, superB.id, { role: "ANKORA_ADMIN" });
    expect(updated.role).toBe("ANKORA_ADMIN");
    // A role change alone does not kill sessions: session.ts re-reads the
    // role from the DB on every request, so the demotion is already live.
    expect(updated.tokenVersion).toBe(superB.tokenVersion);

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "user.role_status_change", entityId: superB.id },
    });
    expect(audit.actorId).toBe(superA.id);
    expect(audit.beforeJson).toEqual({ role: "SUPER_ADMIN", status: "ACTIVE" });
    expect(audit.afterJson).toEqual({ role: "ANKORA_ADMIN", status: "ACTIVE" });

    // And now superA is the last one: the guard applies to them in turn.
    await expect(updateUserRoleStatus(superA, superA.id, { role: "ANKORA_EMPLOYEE" })).rejects.toThrow();
  });
});

describe("updateUserRoleStatus() - suspending/archiving kills live sessions, only on a real status change", () => {
  it("bumps tokenVersion when an ACTIVE user is suspended", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE", tokenVersion: 3 });

    const updated = await updateUserRoleStatus(superAdmin, employee.id, { status: "SUSPENDED" });

    expect(updated.status).toBe("SUSPENDED");
    expect(updated.tokenVersion).toBe(4);
  });

  it("does not bump again when the status is re-submitted unchanged, nor on reactivation", async () => {
    // The edit form posts role+status together; re-saving a SUSPENDED
    // user's role must not count as a fresh suspension.
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "SUSPENDED", tokenVersion: 5 });

    const resubmitted = await updateUserRoleStatus(superAdmin, employee.id, { role: "ANKORA_ADMIN", status: "SUSPENDED" });
    expect(resubmitted.tokenVersion).toBe(5);
    expect(resubmitted.role).toBe("ANKORA_ADMIN");

    const reactivated = await updateUserRoleStatus(superAdmin, employee.id, { status: "ACTIVE" });
    expect(reactivated.tokenVersion).toBe(5);
  });

  it("bumps when moving from SUSPENDED to ARCHIVED (a different non-active status)", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "SUSPENDED", tokenVersion: 1 });

    const archived = await updateUserRoleStatus(superAdmin, employee.id, { status: "ARCHIVED" });
    expect(archived.tokenVersion).toBe(2);
  });

  it.each(NON_SUPER_ADMIN_ROLES)("refuses %s with ForbiddenError and changes nothing", async (role) => {
    const actor = await actorWithRole(role);
    const { user: target } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    await expectRefusedAndUnchanged(() => updateUserRoleStatus(actor, target.id, { role: "SUPER_ADMIN" }));
    await expectRefusedAndUnchanged(() => updateUserRoleStatus(actor, target.id, { status: "SUSPENDED" }));
    // Including on themselves: an ANKORA_ADMIN cannot self-promote.
    await expectRefusedAndUnchanged(() => updateUserRoleStatus(actor, actor.id, { role: "SUPER_ADMIN" }));
  });
});

describe("resendInvite() - only for INVITED users, and every earlier link stops working", () => {
  it("issues a new working link and burns the old one, proven through the real reset-password flow", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: invited, setPasswordToken: firstLink } = await inviteUser(superAdmin, {
      name: "Dana Invitee",
      email: "dana@test.ankora.local",
      role: "ANKORA_EMPLOYEE",
    });
    sendEmailMock.mockClear();

    const { setPasswordToken: secondLink, emailSent } = await resendInvite(superAdmin, invited.id);

    expect(emailSent).toBe(true);
    expect(secondLink).not.toBe(firstLink);
    // The mail goes to the invitee only, and carries the NEW link.
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toEqual(["dana@test.ankora.local"]);
    expect(tokenFromEmail(0)).toBe(secondLink);

    // The forwarded/stale first email is dead.
    const oldAttempt = await consumePasswordResetToken(firstLink, "Br4nd-New-Passw0rd!");
    expect(oldAttempt.ok).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: invited.id } })).status).toBe("INVITED");

    // The new one works and activates the account.
    const newAttempt = await consumePasswordResetToken(secondLink, "Br4nd-New-Passw0rd!");
    expect(newAttempt.ok).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: invited.id } })).status).toBe("ACTIVE");
  });

  it("burns every earlier unused link, not just the latest, and records how many in the audit", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: invited, setPasswordToken: link1 } = await inviteUser(superAdmin, {
      name: "Two Resends",
      email: "two@test.ankora.local",
      role: "ANKORA_EMPLOYEE",
    });
    const { setPasswordToken: link2 } = await resendInvite(superAdmin, invited.id);
    const { setPasswordToken: link3 } = await resendInvite(superAdmin, invited.id);

    expect((await consumePasswordResetToken(link1, "Br4nd-New-Passw0rd!")).ok).toBe(false);
    expect((await consumePasswordResetToken(link2, "Br4nd-New-Passw0rd!")).ok).toBe(false);

    const audits = await prisma.auditEvent.findMany({
      where: { action: "user.invite.resent", entityId: invited.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audits).toHaveLength(2);
    expect(audits.every((a) => a.actorId === superAdmin.id)).toBe(true);
    // Each resend burned exactly the one live link that preceded it.
    expect(audits.map((a) => (a.afterJson as any).revokedLinks)).toEqual([1, 1]);

    expect((await consumePasswordResetToken(link3, "Br4nd-New-Passw0rd!")).ok).toBe(true);
  });

  it("still hands back a working link when the email provider fails", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: invited } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "INVITED" });
    sendEmailMock.mockResolvedValue({ ok: false, error: "provider down" } as any);

    const result = await resendInvite(superAdmin, invited.id);

    expect(result.emailSent).toBe(false);
    expect(result.emailError).toBe("provider down");
    expect((await consumePasswordResetToken(result.setPasswordToken, "Br4nd-New-Passw0rd!")).ok).toBe(true);
  });

  it.each(["ACTIVE", "SUSPENDED", "ARCHIVED"] as const)(
    "refuses a %s user: no token minted, no mail, nothing burned",
    async (status) => {
      const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
      const { user: target } = await createTestUser({ role: "ANKORA_EMPLOYEE", status });
      const before = await snapshot();

      await expect(resendInvite(superAdmin, target.id)).rejects.toThrow("רק למשתמש שטרם בחר סיסמה");

      expect(await snapshot()).toEqual(before);
      expect(sendEmailMock).not.toHaveBeenCalled();
    }
  );

  it("refuses a soft-deleted INVITED user as not found", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: target } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "INVITED" });
    await prisma.user.update({ where: { id: target.id }, data: { deletedAt: new Date() } });

    await expect(resendInvite(superAdmin, target.id)).rejects.toThrow("משתמש לא נמצא");
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it.each(NON_SUPER_ADMIN_ROLES)("refuses %s with ForbiddenError: no mail, old link still the live one", async (role) => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: invited, setPasswordToken } = await inviteUser(superAdmin, {
      name: "Waiting",
      email: `waiting-${role.toLowerCase()}@test.ankora.local`,
      role: "ANKORA_EMPLOYEE",
    });
    sendEmailMock.mockClear();
    const actor = await actorWithRole(role);

    await expectRefusedAndUnchanged(() => resendInvite(actor, invited.id));
    expect((await consumePasswordResetToken(setPasswordToken, "Br4nd-New-Passw0rd!")).ok).toBe(true);
  });
});

describe("logoutAllSessions() - invalidates every issued JWT", () => {
  it("increments tokenVersion by one and audits who did it", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: target } = await createTestUser({ role: "ANKORA_EMPLOYEE", tokenVersion: 7 });

    await logoutAllSessions(superAdmin, target.id);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).tokenVersion).toBe(8);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "user.logout_all_sessions" } });
    expect(audit.actorId).toBe(superAdmin.id);
    expect(audit.entityId).toBe(target.id);
  });

  it.each(NON_SUPER_ADMIN_ROLES)("refuses %s with ForbiddenError and changes nothing", async (role) => {
    const actor = await actorWithRole(role);
    const { user: target } = await createTestUser({ role: "SUPER_ADMIN" });
    await expectRefusedAndUnchanged(() => logoutAllSessions(actor, target.id));
  });
});

describe("listUsers() - the admin user list", () => {
  it("excludes soft-deleted users but keeps suspended/archived ones, with their client access", async () => {
    const client = await createTestClient({ name: "Visible Access" });
    const { user: active } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: suspended } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "SUSPENDED" });
    const { user: deleted } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.user.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    await prisma.userClientAccess.create({ data: { userId: active.id, clientId: client.id } });

    const users = await listUsers();
    const ids = users.map((u) => u.id);

    expect(ids).toContain(active.id);
    expect(ids).toContain(suspended.id);
    expect(ids).not.toContain(deleted.id);
    expect(users.find((u) => u.id === active.id)!.clientAccess.map((a) => a.client.name)).toEqual(["Visible Access"]);
  });
});

describe("setUserClientAccess() - replaces the assignment set", () => {
  it("replaces rather than appends, can clear to empty, and audits before/after", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const a = await createTestClient();
    const b = await createTestClient();
    const c = await createTestClient();

    await setUserClientAccess(superAdmin, employee.id, [a.id, b.id]);
    await setUserClientAccess(superAdmin, employee.id, [b.id, c.id]);

    const rows = await prisma.userClientAccess.findMany({ where: { userId: employee.id } });
    expect(rows.map((r) => r.clientId).sort()).toEqual([b.id, c.id].sort());

    await setUserClientAccess(superAdmin, employee.id, []);
    expect(await prisma.userClientAccess.count({ where: { userId: employee.id } })).toBe(0);

    // Located by content rather than createdAt order: three writes can
    // land in the same millisecond.
    const audits = await prisma.auditEvent.findMany({
      where: { action: "user.client_access_change", entityId: employee.id },
    });
    expect(audits).toHaveLength(3);
    const swap = audits.find((x) => JSON.stringify(x.afterJson) === JSON.stringify([b.id, c.id]))!;
    expect((swap.beforeJson as string[]).sort()).toEqual([a.id, b.id].sort());
    const cleared = audits.find((x) => JSON.stringify(x.afterJson) === "[]")!;
    expect((cleared.beforeJson as string[]).sort()).toEqual([b.id, c.id].sort());
  });

  it("does not touch another user's access", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: e1 } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: e2 } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const a = await createTestClient();
    await prisma.userClientAccess.create({ data: { userId: e2.id, clientId: a.id } });

    await setUserClientAccess(superAdmin, e1.id, []);

    expect(await prisma.userClientAccess.count({ where: { userId: e2.id } })).toBe(1);
  });

  it.each(NON_SUPER_ADMIN_ROLES)("refuses %s with ForbiddenError and changes nothing", async (role) => {
    // The interesting case is an employee granting THEMSELVES a client.
    const actor = await actorWithRole(role);
    const a = await createTestClient();
    const b = await createTestClient();
    await prisma.userClientAccess.create({ data: { userId: actor.id, clientId: a.id } });

    await expectRefusedAndUnchanged(() => setUserClientAccess(actor, actor.id, [a.id, b.id]));
    await expectRefusedAndUnchanged(() => setUserClientAccess(actor, actor.id, []));
  });
});

describe("inviteUser() - who can create whom", () => {
  it.each(NON_SUPER_ADMIN_ROLES)("refuses %s inviting a SUPER_ADMIN: no account, no mail", async (role) => {
    const actor = await actorWithRole(role);

    await expectRefusedAndUnchanged(() =>
      inviteUser(actor, { name: "Escalation", email: `esc-${role.toLowerCase()}@test.ankora.local`, role: "SUPER_ADMIN" })
    );
    expect(await prisma.user.count({ where: { email: `esc-${role.toLowerCase()}@test.ankora.local` } })).toBe(0);
  });

  it("a CLIENT_USER invited with several clients gets one portal membership (the first) and NO staff access", async () => {
    // UserClientAccess is the internal "may log time / see tasks for this
    // client" grant. A client contact holding it for any client - their
    // own or, worse, the second one in the list - would be a staff grant
    // handed to someone outside Ankora.
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const own = await createTestClient({ name: "Own Client" });
    const other = await createTestClient({ name: "Other Client" });

    const { user: invited } = await inviteUser(superAdmin, {
      name: "Client Contact",
      email: "contact@test.ankora.local",
      role: "CLIENT_USER",
      clientIds: [own.id, other.id],
    });

    const memberships = await prisma.clientUser.findMany({ where: { userId: invited.id } });
    expect(memberships.map((m) => m.clientId)).toEqual([own.id]);
    expect(await prisma.userClientAccess.count({ where: { userId: invited.id } })).toBe(0);

    // The portal invite (not the staff one) went to the contact.
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toEqual(["contact@test.ankora.local"]);
    expect(sendEmailMock.mock.calls[0][0].subject).toContain("פורטל");
  });

  it("an employee invited with clients gets staff access to exactly those clients and no portal membership", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const a = await createTestClient();
    const b = await createTestClient();

    const { user: invited } = await inviteUser(superAdmin, {
      name: "New Staff",
      email: "staff@test.ankora.local",
      role: "ANKORA_EMPLOYEE",
      clientIds: [a.id, b.id],
    });

    const access = await prisma.userClientAccess.findMany({ where: { userId: invited.id } });
    expect(access.map((r) => r.clientId).sort()).toEqual([a.id, b.id].sort());
    expect(await prisma.clientUser.count({ where: { userId: invited.id } })).toBe(0);
  });
});
