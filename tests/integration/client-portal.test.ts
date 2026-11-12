import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient, createTestCategory, createTestClientUser } from "./factories";
import {
  resolvePortalClient,
  getWeeklyActivity,
  getMonthlyDetailed,
  getPortalTaskReport,
  updatePortalScheduleRecipients,
} from "@/lib/app-domain/client-portal";
import { ForbiddenError } from "@/lib/app-auth/permissions";

// Phase 6 - spec 21.2's own integration-test requirement, verbatim:
// "Client user של לקוח X לא יכול לשנות URL/ID ולקבל נתוני Y." These tests
// exercise the actual domain functions (not just permissions.ts in
// isolation, which tests/unit/permissions.test.ts already covers) since
// resolvePortalClient's whole design point (ADR addendum 13.3) is that
// isolation is structural, not just a permission check - only an
// end-to-end call proves that.

// Phase 8 regression: startOfWeek/endOfWeek used to compute the week
// boundary from `weekStart`'s UTC calendar fields, not its Asia/Jerusalem
// ones. 2026-08-30T22:30:00Z is 2026-08-31 01:30 in Israel (summer, +3) -
// Israel has already crossed into Monday, UTC has not (still Sunday
// 2026-08-30). The old getUTCDay()-based code computed "this week" as
// starting 2026-08-30T00:00:00Z (UTC's own Sunday); the fix computes it
// as 2026-08-29T21:00:00Z (Israel's Sunday 00:00 local, converted to
// UTC) - three hours earlier. An entry seeded exactly in that three-hour
// gap (2026-08-29T22:00:00Z, which is 2026-08-30 01:00 Israel time -
// already locally Sunday, so it belongs in "this week") is excluded by
// the old boundary and included by the fixed one. See docs/adr/0001,
// Phase 8 addendum section 15.3.
describe("getWeeklyActivity() - Phase 8 timezone fix", () => {
  it("includes an entry that falls in the UTC/Israel week-boundary disagreement window", async () => {
    const client = await createTestClient({ name: "Client TZ" });
    const category = await createTestCategory({ clientId: client.id, name: "Category TZ" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: clientUser } = await createTestClientUser({ clientId: client.id });

    const inDisagreementWindow = new Date("2026-08-29T22:00:00Z");
    await prisma.timeEntry.create({
      data: {
        userId: employee.id,
        clientId: client.id,
        categoryId: category.id,
        startAt: inDisagreementWindow,
        endAt: new Date(inDisagreementWindow.getTime() + 3600_000),
        actualSeconds: 3600,
        billableSeconds: 3600,
      },
    });

    const activity = await getWeeklyActivity(clientUser, new Date("2026-08-30T22:30:00Z"));
    expect(activity.from.toISOString()).toBe("2026-08-29T21:00:00.000Z");
    expect(activity.rows).toHaveLength(1);
    expect(activity.rows[0].category).toBe("Category TZ");
  });
});

describe("resolvePortalClient() - spec 21.2 client isolation", () => {
  it("throws ForbiddenError for a role that lacks report.client.view", async () => {
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(resolvePortalClient(employee)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError for a CLIENT_USER with no ClientUser membership row", async () => {
    const { user: orphan } = await createTestUser({ role: "CLIENT_USER" });
    await expect(resolvePortalClient(orphan)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("resolves a CLIENT_USER to their own client, never a different one", async () => {
    const clientA = await createTestClient({ name: "Client A" });
    const clientB = await createTestClient({ name: "Client B" });
    const { user: userA } = await createTestClientUser({ clientId: clientA.id });
    await createTestClientUser({ clientId: clientB.id });

    const resolved = await resolvePortalClient(userA);
    expect(resolved.client.id).toBe(clientA.id);
    expect(resolved.client.id).not.toBe(clientB.id);
  });
});

describe("getWeeklyActivity() - cross-client isolation (spec 21.2)", () => {
  it("never returns another client's time entries, no matter what the caller asks for", async () => {
    const clientA = await createTestClient({ name: "Client A" });
    const clientB = await createTestClient({ name: "Client B" });
    const categoryA = await createTestCategory({ clientId: clientA.id, name: "Category A" });
    const categoryB = await createTestCategory({ clientId: clientB.id, name: "Category B" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    const now = new Date();
    await prisma.timeEntry.create({
      data: {
        userId: employee.id,
        clientId: clientA.id,
        categoryId: categoryA.id,
        startAt: now,
        endAt: new Date(now.getTime() + 3600_000),
        actualSeconds: 3600,
        billableSeconds: 3600,
      },
    });
    await prisma.timeEntry.create({
      data: {
        userId: employee.id,
        clientId: clientB.id,
        categoryId: categoryB.id,
        startAt: now,
        endAt: new Date(now.getTime() + 3600_000),
        actualSeconds: 3600,
        billableSeconds: 3600,
      },
    });

    const { user: userA } = await createTestClientUser({ clientId: clientA.id });
    const activity = await getWeeklyActivity(userA, now);

    expect(activity.rows).toHaveLength(1);
    expect(activity.rows[0].category).toBe("Category A");
    // resolvePortalClient never takes a clientId parameter at all - there
    // is no argument userA could pass to reach clientB's data even if
    // this test tried to.
  });

  it("never exposes TimeEntry.note - only the Task title (or category name) as 'activity' (spec 13's exclusion list)", async () => {
    const client = await createTestClient();
    const category = await createTestCategory({ clientId: client.id, name: "Consulting" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const now = new Date();

    await prisma.timeEntry.create({
      data: {
        userId: employee.id,
        clientId: client.id,
        categoryId: category.id,
        startAt: now,
        endAt: new Date(now.getTime() + 1800_000),
        actualSeconds: 1800,
        billableSeconds: 1800,
        note: "internal note the client must never see",
      },
    });

    const { user: clientUser } = await createTestClientUser({ clientId: client.id });
    const activity = await getWeeklyActivity(clientUser, now);

    expect(activity.rows).toHaveLength(1);
    expect(activity.rows[0].activity).toBe("Consulting"); // falls back to category.name, no task
    expect(JSON.stringify(activity.rows[0])).not.toContain("internal note");
  });

  it("includes/omits the employee column based on Client.portalShowEmployeeNames", async () => {
    const now = new Date();
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    const openClient = await createTestClient({ name: "Transparent Client" });
    const closedClient = await prisma.client.update({
      where: { id: (await createTestClient({ name: "Anonymous Client" })).id },
      data: { portalShowEmployeeNames: false },
    });
    const categoryOpen = await createTestCategory({ clientId: openClient.id });
    const categoryClosed = await createTestCategory({ clientId: closedClient.id });

    await prisma.timeEntry.create({
      data: {
        userId: employee.id,
        clientId: openClient.id,
        categoryId: categoryOpen.id,
        startAt: now,
        endAt: new Date(now.getTime() + 1800_000),
        actualSeconds: 1800,
        billableSeconds: 1800,
      },
    });
    await prisma.timeEntry.create({
      data: {
        userId: employee.id,
        clientId: closedClient.id,
        categoryId: categoryClosed.id,
        startAt: now,
        endAt: new Date(now.getTime() + 1800_000),
        actualSeconds: 1800,
        billableSeconds: 1800,
      },
    });

    const { user: openUser } = await createTestClientUser({ clientId: openClient.id });
    const { user: closedUser } = await createTestClientUser({ clientId: closedClient.id });

    const openActivity = await getWeeklyActivity(openUser, now);
    const closedActivity = await getWeeklyActivity(closedUser, now);

    expect(openActivity.showEmployeeNames).toBe(true);
    expect(openActivity.rows[0].employee).toBe(employee.name);
    expect(closedActivity.showEmployeeNames).toBe(false);
    expect(closedActivity.rows[0].employee).toBeUndefined();
  });
});

describe("updatePortalScheduleRecipients() - spec 13's Client Admin recipients management (ADR addendum 13.7)", () => {
  it("allows a Client Admin to update recipients on their own client's schedule", async () => {
    const client = await createTestClient();
    const { user: admin } = await createTestClientUser({ clientId: client.id, role: "ADMIN" });
    const schedule = await prisma.reportSchedule.create({
      data: {
        clientId: client.id,
        reportType: "MONTHLY_DETAILED",
        frequency: "MONTHLY",
        recipients: ["old@client.test"],
      },
    });

    const updated = await updatePortalScheduleRecipients(admin, schedule.id, ["NEW@Client.test", " second@client.test "]);
    expect(updated.recipients).toEqual(["new@client.test", "second@client.test"]);
  });

  it("blocks a Client Viewer (not Admin) from editing recipients", async () => {
    const client = await createTestClient();
    const { user: viewer } = await createTestClientUser({ clientId: client.id, role: "VIEWER" });
    const schedule = await prisma.reportSchedule.create({
      data: { clientId: client.id, reportType: "MONTHLY_DETAILED", frequency: "MONTHLY", recipients: ["a@client.test"] },
    });

    await expect(updatePortalScheduleRecipients(viewer, schedule.id, ["b@client.test"])).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });

  it("blocks a Client Admin of Client A from editing a schedule belonging to Client B (spec 21.2)", async () => {
    const clientA = await createTestClient({ name: "Client A" });
    const clientB = await createTestClient({ name: "Client B" });
    const { user: adminA } = await createTestClientUser({ clientId: clientA.id, role: "ADMIN" });
    const scheduleB = await prisma.reportSchedule.create({
      data: { clientId: clientB.id, reportType: "MONTHLY_DETAILED", frequency: "MONTHLY", recipients: ["b@client.test"] },
    });

    await expect(updatePortalScheduleRecipients(adminA, scheduleB.id, ["hijacked@evil.test"])).rejects.toBeInstanceOf(
      ForbiddenError
    );

    const unchanged = await prisma.reportSchedule.findUnique({ where: { id: scheduleB.id } });
    expect(unchanged?.recipients).toEqual(["b@client.test"]);
  });
});

// 11.11.2026 (Hadas's portal review): the week showed 12:53 beside 12.87 on
// the bank for the same entries. The bank sums seconds and rounds once; the
// portal rounded every entry to minutes and then summed. Two entries of 90
// seconds are 3 minutes, not 2 + 2.
describe("portal totals round once, like the hour bank", () => {
  it("sums billable seconds before rounding, in every total the week and the month show", async () => {
    const client = await createTestClient({ name: "Client Rounding" });
    const category = await createTestCategory({ clientId: client.id, name: "Category Rounding" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: clientUser } = await createTestClientUser({ clientId: client.id });

    const start = new Date("2026-11-02T08:00:00Z"); // Monday 2.11.2026, Israel time
    for (let i = 0; i < 2; i++) {
      const at = new Date(start.getTime() + i * 3600_000);
      await prisma.timeEntry.create({
        data: {
          userId: employee.id,
          clientId: client.id,
          categoryId: category.id,
          startAt: at,
          endAt: new Date(at.getTime() + 90_000),
          actualSeconds: 90,
          billableSeconds: 90,
        },
      });
    }

    const week = await getWeeklyActivity(clientUser, start);
    expect(week.totalMinutes).toBe(3);
    expect(week.dailyTotals.find((d) => d.date === "2026-11-02")?.minutes).toBe(3);
    expect(week.topActivities[0].minutes).toBe(3);
    expect(week.activitiesByDay["2026-11-02"]).toEqual([{ activity: "Category Rounding", minutes: 3 }]);
    expect(week.activitiesByDay["2026-11-03"]).toEqual([]);
    // Each row still shows its own minutes, and never the seconds behind them.
    expect(week.rows.map((r) => r.billableMinutes)).toEqual([2, 2]);
    expect(week.rows[0]).not.toHaveProperty("billableSeconds");

    const month = await getMonthlyDetailed(clientUser, start);
    expect(month.totalMinutes).toBe(3);
  });
});

describe("getPortalTaskReport() - the tasks tab", () => {
  it("counts tasks closed in the month and those open today, visible ones only", async () => {
    const client = await createTestClient({ name: "Client Tasks" });
    const other = await createTestClient({ name: "Client Other" });
    const { user: clientUser } = await createTestClientUser({ clientId: client.id });

    const inMonth = new Date("2026-11-05T10:00:00Z");
    const lastMonth = new Date("2026-10-20T10:00:00Z");
    await prisma.task.createMany({
      data: [
        { clientId: client.id, title: "נסגרה החודש", clientVisible: true, status: "DONE", completedAt: inMonth },
        { clientId: client.id, title: "נסגרה בחודש שעבר", clientVisible: true, status: "DONE", completedAt: lastMonth },
        { clientId: client.id, title: "בטיפול", clientVisible: true, status: "IN_PROGRESS" },
        { clientId: client.id, title: "מחכה ללקוח", clientVisible: true, status: "IN_PROGRESS", blockedOn: "CLIENT" },
        { clientId: client.id, title: "פנימית", clientVisible: false, status: "IN_PROGRESS" },
        { clientId: other.id, title: "של לקוח אחר", clientVisible: true, status: "IN_PROGRESS" },
      ],
    });

    const report = await getPortalTaskReport(clientUser, inMonth);
    expect(report.closed.map((p) => p.title)).toEqual(["נסגרה החודש"]);
    // Waiting on the client first.
    expect(report.open.map((p) => p.title)).toEqual(["מחכה ללקוח", "בטיפול"]);
    expect(report.waitingOnClient).toBe(1);

    const october = await getPortalTaskReport(clientUser, lastMonth);
    expect(october.closed.map((p) => p.title)).toEqual(["נסגרה בחודש שעבר"]);
    expect(october.open).toHaveLength(2);
  });
});
