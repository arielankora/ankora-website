import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient, createTestCategory, createTestTimeEntry } from "./factories";
import { upsertBillingPolicy, computeConsumedMinutesForRange } from "@/lib/app-domain/billing";
import { ForbiddenError } from "@/lib/app-auth/permissions";

// Phase 3 - spec 7.1 (Billing Policy) + 8.3 (consumption feeding the Hour
// Bank). Needs a real Prisma client + reachable DATABASE_URL - see
// tests/integration/setup.ts's header comment.

describe("upsertBillingPolicy() - spec 7.1", () => {
  it("is SUPER_ADMIN only (hour_bank.manage), rejecting ANKORA_ADMIN", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient();

    await expect(
      upsertBillingPolicy(admin, client.id, {
        minimumMinutes: 15,
        incrementMinutes: 15,
        roundingMode: "CEIL",
        aggregationScope: "PER_ENTRY",
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it("creates then updates a client's policy, auditing both as distinct actions", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const client = await createTestClient();

    const created = await upsertBillingPolicy(superAdmin, client.id, {
      minimumMinutes: 15,
      incrementMinutes: 15,
      roundingMode: "CEIL",
      aggregationScope: "PER_ENTRY",
    });
    expect(created.minimumMinutes).toBe(15);

    const updated = await upsertBillingPolicy(superAdmin, client.id, {
      minimumMinutes: 30,
      incrementMinutes: 15,
      roundingMode: "CEIL",
      aggregationScope: "PER_ENTRY",
    });
    expect(updated.id).toBe(created.id); // same row, upserted
    expect(updated.minimumMinutes).toBe(30);

    const events = await prisma.auditEvent.findMany({ where: { entityId: created.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["billing_policy.create", "billing_policy.update"]);
  });
});

describe("computeConsumedMinutesForRange() - spec 8.3 aggregation scopes", () => {
  async function seedEntries(clientId: string, userId: string, categoryId: string, taskId: string | null) {
    const day1 = new Date("2026-06-01T08:00:00.000Z");
    // Two short same-day entries: 5 min + 6 min actual.
    await createTestTimeEntry({
      userId,
      clientId,
      categoryId,
      startAt: day1,
      endAt: new Date(day1.getTime() + 5 * 60_000),
    });
    await createTestTimeEntry({
      userId,
      clientId,
      categoryId,
      startAt: new Date(day1.getTime() + 60 * 60_000),
      endAt: new Date(day1.getTime() + 66 * 60_000),
    });
  }

  it("PER_ENTRY (default, no policy row) sums each entry's own billableSeconds unchanged", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const client = await createTestClient();
    const category = await createTestCategory({ clientId: client.id });
    await seedEntries(client.id, user.id, category.id, null);

    const minutes = await computeConsumedMinutesForRange(client.id, {
      from: new Date("2026-06-01T00:00:00.000Z"),
      to: new Date("2026-06-02T00:00:00.000Z"),
    });
    expect(minutes).toBe(11); // 5 + 6, no policy applied
  });

  it("PER_DAY aggregation applies the minimum/rounding once to the day's summed actual time", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const client = await createTestClient();
    const category = await createTestCategory({ clientId: client.id });
    await seedEntries(client.id, employee.id, category.id, null);

    await upsertBillingPolicy(superAdmin, client.id, {
      minimumMinutes: 15,
      incrementMinutes: 15,
      roundingMode: "CEIL",
      aggregationScope: "PER_DAY",
    });

    const minutes = await computeConsumedMinutesForRange(client.id, {
      from: new Date("2026-06-01T00:00:00.000Z"),
      to: new Date("2026-06-02T00:00:00.000Z"),
    });
    // Raw actual = 11 min for the day; CEIL to the next 15-minute increment = 15.
    expect(minutes).toBe(15);
  });
});
