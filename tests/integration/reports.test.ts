import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient, createTestCategory, createTestTimeEntry } from "./factories";
import { runReport } from "@/lib/app-domain/reports";
import { ForbiddenError } from "@/lib/app-auth/permissions";

// Phase 5 - spec 14 (reports), 21.2 ("Report aggregates equal raw time
// entry sums"), and 4.1 ("כל Endpoint בשרת בודק Authorization"). Needs a
// real Prisma client + reachable DATABASE_URL - see tests/integration/
// setup.ts's header. No new tables for this phase - reports read the same
// TimeEntry/HourBank data Phases 2/3 already persist, so setup.ts's TABLES
// list needed no changes.

async function setup() {
  const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
  const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
  const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: clientUser } = await createTestUser({ role: "CLIENT_USER" });
  const clientA = await createTestClient({ name: "Client A" });
  const clientB = await createTestClient({ name: "Client B" });
  const category = await createTestCategory();
  return { superAdmin, admin, employee, clientUser, clientA, clientB, category };
}

describe("runReport() - RBAC (spec 4.1, ADR addendum 12.2)", () => {
  it("SUPER_ADMIN and ANKORA_ADMIN can run reports; ANKORA_EMPLOYEE and CLIENT_USER cannot", async () => {
    const { superAdmin, admin, employee, clientUser } = await setup();

    await expect(runReport(superAdmin, "total_client_hours", {})).resolves.toBeDefined();
    await expect(runReport(admin, "total_client_hours", {})).resolves.toBeDefined();
    await expect(runReport(employee, "total_client_hours", {})).rejects.toThrow(ForbiddenError);
    await expect(runReport(clientUser, "total_client_hours", {})).rejects.toThrow(ForbiddenError);
  });
});

describe("total_client_hours - spec 21.2 aggregates equal raw sums", () => {
  it("sums actual/billable minutes across every matching entry", async () => {
    const { superAdmin, employee, clientA, category } = await setup();
    await createTestTimeEntry({
      userId: employee.id,
      clientId: clientA.id,
      categoryId: category.id,
      startAt: new Date("2026-03-01T09:00:00Z"),
      endAt: new Date("2026-03-01T09:30:00Z"), // 30 min
    });
    await createTestTimeEntry({
      userId: employee.id,
      clientId: clientA.id,
      categoryId: category.id,
      startAt: new Date("2026-03-02T09:00:00Z"),
      endAt: new Date("2026-03-02T10:00:00Z"), // 60 min
    });

    const result = await runReport(superAdmin, "total_client_hours", {
      from: new Date("2026-03-01T00:00:00Z"),
      to: new Date("2026-03-03T00:00:00Z"),
    });

    const raw = await prisma.timeEntry.aggregate({
      where: { deletedAt: null, endAt: { not: null } },
      _sum: { actualSeconds: true, billableSeconds: true },
    });

    expect(result.rows[0].entryCount).toBe(2);
    expect(result.rows[0].actualMinutes).toBe(Math.round((raw._sum.actualSeconds ?? 0) / 60));
    expect(result.rows[0].billableMinutes).toBe(Math.round((raw._sum.billableSeconds ?? 0) / 60));
    expect(result.rows[0].actualMinutes).toBe(90);
  });

  it("excludes currently-running timers (endAt = null) from totals", async () => {
    const { superAdmin, employee, clientA, category } = await setup();
    await createTestTimeEntry({
      userId: employee.id,
      clientId: clientA.id,
      categoryId: category.id,
      startAt: new Date(),
      endAt: null, // still running
    });

    const result = await runReport(superAdmin, "total_client_hours", {});
    expect(result.rows[0].entryCount).toBe(0);
  });
});

describe("hours_by_employee - spec 14.2", () => {
  it("counts distinct clients per employee correctly", async () => {
    const { superAdmin, employee, clientA, clientB, category } = await setup();
    await createTestTimeEntry({ userId: employee.id, clientId: clientA.id, categoryId: category.id });
    await createTestTimeEntry({ userId: employee.id, clientId: clientB.id, categoryId: category.id });

    const result = await runReport(superAdmin, "hours_by_employee", {});
    const row = result.rows.find((r) => r.employee === employee.name);
    expect(row?.clientCount).toBe(2);
  });
});

describe("hours_by_client - spec 14.2 client isolation via filter", () => {
  it("clientId filter narrows Hours by Client to only that client", async () => {
    const { superAdmin, clientA, clientB } = await setup();
    const result = await runReport(superAdmin, "hours_by_client", { clientId: clientA.id });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].client).toBe(clientA.name);
    expect(result.rows.some((r) => r.client === clientB.name)).toBe(false);
  });
});

describe("manual_edits - spec 6.3/6.4", () => {
  it("includes manual entries and edited entries, excludes plain timer entries", async () => {
    const { superAdmin, employee, clientA, category } = await setup();
    await createTestTimeEntry({
      userId: employee.id,
      clientId: clientA.id,
      categoryId: category.id,
      source: "MANUAL",
      isManual: true,
    });
    const timerEntry = await createTestTimeEntry({
      userId: employee.id,
      clientId: clientA.id,
      categoryId: category.id,
      source: "TIMER",
      isManual: false,
    });
    // Simulate an edit on the timer entry (isEdited + a revision row),
    // bypassing lib/app-domain/time-entries.ts's updateTimeEntry() since
    // that flow is Phase 2's own concern, not what this test exercises.
    await prisma.timeEntry.update({ where: { id: timerEntry.id }, data: { isEdited: true } });
    await prisma.timeEntryRevision.create({
      data: { timeEntryId: timerEntry.id, version: 1, changedById: superAdmin.id, reason: "typo fix" },
    });
    await createTestTimeEntry({
      userId: employee.id,
      clientId: clientA.id,
      categoryId: category.id,
      source: "TIMER",
      isManual: false,
    }); // plain, never edited - should be excluded

    const result = await runReport(superAdmin, "manual_edits", {});
    expect(result.rows).toHaveLength(2);
    const editedRow = result.rows.find((r) => r.edited === "כן");
    expect(editedRow?.actor).toBe(superAdmin.name);
    expect(editedRow?.reason).toBe("typo fix");
  });
});

describe("active_timers - spec 14.2", () => {
  it("lists only entries with endAt = null", async () => {
    const { superAdmin, employee, clientA, category } = await setup();
    await createTestTimeEntry({ userId: employee.id, clientId: clientA.id, categoryId: category.id, endAt: null });
    await createTestTimeEntry({ userId: employee.id, clientId: clientA.id, categoryId: category.id }); // stopped

    const result = await runReport(superAdmin, "active_timers", {});
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].employee).toBe(employee.name);
  });
});
