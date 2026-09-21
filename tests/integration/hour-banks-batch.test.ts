import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient, createTestCategory, createTestTimeEntry } from "./factories";
import {
  openHourBankCycle,
  recordHourBankAdjustment,
  getCurrentHourBank,
  getCurrentHourBanksForClients,
} from "@/lib/app-domain/hour-banks";
import { upsertBillingPolicy } from "@/lib/app-domain/billing";

// getCurrentHourBanksForClients - the batched replacement for calling
// getCurrentHourBank in a loop (claude/perf-dashboard-n-plus-one-2026-09).
//
// The only question worth asking of an optimisation is whether it still
// gives the right answer, so almost every test here is an EQUIVALENCE
// test: build a situation, then assert the batched result equals what
// the per-client function returns for the same client. Asserting the
// batched numbers against hand-written expectations would prove the two
// agree with my arithmetic, which is not the same as proving they agree
// with each other - and it is the disagreement that would show up as a
// client being billed differently depending on which screen someone
// looked at.
//
// The situations are chosen to be the ones where a batched
// implementation can plausibly diverge: a cycle that covers now versus
// one that does not, adjustments belonging to one client's bank and not
// another's, entries sitting just inside and just outside a cycle
// boundary, a client with no cycle at all, and a billing policy that
// makes consumption something other than a plain sum.

const DAY = 86_400_000;

/** A cycle around "now", so the covering-cycle branch is the one used. */
function currentWindow() {
  return { cycleStart: new Date(Date.now() - 10 * DAY), cycleEnd: new Date(Date.now() + 20 * DAY) };
}

async function setup() {
  const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
  const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const category = await createTestCategory();
  return { superAdmin, employee, category };
}

/**
 * Assert the batch agrees with the per-client function, client by client.
 *
 * Compares the utilization figures and the identity of the chosen cycle.
 * It deliberately does not compare the whole bank row: the batched
 * version reports the status an expired cycle WOULD have without writing
 * it, so on an expired cycle the per-client call persists CLOSED and the
 * batched one computes CLOSED - the same value, arrived at differently,
 * and comparing the rows before and after that write would be comparing
 * the order the two ran in.
 */
async function expectBatchMatchesPerClient(clientIds: string[]) {
  const batch = await getCurrentHourBanksForClients(clientIds);

  for (const id of clientIds) {
    const single = await getCurrentHourBank(id);
    const batched = batch.get(id);

    if (single === null) {
      expect(batched, `client ${id} has no cycle but the batch returned one`).toBeUndefined();
      continue;
    }

    expect(batched, `client ${id} has a cycle but the batch returned nothing`).toBeDefined();
    expect(batched!.bank.id, `client ${id} chose a different cycle`).toBe(single.bank.id);
    expect(batched!.utilization, `client ${id} utilization`).toEqual(single.utilization);
  }
}

describe("getCurrentHourBanksForClients() - agrees with getCurrentHourBank()", () => {
  it("returns an empty map for no clients, without querying", async () => {
    expect(await getCurrentHourBanksForClients([])).toEqual(new Map());
  });

  it("omits a client that has no cycle at all, rather than mapping it to null", async () => {
    const client = await createTestClient();
    const batch = await getCurrentHourBanksForClients([client.id]);

    // A caller reading `.get(id)?.utilization` gets undefined either
    // way; the difference matters for `.size` and for iterating values,
    // which the dashboard does to average them. A null in there would
    // count as a client with zero utilization and drag the average down.
    expect(batch.size).toBe(0);
  });

  it("matches across a mix of covered, uncovered and bankless clients", async () => {
    const { superAdmin, employee, category } = await setup();

    // Covers now.
    const covered = await createTestClient();
    const window = currentWindow();
    await openHourBankCycle(superAdmin, covered.id, {
      ...window,
      purchasedMinutes: 600,
      rolloverMode: "NONE",
    });
    await createTestTimeEntry({
      userId: employee.id,
      clientId: covered.id,
      categoryId: category.id,
      startAt: new Date(Date.now() - 2 * DAY),
      endAt: new Date(Date.now() - 2 * DAY + 90 * 60_000),
    });

    // Has cycles, none covering now - exercises the fallback branch,
    // which in the batch is a groupBy plus a fetch rather than a second
    // findFirst.
    const past = await createTestClient();
    await openHourBankCycle(superAdmin, past.id, {
      cycleStart: new Date("2020-01-01T00:00:00Z"),
      cycleEnd: new Date("2020-02-01T00:00:00Z"),
      purchasedMinutes: 100,
      rolloverMode: "NONE",
    });
    await openHourBankCycle(superAdmin, past.id, {
      cycleStart: new Date("2020-02-01T00:00:00Z"),
      cycleEnd: new Date("2020-03-01T00:00:00Z"),
      purchasedMinutes: 250,
      rolloverMode: "NONE",
    });

    // No cycles at all.
    const bankless = await createTestClient();

    await expectBatchMatchesPerClient([covered.id, past.id, bankless.id]);

    // And the fallback really did pick the later of the two cycles,
    // rather than whichever the database happened to return first.
    const batch = await getCurrentHourBanksForClients([past.id]);
    expect(batch.get(past.id)!.utilization.purchasedMinutes).toBe(250);
  });

  it("keeps each client's adjustments to that client", async () => {
    const { superAdmin } = await setup();
    const a = await createTestClient();
    const b = await createTestClient();
    const window = currentWindow();

    for (const c of [a, b]) {
      await openHourBankCycle(superAdmin, c.id, { ...window, purchasedMinutes: 600, rolloverMode: "NONE" });
    }
    // Only A is adjusted. A batched sum that grouped by client instead of
    // by bank, or that forgot to key the map at all, would leak this
    // onto B - and B's utilization would quietly change because someone
    // credited a different client.
    await recordHourBankAdjustment(superAdmin, a.id, { minutes: 120, reason: "goodwill" });

    await expectBatchMatchesPerClient([a.id, b.id]);

    const batch = await getCurrentHourBanksForClients([a.id, b.id]);
    expect(batch.get(a.id)!.utilization.adjustmentMinutes).toBe(120);
    expect(batch.get(b.id)!.utilization.adjustmentMinutes).toBe(0);
  });

  it("counts only the entries inside each client's own cycle window", async () => {
    const { superAdmin, employee, category } = await setup();
    const client = await createTestClient();

    const cycleStart = new Date(Date.now() - 5 * DAY);
    const cycleEnd = new Date(Date.now() + 5 * DAY);
    await openHourBankCycle(superAdmin, client.id, {
      cycleStart,
      cycleEnd,
      purchasedMinutes: 600,
      rolloverMode: "NONE",
    });

    // Inside, and just outside on the early side. The batch fetches one
    // window spanning every cycle it found and narrows per client in
    // memory, so "did the narrowing happen" is the question with teeth:
    // without it, one client's entries would be counted against
    // another's cycle.
    await createTestTimeEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: category.id,
      startAt: new Date(cycleStart.getTime() + 60_000),
      endAt: new Date(cycleStart.getTime() + 61 * 60_000),
    });
    await createTestTimeEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: category.id,
      startAt: new Date(cycleStart.getTime() - 3 * DAY),
      endAt: new Date(cycleStart.getTime() - 3 * DAY + 60 * 60_000),
    });

    await expectBatchMatchesPerClient([client.id]);

    const batch = await getCurrentHourBanksForClients([client.id]);
    expect(batch.get(client.id)!.utilization.consumedMinutes).toBe(60);
  });

  it("applies each client's own billing policy, not the first one it found", async () => {
    const { superAdmin, employee, category } = await setup();
    const rounded = await createTestClient();
    const exact = await createTestClient();
    const window = currentWindow();

    for (const c of [rounded, exact]) {
      await openHourBankCycle(superAdmin, c.id, { ...window, purchasedMinutes: 600, rolloverMode: "NONE" });
      await createTestTimeEntry({
        userId: employee.id,
        clientId: c.id,
        categoryId: category.id,
        startAt: new Date(Date.now() - 2 * DAY),
        endAt: new Date(Date.now() - 2 * DAY + 10 * 60_000),
      });
    }

    // A policy that makes ten minutes bill as thirty. If the batch read
    // one policy and applied it to everyone, both clients would show the
    // same consumption and this would catch it.
    await upsertBillingPolicy(superAdmin, rounded.id, {
      minimumMinutes: 30,
      incrementMinutes: 15,
      roundingMode: "CEIL",
      aggregationScope: "PER_DAY",
    });

    await expectBatchMatchesPerClient([rounded.id, exact.id]);

    const batch = await getCurrentHourBanksForClients([rounded.id, exact.id]);
    expect(batch.get(rounded.id)!.utilization.consumedMinutes).toBe(30);
    expect(batch.get(exact.id)!.utilization.consumedMinutes).toBe(10);
  });
});

describe("getCurrentHourBanksForClients() - does not write", () => {
  it("leaves an expired OPEN cycle OPEN in the database while reporting it CLOSED", async () => {
    const { superAdmin } = await setup();
    const client = await createTestClient();

    await openHourBankCycle(superAdmin, client.id, {
      cycleStart: new Date("2020-01-01T00:00:00Z"),
      cycleEnd: new Date("2020-02-01T00:00:00Z"),
      purchasedMinutes: 100,
      rolloverMode: "NONE",
    });
    await prisma.hourBank.updateMany({ where: { clientId: client.id }, data: { status: "OPEN" } });

    const batch = await getCurrentHourBanksForClients([client.id]);

    // The viewer sees CLOSED, which is the truth about a cycle whose end
    // date has passed.
    expect(batch.get(client.id)!.bank.status).toBe("CLOSED");

    // The row is untouched. This is the point of the whole function:
    // rendering a page that summarises every client must not write a row
    // per client. The lazy close still happens on the screens that own
    // the cycle - getCurrentHourBank, below, is one of them.
    const row = await prisma.hourBank.findFirstOrThrow({ where: { clientId: client.id } });
    expect(row.status, "the batched read wrote to the database").toBe("OPEN");

    // And the per-client path still does close it, so the behaviour has
    // moved rather than disappeared.
    await getCurrentHourBank(client.id);
    const afterSingle = await prisma.hourBank.findFirstOrThrow({ where: { clientId: client.id } });
    expect(afterSingle.status).toBe("CLOSED");
  });

  it("does not refresh the cached consumedMinutes column", async () => {
    const { superAdmin, employee, category } = await setup();
    const client = await createTestClient();
    const window = currentWindow();

    await openHourBankCycle(superAdmin, client.id, { ...window, purchasedMinutes: 600, rolloverMode: "NONE" });
    await createTestTimeEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: category.id,
      startAt: new Date(Date.now() - 2 * DAY),
      endAt: new Date(Date.now() - 2 * DAY + 45 * 60_000),
    });

    // Deliberately wrong, so a refresh would be visible.
    await prisma.hourBank.updateMany({ where: { clientId: client.id }, data: { consumedMinutes: 9999 } });

    const batch = await getCurrentHourBanksForClients([client.id]);

    // The returned figure is live and correct...
    expect(batch.get(client.id)!.utilization.consumedMinutes).toBe(45);
    expect(batch.get(client.id)!.bank.consumedMinutes).toBe(45);

    // ...and the stale cache column is still stale, because this read
    // wrote nothing. The cache is refreshed by the screens that own the
    // cycle; a dashboard render is not one of them.
    const row = await prisma.hourBank.findFirstOrThrow({ where: { clientId: client.id } });
    expect(row.consumedMinutes, "the batched read wrote to the database").toBe(9999);
  });
});
