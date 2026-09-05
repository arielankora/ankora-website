import { describe, expect, it } from "vitest";
import { classifyUtilizationRisk, REPORT_DEFINITIONS, LONG_TIMER_HOURS } from "@/lib/app-domain/reports";

// Phase 5 - spec 14.2 (nine internal report types) and the "Overage / At
// Risk" report's threshold classification (ADR addendum 12.3). Note:
// importing "@/lib/app-domain/reports" pulls in lib/prisma.ts through its
// own imports (hour-banks.ts, clients.ts, alerts.ts all import prisma),
// so - like every prior phase's domain-level unit test file (e.g.
// tests/unit/alerts.test.ts, tests/unit/hour-banks.test.ts) - this file
// cannot actually RUN in this sandbox (documented, pre-existing
// limitation: @prisma/client cannot reach binaries.prisma.sh here). It
// runs normally on Vercel's Preview build, which has network access.
// classifyUtilizationRisk() itself is pure and was independently
// cross-checked outside the Prisma import chain - see the ADR addendum's
// verification note for this phase.

describe("REPORT_DEFINITIONS - spec 14.2", () => {
  it("defines exactly the nine report types spec 14.2's table lists", () => {
    expect(REPORT_DEFINITIONS).toHaveLength(9);
    const ids = REPORT_DEFINITIONS.map((r) => r.id);
    expect(new Set(ids).size).toBe(9); // no duplicates
    expect(ids).toEqual([
      "total_client_hours",
      "hours_by_employee",
      "hours_by_client",
      "hours_by_category",
      "employee_client_matrix",
      "manual_edits",
      "overage_at_risk",
      "active_timers",
      "capacity",
    ]);
  });

  it("gives every report type a non-empty Hebrew label", () => {
    for (const r of REPORT_DEFINITIONS) {
      expect(r.label.length).toBeGreaterThan(0);
    }
  });
});

describe("classifyUtilizationRisk() - ADR 12.3", () => {
  it("classifies OVERAGE at exactly 100% utilization", () => {
    expect(classifyUtilizationRisk(100, 0, 80)).toBe("OVERAGE");
  });

  it("classifies OVERAGE above 100% utilization", () => {
    expect(classifyUtilizationRisk(120, -100, 80)).toBe("OVERAGE");
  });

  it("classifies OVERAGE when remaining minutes are negative even if the % rounds under 100", () => {
    // Defensive case: a bank could have negative remaining minutes from a
    // manual downward adjustment without utilizationPct itself reaching
    // 100 in some edge rounding scenario - remainingMinutes < 0 alone is
    // sufficient for OVERAGE.
    expect(classifyUtilizationRisk(99, -1, 80)).toBe("OVERAGE");
  });

  it("classifies AT_RISK at or above the threshold but under 100%", () => {
    expect(classifyUtilizationRisk(80, 200, 80)).toBe("AT_RISK");
    expect(classifyUtilizationRisk(95, 50, 80)).toBe("AT_RISK");
  });

  it("classifies OK below the threshold", () => {
    expect(classifyUtilizationRisk(79.9, 210, 80)).toBe("OK");
    expect(classifyUtilizationRisk(0, 1000, 80)).toBe("OK");
  });

  it("respects a custom (non-default) threshold borrowed from a client's own alert rule", () => {
    expect(classifyUtilizationRisk(55, 450, 50)).toBe("AT_RISK");
    expect(classifyUtilizationRisk(45, 550, 50)).toBe("OK");
  });
});

describe("LONG_TIMER_HOURS - spec 6.1", () => {
  it("is a positive number of hours (spec 6.1's own example: 8/12 שעות)", () => {
    expect(LONG_TIMER_HOURS).toBeGreaterThan(0);
    expect(LONG_TIMER_HOURS).toBe(8);
  });
});
