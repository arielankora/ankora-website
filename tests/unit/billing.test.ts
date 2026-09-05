import { describe, expect, it } from "vitest";
import { applyBillingPolicy, DEFAULT_POLICY } from "@/lib/app-domain/billing";

// Phase 3 - spec 7.1's Billing Policy table. Pure-function tests only:
// applyBillingPolicy takes/returns seconds and never touches the
// database, so these run without a Prisma client or a test database.

describe("applyBillingPolicy() - DEFAULT_POLICY is a no-op (backward compatibility)", () => {
  it("returns actualSeconds unchanged for a client with no BillingPolicy row", () => {
    expect(applyBillingPolicy(125, DEFAULT_POLICY)).toBe(125);
    expect(applyBillingPolicy(3723, undefined)).toBe(3723);
    expect(applyBillingPolicy(3723, null)).toBe(3723);
  });

  it("clamps non-positive/invalid input to 0", () => {
    expect(applyBillingPolicy(0)).toBe(0);
    expect(applyBillingPolicy(-10)).toBe(0);
    expect(applyBillingPolicy(Number.NaN)).toBe(0);
  });
});

describe("applyBillingPolicy() - minimum-per-entry floor (spec 7.1)", () => {
  it("floors a short entry up to the configured minimum", () => {
    const policy = { minimumMinutes: 15, incrementMinutes: 1, roundingMode: "EXACT" as const, aggregationScope: "PER_ENTRY" as const };
    expect(applyBillingPolicy(5 * 60, policy)).toBe(15 * 60);
  });

  it("leaves an entry already above the minimum untouched (EXACT rounding)", () => {
    const policy = { minimumMinutes: 15, incrementMinutes: 1, roundingMode: "EXACT" as const, aggregationScope: "PER_ENTRY" as const };
    expect(applyBillingPolicy(20 * 60, policy)).toBe(20 * 60);
  });
});

describe("applyBillingPolicy() - increment rounding modes (spec 7.1)", () => {
  const base = { minimumMinutes: 0, aggregationScope: "PER_ENTRY" as const };

  it("CEIL rounds up to the next increment", () => {
    const policy = { ...base, incrementMinutes: 15, roundingMode: "CEIL" as const };
    expect(applyBillingPolicy(16 * 60, policy)).toBe(30 * 60);
    expect(applyBillingPolicy(15 * 60, policy)).toBe(15 * 60); // exact multiple stays put
  });

  it("NEAREST rounds to the closest increment", () => {
    const policy = { ...base, incrementMinutes: 15, roundingMode: "NEAREST" as const };
    expect(applyBillingPolicy(7 * 60, policy)).toBe(0); // closer to 0 than to 15
    expect(applyBillingPolicy(8 * 60, policy)).toBe(15 * 60); // closer to 15 than to 0
  });

  it("EXACT ignores the increment and only applies the minimum floor", () => {
    const policy = { ...base, incrementMinutes: 15, roundingMode: "EXACT" as const };
    expect(applyBillingPolicy(16 * 60, policy)).toBe(16 * 60);
  });
});
