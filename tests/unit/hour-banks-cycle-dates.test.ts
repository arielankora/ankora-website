import { beforeEach, describe, expect, it, vi } from "vitest";

// The cycle form sends plain YYYY-MM-DD dates. They are Israeli days, so
// a cycle that starts on 1.11 starts at midnight Israel time, whatever
// zone the server process runs in (Vercel and CI run in UTC). Parsing
// `${date}T00:00:00` reads midnight in the SERVER's zone and moves the
// boundary by two or three hours. The same class of bug was fixed for
// report filters (lib/timezone.ts dayStartInZone) and for the prepaid
// purchase date in this file's sibling action.

const openHourBankCycle = vi.fn(async () => ({}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/app-auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", role: "SUPER_ADMIN" })),
}));
vi.mock("@/lib/app-domain/hour-banks", () => ({
  openHourBankCycle: (...args: unknown[]) => openHourBankCycle(...(args as [])),
  recordHourBankAdjustment: vi.fn(),
  loadPrepaidPackage: vi.fn(),
  previewPrepaidLoad: vi.fn(),
}));
vi.mock("@/lib/app-domain/billing", () => ({ upsertBillingPolicy: vi.fn() }));

import { openHourBankCycleAction } from "@/app/(product)/app/(authenticated)/hour-banks/actions";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("openHourBankCycleAction() dates", () => {
  beforeEach(() => openHourBankCycle.mockClear());

  it("starts and ends the cycle at midnight Israel time, not midnight server time", async () => {
    const res = await openHourBankCycleAction(
      undefined,
      form({
        clientId: "c1",
        cycleStart: "2026-11-01", // winter time, UTC+2
        cycleEnd: "2026-12-01",
        purchasedHours: "10",
      })
    );
    expect(res).toEqual({ ok: true });
    const input = (openHourBankCycle.mock.calls[0] as unknown[])[2] as { cycleStart: Date; cycleEnd: Date };
    expect(input.cycleStart.toISOString()).toBe("2026-10-31T22:00:00.000Z");
    expect(input.cycleEnd.toISOString()).toBe("2026-11-30T22:00:00.000Z");
  });

  it("uses the summer offset for a summer date", async () => {
    await openHourBankCycleAction(
      undefined,
      form({ clientId: "c1", cycleStart: "2026-07-01", cycleEnd: "2026-08-01", purchasedHours: "10" })
    );
    const input = (openHourBankCycle.mock.calls[0] as unknown[])[2] as { cycleStart: Date };
    expect(input.cycleStart.toISOString()).toBe("2026-06-30T21:00:00.000Z");
  });
});
