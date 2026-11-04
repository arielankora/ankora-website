import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient, createTestCategory, createTestTimeEntry } from "./factories";
import {
  openHourBankCycle,
  recordHourBankAdjustment,
  loadPrepaidPackage,
  readOnlyUtilization,
} from "@/lib/app-domain/hour-banks";
import {
  countOpenAlertEvents,
  ensureDefaultAlertRules,
  evaluateAlertsForClient,
  listAlertRulesForClient,
  listOpenAlertEvents,
  resolveAlertEvent,
} from "@/lib/app-domain/alerts";
import { findAndCloseStaleAlerts } from "@/lib/app-domain/alert-closure";
import { prisma as appPrisma } from "@/lib/prisma";

// 4.11.2026: hour-bank alerts close on their own when a new cycle is opened
// or hours are loaded (lib/app-domain/alert-closure.ts). Same database
// setup as every other tests/integration file.
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
import { sendEmail } from "@/lib/email";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

beforeEach(() => {
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue({ ok: true, providerMessageId: "test-message-id" });
});

/// A client with the two default rules (80% and 100%) and a 100-minute
/// cycle that started ten days ago and ended two hours ago. Still the
/// client's latest bank, so it is the one alerts are evaluated against
/// until a new one is opened.
async function setup() {
  const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
  const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const client = await createTestClient();
  const category = await createTestCategory({ clientId: client.id });
  await ensureDefaultAlertRules(superAdmin, client.id);
  const rules = await prisma.alertRule.findMany({ where: { clientId: client.id } });
  const rule80 = rules.find((r) => r.thresholdValue === 80)!;
  const rule100 = rules.find((r) => r.thresholdValue === 100)!;

  const now = Date.now();
  const bank = await openHourBankCycle(superAdmin, client.id, {
    cycleStart: new Date(now - 10 * DAY),
    cycleEnd: new Date(now - 2 * HOUR),
    purchasedMinutes: 100,
    rolloverMode: "NONE",
  });

  /// Records `minutes` of work ending at `endAt` (by default inside the
  /// first bank).
  async function consume(minutes: number, endAt = new Date(now - 5 * HOUR)) {
    await createTestTimeEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: category.id,
      startAt: new Date(endAt.getTime() - minutes * 60_000),
      endAt,
    });
  }

  async function eventOf(ruleId: string, hourBankId = bank.id) {
    const events = await prisma.alertEvent.findMany({ where: { ruleId, hourBankId }, orderBy: { triggeredAt: "desc" } });
    return events;
  }

  async function openNextCycle() {
    return openHourBankCycle(superAdmin, client.id, {
      cycleStart: new Date(now - 2 * HOUR),
      cycleEnd: new Date(now + 30 * DAY),
      purchasedMinutes: 100,
      rolloverMode: "NONE",
    });
  }

  return { superAdmin, client, bank, rule80, rule100, consume, eventOf, openNextCycle, now };
}

describe("opening a new cycle", () => {
  it("closes the previous cycle's open alerts as 'נפתח מחזור חדש', without deleting them", async () => {
    const t = await setup();
    await t.consume(90);
    await evaluateAlertsForClient(t.client.id);
    const [before] = await t.eventOf(t.rule80.id);
    expect(before.resolvedAt).toBeNull();

    const next = await t.openNextCycle();

    const [after] = await t.eventOf(t.rule80.id);
    expect(after.id).toBe(before.id);
    expect(after.resolvedAt).not.toBeNull();
    expect(after.closeKind).toBe("NEW_CYCLE");
    expect(after.closeReason).toBe("נפתח מחזור חדש");
    expect(await prisma.alertEvent.count()).toBe(1);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "alert_event.auto_close", entityId: next.id } });
    expect(audit).not.toBeNull();
  });

  it("closes the 100% alert too, and a new cycle may fire its own alert again", async () => {
    const t = await setup();
    await t.consume(105);
    await evaluateAlertsForClient(t.client.id);
    expect((await t.eventOf(t.rule100.id))[0].resolvedAt).toBeNull();

    const next = await t.openNextCycle();
    const [closed100] = await t.eventOf(t.rule100.id);
    expect(closed100.closeKind).toBe("NEW_CYCLE");
    // The 80% one had already been superseded, and stays closed.
    const [closed80] = await t.eventOf(t.rule80.id);
    expect(closed80.resolvedAt).not.toBeNull();
    expect(closed80.closeKind).toBe("SUPERSEDED");
    expect(await countOpenAlertEvents()).toBe(0);

    // Crossing 80% again in the new cycle is a new alert.
    await t.consume(85, new Date(t.now - 10 * 60_000));
    await evaluateAlertsForClient(t.client.id);
    const inNext = await t.eventOf(t.rule80.id, next.id);
    expect(inNext).toHaveLength(1);
    expect(inNext[0].resolvedAt).toBeNull();
  });
});

describe("loading hours into an existing bank (a positive adjustment)", () => {
  it("closes both alerts when utilization drops below 80%", async () => {
    const t = await setup();
    await t.consume(105);
    await evaluateAlertsForClient(t.client.id);

    // 105 of 200 minutes: 52.5%.
    await recordHourBankAdjustment(t.superAdmin, t.client.id, { hourBankId: t.bank.id, minutes: 100, reason: "טעינה" });

    const [e100] = await t.eventOf(t.rule100.id);
    const [e80] = await t.eventOf(t.rule80.id);
    expect(e100.resolvedAt).not.toBeNull();
    expect(e100.closeKind).toBe("HOURS_LOADED");
    expect(e100.closeReason).toBe("נטענו שעות לבנק");
    expect(e80.resolvedAt).not.toBeNull();
    expect(await countOpenAlertEvents()).toBe(0);
  });

  it("closes the 100% alert and leaves the 80% one open when utilization stays above 80%", async () => {
    const t = await setup();
    await t.consume(105);
    await evaluateAlertsForClient(t.client.id);
    const [e80Before] = await t.eventOf(t.rule80.id);
    expect(e80Before.closeKind).toBe("SUPERSEDED");

    // 105 of 120 minutes: 87.5%.
    await recordHourBankAdjustment(t.superAdmin, t.client.id, { hourBankId: t.bank.id, minutes: 20, reason: "טעינה" });

    const [e100] = await t.eventOf(t.rule100.id);
    const e80 = await t.eventOf(t.rule80.id);
    expect(e100.closeKind).toBe("HOURS_LOADED");
    // The same 80% event is open again: no second event, no second email.
    expect(e80).toHaveLength(1);
    expect(e80[0].id).toBe(e80Before.id);
    expect(e80[0].resolvedAt).toBeNull();
    expect(e80[0].closeKind).toBeNull();
    expect(await countOpenAlertEvents()).toBe(1);
  });

  it("a debit does not close anything", async () => {
    const t = await setup();
    await t.consume(90);
    await evaluateAlertsForClient(t.client.id);
    await recordHourBankAdjustment(t.superAdmin, t.client.id, { hourBankId: t.bank.id, minutes: -5, reason: "קיזוז" });
    expect((await t.eventOf(t.rule80.id))[0].resolvedAt).toBeNull();
  });
});

describe("loading a prepaid package", () => {
  it("closes the previous bank's open alerts as 'נטענו שעות לבנק'", async () => {
    const t = await setup();
    await t.consume(90);
    await evaluateAlertsForClient(t.client.id);

    const { bank: pkg } = await loadPrepaidPackage(t.superAdmin, t.client.id, {
      startAt: new Date(t.now - 1 * HOUR),
      purchasedMinutes: 600,
    });

    const [e80] = await t.eventOf(t.rule80.id);
    expect(e80.closeKind).toBe("HOURS_LOADED");
    expect(e80.closeReason).toBe("נטענו שעות לבנק");
    // Nothing breached on the new package.
    expect(await prisma.alertEvent.count({ where: { hourBankId: pkg.id } })).toBe(0);
    expect(await countOpenAlertEvents()).toBe(0);
  });
});

describe("one alert per threshold per cycle", () => {
  it("crossing 80% again in the same cycle does not create a second event", async () => {
    const t = await setup();
    await t.consume(90);
    await evaluateAlertsForClient(t.client.id);
    await recordHourBankAdjustment(t.superAdmin, t.client.id, { hourBankId: t.bank.id, minutes: 50, reason: "טעינה" });
    expect((await t.eventOf(t.rule80.id))[0].closeKind).toBe("HOURS_LOADED");

    await recordHourBankAdjustment(t.superAdmin, t.client.id, { hourBankId: t.bank.id, minutes: -50, reason: "ביטול" });
    await evaluateAlertsForClient(t.client.id);
    await evaluateAlertsForClient(t.client.id);

    expect(await t.eventOf(t.rule80.id)).toHaveLength(1);
    expect(await t.eventOf(t.rule100.id)).toHaveLength(0);
  });

  it("an entry that crosses both 80% and 100% leaves only the 100% alert open", async () => {
    const t = await setup();
    await t.consume(110);
    await evaluateAlertsForClient(t.client.id);
    await evaluateAlertsForClient(t.client.id);

    const e80 = await t.eventOf(t.rule80.id);
    const e100 = await t.eventOf(t.rule100.id);
    expect(e80).toHaveLength(1);
    expect(e100).toHaveLength(1);
    expect(e80[0].closeKind).toBe("SUPERSEDED");
    expect(e80[0].closeReason).toBe("נוצרה התראת 100%");
    expect(e100[0].resolvedAt).toBeNull();
  });

  it("when the 100% alert closes under the threshold, the superseded 80% one comes back", async () => {
    const t = await setup();
    await t.consume(105);
    await evaluateAlertsForClient(t.client.id);
    const before = await prisma.emailDelivery.count();

    // A time entry is deleted: 85 of 100 minutes.
    await prisma.timeEntry.deleteMany({ where: { clientId: t.client.id } });
    await t.consume(85);
    await evaluateAlertsForClient(t.client.id);

    expect((await t.eventOf(t.rule100.id))[0].closeKind).toBe("BELOW_THRESHOLD");
    const e80 = await t.eventOf(t.rule80.id);
    expect(e80).toHaveLength(1);
    expect(e80[0].resolvedAt).toBeNull();
    expect(await prisma.emailDelivery.count()).toBe(before);
  });
});

describe("the open-alerts counter and the event history", () => {
  it("does not count auto-closed alerts, and the history shows the reason", async () => {
    const t = await setup();
    await t.consume(90);
    await evaluateAlertsForClient(t.client.id);
    expect(await countOpenAlertEvents()).toBe(1);
    expect(await listOpenAlertEvents()).toHaveLength(1);

    await t.openNextCycle();

    expect(await countOpenAlertEvents()).toBe(0);
    expect(await listOpenAlertEvents()).toHaveLength(0);
    const rules = await listAlertRulesForClient(t.client.id);
    const history = rules.find((r) => r.id === t.rule80.id)!.events;
    expect(history).toHaveLength(1);
    expect(history[0].closeReason).toBe("נפתח מחזור חדש");
  });
});

describe("an alert a person marked as handled", () => {
  it("is not changed by a new cycle, a load or an evaluation", async () => {
    const t = await setup();
    await t.consume(90);
    await evaluateAlertsForClient(t.client.id);
    const [open] = await t.eventOf(t.rule80.id);
    const handled = await resolveAlertEvent(t.superAdmin, open.id);
    expect(handled.closeKind).toBe("MANUAL");

    await recordHourBankAdjustment(t.superAdmin, t.client.id, { hourBankId: t.bank.id, minutes: 50, reason: "טעינה" });
    await recordHourBankAdjustment(t.superAdmin, t.client.id, { hourBankId: t.bank.id, minutes: -50, reason: "ביטול" });
    await evaluateAlertsForClient(t.client.id);
    await t.openNextCycle();

    const after = await prisma.alertEvent.findUniqueOrThrow({ where: { id: open.id } });
    expect(after.closeKind).toBe("MANUAL");
    expect(after.closeReason).toBeNull();
    expect(after.resolvedAt?.getTime()).toBe(handled.resolvedAt?.getTime());
  });
});

describe("findAndCloseStaleAlerts() - the one-time cleanup", () => {
  it("in a dry run reports what would close and writes nothing; with apply, closes it", async () => {
    const t = await setup();
    await t.consume(90);
    // Events as they were left before this change: open, with no close kind.
    const stale = await prisma.alertEvent.create({ data: { ruleId: t.rule80.id, hourBankId: t.bank.id, value: 90 } });
    const next = await prisma.hourBank.create({
      data: {
        clientId: t.client.id,
        cycleStart: new Date(t.now - 2 * HOUR),
        cycleEnd: new Date(t.now + 30 * DAY),
        purchasedMinutes: 100,
      },
    });
    const below = await prisma.alertEvent.create({ data: { ruleId: t.rule80.id, hourBankId: next.id, value: 85 } });
    const manual = await prisma.alertEvent.create({
      data: { ruleId: t.rule100.id, hourBankId: t.bank.id, value: 100, resolvedAt: new Date(), closeKind: "MANUAL" },
    });

    const dry = await findAndCloseStaleAlerts(appPrisma, readOnlyUtilization, { apply: false });
    expect(dry.applied).toBe(false);
    expect(dry.openBefore).toBe(2);
    expect(dry.toClose.NEW_CYCLE).toEqual([stale.id]);
    expect(dry.toClose.BELOW_THRESHOLD).toEqual([below.id]);
    expect(await countOpenAlertEvents()).toBe(2);

    const real = await findAndCloseStaleAlerts(appPrisma, readOnlyUtilization, { apply: true });
    expect(real.applied).toBe(true);
    expect(await countOpenAlertEvents()).toBe(0);
    expect((await prisma.alertEvent.findUniqueOrThrow({ where: { id: stale.id } })).closeReason).toBe("נפתח מחזור חדש");
    expect((await prisma.alertEvent.findUniqueOrThrow({ where: { id: below.id } })).closeKind).toBe("BELOW_THRESHOLD");
    expect((await prisma.alertEvent.findUniqueOrThrow({ where: { id: manual.id } })).closeKind).toBe("MANUAL");
  });
});
