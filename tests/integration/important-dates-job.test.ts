import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient, createTestClientUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import {
  updateImportantDateStatus,
  snoozeImportantDate,
  deleteImportantDate,
  addReminderRule,
  removeReminderRule,
} from "@/lib/app-domain/important-dates";
import {
  recomputeOccurrences,
  flagOverdueDates,
  sendPendingReminders,
  escalateUnhandledReminders,
  reconcileImportantDates,
} from "@/lib/app-domain/important-dates-job";
import type { User, ImportantDateStatus, RecurrenceType } from "@prisma/client";

// The important-dates daily job (lib/app-domain/important-dates-job.ts)
// runs from the 05:00 UTC alerts-reconcile cron with nobody watching. What
// a person notices is: did the reminder arrive, on the right Israeli day,
// exactly once, to the right people - and did it stay quiet for a date
// that was handled, paused, snoozed or deleted. Escalation is the one step
// that mails people other than the date's owner, so who it reaches is
// checked explicitly.
//
// tests/integration/important-dates.test.ts already covers create/update,
// sensitivity, holiday seeding and the createDue* steps' raw idempotency;
// this file covers the rest of the job and the important-dates.ts writes
// that file does not touch (status, snooze, delete, reminder rules).
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(),
}));
import { sendEmail } from "@/lib/email";

beforeEach(() => {
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue({ ok: true, providerMessageId: "msg" });
});

const DAY = 86_400_000;
/// The cron's own time of day: 05:00 UTC (08:00 IDT / 07:00 IST).
function cronAt(isoDate: string) {
  return new Date(`${isoDate}T05:00:00Z`);
}

// 1 November 2026 in Israel is already winter time (the clocks go back on
// 25 October), so Israeli midnight is 22:00 UTC the evening before. The
// seven-day reminder window therefore opens across the DST change.
const NOV_1_ISRAEL = new Date("2026-10-31T22:00:00Z");

/// Inserts an ImportantDate with an explicit nextOccurrenceAt. Deliberately
/// bypasses createImportantDate(), which computes the occurrence from the
/// real clock - these tests need the job's own `now` to be the only clock.
async function createDate(opts: {
  clientId: string;
  responsibleUserId: string;
  title?: string;
  month?: number;
  day?: number;
  recurrence?: RecurrenceType;
  nextOccurrenceAt?: Date;
  status?: ImportantDateStatus;
  extraEmailRecipients?: string[];
  rules?: Array<{
    daysBefore: number;
    sendInApp?: boolean;
    sendEmail?: boolean;
    escalateToManager?: boolean;
    escalateAfterDays?: number | null;
    extraAnkoraRecipients?: string[];
  }>;
}) {
  return prisma.importantDate.create({
    data: {
      clientId: opts.clientId,
      title: opts.title ?? "חידוש ביטוח רכב",
      type: "חידוש ביטוח רכב",
      category: "VEHICLE_PROPERTY",
      month: opts.month ?? 11,
      day: opts.day ?? 1,
      recurrence: opts.recurrence ?? "ANNUAL",
      responsibleUserId: opts.responsibleUserId,
      additionalUserIds: [],
      extraEmailRecipients: opts.extraEmailRecipients ?? [],
      status: opts.status ?? "ACTIVE",
      nextOccurrenceAt: opts.nextOccurrenceAt ?? NOV_1_ISRAEL,
      reminderRules: {
        create: (opts.rules ?? [{ daysBefore: 7 }]).map((r) => ({
          daysBefore: r.daysBefore,
          sendInApp: r.sendInApp ?? true,
          sendEmail: r.sendEmail ?? false,
          escalateToManager: r.escalateToManager ?? false,
          escalateAfterDays: r.escalateAfterDays ?? null,
          extraAnkoraRecipients: r.extraAnkoraRecipients ?? [],
          clientRecipients: [],
        })),
      },
    },
    include: { reminderRules: true },
  });
}

async function setup() {
  const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN", email: "boss@ankora.test" });
  const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN", email: "ops-admin@ankora.test" });
  const { user: owner } = await createTestUser({ role: "ANKORA_EMPLOYEE", email: "owner@ankora.test" });
  const { user: bystander } = await createTestUser({ role: "ANKORA_EMPLOYEE", email: "bystander@ankora.test" });
  const client = await createTestClient({ name: "Client Delta" });
  await prisma.userClientAccess.create({ data: { userId: owner.id, clientId: client.id } });
  return { superAdmin, admin, owner, bystander, client };
}

function emailsTo(address: string) {
  return vi.mocked(sendEmail).mock.calls.map(([i]) => i).filter((i) => i.to.includes(address));
}

describe("sendPendingReminders() via reconcileImportantDates() - once, on the right Israeli day, to the date's people", () => {
  it("does not remind on the eighth day before, reminds on the seventh, across the DST change", async () => {
    const { owner, client } = await setup();
    await createDate({ clientId: client.id, responsibleUserId: owner.id, rules: [{ daysBefore: 7, sendInApp: true, sendEmail: true }] });

    // 24.10 in Israel: eight days before 1.11.
    const early = await reconcileImportantDates(cronAt("2026-10-24"));
    expect(early.remindersSent).toBe(0);
    expect(await prisma.reminderOccurrence.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();

    // 25.10 in Israel: seven days before (and the night the clocks change).
    const due = await reconcileImportantDates(cronAt("2026-10-25"));
    expect(due.errors).toEqual([]);
    expect(due.remindersSent).toBe(2); // one in-app, one email

    const [notification] = await prisma.notification.findMany();
    expect(notification.userId).toBe(owner.id);
    // The date a person reads is the Israeli one, not 31/10 (its UTC date).
    expect(notification.body).toContain("01/11/2026");
    expect(notification.body).toContain("בעוד 7 ימים");
  });

  it("sends each reminder exactly once across repeated cron runs", async () => {
    const { owner, client } = await setup();
    await createDate({ clientId: client.id, responsibleUserId: owner.id, rules: [{ daysBefore: 7, sendInApp: true, sendEmail: true }] });

    await reconcileImportantDates(cronAt("2026-10-25"));
    await reconcileImportantDates(cronAt("2026-10-25"));
    await reconcileImportantDates(cronAt("2026-10-26"));

    expect(await prisma.notification.count()).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(await prisma.reminderOccurrence.count({ where: { status: "SENT" } })).toBe(2);
  });

  it("emails the owner plus the date's and rule's extra recipients, and nobody else", async () => {
    const { owner, client } = await setup();
    await createTestClientUser({ clientId: client.id, role: "ADMIN", email: "client-admin@delta.example" });
    await createDate({
      clientId: client.id,
      responsibleUserId: owner.id,
      extraEmailRecipients: ["assistant@ankora.test"],
      rules: [{ daysBefore: 7, sendInApp: false, sendEmail: true, extraAnkoraRecipients: ["ops@ankora.test"] }],
    });

    await reconcileImportantDates(cronAt("2026-10-25"));

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [email] = vi.mocked(sendEmail).mock.calls[0];
    expect([...email.to].sort()).toEqual(["assistant@ankora.test", "ops@ankora.test", "owner@ankora.test"]);
    expect(email.subject).toContain("Client Delta");
  });

  it("retries a failed email on the next run, and gives up after five attempts", async () => {
    const { owner, client } = await setup();
    await createDate({ clientId: client.id, responsibleUserId: owner.id, rules: [{ daysBefore: 7, sendInApp: false, sendEmail: true }] });

    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, error: "provider down" });
    await reconcileImportantDates(cronAt("2026-10-25"));
    let occ = await prisma.reminderOccurrence.findFirstOrThrow();
    expect(occ.status).toBe("FAILED");
    expect(occ.error).toBe("provider down");

    // Next day the provider is back: the same reminder goes out, once.
    await reconcileImportantDates(cronAt("2026-10-26"));
    occ = await prisma.reminderOccurrence.findFirstOrThrow();
    expect(occ.status).toBe("SENT");
    expect(occ.attempts).toBe(2);
    expect(sendEmail).toHaveBeenCalledTimes(2);

    // A permanently failing address stops being hammered after 5 tries.
    // Start over with a fresh occurrence that never succeeds.
    await prisma.reminderOccurrence.deleteMany();
    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendEmail).mockResolvedValue({ ok: false, error: "bounced" });
    await reconcileImportantDates(cronAt("2026-10-25")); // creates it, attempt 1
    for (let i = 1; i < 8; i++) await sendPendingReminders(new Date(cronAt("2026-10-25").getTime() + i * DAY));
    expect(sendEmail).toHaveBeenCalledTimes(5);
    occ = await prisma.reminderOccurrence.findFirstOrThrow();
    expect(occ.attempts).toBe(5);
    expect(occ.status).toBe("FAILED");
  });

  it("creates no reminders for a PAUSED or ARCHIVED date, or a deleted one", async () => {
    const { owner, client } = await setup();
    await createDate({ clientId: client.id, responsibleUserId: owner.id, status: "PAUSED", rules: [{ daysBefore: 7, sendEmail: true }] });
    await createDate({ clientId: client.id, responsibleUserId: owner.id, status: "ARCHIVED", rules: [{ daysBefore: 7, sendEmail: true }] });
    const deleted = await createDate({ clientId: client.id, responsibleUserId: owner.id, rules: [{ daysBefore: 7, sendEmail: true }] });
    await deleteImportantDate(owner, deleted.id);

    const result = await reconcileImportantDates(cronAt("2026-10-25"));

    expect(result.remindersCreated).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  // PRODUCT BUG (found 2026-10-07): sendPendingReminders() never re-checks
  // the date it is reminding about. A reminder whose email failed is
  // retried on the following runs even after the date was deleted (or
  // paused/archived), so the owner and every extra recipient get
  // "תזכורת: ..." for a date somebody removed on purpose.
  it.fails("does not retry a failed reminder once its date has been deleted", async () => {
    const { owner, client } = await setup();
    const date = await createDate({ clientId: client.id, responsibleUserId: owner.id, rules: [{ daysBefore: 7, sendInApp: false, sendEmail: true }] });
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, error: "provider down" });
    await reconcileImportantDates(cronAt("2026-10-25"));

    await deleteImportantDate(owner, date.id);
    vi.mocked(sendEmail).mockClear();
    await reconcileImportantDates(cronAt("2026-10-26"));

    expect(sendEmail).not.toHaveBeenCalled();
  });

  // PRODUCT BUG (found 2026-10-07): marking a date "טופל למופע הנוכחי"
  // (HANDLED_CURRENT) does not stop that same occurrence's remaining
  // reminders - createDueReminderOccurrences() only skips ARCHIVED/PAUSED.
  // The doc comment on updateImportantDateStatus() describes HANDLED_CURRENT
  // as suppressing reminders until the next occurrence. User impact: the
  // owner handles the insurance renewal after the 7-day reminder and is
  // still told "מחר" the day before.
  it.fails("stays quiet for the rest of an occurrence once it is marked handled", async () => {
    const { owner, client } = await setup();
    const date = await createDate({ clientId: client.id, responsibleUserId: owner.id, rules: [{ daysBefore: 7 }, { daysBefore: 1 }] });
    await reconcileImportantDates(cronAt("2026-10-25"));
    expect(await prisma.notification.count()).toBe(1);

    await updateImportantDateStatus(owner, date.id, "HANDLED_CURRENT");
    await reconcileImportantDates(cronAt("2026-10-31"));

    expect(await prisma.notification.count()).toBe(1);
  });

  // PRODUCT BUG (found 2026-10-07): snoozeImportantDate() stores
  // snoozedUntil, but nothing in the daily job reads it (grep: the column is
  // only ever written). The date page offers "דחיית טיפול (Snooze)", the
  // user picks a date, and the reminders arrive anyway.
  it.fails("does not remind while the date is snoozed", async () => {
    const { owner, client } = await setup();
    const date = await createDate({ clientId: client.id, responsibleUserId: owner.id, rules: [{ daysBefore: 7, sendInApp: true, sendEmail: true }] });
    await snoozeImportantDate(owner, date.id, new Date("2026-10-30T00:00:00Z"));

    await reconcileImportantDates(cronAt("2026-10-25"));

    expect(await prisma.notification.count()).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  // PRODUCT BUG (found 2026-10-07): the reminder idempotency key is
  // (date, rule, occurrenceYear, channel) - built for ANNUAL dates. A
  // MONTHLY date has twelve occurrences in a year that all share one key,
  // so only the first month of each year is ever reminded; every later
  // month hits the unique constraint and is silently skipped. The same
  // year-only key is used for auto-created tasks (buildAutoTaskOccurrenceKey),
  // so a monthly auto-task is created once a year too.
  it.fails("reminds about a MONTHLY date every month, not only the first month of the year", async () => {
    const { owner, client } = await setup();
    // 15.10.2026 in Israel (IDT): 14.10 21:00 UTC.
    await createDate({
      clientId: client.id,
      responsibleUserId: owner.id,
      recurrence: "MONTHLY",
      day: 15,
      month: 10,
      nextOccurrenceAt: new Date("2026-10-14T21:00:00Z"),
      rules: [{ daysBefore: 1 }],
    });

    await reconcileImportantDates(cronAt("2026-10-14"));
    expect(await prisma.notification.count()).toBe(1);

    // Next month: the job rolls the date forward to 15.11, then should
    // remind the day before, as it did in October.
    await reconcileImportantDates(cronAt("2026-11-14"));
    expect(await prisma.notification.count()).toBe(2);
  });
});

describe("escalateUnhandledReminders() - only after the configured delay, only to Ankora admins, once", () => {
  async function escalatingDate() {
    const ctx = await setup();
    await createTestClientUser({ clientId: ctx.client.id, role: "ADMIN", email: "client-admin@delta.example" });
    const date = await createDate({
      clientId: ctx.client.id,
      responsibleUserId: ctx.owner.id,
      rules: [{ daysBefore: 7, sendInApp: false, sendEmail: true, escalateToManager: true, escalateAfterDays: 2 }],
    });
    await reconcileImportantDates(cronAt("2026-10-25")); // the reminder itself
    vi.mocked(sendEmail).mockClear();
    return { ...ctx, date };
  }

  it("does not escalate before escalateAfterDays have passed since the reminder", async () => {
    await escalatingDate();
    const result = await reconcileImportantDates(cronAt("2026-10-26"));
    expect(result.escalated).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("escalates once, to SUPER_ADMIN and ANKORA_ADMIN only, after the delay", async () => {
    await escalatingDate();

    const result = await reconcileImportantDates(cronAt("2026-10-27"));
    expect(result.escalated).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [email] = vi.mocked(sendEmail).mock.calls[0];
    expect([...email.to].sort()).toEqual(["boss@ankora.test", "ops-admin@ankora.test"]);
    // Not the owner, not another employee, never the client.
    expect(email.to).not.toContain("owner@ankora.test");
    expect(email.to).not.toContain("bystander@ankora.test");
    expect(email.to).not.toContain("client-admin@delta.example");
    expect(email.subject).toContain("Client Delta");

    // Same day again: nothing new.
    await reconcileImportantDates(cronAt("2026-10-27"));
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not escalate a date that was handled in the meantime", async () => {
    const { owner, date } = await escalatingDate();
    await updateImportantDateStatus(owner, date.id, "HANDLED_CURRENT");

    const result = await escalateUnhandledReminders(cronAt("2026-10-27"));
    expect(result.escalated).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  // PRODUCT BUG (found 2026-10-07): the escalation is stored as a SENT
  // EMAIL ReminderOccurrence under the same rule, so the next run treats
  // the escalation itself as a reminder to escalate (key
  // "...:escalation:escalation"), and so on every escalateAfterDays until
  // someone handles the date. The comment above the idempotency check says
  // the escalation row exists precisely to make it happen once.
  it.fails("escalates a reminder only once, not again every escalateAfterDays", async () => {
    await escalatingDate();
    await reconcileImportantDates(cronAt("2026-10-27"));
    await reconcileImportantDates(cronAt("2026-10-29"));
    await reconcileImportantDates(cronAt("2026-10-31"));
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  // PRODUCT BUG (found 2026-10-07): escalation does not check deletedAt,
  // so deleting a date after its reminder still mails every admin
  // "הסלמה: ..." about it.
  it.fails("does not escalate a date that was deleted after its reminder", async () => {
    const { owner, date } = await escalatingDate();
    await deleteImportantDate(owner, date.id);
    await reconcileImportantDates(cronAt("2026-10-27"));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  // PRODUCT BUG (found 2026-10-07): getAdminEmails() selects by role only,
  // never by status, so an admin whose account was SUSPENDED or ARCHIVED
  // (someone who left Ankora) keeps receiving escalation emails naming
  // clients and their dates.
  it.fails("does not send escalations to a suspended or archived admin", async () => {
    const ctx = await escalatingDate();
    await prisma.user.update({ where: { id: ctx.admin.id }, data: { status: "ARCHIVED" } });

    await reconcileImportantDates(cronAt("2026-10-27"));

    const [email] = vi.mocked(sendEmail).mock.calls[0];
    expect(email.to).toEqual(["boss@ankora.test"]);
  });
});

describe("recomputeOccurrences() / flagOverdueDates() - the date moves on, and an unhandled one is flagged", () => {
  it("flags an ACTIVE date on its own Israeli day, then rolls it to next year the day after", async () => {
    const { owner, client } = await setup();
    const date = await createDate({ clientId: client.id, responsibleUserId: owner.id, rules: [] });

    // 1.11 at 07:00 Israel: the occurrence is today, not "next year" yet.
    await reconcileImportantDates(cronAt("2026-11-01"));
    let row = await prisma.importantDate.findUniqueOrThrow({ where: { id: date.id } });
    expect(row.status).toBe("NEEDS_ATTENTION");
    expect(row.nextOccurrenceAt?.toISOString()).toBe(NOV_1_ISRAEL.toISOString());

    await reconcileImportantDates(cronAt("2026-11-02"));
    row = await prisma.importantDate.findUniqueOrThrow({ where: { id: date.id } });
    expect(row.nextOccurrenceAt?.toISOString()).toBe("2027-10-31T22:00:00.000Z"); // 1.11.2027, Israeli midnight
    expect(row.status).toBe("NEEDS_ATTENTION"); // still nobody handled it
  });

  it("returns a HANDLED_CURRENT date to ACTIVE once its handled occurrence is behind it", async () => {
    const { owner, client } = await setup();
    const date = await createDate({ clientId: client.id, responsibleUserId: owner.id, rules: [] });
    await updateImportantDateStatus(owner, date.id, "HANDLED_CURRENT");

    const { updated } = await recomputeOccurrences(cronAt("2026-11-02"));
    expect(updated).toBe(1);
    const row = await prisma.importantDate.findUniqueOrThrow({ where: { id: date.id } });
    expect(row.status).toBe("ACTIVE");
    expect(row.nextOccurrenceAt?.toISOString()).toBe("2027-10-31T22:00:00.000Z");
  });

  it("never moves a ONCE, PAUSED, ARCHIVED or deleted date, and never flags IN_PROGRESS or ONCE", async () => {
    const { owner, client } = await setup();
    const past = new Date("2026-10-01T21:00:00Z");
    const once = await createDate({ clientId: client.id, responsibleUserId: owner.id, recurrence: "ONCE", nextOccurrenceAt: past, rules: [] });
    const paused = await createDate({ clientId: client.id, responsibleUserId: owner.id, status: "PAUSED", nextOccurrenceAt: past, rules: [] });
    const archived = await createDate({ clientId: client.id, responsibleUserId: owner.id, status: "ARCHIVED", nextOccurrenceAt: past, rules: [] });
    const inProgress = await createDate({ clientId: client.id, responsibleUserId: owner.id, status: "IN_PROGRESS", nextOccurrenceAt: past, rules: [] });
    const deleted = await createDate({ clientId: client.id, responsibleUserId: owner.id, nextOccurrenceAt: past, rules: [] });
    await prisma.importantDate.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

    const now = cronAt("2026-10-10");
    const { flagged } = await flagOverdueDates(now);
    expect(flagged).toBe(0);
    await recomputeOccurrences(now);

    const rows = await prisma.importantDate.findMany({ where: { id: { in: [once.id, paused.id, archived.id, deleted.id] } } });
    for (const r of rows) expect(r.nextOccurrenceAt?.toISOString()).toBe(past.toISOString());
    const statuses = Object.fromEntries(
      (await prisma.importantDate.findMany({ where: { id: { in: [once.id, inProgress.id] } } })).map((r) => [r.id, r.status])
    );
    expect(statuses[once.id]).toBe("ACTIVE");
    expect(statuses[inProgress.id]).toBe("IN_PROGRESS");
  });
});

describe("important-dates.ts writes - status, snooze, delete, reminder rules are scoped to the date's client", () => {
  async function scoped() {
    const ctx = await setup();
    const date = await createDate({ clientId: ctx.client.id, responsibleUserId: ctx.owner.id });
    const { user: clientUser } = await createTestClientUser({ clientId: ctx.client.id, role: "ADMIN" });
    return { ...ctx, date, clientUser };
  }

  it("rejects an employee without access to the client, and a client user, on every write", async () => {
    const { bystander, clientUser, date } = await scoped();
    const ruleId = date.reminderRules[0].id;

    for (const actor of [bystander, clientUser] as User[]) {
      await expect(updateImportantDateStatus(actor, date.id, "ARCHIVED")).rejects.toThrow(ForbiddenError);
      await expect(snoozeImportantDate(actor, date.id, new Date("2026-12-01"))).rejects.toThrow(ForbiddenError);
      await expect(deleteImportantDate(actor, date.id)).rejects.toThrow(ForbiddenError);
      await expect(addReminderRule(actor, date.id, { daysBefore: 3, sendEmail: true })).rejects.toThrow(ForbiddenError);
      await expect(removeReminderRule(actor, ruleId)).rejects.toThrow(ForbiddenError);
    }

    const row = await prisma.importantDate.findUniqueOrThrow({ where: { id: date.id }, include: { reminderRules: true } });
    expect(row.status).toBe("ACTIVE");
    expect(row.snoozedUntil).toBeNull();
    expect(row.deletedAt).toBeNull();
    expect(row.reminderRules.map((r) => r.id)).toEqual([ruleId]);
  });

  it("an employee with access to another client cannot touch this client's date", async () => {
    const { owner, client } = await setup();
    const other = await createTestClient({ name: "Other Client" });
    const { user: otherOwner } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.userClientAccess.create({ data: { userId: otherOwner.id, clientId: other.id } });
    const date = await createDate({ clientId: client.id, responsibleUserId: owner.id });

    await expect(updateImportantDateStatus(otherOwner, date.id, "HANDLED_CURRENT")).rejects.toThrow(ForbiddenError);
    await expect(addReminderRule(otherOwner, date.id, { daysBefore: 1 })).rejects.toThrow(ForbiddenError);
  });

  it("status changes record what was handled and when it was archived, and audit the change", async () => {
    const { owner, date } = await scoped();

    const handled = await updateImportantDateStatus(owner, date.id, "HANDLED_CURRENT");
    expect(handled.currentOccurrenceAt?.toISOString()).toBe(NOV_1_ISRAEL.toISOString());

    const archived = await updateImportantDateStatus(owner, date.id, "ARCHIVED");
    expect(archived.archivedAt).not.toBeNull();

    const restored = await updateImportantDateStatus(owner, date.id, "ACTIVE");
    expect(restored.archivedAt).toBeNull();

    expect(await prisma.auditEvent.count({ where: { action: "important_date.status_change", entityId: date.id } })).toBe(3);
  });

  it("delete is a soft delete, and a deleted date can no longer be changed", async () => {
    const { owner, date } = await scoped();
    await deleteImportantDate(owner, date.id);

    const row = await prisma.importantDate.findUniqueOrThrow({ where: { id: date.id } });
    expect(row.deletedAt).not.toBeNull();
    await expect(updateImportantDateStatus(owner, date.id, "ACTIVE")).rejects.toThrow("Important date not found.");
    await expect(addReminderRule(owner, date.id, { daysBefore: 1 })).rejects.toThrow("Important date not found.");
  });

  it("a rule added by the owner is used by the next run, and a removed rule is not", async () => {
    const { owner, date } = await scoped();
    const added = await addReminderRule(owner, date.id, { daysBefore: 3, sendInApp: true });
    expect(added.escalateToManager).toBe(false);
    await removeReminderRule(owner, date.reminderRules[0].id); // the 7-day rule

    await reconcileImportantDates(cronAt("2026-10-25")); // 7 days before: removed rule, nothing
    expect(await prisma.notification.count()).toBe(0);
    await reconcileImportantDates(cronAt("2026-10-29")); // 3 days before
    expect(await prisma.notification.count()).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: { in: ["reminder_rule.create", "reminder_rule.delete"] } } })).toBe(2);
  });
});
