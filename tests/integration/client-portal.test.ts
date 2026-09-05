import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient, createTestCategory, createTestClientUser } from "./factories";
import {
  resolvePortalClient,
  getWeeklyActivity,
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
