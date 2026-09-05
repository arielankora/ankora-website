import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient } from "./factories";
import {
  openHourBankCycle,
  recordHourBankAdjustment,
  getCurrentHourBank,
  listHourBanksForClient,
} from "@/lib/app-domain/hour-banks";
import { ForbiddenError } from "@/lib/app-auth/permissions";

// Phase 3 - spec 8 (Clients & Hour Bank). Needs a real Prisma client +
// reachable DATABASE_URL - see tests/integration/setup.ts's header.

async function setup() {
  const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
  const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
  const client = await createTestClient();
  return { superAdmin, admin, client };
}

describe("openHourBankCycle() - spec 8.1/8.2", () => {
  it("is SUPER_ADMIN only (hour_bank.manage), rejecting ANKORA_ADMIN even though it has client.manage", async () => {
    const { admin, client } = await setup();
    await expect(
      openHourBankCycle(admin, client.id, {
        cycleStart: new Date("2026-01-01T00:00:00Z"),
        cycleEnd: new Date("2026-02-01T00:00:00Z"),
        purchasedMinutes: 600,
        rolloverMode: "NONE",
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects a cycleEnd on or before cycleStart", async () => {
    const { superAdmin, client } = await setup();
    await expect(
      openHourBankCycle(superAdmin, client.id, {
        cycleStart: new Date("2026-02-01T00:00:00Z"),
        cycleEnd: new Date("2026-01-01T00:00:00Z"),
        purchasedMinutes: 600,
        rolloverMode: "NONE",
      })
    ).rejects.toThrow();
  });

  it("a client's first cycle always starts with rolloverInMinutes = 0", async () => {
    const { superAdmin, client } = await setup();
    const bank = await openHourBankCycle(superAdmin, client.id, {
      cycleStart: new Date("2026-01-01T00:00:00Z"),
      cycleEnd: new Date("2026-02-01T00:00:00Z"),
      purchasedMinutes: 600,
      rolloverMode: "FULL",
    });
    expect(bank.rolloverInMinutes).toBe(0);
    expect(bank.status).toBe("OPEN");
  });

  it("FULL rollover carries the previous cycle's unused minutes into the new one, and closes the previous cycle", async () => {
    const { superAdmin, client } = await setup();
    const first = await openHourBankCycle(superAdmin, client.id, {
      cycleStart: new Date("2026-01-01T00:00:00Z"),
      cycleEnd: new Date("2026-02-01T00:00:00Z"),
      purchasedMinutes: 600,
      rolloverMode: "FULL",
    });
    // Simulate 400 minutes consumed in cycle 1 (no real TimeEntry rows -
    // directly seed the cached snapshot field the rollover math reads).
    await prisma.hourBank.update({ where: { id: first.id }, data: { consumedMinutes: 400 } });

    const second = await openHourBankCycle(superAdmin, client.id, {
      cycleStart: new Date("2026-02-01T00:00:00Z"),
      cycleEnd: new Date("2026-03-01T00:00:00Z"),
      purchasedMinutes: 600,
      rolloverMode: "NONE",
    });
    expect(second.rolloverInMinutes).toBe(200); // 600 - 400

    const reloadedFirst = await prisma.hourBank.findUniqueOrThrow({ where: { id: first.id } });
    expect(reloadedFirst.status).toBe("CLOSED");
  });

  it("CAPPED rollover never carries more than rolloverCapMinutes", async () => {
    const { superAdmin, client } = await setup();
    const first = await openHourBankCycle(superAdmin, client.id, {
      cycleStart: new Date("2026-01-01T00:00:00Z"),
      cycleEnd: new Date("2026-02-01T00:00:00Z"),
      purchasedMinutes: 600,
      rolloverMode: "CAPPED",
      rolloverCapMinutes: 50,
    });
    await prisma.hourBank.update({ where: { id: first.id }, data: { consumedMinutes: 400 } }); // 200 unused

    const second = await openHourBankCycle(superAdmin, client.id, {
      cycleStart: new Date("2026-02-01T00:00:00Z"),
      cycleEnd: new Date("2026-03-01T00:00:00Z"),
      purchasedMinutes: 600,
      rolloverMode: "NONE",
    });
    expect(second.rolloverInMinutes).toBe(50); // capped, not the full 200
  });

  it("MANUAL rollover uses the admin-supplied override, not a formula", async () => {
    const { superAdmin, client } = await setup();
    const first = await openHourBankCycle(superAdmin, client.id, {
      cycleStart: new Date("2026-01-01T00:00:00Z"),
      cycleEnd: new Date("2026-02-01T00:00:00Z"),
      purchasedMinutes: 600,
      rolloverMode: "MANUAL",
    });
    await prisma.hourBank.update({ where: { id: first.id }, data: { consumedMinutes: 400 } });

    const second = await openHourBankCycle(superAdmin, client.id, {
      cycleStart: new Date("2026-02-01T00:00:00Z"),
      cycleEnd: new Date("2026-03-01T00:00:00Z"),
      purchasedMinutes: 600,
      rolloverMode: "NONE",
      manualRolloverInMinutes: 77,
    });
    expect(second.rolloverInMinutes).toBe(77);
  });
});

describe("recordHourBankAdjustment() - spec 8.2 manual adjustments", () => {
  it("requires a non-empty reason", async () => {
    const { superAdmin, client } = await setup();
    await openHourBankCycle(superAdmin, client.id, {
      cycleStart: new Date("2026-01-01T00:00:00Z"),
      cycleEnd: new Date("2026-02-01T00:00:00Z"),
      purchasedMinutes: 600,
      rolloverMode: "NONE",
    });
    await expect(
      recordHourBankAdjustment(superAdmin, client.id, { minutes: 30, reason: "   " })
    ).rejects.toThrow(/reason/);
  });

  it("defaults to the client's current cycle when no hourBankId is given, and flags a CLOSED cycle as RECALCULATED", async () => {
    const { superAdmin, client } = await setup();
    const bank = await openHourBankCycle(superAdmin, client.id, {
      cycleStart: new Date("2026-01-01T00:00:00Z"),
      cycleEnd: new Date("2026-02-01T00:00:00Z"),
      purchasedMinutes: 600,
      rolloverMode: "NONE",
    });
    // Simulate the cycle already having closed (spec 8.2's "cycle_end passed").
    await prisma.hourBank.update({ where: { id: bank.id }, data: { status: "CLOSED" } });

    const adjustment = await recordHourBankAdjustment(superAdmin, client.id, {
      minutes: -30,
      reason: "Client requested a courtesy credit reversal",
    });
    expect(adjustment.hourBankId).toBe(bank.id);

    const reloaded = await prisma.hourBank.findUniqueOrThrow({ where: { id: bank.id } });
    expect(reloaded.status).toBe("RECALCULATED");
    expect(reloaded.recalculatedAt).not.toBeNull();
  });
});

describe("getCurrentHourBank() / listHourBanksForClient() - live snapshot (spec 8.3, 12)", () => {
  it("returns null for a client with no cycles yet rather than throwing", async () => {
    const client = await createTestClient();
    expect(await getCurrentHourBank(client.id)).toBeNull();
    expect(await listHourBanksForClient(client.id)).toEqual([]);
  });

  it("falls back to the most recent cycle when none currently covers 'now'", async () => {
    const { superAdmin, client } = await setup();
    // A cycle entirely in the past relative to "now" in these tests.
    await openHourBankCycle(superAdmin, client.id, {
      cycleStart: new Date("2020-01-01T00:00:00Z"),
      cycleEnd: new Date("2020-02-01T00:00:00Z"),
      purchasedMinutes: 100,
      rolloverMode: "NONE",
    });
    const snapshot = await getCurrentHourBank(client.id);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.utilization.totalMinutes).toBe(100);
  });
});
