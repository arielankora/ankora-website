import { describe, expect, it, vi, afterEach } from "vitest";
import { prisma } from "./setup";
import {
  createTestUser,
  createTestClient,
  createTestCategory,
  createTestTimeEntry,
  createTestClientUser,
} from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import {
  getClient,
  listClients,
  listAccessibleClients,
  archiveClient,
  restoreClient,
  listStaffForAssignment,
} from "@/lib/app-domain/clients";
import { listCategories, getCategoryMonthlyHours, updateCategory, archiveCategory } from "@/lib/app-domain/categories";
import { startTimer, listMyTimeEntries } from "@/lib/app-domain/time-entries";
import { usableCategories } from "@/lib/mcp/lookup";
import type { User, UserRole } from "@prisma/client";

// Client and category administration (lib/app-domain/clients.ts,
// categories.ts). client.manage and category.manage belong to SUPER_ADMIN
// and ANKORA_ADMIN; employees and client users are refused. The user-
// visible effects that matter: an archived client or category disappears
// from every picker an employee works from, without erasing the hours
// already logged against it, and comes back intact on restore.

// Every test here hashes several passwords (bcrypt) and runs a dozen
// queries; on a loaded runner that brushes the 5s default.
vi.setConfig({ testTimeout: 20_000 });

async function actor(role: UserRole): Promise<User> {
  if (role === "CLIENT_USER") {
    const client = await createTestClient();
    return (await createTestClientUser({ clientId: client.id, role: "ADMIN" })).user;
  }
  return (await createTestUser({ role })).user;
}

/// An employee assigned to `client`, ready to start a timer.
async function assignedEmployee(clientId: string) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return user;
}

async function clientRowAndAudits(clientId: string) {
  return {
    client: await prisma.client.findUniqueOrThrow({ where: { id: clientId } }),
    audits: await prisma.auditEvent.count(),
  };
}

describe("getClient() - the client detail page", () => {
  it("returns the client with its assigned staff and categories", async () => {
    const client = await createTestClient({ name: "Detail Client" });
    const employee = await assignedEmployee(client.id);
    const category = await createTestCategory({ clientId: client.id });

    const found = await getClient(client.id);

    expect(found?.name).toBe("Detail Client");
    expect(found?.employeeAccess.map((a) => a.user.id)).toEqual([employee.id]);
    expect(found?.categories.map((c) => c.id)).toEqual([category.id]);
  });

  it("returns null for an archived client and for an unknown id", async () => {
    const client = await createTestClient();
    await prisma.client.update({ where: { id: client.id }, data: { deletedAt: new Date(), status: "ARCHIVED" } });

    expect(await getClient(client.id)).toBeNull();
    expect(await getClient("does-not-exist")).toBeNull();
  });
});

describe("archiveClient() / restoreClient() - who may, and what employees see", () => {
  it.each(["SUPER_ADMIN", "ANKORA_ADMIN"] as const)("%s may archive and restore, each audited", async (role) => {
    const admin = await actor(role);
    const client = await createTestClient();

    const archived = await archiveClient(admin, client.id);
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.deletedAt).not.toBeNull();

    const restored = await restoreClient(admin, client.id);
    expect(restored.status).toBe("ACTIVE");
    expect(restored.deletedAt).toBeNull();

    const audits = await prisma.auditEvent.findMany({ where: { entityId: client.id } });
    expect(audits.map((a) => a.action).sort()).toEqual(["client.archive", "client.restore"]);
    expect(audits.every((a) => a.actorId === admin.id && a.clientId === client.id)).toBe(true);
  });

  it.each(["ANKORA_EMPLOYEE", "CLIENT_USER"] as const)(
    "%s is refused both archive and restore with ForbiddenError, and nothing changes",
    async (role) => {
      const who = await actor(role);
      const live = await createTestClient();
      const gone = await createTestClient();
      await prisma.client.update({ where: { id: gone.id }, data: { status: "ARCHIVED", deletedAt: new Date() } });

      const liveBefore = await clientRowAndAudits(live.id);
      await expect(archiveClient(who, live.id)).rejects.toBeInstanceOf(ForbiddenError);
      expect(await clientRowAndAudits(live.id)).toEqual(liveBefore);

      const goneBefore = await clientRowAndAudits(gone.id);
      await expect(restoreClient(who, gone.id)).rejects.toBeInstanceOf(ForbiddenError);
      expect(await clientRowAndAudits(gone.id)).toEqual(goneBefore);
    }
  );

  it("an archived client leaves the employee's picker and timer, but its logged hours remain", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient({ name: "Archived Co" });
    const stays = await createTestClient({ name: "Still Here" });
    const category = await createTestCategory();
    const employee = await assignedEmployee(client.id);
    await prisma.userClientAccess.create({ data: { userId: employee.id, clientId: stays.id } });
    const history = await createTestTimeEntry({ userId: employee.id, clientId: client.id, categoryId: category.id });

    await archiveClient(admin, client.id);

    // Gone from every picker: the employee's, the admin's, the client list.
    expect((await listAccessibleClients(employee)).map((c) => c.id)).toEqual([stays.id]);
    expect((await listAccessibleClients(admin)).map((c) => c.id)).not.toContain(client.id);
    expect((await listClients()).map((c) => c.id)).not.toContain(client.id);

    // The server refuses a timer even if the UI were bypassed.
    await expect(startTimer(employee, { clientId: client.id, categoryId: category.id })).rejects.toThrow("inactive");
    expect(await prisma.timeEntry.count({ where: { clientId: client.id } })).toBe(1);

    // History survives: the row still exists and the employee still sees it.
    const mine = await listMyTimeEntries(employee.id);
    expect(mine.map((e) => e.id)).toContain(history.id);
    // The staff assignment is not discarded either, so a restore needs no re-setup.
    expect(await prisma.userClientAccess.count({ where: { userId: employee.id, clientId: client.id } })).toBe(1);
  });

  it("restore brings the client back into the picker and the timer works again", async () => {
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const client = await createTestClient();
    const category = await createTestCategory();
    const employee = await assignedEmployee(client.id);

    await archiveClient(admin, client.id);
    await restoreClient(admin, client.id);

    expect((await listAccessibleClients(employee)).map((c) => c.id)).toEqual([client.id]);
    expect(await getClient(client.id)).not.toBeNull();
    const entry = await startTimer(employee, { clientId: client.id, categoryId: category.id });
    expect(entry.clientId).toBe(client.id);
    expect(entry.endAt).toBeNull();
  });
});

describe("listStaffForAssignment() - who can be named account manager", () => {
  it("lists only active, non-deleted Ankora staff, by name, never a client user", async () => {
    // A client user named as account manager would appear on their own
    // portal as "the person accountable for you".
    // Written directly (no password hashing): eight bcrypt hashes push this
    // test past vitest's 5s timeout, and nobody here ever logs in.
    const mk = (name: string, role: UserRole, status: "ACTIVE" | "SUSPENDED" | "INVITED" = "ACTIVE") =>
      prisma.user.create({
        data: { name, role, status, email: `${name.replace(/\s/g, ".").toLowerCase()}@test.ankora.local`, passwordHash: "x" },
      });
    const zed = await mk("Zed Admin", "ANKORA_ADMIN");
    const amy = await mk("Amy Employee", "ANKORA_EMPLOYEE");
    const sup = await mk("Mo Super", "SUPER_ADMIN");
    await mk("Cleo Client", "CLIENT_USER");
    await mk("Sam Suspended", "ANKORA_EMPLOYEE", "SUSPENDED");
    await mk("Ivy Invited", "ANKORA_EMPLOYEE", "INVITED");
    const del = await mk("Dee Deleted", "ANKORA_EMPLOYEE");
    await prisma.user.update({ where: { id: del.id }, data: { deletedAt: new Date() } });

    const staff = await listStaffForAssignment();

    expect(staff).toEqual([
      { id: amy.id, name: "Amy Employee" },
      { id: sup.id, name: "Mo Super" },
      { id: zed.id, name: "Zed Admin" },
    ]);
  });
});

describe("listCategories() and client-scoped categories - client A's category is never client B's", () => {
  it("excludes archived categories and carries the owning client", async () => {
    const client = await createTestClient({ name: "Owner" });
    const global = await createTestCategory();
    const scoped = await createTestCategory({ clientId: client.id });
    const archived = await createTestCategory();
    await prisma.category.update({ where: { id: archived.id }, data: { deletedAt: new Date(), active: false } });

    const rows = await listCategories();

    expect(rows.map((c) => c.id).sort()).toEqual([global.id, scoped.id].sort());
    expect(rows.find((c) => c.id === scoped.id)?.client?.name).toBe("Owner");
  });

  it("a CLIENT category of A is not offered for B, and the server refuses it for B", async () => {
    // listCategories itself is unscoped by design (one catalogue, filtered
    // per client by the callers); the per-client filter that the MCP
    // tools use, and the domain guard behind the timer, are what keep
    // client A's internal category names away from client B's hours.
    const clientA = await createTestClient();
    const clientB = await createTestClient();
    const global = await createTestCategory();
    const onlyA = await createTestCategory({ clientId: clientA.id });

    expect((await usableCategories(clientA.id)).map((c) => c.id).sort()).toEqual([global.id, onlyA.id].sort());
    expect((await usableCategories(clientB.id)).map((c) => c.id)).toEqual([global.id]);

    const employee = await assignedEmployee(clientB.id);
    await expect(startTimer(employee, { clientId: clientB.id, categoryId: onlyA.id })).rejects.toThrow(
      "does not belong to the selected client"
    );
    // Not even an admin's inactive-target override lets it through.
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    await expect(startTimer(admin, { clientId: clientB.id, categoryId: onlyA.id })).rejects.toThrow(
      "does not belong to the selected client"
    );
    expect(await prisma.timeEntry.count()).toBe(0);
  });
});

describe("updateCategory() - edits, deactivation, permissions", () => {
  it("ANKORA_ADMIN can rename (trimmed), reorder and deactivate; audited with before/after and the client", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient();
    const category = await createTestCategory({ clientId: client.id, name: "Old Name" });

    const updated = await updateCategory(admin, category.id, { name: "  New Name  ", sortOrder: 4, active: false });

    expect(updated).toMatchObject({ name: "New Name", sortOrder: 4, active: false });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "category.update", entityId: category.id } });
    expect(audit.actorId).toBe(admin.id);
    expect(audit.clientId).toBe(client.id);
    expect((audit.beforeJson as any).name).toBe("Old Name");
    expect((audit.afterJson as any).name).toBe("New Name");
  });

  it("a deactivated category can no longer be used by an employee", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient();
    const category = await createTestCategory();
    const employee = await assignedEmployee(client.id);

    await updateCategory(admin, category.id, { active: false });

    await expect(startTimer(employee, { clientId: client.id, categoryId: category.id })).rejects.toThrow("inactive");
    expect((await usableCategories(client.id)).map((c) => c.id)).not.toContain(category.id);
  });

  it.each(["ANKORA_EMPLOYEE", "CLIENT_USER"] as const)("%s is refused with ForbiddenError and nothing changes", async (role) => {
    const who = await actor(role);
    const category = await createTestCategory({ name: "Untouched" });
    const before = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
    const audits = await prisma.auditEvent.count();

    await expect(updateCategory(who, category.id, { name: "Hijacked", active: false })).rejects.toBeInstanceOf(
      ForbiddenError
    );

    expect(await prisma.category.findUniqueOrThrow({ where: { id: category.id } })).toEqual(before);
    expect(await prisma.auditEvent.count()).toBe(audits);
  });
});

describe("archiveCategory() - removal from pickers, history kept", () => {
  it("removes it from the catalogue and the timer, keeps logged hours, audits", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient();
    const category = await createTestCategory({ clientId: client.id });
    const employee = await assignedEmployee(client.id);
    const past = await createTestTimeEntry({ userId: employee.id, clientId: client.id, categoryId: category.id });

    const archived = await archiveCategory(admin, category.id);

    expect(archived.active).toBe(false);
    expect(archived.deletedAt).not.toBeNull();
    expect((await listCategories()).map((c) => c.id)).not.toContain(category.id);
    await expect(startTimer(employee, { clientId: client.id, categoryId: category.id })).rejects.toThrow("inactive");
    expect((await listMyTimeEntries(employee.id)).map((e) => e.id)).toContain(past.id);

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "category.archive" } });
    expect(audit).toMatchObject({ actorId: admin.id, entityId: category.id, clientId: client.id });
  });

  it.each(["ANKORA_EMPLOYEE", "CLIENT_USER"] as const)("%s is refused with ForbiddenError and nothing changes", async (role) => {
    const who = await actor(role);
    const category = await createTestCategory();
    const before = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
    const audits = await prisma.auditEvent.count();

    await expect(archiveCategory(who, category.id)).rejects.toBeInstanceOf(ForbiddenError);

    expect(await prisma.category.findUniqueOrThrow({ where: { id: category.id } })).toEqual(before);
    expect(await prisma.auditEvent.count()).toBe(audits);
  });
});

describe("getCategoryMonthlyHours() - the 'hours this month' column", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /// Only Date is faked: Prisma and pg need real timers to talk to the DB.
  function freezeAt(iso: string) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  }

  async function fixtures() {
    const client = await createTestClient();
    const category = await createTestCategory();
    const other = await createTestCategory();
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const entry = (startAt: string, hours: number, categoryId = category.id) =>
      createTestTimeEntry({
        userId: user.id,
        clientId: client.id,
        categoryId,
        startAt: new Date(startAt),
        endAt: new Date(new Date(startAt).getTime() + hours * 3600_000),
      });
    return { client, category, other, user, entry };
  }

  it("sums finished, non-deleted entries of the current month per category, in seconds", async () => {
    freezeAt("2026-11-15T10:00:00Z");
    const { category, other, entry, user, client } = await fixtures();
    await entry("2026-11-03T08:00:00Z", 2);
    await entry("2026-11-20T08:00:00Z", 1.5);
    await entry("2026-11-10T08:00:00Z", 1, other.id);
    await entry("2026-10-10T08:00:00Z", 5); // last month
    await entry("2026-12-02T08:00:00Z", 5); // next month
    const deleted = await entry("2026-11-04T08:00:00Z", 3);
    await prisma.timeEntry.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    // A timer still running has no actualSeconds yet and must not count.
    await createTestTimeEntry({
      userId: user.id,
      clientId: client.id,
      categoryId: category.id,
      startAt: new Date("2026-11-15T09:00:00Z"),
      endAt: null,
    });

    const hours = await getCategoryMonthlyHours();

    expect(hours.get(category.id)).toBe(3.5 * 3600);
    expect(hours.get(other.id)).toBe(3600);
  });

  // PRODUCT BUG (found 2026-10-07): getCategoryMonthlyHours computes the
  // month with getUTCMonth / Date.UTC (categories.ts:21-23), so "this
  // month" is the UTC month, not the Israel month. Every other monthly
  // figure in the product (hour banks, reports, portal) uses Asia/Jerusalem
  // boundaries. Impact: work done between 00:00 and 02:00/03:00 Israel time
  // on the 1st of a month is shown under the previous month on the
  // Categories screen, and during those same hours after midnight on the
  // 1st the whole column still shows the month that just ended - so the
  // number on this screen disagrees with the hour bank for the same work.
  // The code comment says the UTC choice was deliberate for one summary
  // column; flagged for Ariel to decide.
  it.fails("uses Israel month boundaries: 2026-10-31T22:30Z is November, 2026-11-30T22:30Z is December", async () => {
    freezeAt("2026-11-15T10:00:00Z");
    const { category, entry } = await fixtures();
    await entry("2026-10-31T22:30:00Z", 1); // 1 Nov 00:30 in Israel (UTC+2 after the 25.10 DST change)
    await entry("2026-11-30T22:30:00Z", 2); // 1 Dec 00:30 in Israel

    const hours = await getCategoryMonthlyHours();

    expect(hours.get(category.id)).toBe(3600);
  });
});
