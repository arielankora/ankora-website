import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient, createTestCategory, createTestTimeEntry, createTestClientUser } from "./factories";
import {
  openHourBankCycle,
  loadPrepaidPackage,
  previewPrepaidLoad,
  getCurrentHourBank,
  getCurrentHourBanksForClients,
  getPrepaidForecast,
} from "@/lib/app-domain/hour-banks";
import { runReport } from "@/lib/app-domain/reports";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { addDaysToKey, localDateKey, localDateTimeToUtc } from "@/lib/timezone";

// 12.10.2026 (RIMED): prepaid hour packages. A package is an HourBank of
// kind PREPAID that runs until the next load or its expiry, carries its
// whole balance (an overrun included) into the next package, and is
// measured against the hours loaded.

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
import { sendEmail } from "@/lib/email";

beforeEach(() => {
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue({ ok: true, providerMessageId: "test-message-id" });
});

/// Israel midnight, `n` days ago. Relative to now so the suite does not
/// rot when a fixed date drifts past a one-year expiry.
function israelMidnight(daysAgo: number): Date {
  return localDateTimeToUtc(addDaysToKey(localDateKey(new Date()), -daysAgo), "00:00");
}

async function setup() {
  const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
  const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
  const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const client = await createTestClient({ name: "RIMED" });
  const category = await createTestCategory();
  const work = (startAt: Date, minutes: number) =>
    createTestTimeEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: category.id,
      startAt,
      endAt: new Date(startAt.getTime() + minutes * 60_000),
    });
  return { superAdmin, admin, employee, client, category, work };
}

describe("loadPrepaidPackage: the RIMED move from a cycle to a package", () => {
  it("ends the cycle at the purchase, carries the overrun, and counts every entry once", async () => {
    const { superAdmin, client, work } = await setup();
    const cycleStart = israelMidnight(20);
    const purchase = israelMidnight(1);

    // A 30-hour cycle, overrun by two hours before the purchase.
    await openHourBankCycle(superAdmin, client.id, {
      cycleStart,
      cycleEnd: israelMidnight(-20),
      purchasedMinutes: 1800,
      rolloverMode: "NONE",
    });
    await work(new Date(cycleStart.getTime() + 3600_000), 1920);
    // One entry at the exact instant of the purchase, one after it.
    await work(purchase, 60);
    await work(new Date(purchase.getTime() + 2 * 3600_000), 30);

    const preview = await previewPrepaidLoad(client.id, purchase);
    expect(preview.previous?.balanceMinutes).toBe(-120);
    expect(preview.carryInMinutes).toBe(-120);

    const { bank } = await loadPrepaidPackage(superAdmin, client.id, { startAt: purchase, purchasedMinutes: 1800 });

    expect(bank.kind).toBe("PREPAID");
    expect(bank.rolloverInMinutes).toBe(-120);
    expect(bank.cycleStart.getTime()).toBe(purchase.getTime());
    // One year of validity, Israel midnight.
    const [y, m, d] = localDateKey(purchase).split("-").map(Number);
    expect(localDateKey(bank.cycleEnd)).toBe(`${y + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);

    const banks = await prisma.hourBank.findMany({ where: { clientId: client.id }, orderBy: { cycleStart: "asc" } });
    expect(banks).toHaveLength(2);
    expect(banks[0].status).toBe("CLOSED");
    // The two meet: no gap, no overlap.
    expect(banks[0].cycleEnd.getTime()).toBe(banks[1].cycleStart.getTime());

    const current = await getCurrentHourBank(client.id);
    expect(current?.bank.id).toBe(bank.id);
    // 90 minutes after the purchase, none before it.
    expect(current?.utilization.consumedMinutes).toBe(90);
    // 30 bought, 2 owed, 1.5 used: 26.5 left.
    expect(current?.utilization.remainingMinutes).toBe(1800 - 120 - 90);
    // Of the package: (30 - 26.5) / 30.
    expect(current?.utilization.utilizationPct).toBe(11.7);

    // The batched read gives the same answer.
    const batch = await getCurrentHourBanksForClients([client.id]);
    expect(batch.get(client.id)?.utilization).toEqual(current?.utilization);

    // The closed cycle keeps exactly what happened before the purchase.
    const closed = await getCurrentHourBank(client.id);
    expect(closed).not.toBeNull();
    const audit = await prisma.auditEvent.findFirst({ where: { action: "hour_bank.load_package", entityId: bank.id } });
    expect(audit).not.toBeNull();
  });

  it("a second load carries the whole positive balance of a package still valid", async () => {
    const { superAdmin, client, work } = await setup();
    const first = israelMidnight(10);
    await loadPrepaidPackage(superAdmin, client.id, { startAt: first, purchasedMinutes: 600 });
    await work(new Date(first.getTime() + 3600_000), 120);

    const second = israelMidnight(2);
    const { bank } = await loadPrepaidPackage(superAdmin, client.id, { startAt: second, purchasedMinutes: 1200 });
    expect(bank.rolloverInMinutes).toBe(480);

    const current = await getCurrentHourBank(client.id);
    expect(current?.utilization.totalMinutes).toBe(1680);
    // Carried hours are used first: nothing of the new load is gone yet.
    expect(current?.utilization.utilizationPct).toBe(0);
  });

  it("unused hours of an expired package stay behind; an overrun never does", async () => {
    const { superAdmin, client, work } = await setup();
    const a = israelMidnight(40);
    await loadPrepaidPackage(superAdmin, client.id, { startAt: a, purchasedMinutes: 600, expiresAt: israelMidnight(30) });
    await work(new Date(a.getTime() + 3600_000), 60);
    const { bank: b } = await loadPrepaidPackage(superAdmin, client.id, { startAt: israelMidnight(5), purchasedMinutes: 600 });
    expect(b.rolloverInMinutes).toBe(0);

    const other = await setup();
    const c = israelMidnight(40);
    await loadPrepaidPackage(other.superAdmin, other.client.id, {
      startAt: c,
      purchasedMinutes: 60,
      expiresAt: israelMidnight(30),
    });
    await other.work(new Date(c.getTime() + 3600_000), 90);
    const { bank: d } = await loadPrepaidPackage(other.superAdmin, other.client.id, {
      startAt: israelMidnight(5),
      purchasedMinutes: 600,
    });
    expect(d.rolloverInMinutes).toBe(-30);
  });

  it("refuses what would make the books wrong, and anyone but a super admin", async () => {
    const { superAdmin, admin, client } = await setup();
    await expect(
      loadPrepaidPackage(admin, client.id, { startAt: israelMidnight(1), purchasedMinutes: 600 })
    ).rejects.toThrow(ForbiddenError);
    await expect(
      loadPrepaidPackage(superAdmin, client.id, { startAt: israelMidnight(-2), purchasedMinutes: 600 })
    ).rejects.toThrow("בעתיד");
    await expect(
      loadPrepaidPackage(superAdmin, client.id, { startAt: israelMidnight(1), purchasedMinutes: 0 })
    ).rejects.toThrow();

    await loadPrepaidPackage(superAdmin, client.id, { startAt: israelMidnight(3), purchasedMinutes: 600 });
    await expect(
      loadPrepaidPackage(superAdmin, client.id, { startAt: israelMidnight(3), purchasedMinutes: 600 })
    ).rejects.toThrow("אחרי תחילת");
  });

  it("opening a cycle after a package ends the package there, so 'now' has one bank", async () => {
    const { superAdmin, client } = await setup();
    await loadPrepaidPackage(superAdmin, client.id, { startAt: israelMidnight(10), purchasedMinutes: 600 });
    const cycleStart = israelMidnight(2);
    const cycle = await openHourBankCycle(superAdmin, client.id, {
      cycleStart,
      cycleEnd: israelMidnight(-28),
      purchasedMinutes: 600,
      rolloverMode: "NONE",
    });
    const pkg = await prisma.hourBank.findFirst({ where: { clientId: client.id, kind: "PREPAID" } });
    expect(pkg?.cycleEnd.getTime()).toBe(cycleStart.getTime());
    expect((await getCurrentHourBank(client.id))?.bank.id).toBe(cycle.id);
  });
});

describe("package alerts: 80% of the package loaded, then all of it, once each per load", () => {
  it("fires at 80% of the 30 hours, again at 100%, and again for the next load; never to the client", async () => {
    const { superAdmin, client, work } = await setup();
    // A portal user exists and must not be mailed (Ariel, 12.10.2026).
    const { user: portalUser } = await createTestClientUser({ clientId: client.id });

    const start = israelMidnight(6);
    await loadPrepaidPackage(superAdmin, client.id, { startAt: start, purchasedMinutes: 1800 });
    const rules = await prisma.alertRule.findMany({ where: { clientId: client.id }, orderBy: { thresholdValue: "asc" } });
    expect(rules.map((r) => [r.type, r.thresholdValue])).toEqual([
      ["UTILIZATION_PCT", 80],
      ["UTILIZATION_PCT", 100],
    ]);

    const { evaluateAlertsForClient } = await import("@/lib/app-domain/alerts");

    // 23.98 hours: not yet.
    await work(new Date(start.getTime() + 3600_000), 1439);
    await evaluateAlertsForClient(client.id);
    expect(await prisma.alertEvent.count({ where: { ruleId: rules[0].id } })).toBe(0);

    // 24 hours: 80%.
    await work(new Date(start.getTime() + 2 * 86_400_000), 1);
    await evaluateAlertsForClient(client.id);
    expect(await prisma.alertEvent.count({ where: { ruleId: rules[0].id } })).toBe(1);
    expect(await prisma.alertEvent.count({ where: { ruleId: rules[1].id } })).toBe(0);

    // 30 hours: 100%.
    await work(new Date(start.getTime() + 3 * 86_400_000), 360);
    await evaluateAlertsForClient(client.id);
    expect(await prisma.alertEvent.count({ where: { ruleId: rules[1].id } })).toBe(1);

    const recipients = vi.mocked(sendEmail).mock.calls.flatMap((c) => (c[0] as { to: string[] }).to);
    expect(recipients).not.toContain(portalUser.email);
    const bodies = vi.mocked(sendEmail).mock.calls.map((c) => (c[0] as { text: string }).text).join("\n");
    expect(bodies).toContain("מ-30.00 השעות שנטענו");

    // The next load starts the story again.
    await loadPrepaidPackage(superAdmin, client.id, { startAt: israelMidnight(1), purchasedMinutes: 600 });
    await work(new Date(israelMidnight(1).getTime() + 3600_000), 480);
    await evaluateAlertsForClient(client.id);
    expect(await prisma.alertEvent.count({ where: { ruleId: rules[0].id } })).toBe(2);
  });
});

describe("forecast and reports", () => {
  it("projects when the package runs out from the last four weeks, and the report says so", async () => {
    const { superAdmin, client, work } = await setup();
    await loadPrepaidPackage(superAdmin, client.id, { startAt: israelMidnight(27), purchasedMinutes: 6000 });
    // 40 hours over four weeks: 10 a week.
    for (let i = 0; i < 8; i++) await work(new Date(israelMidnight(26 - i * 3).getTime() + 3600_000), 300);

    const snapshot = await getCurrentHourBank(client.id);
    expect(snapshot?.utilization.remainingMinutes).toBe(3600);
    const forecast = await getPrepaidForecast(snapshot);
    expect(forecast?.status).toBe("projected");
    if (forecast?.status !== "projected") return;
    expect(forecast.weeklyMinutes).toBe(600);
    expect(forecast.daysLeft).toBe(42);

    const report = await runReport(superAdmin, "hours_by_client", { clientId: client.id });
    expect(report.rows[0]).toMatchObject({ client: "RIMED", kind: "חבילה" });
    expect(String(report.rows[0].forecast)).toMatch(/\d{4}/);
  });

  it("a cycle has no forecast", async () => {
    const { superAdmin, client } = await setup();
    await openHourBankCycle(superAdmin, client.id, {
      cycleStart: israelMidnight(5),
      cycleEnd: israelMidnight(-25),
      purchasedMinutes: 600,
      rolloverMode: "NONE",
    });
    expect(await getPrepaidForecast(await getCurrentHourBank(client.id))).toBeNull();
  });
});
