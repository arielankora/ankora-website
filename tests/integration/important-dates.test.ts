import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient } from "./factories";
import {
  createImportantDate,
  updateImportantDate,
  listImportantDates,
  setHolidayCalendarSubscription,
  ConflictError,
} from "@/lib/app-domain/important-dates";
import { seedHolidayOccurrences, createDueReminderOccurrences, createDueAutoTasks } from "@/lib/app-domain/important-dates-job";
import { ForbiddenError } from "@/lib/app-auth/permissions";

// Phase 10 ("מועדים חשובים") integration tests - like every other
// tests/integration/*.test.ts file, these need a real Postgres with
// migrations applied (see tests/integration/setup.ts's header) and the
// generated Prisma Client, neither of which is available in this
// sandbox (see docs/adr/0001, "Known limitations" - the same
// binaries.prisma.sh network block that stops `prisma generate`). They
// run normally on Vercel's Preview build / CI, same as every prior
// phase's integration suite.

describe("important-dates: client scoping (same precedent as tasks.ts)", () => {
  it("blocks an employee not assigned to the client from creating a date for it", async () => {
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const client = await createTestClient();

    await expect(
      createImportantDate(employee, {
        clientId: client.id,
        title: "יום הולדת",
        type: "יום הולדת",
        category: "PEOPLE_FAMILY",
        month: 5,
        day: 12,
        responsibleUserId: employee.id,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows an admin (canManageClients) to create a date for any active client", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: responsible } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const client = await createTestClient();

    const date = await createImportantDate(admin, {
      clientId: client.id,
      title: "פג תוקף דרכון",
      type: "פג תוקף דרכון",
      category: "DOCUMENTS_AUTHORITIES",
      month: 3,
      day: 1,
      responsibleUserId: responsible.id,
    });

    expect(date.clientId).toBe(client.id);
    expect(date.nextOccurrenceAt).not.toBeNull();
  });
});

describe("important-dates: default reminders per category", () => {
  it("creates ReminderRule rows from DEFAULT_REMINDER_OFFSETS_BY_CATEGORY when useDefaultReminders is not disabled", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient();

    const date = await createImportantDate(admin, {
      clientId: client.id,
      title: "חידוש ביטוח רכב",
      type: "חידוש ביטוח רכב",
      category: "VEHICLE_PROPERTY",
      month: 6,
      day: 1,
      responsibleUserId: admin.id,
    });

    const rules = await prisma.reminderRule.findMany({ where: { importantDateId: date.id } });
    expect(rules.length).toBeGreaterThan(0); // VEHICLE_PROPERTY defaults to [30, 7]
    expect(rules.map((r) => r.daysBefore).sort((a, b) => a - b)).toEqual([7, 30]);
  });

  it("creates no ReminderRule rows when useDefaultReminders is explicitly disabled", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient();

    const date = await createImportantDate(admin, {
      clientId: client.id,
      title: "מועד ללא תזכורות",
      type: "מועד כללי",
      category: "GENERAL",
      month: 6,
      day: 1,
      responsibleUserId: admin.id,
      useDefaultReminders: false,
    });

    const rules = await prisma.reminderRule.findMany({ where: { importantDateId: date.id } });
    expect(rules).toHaveLength(0);
  });
});

describe("important-dates: sensitivity default + redaction (spec: medical dates default to Sensitive)", () => {
  it("defaults a HEALTH_TRAVEL date to SENSITIVE unless overridden", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient();

    const date = await createImportantDate(admin, {
      clientId: client.id,
      title: "בדיקה תקופתית",
      type: "בדיקה תקופתית",
      category: "HEALTH_TRAVEL",
      month: 6,
      day: 1,
      responsibleUserId: admin.id,
      notes: "פרטים רגילים ללא מספרי מסמך",
    });

    expect(date.sensitivity).toBe("SENSITIVE");
  });

  it("redacts notes for a SENSITIVE date from a non-admin, non-responsible caller", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: responsible } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: otherEmployee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const client = await createTestClient();
    await prisma.userClientAccess.createMany({
      data: [
        { userId: responsible.id, clientId: client.id },
        { userId: otherEmployee.id, clientId: client.id },
      ],
    });

    await createImportantDate(admin, {
      clientId: client.id,
      title: "בדיקה תקופתית",
      type: "בדיקה תקופתית",
      category: "HEALTH_TRAVEL",
      month: 6,
      day: 1,
      responsibleUserId: responsible.id,
      notes: "רגיש - לא לחשוף",
    });

    const asOther = await listImportantDates(otherEmployee, { clientId: client.id });
    expect(asOther[0].notes).toBeNull();

    const asResponsible = await listImportantDates(responsible, { clientId: client.id });
    expect(asResponsible[0].notes).toBe("רגיש - לא לחשוף");
  });
});

describe("important-dates: optimistic concurrency (Phase 7 pattern)", () => {
  it("rejects an update whose expectedUpdatedAt no longer matches the row", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient();

    const date = await createImportantDate(admin, {
      clientId: client.id,
      title: "מועד לבדיקה",
      type: "מועד כללי",
      category: "GENERAL",
      month: 6,
      day: 1,
      responsibleUserId: admin.id,
    });

    const staleTimestamp = new Date(date.updatedAt.getTime() - 60_000);

    await expect(updateImportantDate(admin, date.id, { title: "כותרת חדשה", expectedUpdatedAt: staleTimestamp })).rejects.toBeInstanceOf(
      ConflictError
    );
  });
});

describe("important-dates: holiday-calendar subscription requires important_date.manage_catalog", () => {
  it("blocks an ANKORA_ADMIN (no manage_catalog permission) from subscribing a client", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient();

    await expect(setHolidayCalendarSubscription(admin, client.id, "il_holidays", { enabled: true })).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });

  it("allows a SUPER_ADMIN to subscribe a client", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const client = await createTestClient();

    const sub = await setHolidayCalendarSubscription(superAdmin, client.id, "il_holidays", { enabled: true });
    expect(sub.enabled).toBe(true);
  });
});

describe("important-dates-job: idempotency (spec: never create the same holiday/reminder/task twice)", () => {
  it("subscribing seeds holidays immediately (no need to wait for the daily cron), and a subsequent sweep never creates duplicates", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const client = await createTestClient();

    // setHolidayCalendarSubscription() itself seeds immediately now
    // (Ariel follow-up request) - no explicit seedHolidayOccurrences()
    // call needed here to see the rows show up.
    await setHolidayCalendarSubscription(superAdmin, client.id, "il_holidays", { enabled: true, responsibleUserId: superAdmin.id });

    const rowsAfterSubscribe = await prisma.importantDate.findMany({ where: { clientId: client.id, source: "HOLIDAY" } });
    expect(rowsAfterSubscribe.length).toBeGreaterThan(0);

    // A subsequent sweep (the daily cron's own unscoped call) must never
    // create duplicates - the @@unique([clientId, holidayKey]) constraint
    // is what actually guarantees this, not the scoping itself.
    const rerun = await seedHolidayOccurrences(new Date());
    expect(rerun.created).toBe(0);

    const rows = await prisma.importantDate.findMany({ where: { clientId: client.id, source: "HOLIDAY" } });
    const keys = rows.map((r) => r.holidayKey);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate holidayKey per client
  });

  it("seedHolidayOccurrences() scoped to one clientId+calendarKey never touches another client's subscription", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const clientA = await createTestClient();
    const clientB = await createTestClient();

    // Bypass the immediate-seed side effect of setHolidayCalendarSubscription()
    // here by inserting the subscription rows directly, so this test
    // isolates seedHolidayOccurrences()'s own scoping logic.
    await prisma.holidayCalendarSubscription.createMany({
      data: [
        { clientId: clientA.id, calendarKey: "il_holidays", enabled: true, defaultReminderDaysBefore: [30, 7], responsibleUserId: superAdmin.id, createTasks: false },
        { clientId: clientB.id, calendarKey: "il_holidays", enabled: true, defaultReminderDaysBefore: [30, 7], responsibleUserId: superAdmin.id, createTasks: false },
      ],
    });

    const result = await seedHolidayOccurrences(new Date(), { clientId: clientA.id, calendarKey: "il_holidays" });
    expect(result.created).toBeGreaterThan(0);

    const clientARows = await prisma.importantDate.findMany({ where: { clientId: clientA.id, source: "HOLIDAY" } });
    const clientBRows = await prisma.importantDate.findMany({ where: { clientId: clientB.id, source: "HOLIDAY" } });
    expect(clientARows.length).toBeGreaterThan(0);
    expect(clientBRows).toHaveLength(0); // scoped call must never seed an unrelated client
  });

  it("createDueReminderOccurrences() run twice never creates duplicate ReminderOccurrence rows", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient();
    const date = await createImportantDate(admin, {
      clientId: client.id,
      title: "מועד עם תזכורת",
      type: "מועד כללי",
      category: "GENERAL",
      month: new Date().getUTCMonth() + 1,
      day: new Date().getUTCDate(),
      responsibleUserId: admin.id,
    });
    expect(date.nextOccurrenceAt).not.toBeNull();

    const now = date.nextOccurrenceAt!;
    const first = await createDueReminderOccurrences(now);
    expect(first.created).toBeGreaterThan(0);

    const second = await createDueReminderOccurrences(now);
    expect(second.created).toBe(0); // idempotencyKey unique constraint blocks the duplicate

    const occurrences = await prisma.reminderOccurrence.findMany({ where: { importantDateId: date.id } });
    const keys = occurrences.map((o) => o.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("createDueAutoTasks() run twice never creates duplicate Task rows for the same occurrence", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient();
    const date = await createImportantDate(admin, {
      clientId: client.id,
      title: "מועד עם משימה אוטומטית",
      type: "מועד כללי",
      category: "GENERAL",
      month: new Date().getUTCMonth() + 1,
      day: new Date().getUTCDate(),
      responsibleUserId: admin.id,
      createAutoTask: true,
      autoTaskLeadDays: 0,
    });

    const now = date.nextOccurrenceAt!;
    const first = await createDueAutoTasks(now);
    expect(first.created).toBe(1);

    const second = await createDueAutoTasks(now);
    expect(second.created).toBe(0); // @@unique([importantDateId, importantDateOccurrenceKey]) blocks the duplicate

    const tasks = await prisma.task.findMany({ where: { importantDateId: date.id } });
    expect(tasks).toHaveLength(1);
  });
});
