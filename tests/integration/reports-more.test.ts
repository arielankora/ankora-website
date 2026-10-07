import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient, createTestCategory, createTestClientUser } from "./factories";
import { runReport, type ReportType } from "@/lib/app-domain/reports";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { openHourBankCycle } from "@/lib/app-domain/hour-banks";
import { dayEndInZone, dayStartInZone } from "@/lib/timezone";

// The four internal reports tests/integration/reports.test.ts does not
// reach: hours_by_category, employee_client_matrix, overage_at_risk and
// capacity. Each one is asserted against a small dataset whose numbers are
// worked out by hand in the comments, because "report aggregates equal raw
// time entry sums" (spec 21.2) is only a real check when the expected sum
// is known independently of the code that produces it.
//
// The dataset deliberately carries the three rows that must NOT count: a
// soft-deleted entry, a running timer (endAt null, no seconds yet) and an
// entry outside the date range. Each is big enough that including it by
// mistake would change every number below.

const MIN = 60;

/// A finished entry with its own actual and billable seconds. The shared
/// factory always sets billable === actual, which would hide exactly the
/// distinction (a 10 minute call billed as 15) these reports exist to show.
async function entry(o: {
  userId: string;
  clientId: string;
  categoryId: string;
  startAt: Date;
  actualSeconds: number;
  billableSeconds: number;
  deletedAt?: Date | null;
}) {
  return prisma.timeEntry.create({
    data: {
      userId: o.userId,
      clientId: o.clientId,
      categoryId: o.categoryId,
      startAt: o.startAt,
      endAt: new Date(o.startAt.getTime() + o.actualSeconds * 1000),
      actualSeconds: o.actualSeconds,
      billableSeconds: o.billableSeconds,
      source: "MANUAL",
      isManual: true,
      deletedAt: o.deletedAt ?? null,
    },
  });
}

async function runningTimer(o: { userId: string; clientId: string; categoryId: string; startAt: Date }) {
  return prisma.timeEntry.create({
    data: { ...o, endAt: null, actualSeconds: null, billableSeconds: null, source: "TIMER", isManual: false },
  });
}

async function named(role: "SUPER_ADMIN" | "ANKORA_EMPLOYEE", name: string) {
  const { user } = await createTestUser({ role });
  return prisma.user.update({ where: { id: user.id }, data: { name } });
}

/// September 2026, all inside one range. Hand-computed totals:
///
///   #  who    client  category  actual  billable
///   1  Alice  A       Meetings      50        60
///   2  Alice  A       Admin         10        15   (minimum-billing style)
///   3  Alice  B       Meetings      30        30
///   4  Bob    A       Meetings      45        45
///   5  Bob    B       Admin        120       120   SOFT-DELETED
///   6  Bob    B       Meetings    running             TIMER STILL RUNNING
///   7  Alice  B       Admin        200       200   OUTSIDE RANGE (August)
async function seed() {
  const admin = await named("SUPER_ADMIN", "Admin");
  const alice = await named("ANKORA_EMPLOYEE", "Alice");
  const bob = await named("ANKORA_EMPLOYEE", "Bob");
  const clientA = await createTestClient({ name: "Client A" });
  const clientB = await createTestClient({ name: "Client B" });
  const meetings = await createTestCategory({ name: "Meetings" });
  const adminCat = await createTestCategory({ name: "Admin" });

  // Client A's rows are the most recent, so they come first in the
  // startAt-desc order the reports read in (matters only for capacity's
  // breakdown text).
  await entry({ userId: alice.id, clientId: clientA.id, categoryId: meetings.id, startAt: new Date("2026-09-20T07:00:00Z"), actualSeconds: 50 * MIN, billableSeconds: 60 * MIN });
  await entry({ userId: alice.id, clientId: clientA.id, categoryId: adminCat.id, startAt: new Date("2026-09-19T07:00:00Z"), actualSeconds: 10 * MIN, billableSeconds: 15 * MIN });
  await entry({ userId: alice.id, clientId: clientB.id, categoryId: meetings.id, startAt: new Date("2026-09-10T07:00:00Z"), actualSeconds: 30 * MIN, billableSeconds: 30 * MIN });
  await entry({ userId: bob.id, clientId: clientA.id, categoryId: meetings.id, startAt: new Date("2026-09-18T07:00:00Z"), actualSeconds: 45 * MIN, billableSeconds: 45 * MIN });
  await entry({ userId: bob.id, clientId: clientB.id, categoryId: adminCat.id, startAt: new Date("2026-09-17T07:00:00Z"), actualSeconds: 120 * MIN, billableSeconds: 120 * MIN, deletedAt: new Date() });
  await runningTimer({ userId: bob.id, clientId: clientB.id, categoryId: meetings.id, startAt: new Date("2026-09-16T07:00:00Z") });
  await entry({ userId: alice.id, clientId: clientB.id, categoryId: adminCat.id, startAt: new Date("2026-08-15T07:00:00Z"), actualSeconds: 200 * MIN, billableSeconds: 200 * MIN });

  // Built exactly the way the Reports page and the CSV export route build
  // them (Israel midnight to Israel end of day).
  const september = { from: dayStartInZone("2026-09-01"), to: dayEndInZone("2026-09-30") };
  return { admin, alice, bob, clientA, clientB, meetings, adminCat, september };
}

describe("runReport() - the four reports are internal only (report.internal.view)", () => {
  // A client user seeing the employee/client matrix would see how much
  // time Ankora spends on OTHER clients; an employee would see colleagues'
  // hours. Both are refused before any query runs.
  const types: ReportType[] = ["hours_by_category", "employee_client_matrix", "overage_at_risk", "capacity"];

  it.each(types)("%s: SUPER_ADMIN and ANKORA_ADMIN may run it; ANKORA_EMPLOYEE and CLIENT_USER are refused", async (type) => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const client = await createTestClient();
    const { user: clientAdmin } = await createTestClientUser({ clientId: client.id, role: "ADMIN" });

    await expect(runReport(superAdmin, type, {})).resolves.toMatchObject({ type });
    await expect(runReport(admin, type, {})).resolves.toMatchObject({ type });
    await expect(runReport(employee, type, {})).rejects.toThrow(ForbiddenError);
    // Even a client ADMIN, scoped to their own client, is refused: the
    // internal reports are not client-scoped at all.
    await expect(runReport(clientAdmin, type, { clientId: client.id })).rejects.toThrow(ForbiddenError);
  });
});

describe("hours_by_category - cross-client and per-client split", () => {
  it("sums actual and billable per category, excluding deleted, running and out-of-range entries", async () => {
    const { admin, september } = await seed();

    const result = await runReport(admin, "hours_by_category", september);

    // Meetings: #1 50/60 + #3 30/30 + #4 45/45 = 125 actual / 135 billable
    // Admin:    #2 10/15                        =  10 actual /  15 billable
    // (#5 deleted 120, #6 running, #7 August 200 all excluded.)
    // Share of billable: 135/150 = 90%, 15/150 = 10%.
    expect(result.rows).toEqual([
      { category: "Meetings", actualMinutes: 125, billableMinutes: 135, pctOfTotal: 90 },
      { category: "Admin", actualMinutes: 10, billableMinutes: 15, pctOfTotal: 10 },
    ]);
  });

  it("with a client filter, shows only that client's split and percentages of that client's total", async () => {
    const { admin, clientA, september } = await seed();

    const result = await runReport(admin, "hours_by_category", { ...september, clientId: clientA.id });

    // Client A only: Meetings #1 + #4 = 95/105, Admin #2 = 10/15.
    // 105/120 = 87.5%, 15/120 = 12.5% - one decimal, as the column shows it.
    expect(result.rows).toEqual([
      { category: "Meetings", actualMinutes: 95, billableMinutes: 105, pctOfTotal: 87.5 },
      { category: "Admin", actualMinutes: 10, billableMinutes: 15, pctOfTotal: 12.5 },
    ]);
  });

  it("returns no rows (not a divide-by-zero row) for a range with no finished time", async () => {
    const { admin } = await seed();
    const result = await runReport(admin, "hours_by_category", {
      from: dayStartInZone("2026-07-01"),
      to: dayEndInZone("2026-07-31"),
    });
    expect(result.rows).toEqual([]);
  });
});

describe("hours_by_category - Israel-day range on the DST day (2026-10-25, 25 hours)", () => {
  // Israel leaves summer time at 02:00 on Sunday 25.10.2026, so that day
  // runs from 2026-10-24T21:00Z (UTC+3) to 2026-10-25T22:00Z (UTC+2) -
  // 25 hours. A range for "25.10 to 25.10" must include an entry at 23:30
  // that night (21:30Z), which a fixed +3 offset would cut off at 21:00Z,
  // and must not include 23:30 the evening before.
  it("includes exactly the entries whose start falls on 25.10 Israel time, the 'to' day inclusive", async () => {
    const admin = await named("SUPER_ADMIN", "Admin");
    const alice = await named("ANKORA_EMPLOYEE", "Alice");
    const client = await createTestClient({ name: "Client A" });
    const cat = await createTestCategory({ name: "Ops" });
    const at = (iso: string, minutes: number) =>
      entry({ userId: alice.id, clientId: client.id, categoryId: cat.id, startAt: new Date(iso), actualSeconds: minutes * MIN, billableSeconds: minutes * MIN });

    await at("2026-10-24T20:30:00Z", 1); // 24.10 23:30 Israel - the day before
    await at("2026-10-24T21:00:00Z", 10); // 25.10 00:00 Israel - first instant, in
    await at("2026-10-25T10:00:00Z", 100); // 25.10 12:00 Israel - in
    await at("2026-10-25T21:30:00Z", 1000); // 25.10 23:30 Israel (UTC+2 now) - in
    await at("2026-10-25T22:00:00Z", 10000); // 26.10 00:00 Israel - the day after

    const from = dayStartInZone("2026-10-25")!;
    const to = dayEndInZone("2026-10-25")!;
    // The day really is 25 hours long here.
    expect(to.getTime() + 1 - from.getTime()).toBe(25 * 3600_000);

    const result = await runReport(admin, "hours_by_category", { from, to });
    expect(result.rows).toEqual([{ category: "Ops", actualMinutes: 1110, billableMinutes: 1110, pctOfTotal: 100 }]);
  });
});

describe("employee_client_matrix - who worked how much for whom", () => {
  it("gives one row per (employee, client) pair with activity, sorted by employee then billable", async () => {
    const { admin, september } = await seed();

    const result = await runReport(admin, "employee_client_matrix", september);

    // Alice x A: #1 + #2 = 60 actual / 75 billable
    // Alice x B: #3      = 30 / 30   (#7 is August, out of range)
    // Bob   x A: #4      = 45 / 45
    // Bob   x B: nothing - #5 deleted, #6 still running. No row at all,
    //            rather than a zero row that would read as "worked 0:00".
    expect(result.rows).toEqual([
      { employee: "Alice", client: "Client A", actualMinutes: 60, billableMinutes: 75 },
      { employee: "Alice", client: "Client B", actualMinutes: 30, billableMinutes: 30 },
      { employee: "Bob", client: "Client A", actualMinutes: 45, billableMinutes: 45 },
    ]);
  });

  it("an employee filter narrows the matrix to that employee's own rows", async () => {
    const { admin, bob, september } = await seed();
    const result = await runReport(admin, "employee_client_matrix", { ...september, userId: bob.id });
    expect(result.rows).toEqual([{ employee: "Bob", client: "Client A", actualMinutes: 45, billableMinutes: 45 }]);
  });
});

describe("capacity - an employee's period total and its split across clients", () => {
  it("totals each employee's finished time and breaks the billable minutes down by client", async () => {
    const { admin, september } = await seed();

    const result = await runReport(admin, "capacity", september);

    // Alice: 50+10+30 = 90 actual, 60+15+30 = 105 billable; A 75, B 30.
    // Bob:   45 / 45; A 45. His deleted 120 and running timer on B do not
    //        appear in the total or the breakdown.
    expect(result.rows).toEqual([
      { employee: "Alice", actualMinutes: 90, billableMinutes: 105, clientBreakdown: "Client A: 75; Client B: 30" },
      { employee: "Bob", actualMinutes: 45, billableMinutes: 45, clientBreakdown: "Client A: 45" },
    ]);
  });

  // PRODUCT BUG (found 2026-10-07): capacity() rounds every ENTRY to whole
  // minutes before adding it to the per-client breakdown
  // (row.perClient.set(..., + toMinutes(e.billableSeconds)), reports.ts
  // line 532), while the employee's total rounds the SUM once. Timer
  // entries carry arbitrary seconds, so the two drift by up to half a
  // minute per entry: four 90-second entries are 6 billable minutes in
  // the total but "8" in the breakdown. Over a month of short timer
  // entries the breakdown an admin reads to judge "how is her time split"
  // disagrees with the total in the same row by tens of minutes.
  it.fails("the per-client breakdown adds up to the billable total (one client, short timer entries)", async () => {
    const admin = await named("SUPER_ADMIN", "Admin");
    const alice = await named("ANKORA_EMPLOYEE", "Alice");
    const client = await createTestClient({ name: "Client A" });
    const cat = await createTestCategory({ name: "Ops" });
    for (let i = 0; i < 4; i++) {
      await entry({ userId: alice.id, clientId: client.id, categoryId: cat.id, startAt: new Date(Date.UTC(2026, 8, 10, 7, i * 5)), actualSeconds: 90, billableSeconds: 90 });
    }

    const result = await runReport(admin, "capacity", {});
    expect(result.rows[0].billableMinutes).toBe(6); // 360 seconds
    expect(result.rows[0].clientBreakdown).toBe("Client A: 6");
  });
});

describe("overage_at_risk - utilisation measured against the current hour bank", () => {
  // One cycle per client around "now", 600 purchased minutes unless noted,
  // with consumption seeded inside the cycle. Utilisation is computed on
  // BILLABLE minutes (that is what the bank is drawn down by), so the
  // over-the-line client below is over only because of billing rounding.
  async function bank(admin: { id: string } & Record<string, unknown>, clientId: string, purchasedMinutes: number) {
    await openHourBankCycle(admin as never, clientId, {
      cycleStart: new Date(Date.now() - 10 * 86_400_000),
      cycleEnd: new Date(Date.now() + 10 * 86_400_000),
      purchasedMinutes,
      rolloverMode: "NONE",
    });
  }
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

  async function rule(clientId: string, thresholdValue: number, enabled = true) {
    await prisma.alertRule.create({
      data: { clientId, type: "UTILIZATION_PCT", thresholdValue, enabled, recipientsAnkora: [], recipientsClient: [] },
    });
  }

  it("lists over-bank and at-risk clients with the threshold actually used, and leaves healthy ones out", async () => {
    const admin = await named("SUPER_ADMIN", "Admin");
    const alice = await named("ANKORA_EMPLOYEE", "Alice");
    const cat = await createTestCategory({ name: "Ops" });
    const add = (clientId: string, actual: number, billable: number, extra: { deletedAt?: Date } = {}) =>
      entry({ userId: alice.id, clientId, categoryId: cat.id, startAt: daysAgo(2), actualSeconds: actual * MIN, billableSeconds: billable * MIN, ...extra });

    // Over: 60-minute bank, 50 actual minutes billed as 65 -> 108.3%,
    // remaining -5. On actual minutes it would look fine (83%).
    const over = await createTestClient({ name: "Over" });
    await bank(admin, over.id, 60);
    await add(over.id, 50, 65);

    // At risk by the default 80% line: 510/600 = 85%. A deleted 200-minute
    // entry would push it over 100% if it were counted.
    const risk = await createTestClient({ name: "Risky" });
    await bank(admin, risk.id, 600);
    await add(risk.id, 510, 510);
    await add(risk.id, 200, 200, { deletedAt: new Date() });

    // Own alert rules at 70% and 50%: the LOWEST enabled one is the
    // early-warning line, so 330/600 = 55% is at risk with threshold 50.
    const custom = await createTestClient({ name: "Custom" });
    await bank(admin, custom.id, 600);
    await rule(custom.id, 70);
    await rule(custom.id, 50);
    await add(custom.id, 330, 330);

    // A DISABLED 30% rule is ignored: 240/600 = 40% stays OK against its
    // enabled 50% rule and does not appear.
    const quiet = await createTestClient({ name: "Quiet" });
    await bank(admin, quiet.id, 600);
    await rule(quiet.id, 50);
    await rule(quiet.id, 30, false);
    await add(quiet.id, 240, 240);

    // Healthy: 300/600 = 50% under the default 80%. A running timer on it
    // has no minutes yet and changes nothing.
    const healthy = await createTestClient({ name: "Healthy" });
    await bank(admin, healthy.id, 600);
    await add(healthy.id, 300, 300);
    await runningTimer({ userId: alice.id, clientId: healthy.id, categoryId: cat.id, startAt: daysAgo(1) });

    // No hour bank at all: nothing to be over, so no row.
    const noBank = await createTestClient({ name: "NoBank" });
    await add(noBank.id, 5000, 5000);

    const result = await runReport(admin, "overage_at_risk", {});

    // Sorted by utilisation, highest first.
    expect(result.rows).toEqual([
      { client: "Over", status: "חריגה", utilizationPct: 108.3, remainingMinutes: -5, thresholdUsed: 80 },
      { client: "Risky", status: "בסיכון", utilizationPct: 85, remainingMinutes: 90, thresholdUsed: 80 },
      { client: "Custom", status: "בסיכון", utilizationPct: 55, remainingMinutes: 270, thresholdUsed: 50 },
    ]);
  });

  it("leaves archived clients out of the overview, but a client filter still shows that client", async () => {
    const admin = await named("SUPER_ADMIN", "Admin");
    const alice = await named("ANKORA_EMPLOYEE", "Alice");
    const cat = await createTestCategory({ name: "Ops" });
    const archived = await createTestClient({ name: "Archived" });
    await bank(admin, archived.id, 60);
    await entry({ userId: alice.id, clientId: archived.id, categoryId: cat.id, startAt: daysAgo(2), actualSeconds: 120 * MIN, billableSeconds: 120 * MIN });
    await prisma.client.update({ where: { id: archived.id }, data: { status: "ARCHIVED" } });

    expect((await runReport(admin, "overage_at_risk", {})).rows).toEqual([]);
    const filtered = await runReport(admin, "overage_at_risk", { clientId: archived.id });
    expect(filtered.rows).toEqual([
      { client: "Archived", status: "חריגה", utilizationPct: 200, remainingMinutes: -60, thresholdUsed: 80 },
    ]);
  });
});
