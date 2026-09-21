import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestUser } from "./factories";
import {
  changeOwnPassword,
  getLastPasswordChangeAt,
  updateLongRunningTimerEmailPreference,
  updateOwnName,
  updateOwnTimezone,
} from "@/lib/app-domain/profile";
import { authenticateWithPassword } from "@/lib/app-auth/authenticate";

// Phase 18 (Profile screen) - self-service, and the one place in the
// product where a user changes their own credentials.
//
// The capability scan had `domain:profile` at high risk with no test of
// any kind. Everything here is scoped to `actor` and takes no target id,
// so there is no IDOR to probe - which makes the interesting properties
// the other two: that a password change actually invalidates the old
// password everywhere, and that "when did I last change it" tells the
// truth rather than a plausible-looking guess.

describe("changeOwnPassword() - spec 4.2", () => {
  it("requires the current password, and changes nothing when it is wrong", async () => {
    const { user, password } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    const result = await changeOwnPassword(user, "not-the-current-one", "Br4nd-New-Passw0rd!");

    expect(result.ok).toBe(false);
    // Still the old password, and still the old session generation - a
    // failed attempt must not log the user out of anything.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.passwordHash).toBe(user.passwordHash);
    expect(after.tokenVersion).toBe(user.tokenVersion);
    expect(await authenticateWithPassword(user.email, password)).not.toBeNull();
  });

  it("refuses a new password that fails the policy, without touching the old one", async () => {
    const { user, password } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    const result = await changeOwnPassword(user, password, "short");

    expect(result.ok).toBe(false);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.passwordHash).toBe(user.passwordHash);
  });

  it("swaps the password and makes the old one stop working", async () => {
    const { user, password } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    const result = await changeOwnPassword(user, password, "Br4nd-New-Passw0rd!");
    expect(result.ok).toBe(true);

    expect(await authenticateWithPassword(user.email, "Br4nd-New-Passw0rd!")).not.toBeNull();
    expect(await authenticateWithPassword(user.email, password)).toBeNull();
  });

  it("bumps tokenVersion, which is what actually signs the other devices out", async () => {
    const { user, password } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    await changeOwnPassword(user, password, "Br4nd-New-Passw0rd!");

    // This is the whole security value of the feature. Someone changing
    // their password after losing a laptop is doing it to end the session
    // ON that laptop; a new hash with an unchanged tokenVersion leaves
    // every existing JWT valid and the change is theatre. getCurrentUser
    // re-checks this against the database on every request.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.tokenVersion).toBe(user.tokenVersion + 1);
  });

  it("audits the change without recording either password", async () => {
    const { user, password } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    await changeOwnPassword(user, password, "Br4nd-New-Passw0rd!");

    const event = await prisma.auditEvent.findFirst({
      where: { actorId: user.id, action: "profile.password_change" },
    });
    expect(event).not.toBeNull();
    const serialised = JSON.stringify(event);
    expect(serialised).not.toContain(password);
    expect(serialised).not.toContain("Br4nd-New-Passw0rd!");
  });
});

describe("getLastPasswordChangeAt()", () => {
  it("returns null for a user who has never changed their password here", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    expect(await getLastPasswordChangeAt(user)).toBeNull();
  });

  it("does not mistake an unrelated profile edit for a password change", async () => {
    // The reason this reads the audit trail instead of User.updatedAt:
    // updatedAt moves on ANY write, so a timezone change would otherwise
    // report as "password updated just now" on the profile screen.
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    await updateOwnTimezone(user, "Europe/Berlin");

    expect(await getLastPasswordChangeAt(user)).toBeNull();
  });

  it("reports a real change", async () => {
    const { user, password } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const before = new Date();

    await changeOwnPassword(user, password, "Br4nd-New-Passw0rd!");

    const at = await getLastPasswordChangeAt(user);
    expect(at).not.toBeNull();
    expect(at!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });
});

describe("updateOwnName() / updateOwnTimezone()", () => {
  it("trims, and refuses a name that is only whitespace", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    await updateOwnName(user, "  נועה כהן  ");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe("נועה כהן");

    await expect(updateOwnName(user, "   ")).rejects.toThrow();
  });

  it("refuses an over-long name rather than truncating it silently", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(updateOwnName(user, "x".repeat(101))).rejects.toThrow();
  });

  it("records the old and new name, so a rename is traceable", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const original = user.name;

    await updateOwnName(user, "שם חדש");

    const event = await prisma.auditEvent.findFirst({
      where: { actorId: user.id, action: "profile.name_update" },
    });
    expect(JSON.stringify(event?.before)).toContain(original);
    expect(JSON.stringify(event?.after)).toContain("שם חדש");
  });

  it("refuses an empty timezone", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(updateOwnTimezone(user, "  ")).rejects.toThrow();
  });
});

describe("updateLongRunningTimerEmailPreference()", () => {
  it("round-trips both ways, scoped to the caller's own row", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: other } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const otherBefore = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });

    await updateLongRunningTimerEmailPreference(user, false);
    const off = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    await updateLongRunningTimerEmailPreference(user, true);
    const on = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    expect(off.notifyLongRunningTimerByEmail).toBe(false);
    expect(on.notifyLongRunningTimerByEmail).toBe(true);

    // Nobody else moved. These functions take no target id at all, which
    // is the structural reason they cannot - this asserts the structure
    // has not quietly gained one.
    const otherAfter = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });
    expect(otherAfter.notifyLongRunningTimerByEmail).toBe(otherBefore.notifyLongRunningTimerByEmail);
  });
});
