import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient, createTestCategory, createTestClientUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";

// Client isolation across every number the portal shows a client.
//
// client-portal.test.ts proves isolation for getWeeklyActivity and the
// recipients write; portal-phase0 proves resolvePortalClient's cookie and
// preview rules. Neither calls the four screens that carry hours and
// money: the dashboard (hour bank), the monthly detailed report (what the
// export and the scheduled email are built from), the category summary
// and the history. Each of those runs its OWN query with the resolved
// clientId, so each is a separate place a missing where-clause would hand
// client A client B's hours. That is the failure that ends a contract, so
// every test here seeds two clients with the same shape of data and
// different numbers, and asserts A's user gets exactly A's numbers.

let cookieJar: Record<string, string> = {};

// The portal reads its client selection / staff preview from cookies.
// Same per-file mock as portal-phase0.test.ts: no cookie means "no
// selection", which is what production does outside a request.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar[name] ? { name, value: cookieJar[name] } : undefined),
  }),
}));

const {
  getPortalDashboard,
  getMonthlyDetailed,
  getCategorySummary,
  getPortalHistory,
  PORTAL_CLIENT_COOKIE,
  PORTAL_PREVIEW_COOKIE,
} = await import("@/lib/app-domain/client-portal");

beforeEach(() => {
  cookieJar = {};
});

const HOUR = 3600_000;
const DAY = 24 * HOUR;

async function seedEntry(data: {
  userId: string;
  clientId: string;
  categoryId: string;
  startAt: Date;
  actualSeconds: number;
  billableSeconds: number;
  taskId?: string;
  note?: string;
  deletedAt?: Date;
  endAt?: Date | null;
}) {
  const endAt = data.endAt === undefined ? new Date(data.startAt.getTime() + data.actualSeconds * 1000) : data.endAt;
  return prisma.timeEntry.create({
    data: {
      userId: data.userId,
      clientId: data.clientId,
      categoryId: data.categoryId,
      taskId: data.taskId,
      startAt: data.startAt,
      endAt,
      actualSeconds: endAt ? data.actualSeconds : null,
      billableSeconds: endAt ? data.billableSeconds : null,
      note: data.note,
      deletedAt: data.deletedAt,
    },
  });
}

/// Two clients, each with its own category, task and entries in November
/// 2026 (Israel time). The numbers differ on purpose (A: 30+45 billable
/// minutes, B: 120) so a leak shows up as a wrong total, not just an
/// extra row.
async function seedTwoClients() {
  const clientA = await createTestClient({ name: "לקוח א" });
  const clientB = await createTestClient({ name: "לקוח ב" });
  const catA = await createTestCategory({ clientId: clientA.id, name: "ניהול בית" });
  const catA2 = await createTestCategory({ clientId: clientA.id, name: "רכב" });
  const catB = await createTestCategory({ clientId: clientB.id, name: "סודי של ב" });
  const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const taskA = await prisma.task.create({ data: { clientId: clientA.id, title: "חידוש ביטוח דירה" } });
  const taskB = await prisma.task.create({ data: { clientId: clientB.id, title: "משימה של ב" } });

  const nov10 = new Date("2026-11-10T08:00:00Z");
  await seedEntry({
    userId: employee.id,
    clientId: clientA.id,
    categoryId: catA.id,
    taskId: taskA.id,
    startAt: nov10,
    actualSeconds: 1200,
    billableSeconds: 1800, // a 15/30-minute minimum lifted 20 actual minutes to 30 billable
    note: "הערה פנימית של A",
  });
  await seedEntry({
    userId: employee.id,
    clientId: clientA.id,
    categoryId: catA2.id,
    startAt: new Date(nov10.getTime() + DAY),
    actualSeconds: 2700,
    billableSeconds: 2700,
  });
  await seedEntry({
    userId: employee.id,
    clientId: clientB.id,
    categoryId: catB.id,
    taskId: taskB.id,
    startAt: nov10,
    actualSeconds: 7200,
    billableSeconds: 7200,
  });

  return { clientA, clientB, catA, catA2, catB, employee, taskA, taskB };
}

describe("getMonthlyDetailed() - a client sees only their own month", () => {
  it("returns only client A's rows and total, for both an ADMIN and a VIEWER of A", async () => {
    const { clientA } = await seedTwoClients();
    const { user: adminA } = await createTestClientUser({ clientId: clientA.id, role: "ADMIN" });
    const { user: viewerA } = await createTestClientUser({ clientId: clientA.id, role: "VIEWER" });

    for (const u of [adminA, viewerA]) {
      const report = await getMonthlyDetailed(u, new Date("2026-11-15T12:00:00Z"));
      expect(report.rows.map((r) => r.category).sort()).toEqual(["ניהול בית", "רכב"].sort());
      expect(report.totalMinutes).toBe(75);
      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain("סודי של ב");
      expect(serialized).not.toContain("משימה של ב");
    }
  });

  it("shows billable minutes, never actual minutes, and the task title instead of the internal note", async () => {
    const { clientA } = await seedTwoClients();
    const { user: viewerA } = await createTestClientUser({ clientId: clientA.id });

    const report = await getMonthlyDetailed(viewerA, new Date("2026-11-15T12:00:00Z"));
    const insurance = report.rows.find((r) => r.activity === "חידוש ביטוח דירה");
    // 20 actual minutes, 30 billable: the client is billed 30 and must
    // read 30, or the report and the invoice disagree.
    expect(insurance?.billableMinutes).toBe(30);
    expect(JSON.stringify(report)).not.toContain("הערה פנימית");
    // No task: the category name stands in, never a blank activity.
    expect(report.rows.find((r) => r.category === "רכב")?.activity).toBe("רכב");
  });

  it("never counts a soft-deleted entry or a running timer", async () => {
    const { clientA, catA, employee } = await seedTwoClients();
    await seedEntry({
      userId: employee.id,
      clientId: clientA.id,
      categoryId: catA.id,
      startAt: new Date("2026-11-12T08:00:00Z"),
      actualSeconds: 36_000,
      billableSeconds: 36_000,
      deletedAt: new Date(),
    });
    await seedEntry({
      userId: employee.id,
      clientId: clientA.id,
      categoryId: catA.id,
      startAt: new Date("2026-11-13T08:00:00Z"),
      actualSeconds: 0,
      billableSeconds: 0,
      endAt: null,
    });
    const { user: viewerA } = await createTestClientUser({ clientId: clientA.id });

    const report = await getMonthlyDetailed(viewerA, new Date("2026-11-15T12:00:00Z"));
    expect(report.rows).toHaveLength(2);
    expect(report.totalMinutes).toBe(75);
  });

  // 2026-10-31T22:30Z is 2026-11-01 00:30 in Israel (winter time, +2,
  // since 25.10). For the client that work happened in November. A UTC
  // month boundary would put it in October's report and the client would
  // see it billed in the wrong month.
  it("puts an entry at 2026-10-31T22:30Z into November, and 21:30Z into October (Israel month)", async () => {
    const client = await createTestClient();
    const cat = await createTestCategory({ clientId: client.id, name: "גבול" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await seedEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: cat.id,
      startAt: new Date("2026-10-31T22:30:00Z"),
      actualSeconds: 600,
      billableSeconds: 600,
    });
    await seedEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: cat.id,
      startAt: new Date("2026-10-31T21:30:00Z"),
      actualSeconds: 1200,
      billableSeconds: 1200,
    });
    const { user: viewer } = await createTestClientUser({ clientId: client.id });

    const november = await getMonthlyDetailed(viewer, new Date("2026-11-15T12:00:00Z"));
    expect(november.from.toISOString()).toBe("2026-10-31T22:00:00.000Z");
    expect(november.to.toISOString()).toBe("2026-11-30T22:00:00.000Z");
    expect(november.rows).toEqual([expect.objectContaining({ date: "2026-11-01", billableMinutes: 10 })]);

    const october = await getMonthlyDetailed(viewer, new Date("2026-10-15T12:00:00Z"));
    // October starts at Israel midnight in summer time (+3).
    expect(october.from.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(october.rows).toEqual([expect.objectContaining({ date: "2026-10-31", billableMinutes: 20 })]);
  });

  it("names the employee only when the client's privacy setting allows it", async () => {
    const { clientA, clientB, employee } = await seedTwoClients();
    await prisma.client.update({ where: { id: clientB.id }, data: { portalShowEmployeeNames: false } });
    const { user: viewerA } = await createTestClientUser({ clientId: clientA.id });
    const { user: viewerB } = await createTestClientUser({ clientId: clientB.id });

    const a = await getMonthlyDetailed(viewerA, new Date("2026-11-15T12:00:00Z"));
    const b = await getMonthlyDetailed(viewerB, new Date("2026-11-15T12:00:00Z"));

    expect(a.showEmployeeNames).toBe(true);
    expect(a.rows.every((r) => r.employee === employee.name)).toBe(true);
    expect(b.showEmployeeNames).toBe(false);
    expect(b.rows.every((r) => r.employee === undefined)).toBe(true);
    expect(JSON.stringify(b)).not.toContain(employee.name);
  });

  it("counts only the client's own top-level, live tasks marked DONE inside the month", async () => {
    const { clientA, clientB } = await seedTwoClients();
    const inNov = new Date("2026-11-20T10:00:00Z");
    const parent = await prisma.task.create({
      data: { clientId: clientA.id, title: "סגור בנובמבר", status: "DONE", updatedAt: inNov },
    });
    // Each of these must NOT be counted: a subtask (steps are not
    // promises), a deleted task, a task closed in October, another
    // client's task, and an open one.
    await prisma.task.create({
      data: { clientId: clientA.id, title: "תת-משימה", status: "DONE", parentId: parent.id, updatedAt: inNov },
    });
    await prisma.task.create({
      data: { clientId: clientA.id, title: "נמחקה", status: "DONE", deletedAt: inNov, updatedAt: inNov },
    });
    await prisma.task.create({
      data: { clientId: clientA.id, title: "אוקטובר", status: "DONE", updatedAt: new Date("2026-10-20T10:00:00Z") },
    });
    await prisma.task.create({ data: { clientId: clientB.id, title: "של ב", status: "DONE", updatedAt: inNov } });
    await prisma.task.create({ data: { clientId: clientA.id, title: "פתוחה", status: "OPEN", updatedAt: inNov } });

    const { user: viewerA } = await createTestClientUser({ clientId: clientA.id });
    const report = await getMonthlyDetailed(viewerA, new Date("2026-11-15T12:00:00Z"));
    expect(report.tasksCompleted).toBe(1);
  });

  it("labels the auto-send from the client's own enabled monthly schedule only", async () => {
    const { clientA, clientB } = await seedTwoClients();
    const { user: viewerA } = await createTestClientUser({ clientId: clientA.id });
    const { user: viewerB } = await createTestClientUser({ clientId: clientB.id });

    // B has a schedule, A does not yet: A must not borrow B's.
    await prisma.reportSchedule.create({
      data: { clientId: clientB.id, reportType: "MONTHLY_DETAILED", frequency: "MONTHLY", dayOfMonth: 3, recipients: ["b@b.test"] },
    });
    // A disabled one says nothing will be sent, so no label.
    await prisma.reportSchedule.create({
      data: {
        clientId: clientA.id,
        reportType: "MONTHLY_DETAILED",
        frequency: "MONTHLY",
        dayOfMonth: 9,
        enabled: false,
        recipients: ["a@a.test"],
      },
    });
    expect((await getMonthlyDetailed(viewerA, new Date("2026-11-15T12:00:00Z"))).autoSendLabel).toBeNull();
    expect((await getMonthlyDetailed(viewerB, new Date("2026-11-15T12:00:00Z"))).autoSendLabel).toBe(
      "נשלח אוטומטית ב-3 לכל חודש"
    );

    await prisma.reportSchedule.create({
      data: { clientId: clientA.id, reportType: "MONTHLY_DETAILED", frequency: "WEEKLY", dayOfWeek: 0, recipients: ["a@a.test"] },
    });
    expect((await getMonthlyDetailed(viewerA, new Date("2026-11-15T12:00:00Z"))).autoSendLabel).toBe(
      "נשלח אוטומטית כל שבוע ביום ראשון"
    );
  });
});

describe("getCategorySummary() - client isolation and percentages", () => {
  it("sums only client A's billable minutes per category, with % of A's own total", async () => {
    const { clientA } = await seedTwoClients();
    const { user: adminA } = await createTestClientUser({ clientId: clientA.id, role: "ADMIN" });

    const summary = await getCategorySummary(
      adminA,
      new Date("2026-10-31T22:00:00Z"),
      new Date("2026-11-30T22:00:00Z")
    );

    expect(summary.totalMinutes).toBe(75);
    // Sorted largest first; 45/75 = 60%, 30/75 = 40%.
    expect(summary.rows).toEqual([
      { category: "רכב", minutes: 45, pctOfTotal: 60 },
      { category: "ניהול בית", minutes: 30, pctOfTotal: 40 },
    ]);
  });

  it("excludes soft-deleted entries and returns zeroes, not NaN, for an empty range", async () => {
    const { clientA, catA, employee } = await seedTwoClients();
    await seedEntry({
      userId: employee.id,
      clientId: clientA.id,
      categoryId: catA.id,
      startAt: new Date("2026-12-05T08:00:00Z"),
      actualSeconds: 3600,
      billableSeconds: 3600,
      deletedAt: new Date(),
    });
    const { user: viewerA } = await createTestClientUser({ clientId: clientA.id });

    const december = await getCategorySummary(
      viewerA,
      new Date("2026-11-30T22:00:00Z"),
      new Date("2026-12-31T22:00:00Z")
    );
    expect(december).toMatchObject({ rows: [], totalMinutes: 0 });
  });

  it("defaults to the current Israel month when no range is given", async () => {
    const client = await createTestClient();
    const cat = await createTestCategory({ clientId: client.id, name: "עכשיו" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await seedEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: cat.id,
      startAt: new Date(Date.now() - 60_000 - 900_000),
      actualSeconds: 900,
      billableSeconds: 900,
    });
    const { user: viewer } = await createTestClientUser({ clientId: client.id });

    const summary = await getCategorySummary(viewer);
    expect(summary.from.getTime()).toBeLessThanOrEqual(Date.now());
    expect(summary.to.getTime()).toBeGreaterThan(Date.now());
    expect(summary.rows).toEqual([{ category: "עכשיו", minutes: 15, pctOfTotal: 100 }]);
  });
});

describe("getPortalDashboard() - the hour bank a client sees is their own", () => {
  it("returns client A's current cycle with A's consumption, never B's", async () => {
    const clientA = await createTestClient({ name: "לקוח א" });
    const clientB = await createTestClient({ name: "לקוח ב" });
    const catA = await createTestCategory({ clientId: clientA.id });
    const catB = await createTestCategory({ clientId: clientB.id });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const now = Date.now();
    const cycle = { cycleStart: new Date(now - 10 * DAY), cycleEnd: new Date(now + 5 * DAY - HOUR) };
    const bankA = await prisma.hourBank.create({ data: { clientId: clientA.id, ...cycle, purchasedMinutes: 600 } });
    await prisma.hourBank.create({ data: { clientId: clientB.id, ...cycle, purchasedMinutes: 6000 } });
    await seedEntry({
      userId: employee.id,
      clientId: clientA.id,
      categoryId: catA.id,
      startAt: new Date(now - 2 * HOUR),
      actualSeconds: 1200,
      billableSeconds: 1800,
    });
    await seedEntry({
      userId: employee.id,
      clientId: clientB.id,
      categoryId: catB.id,
      startAt: new Date(now - 2 * HOUR),
      actualSeconds: 7200,
      billableSeconds: 7200,
    });
    const { user: viewerA } = await createTestClientUser({ clientId: clientA.id });

    const dash = await getPortalDashboard(viewerA);

    expect(dash.client.name).toBe("לקוח א");
    expect(dash.snapshot?.bank.id).toBe(bankA.id);
    expect(dash.snapshot?.utilization.totalMinutes).toBe(600);
    // Billable, not actual: 30 minutes, not 20.
    expect(dash.snapshot?.utilization.consumedMinutes).toBe(30);
    expect(dash.daysUntilCycleEnd).toBe(5);
  });

  it("returns a null snapshot (not another client's bank) when the client has no cycle", async () => {
    const clientA = await createTestClient();
    const clientB = await createTestClient();
    await prisma.hourBank.create({
      data: { clientId: clientB.id, cycleStart: new Date(Date.now() - DAY), cycleEnd: new Date(Date.now() + DAY), purchasedMinutes: 60 },
    });
    const { user: viewerA } = await createTestClientUser({ clientId: clientA.id });

    const dash = await getPortalDashboard(viewerA);
    expect(dash.snapshot).toBeNull();
    expect(dash.daysUntilCycleEnd).toBeNull();
  });
});

describe("getPortalHistory() - cycles and sent reports of the client's own account", () => {
  async function seedHistory() {
    const clientA = await createTestClient({ name: "לקוח א" });
    const clientB = await createTestClient({ name: "לקוח ב" });
    for (const [c, minutes] of [
      [clientA, 600],
      [clientB, 9999],
    ] as const) {
      await prisma.hourBank.create({
        data: {
          clientId: c.id,
          cycleStart: new Date("2026-09-01T00:00:00Z"),
          cycleEnd: new Date("2026-10-01T00:00:00Z"),
          purchasedMinutes: minutes,
          status: "CLOSED",
        },
      });
      const schedule = await prisma.reportSchedule.create({
        data: {
          clientId: c.id,
          reportType: "MONTHLY_DETAILED",
          frequency: "MONTHLY",
          dayOfMonth: 1,
          recipients: [`owner@${c.id}.test`],
        },
      });
      await prisma.reportRun.create({
        data: {
          scheduleId: schedule.id,
          periodStart: new Date("2026-09-01T00:00:00Z"),
          periodEnd: new Date("2026-10-01T00:00:00Z"),
          snapshotJson: {},
        },
      });
    }
    return { clientA, clientB };
  }

  it("lists only A's cycles, runs and schedules, and lets only A's ADMIN manage recipients", async () => {
    const { clientA, clientB } = await seedHistory();
    const { user: adminA } = await createTestClientUser({ clientId: clientA.id, role: "ADMIN" });
    const { user: viewerA } = await createTestClientUser({ clientId: clientA.id, role: "VIEWER" });

    const asAdmin = await getPortalHistory(adminA);
    expect(asAdmin.cycles).toHaveLength(1);
    expect(asAdmin.cycles[0].totalMinutes).toBe(600);
    expect(asAdmin.reportRuns).toHaveLength(1);
    expect(asAdmin.schedules).toHaveLength(1);
    expect(asAdmin.schedules[0].recipients).toEqual([`owner@${clientA.id}.test`]);
    expect(JSON.stringify(asAdmin)).not.toContain(clientB.id);
    expect(asAdmin.canManageRecipients).toBe(true);

    const asViewer = await getPortalHistory(viewerA);
    expect(asViewer.cycles).toHaveLength(1);
    expect(asViewer.canManageRecipients).toBe(false);
  });
});

describe("portal reads - who is refused", () => {
  const calls = {
    getPortalDashboard: (u: Parameters<typeof getPortalDashboard>[0]) => getPortalDashboard(u),
    getMonthlyDetailed: (u: Parameters<typeof getPortalDashboard>[0]) => getMonthlyDetailed(u),
    getCategorySummary: (u: Parameters<typeof getPortalDashboard>[0]) => getCategorySummary(u),
    getPortalHistory: (u: Parameters<typeof getPortalDashboard>[0]) => getPortalHistory(u),
  };

  it("refuses a CLIENT_USER with no membership in every function", async () => {
    await seedTwoClients();
    const { user: orphan } = await createTestUser({ role: "CLIENT_USER" });
    for (const fn of Object.values(calls)) {
      await expect(fn(orphan)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  // archiveClient sets status ARCHIVED and deletedAt together. A client
  // whose contract ended must not keep reading hours through a login
  // nobody remembered to revoke.
  it("refuses a CLIENT_USER whose only membership is to an archived client", async () => {
    const { clientA } = await seedTwoClients();
    const { user: viewerA } = await createTestClientUser({ clientId: clientA.id });
    await prisma.client.update({ where: { id: clientA.id }, data: { status: "ARCHIVED", deletedAt: new Date() } });
    for (const fn of Object.values(calls)) {
      await expect(fn(viewerA)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("ignores a client-selection cookie pointing at a client the user does not belong to", async () => {
    const { clientA, clientB } = await seedTwoClients();
    const { user: viewerA } = await createTestClientUser({ clientId: clientA.id });
    cookieJar[PORTAL_CLIENT_COOKIE] = clientB.id;

    const report = await getMonthlyDetailed(viewerA, new Date("2026-11-15T12:00:00Z"));
    expect(report.totalMinutes).toBe(75);
    expect(JSON.stringify(report)).not.toContain("סודי של ב");
  });

  // Staff are not portal users: without a preview selection an Ankora
  // role has no report.client.view and is refused, exactly like an
  // outsider. Internal staff read client numbers on the internal screens.
  it("refuses every staff role when no preview is selected", async () => {
    await seedTwoClients();
    for (const role of ["SUPER_ADMIN", "ANKORA_ADMIN", "ANKORA_EMPLOYEE"] as const) {
      const { user } = await createTestUser({ role });
      for (const fn of Object.values(calls)) {
        await expect(fn(user)).rejects.toBeInstanceOf(ForbiddenError);
      }
    }
  });

  // The staff preview is meant to show a manager exactly what that client
  // sees: the previewed client's numbers, nothing more, read-only.
  it("lets an admin preview client B and see exactly B's numbers; an employee's preview is refused", async () => {
    const { clientB } = await seedTwoClients();
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    cookieJar[PORTAL_PREVIEW_COOKIE] = clientB.id;

    const report = await getMonthlyDetailed(admin, new Date("2026-11-15T12:00:00Z"));
    expect(report.totalMinutes).toBe(120);
    expect(report.rows.map((r) => r.category)).toEqual(["סודי של ב"]);
    expect((await getPortalHistory(admin)).canManageRecipients).toBe(false);

    for (const fn of Object.values(calls)) {
      await expect(fn(employee)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("refuses a staff preview of an archived client", async () => {
    const { clientB } = await seedTwoClients();
    await prisma.client.update({ where: { id: clientB.id }, data: { status: "ARCHIVED", deletedAt: new Date() } });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    cookieJar[PORTAL_PREVIEW_COOKIE] = clientB.id;

    await expect(getMonthlyDetailed(admin)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
