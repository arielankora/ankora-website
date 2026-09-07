import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient, createTestCategory, createTestTimeEntry } from "./factories";
import { setUserClientAccess } from "@/lib/app-domain/users";
import {
  startTimer,
  stopTimer,
  createManualEntry,
  updateTimeEntry,
  deleteTimeEntry,
  getActiveTimer,
  ActiveTimerExistsError,
  OverlapError,
  EditWindowExpiredError,
  BackdateReasonRequiredError,
  ConflictError,
  FutureEntryError,
} from "@/lib/app-domain/time-entries";
import { ForbiddenError } from "@/lib/app-auth/permissions";

async function setupEmployeeWithClient() {
  const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
  const client = await createTestClient();
  const category = await createTestCategory();
  await setUserClientAccess(superAdmin, employee.id, [client.id]);
  return { employee, superAdmin, client, category };
}

describe("startTimer - spec 6.1 / 18.1 timer/start", () => {
  it("creates a running entry (endAt null, source TIMER)", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();

    const entry = await startTimer(employee, { clientId: client.id, categoryId: category.id });

    expect(entry.endAt).toBeNull();
    expect(entry.source).toBe("TIMER");
    expect(entry.userId).toBe(employee.id);
  });

  it("blocks a second concurrent timer for the same user (spec 5.1: one active timer per user)", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();
    await startTimer(employee, { clientId: client.id, categoryId: category.id });

    await expect(startTimer(employee, { clientId: client.id, categoryId: category.id })).rejects.toBeInstanceOf(
      ActiveTimerExistsError
    );
  });

  it("blocks starting a timer against a client the employee has no UserClientAccess for (spec 4.1)", async () => {
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const unassignedClient = await createTestClient();
    const category = await createTestCategory();

    await expect(
      startTimer(employee, { clientId: unassignedClient.id, categoryId: category.id })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets an admin (client.manage override) start a timer against any client", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient();
    const category = await createTestCategory();

    const entry = await startTimer(admin, { clientId: client.id, categoryId: category.id });
    expect(entry.userId).toBe(admin.id);
  });

  it("is visible cross-device via getActiveTimer (spec 6.1: shown on any device with the same time)", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();
    const started = await startTimer(employee, { clientId: client.id, categoryId: category.id });

    const active = await getActiveTimer(employee.id);
    expect(active?.id).toBe(started.id);
  });
});

describe("stopTimer - spec 6.1 / 18.1 timer/stop, 18.2 idempotency", () => {
  it("sets endAt and computes actualSeconds from the server clock", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();
    const started = await createTestTimeEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: category.id,
      startAt: new Date(Date.now() - 60_000),
      endAt: null,
      source: "TIMER",
      isManual: false,
    });

    const stopped = await stopTimer(employee, started.id);

    expect(stopped.endAt).not.toBeNull();
    expect(stopped.actualSeconds).toBeGreaterThanOrEqual(59);
    expect(stopped.billableSeconds).toBe(stopped.actualSeconds);
  });

  it("is idempotent - a duplicate Stop request does not error or double-process", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();
    const started = await createTestTimeEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: category.id,
      endAt: null,
      source: "TIMER",
      isManual: false,
    });

    const first = await stopTimer(employee, started.id);
    const second = await stopTimer(employee, started.id);

    expect(second.endAt?.getTime()).toBe(first.endAt?.getTime());
    expect(second.actualSeconds).toBe(first.actualSeconds);
  });
});

describe("createManualEntry - spec 6.3", () => {
  it("creates a manual entry with actualSeconds computed from start/end", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();
    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + 2 * 3600_000);

    const entry = await createManualEntry(employee, employee.id, {
      clientId: client.id,
      categoryId: category.id,
      startAt,
      endAt,
      note: "Weekly report",
    });

    expect(entry.isManual).toBe(true);
    expect(entry.source).toBe("MANUAL");
    expect(entry.actualSeconds).toBe(2 * 3600);
  });

  it("requires a reason when the entry is for a previous day (spec 6.3 backdate rule)", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();
    const yesterday = new Date(Date.now() - 24 * 3600_000);
    const yesterdayEnd = new Date(yesterday.getTime() + 3600_000);

    await expect(
      createManualEntry(employee, employee.id, {
        clientId: client.id,
        categoryId: category.id,
        startAt: yesterday,
        endAt: yesterdayEnd,
      })
    ).rejects.toBeInstanceOf(BackdateReasonRequiredError);

    const entry = await createManualEntry(employee, employee.id, {
      clientId: client.id,
      categoryId: category.id,
      startAt: yesterday,
      endAt: yesterdayEnd,
      backdateReason: "Forgot to log yesterday",
    });
    expect(entry.id).toBeTruthy();
  });

  // Overnight bug-hunt (docs/adr/0001 section 19.2): a future date/time
  // was previously accepted and mislabeled as needing a *backdate*
  // reason (isBackdated() only checks "not today"), instead of being
  // rejected outright - there's no legitimate case for logging hours
  // that haven't happened yet.
  it("rejects a future start time (overnight bug-hunt fix)", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();
    const futureStart = new Date(Date.now() + 24 * 3600_000);
    const futureEnd = new Date(futureStart.getTime() + 3600_000);

    await expect(
      createManualEntry(employee, employee.id, {
        clientId: client.id,
        categoryId: category.id,
        startAt: futureStart,
        endAt: futureEnd,
      })
    ).rejects.toBeInstanceOf(FutureEntryError);
  });

  it("rejects a future end time even when start is in the past (overnight bug-hunt fix)", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();
    const startAt = new Date();
    const futureEnd = new Date(Date.now() + 3600_000);

    await expect(
      createManualEntry(employee, employee.id, {
        clientId: client.id,
        categoryId: category.id,
        startAt,
        endAt: futureEnd,
      })
    ).rejects.toBeInstanceOf(FutureEntryError);
  });

  it("rejects start >= end (spec 5.1)", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();
    const t = new Date();

    await expect(
      createManualEntry(employee, employee.id, {
        clientId: client.id,
        categoryId: category.id,
        startAt: t,
        endAt: t,
      })
    ).rejects.toThrow();
  });

  it("blocks an overlapping entry unless override + edit_others (spec 6.3)", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();
    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + 3600_000);
    await createManualEntry(employee, employee.id, { clientId: client.id, categoryId: category.id, startAt, endAt });

    const overlapStart = new Date(startAt.getTime() + 1_800_000); // 30 min into the first entry
    const overlapEnd = new Date(overlapStart.getTime() + 3600_000);

    await expect(
      createManualEntry(employee, employee.id, {
        clientId: client.id,
        categoryId: category.id,
        startAt: overlapStart,
        endAt: overlapEnd,
      })
    ).rejects.toBeInstanceOf(OverlapError);

    // Employee alone (no edit_others) cannot override even with the flag set.
    await expect(
      createManualEntry(employee, employee.id, {
        clientId: client.id,
        categoryId: category.id,
        startAt: overlapStart,
        endAt: overlapEnd,
        allowOverlapOverride: true,
      })
    ).rejects.toBeInstanceOf(OverlapError);
  });

  it("records actor distinct from userId when an admin enters time for an employee (spec 6.3 audit rule)", async () => {
    const { employee, superAdmin, client, category } = await setupEmployeeWithClient();
    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + 3600_000);

    const entry = await createManualEntry(superAdmin, employee.id, {
      clientId: client.id,
      categoryId: category.id,
      startAt,
      endAt,
    });

    expect(entry.userId).toBe(employee.id);
    const auditRow = await prisma.auditEvent.findFirst({
      where: { entityType: "TimeEntry", entityId: entry.id, action: "time_entry.create" },
    });
    expect(auditRow?.actorId).toBe(superAdmin.id);
    expect(auditRow?.actorId).not.toBe(entry.userId);
  });
});

describe("updateTimeEntry - spec 5.1 revisions, 6.4 edit window", () => {
  it("creates a TimeEntryRevision and marks isEdited on every mutating edit", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();
    const entry = await createTestTimeEntry({ userId: employee.id, clientId: client.id, categoryId: category.id });

    const updated = await updateTimeEntry(employee, entry.id, { note: "Updated note", reason: "Fixing typo" });

    expect(updated.isEdited).toBe(true);
    const revisions = await prisma.timeEntryRevision.findMany({ where: { timeEntryId: entry.id } });
    expect(revisions).toHaveLength(1);
    expect(revisions[0].version).toBe(1);
    expect(revisions[0].reason).toBe("Fixing typo");
  });

  it("increments the revision version on each subsequent edit", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();
    const entry = await createTestTimeEntry({ userId: employee.id, clientId: client.id, categoryId: category.id });

    await updateTimeEntry(employee, entry.id, { note: "First edit" });
    await updateTimeEntry(employee, entry.id, { note: "Second edit" });

    const revisions = await prisma.timeEntryRevision.findMany({
      where: { timeEntryId: entry.id },
      orderBy: { version: "asc" },
    });
    expect(revisions.map((r) => r.version)).toEqual([1, 2]);
  });

  it("rejects editing an entry's end time to the future (overnight bug-hunt fix)", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();
    const entry = await createTestTimeEntry({ userId: employee.id, clientId: client.id, categoryId: category.id });

    await expect(
      updateTimeEntry(employee, entry.id, { endAt: new Date(Date.now() + 3600_000) })
    ).rejects.toBeInstanceOf(FutureEntryError);
  });

  it("allows a non-time edit (e.g. note) without re-checking the future-date guard", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();
    const entry = await createTestTimeEntry({ userId: employee.id, clientId: client.id, categoryId: category.id });

    // Must not throw FutureEntryError just because time has moved on
    // since the entry was created - only startAt/endAt changes re-check it.
    const updated = await updateTimeEntry(employee, entry.id, { note: "just a note edit" });
    expect(updated.note).toBe("just a note edit");
  });

  it("rejects an edit whose expectedUpdatedAt no longer matches (spec 20 conflict rule)", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();
    const entry = await createTestTimeEntry({ userId: employee.id, clientId: client.id, categoryId: category.id });

    // Someone else's edit lands first...
    await updateTimeEntry(employee, entry.id, { note: "Someone else's change" });

    // ...then this caller, still holding the entry's original updatedAt
    // from before that edit, tries to save on top of it.
    await expect(
      updateTimeEntry(employee, entry.id, {
        note: "My stale change",
        expectedUpdatedAt: entry.updatedAt,
      })
    ).rejects.toBeInstanceOf(ConflictError);

    // The rejected edit must not have been applied.
    const stillThere = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(stillThere.note).toBe("Someone else's change");
  });

  it("allows the edit when expectedUpdatedAt matches the current row (no false-positive conflicts)", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();
    const entry = await createTestTimeEntry({ userId: employee.id, clientId: client.id, categoryId: category.id });

    const updated = await updateTimeEntry(employee, entry.id, {
      note: "First real edit",
      expectedUpdatedAt: entry.updatedAt,
    });
    expect(updated.note).toBe("First real edit");
  });

  it("blocks a self-edit past the window unless the actor has edit_others (spec 6.4)", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();
    const oldEntry = await createTestTimeEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: category.id,
      startAt: new Date(Date.now() - 72 * 3600_000), // 72h ago, past the 48h window
      endAt: new Date(Date.now() - 71 * 3600_000),
    });

    await expect(updateTimeEntry(employee, oldEntry.id, { note: "Too late" })).rejects.toBeInstanceOf(
      EditWindowExpiredError
    );
  });

  it("lets a manager (edit_others) edit past the self-edit window", async () => {
    const { employee, superAdmin, client, category } = await setupEmployeeWithClient();
    const oldEntry = await createTestTimeEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: category.id,
      startAt: new Date(Date.now() - 72 * 3600_000),
      endAt: new Date(Date.now() - 71 * 3600_000),
    });

    const updated = await updateTimeEntry(superAdmin, oldEntry.id, { note: "Manager fix", reason: "Correction" });
    expect(updated.note).toBe("Manager fix");
  });
});

describe("deleteTimeEntry - spec 5.1 soft delete only", () => {
  it("sets deletedAt but keeps the row in the database", async () => {
    const { employee, client, category } = await setupEmployeeWithClient();
    const entry = await createTestTimeEntry({ userId: employee.id, clientId: client.id, categoryId: category.id });

    await deleteTimeEntry(employee, entry.id);

    const row = await prisma.timeEntry.findUnique({ where: { id: entry.id } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).not.toBeNull();
  });
});
