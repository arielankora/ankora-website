import { describe, expect, it } from "vitest";
import { assessClient, attentionRank, bankDisplay, type BankState } from "@/lib/client-attention";

// The clients screen (3.11.2026): what makes a client "need attention".

const start = new Date("2026-11-01T00:00:00+02:00");
const end = new Date("2026-12-01T00:00:00+02:00");
const day = (n: number) => new Date(start.getTime() + n * 86_400_000);

function cycle(over: Partial<BankState> = {}): BankState {
  const purchased = over.purchasedMinutes ?? 2400;
  const rollover = over.rolloverInMinutes ?? 0;
  const total = over.totalMinutes ?? purchased + rollover;
  const consumed = over.consumedMinutes ?? 0;
  return {
    kind: "CYCLE",
    cycleStart: start,
    cycleEnd: end,
    purchasedMinutes: purchased,
    rolloverInMinutes: rollover,
    totalMinutes: total,
    consumedMinutes: consumed,
    remainingMinutes: total - consumed,
    utilizationPct: total > 0 ? Math.round((consumed / total) * 1000) / 10 : 0,
    ...over,
  };
}

describe("assessClient()", () => {
  it("a quiet cycle is on track and says nothing", () => {
    const a = assessClient({ bank: cycle({ consumedMinutes: 300 }), previous: null, forecast: null, now: day(10) });
    expect(a.attention).toBe(false);
    expect(a.reasons).toEqual([]);
    expect(a.expectedPct).toBeCloseTo(33.3, 1);
  });

  it("flags a cycle whose previous cycle overran, and counts it", () => {
    const a = assessClient({
      bank: cycle({ consumedMinutes: 300 }),
      previous: { kind: "CYCLE", purchasedMinutes: 2400, totalMinutes: 2400, consumedMinutes: 4648, remainingMinutes: -2248 },
      forecast: null,
      now: day(2),
    });
    expect(a.attention).toBe(true);
    expect(a.tone).toBe("bad");
    expect(a.previousOverrun).toBe(true);
    expect(a.reasons[0]).toContain("37.47");
  });

  it("does not treat a previous package's overrun as news: it is carried into the next one by design", () => {
    const a = assessClient({
      bank: { ...cycle({ consumedMinutes: 36 }), kind: "PREPAID", purchasedMinutes: 1800, rolloverInMinutes: -42, totalMinutes: 1758, remainingMinutes: 1722 },
      previous: { kind: "PREPAID", purchasedMinutes: 1800, totalMinutes: 1671, consumedMinutes: 1738, remainingMinutes: -67 },
      forecast: { status: "insufficient_data" },
      now: day(2),
    });
    expect(a.attention).toBe(false);
    expect(a.previousOverrun).toBe(false);
    expect(a.reasons[0]).toContain("חוב");
  });

  it("flags less than 40% left, with the days to renewal", () => {
    const a = assessClient({ bank: cycle({ purchasedMinutes: 600, consumedMinutes: 390 }), previous: null, forecast: null, now: day(2) });
    expect(a.attention).toBe(true);
    expect(a.tone).toBe("warn");
    expect(a.reasons[0]).toContain("35%");
    expect(a.reasons[0]).toContain("28 ימים");
  });

  it("does not judge the pace in the first week", () => {
    const a = assessClient({ bank: cycle({ consumedMinutes: 700 }), previous: null, forecast: null, now: day(3) });
    expect(a.attention).toBe(false);
  });

  it("flags a fast pace after the first week", () => {
    // 10 of 30 days: 800 of 2400 expected, 1300 used = 1.6x.
    const a = assessClient({ bank: cycle({ consumedMinutes: 1300 }), previous: null, forecast: null, now: day(10) });
    expect(a.attention).toBe(true);
    expect(a.reasons.join(" ")).toContain("פי 1.6");
  });

  it("flags a used-up bank as bad", () => {
    const a = assessClient({ bank: cycle({ purchasedMinutes: 600, consumedMinutes: 660 }), previous: null, forecast: null, now: day(20) });
    expect(a.tone).toBe("bad");
    expect(a.reasons[0]).toContain("1.00");
  });

  it("flags a package forecast to run out within three weeks, and not one further out", () => {
    const pkg: BankState = { ...cycle(), kind: "PREPAID", purchasedMinutes: 1800, totalMinutes: 1800, consumedMinutes: 100, remainingMinutes: 1700, cycleEnd: new Date("2027-11-01") };
    const soon = assessClient({ bank: pkg, previous: null, forecast: { status: "projected", depletionDate: day(22), daysLeft: 20 }, now: day(2) });
    expect(soon.attention).toBe(true);
    expect(soon.endingSoon).toBe(true);
    expect(soon.expectedPct).toBeNull();
    const later = assessClient({ bank: pkg, previous: null, forecast: { status: "projected", depletionDate: day(40), daysLeft: 38 }, now: day(2) });
    expect(later.attention).toBe(false);
  });

  it("shows at most two reasons, the bad ones first", () => {
    const a = assessClient({
      bank: cycle({ purchasedMinutes: 600, consumedMinutes: 500 }),
      previous: { kind: "CYCLE", purchasedMinutes: 600, totalMinutes: 600, consumedMinutes: 700, remainingMinutes: -100 },
      forecast: null,
      now: day(10),
    });
    expect(a.reasons).toHaveLength(2);
    expect(a.reasons[0]).toContain("במחזור הקודם");
  });
});

describe("bankDisplay()", () => {
  it("reads a package against the hours bought, a cycle against its total", () => {
    const pkg = bankDisplay({ kind: "PREPAID", purchasedMinutes: 1800, totalMinutes: 1758, consumedMinutes: 36, remainingMinutes: 1722 });
    expect(pkg.total).toBe("30.00");
    expect(pkg.consumed).toBe("1.30");
    expect(pkg.remaining).toBe("28.70");
    const cyc = bankDisplay({ kind: "CYCLE", purchasedMinutes: 6660, totalMinutes: 7764, consumedMinutes: 946, remainingMinutes: 6818 });
    expect(cyc.total).toBe("129.40");
    expect(cyc.consumed).toBe("15.77");
  });
});

describe("attentionRank()", () => {
  it("orders bad, warn, on track, no bank", () => {
    expect(attentionRank({ attention: true, tone: "bad" })).toBeLessThan(attentionRank({ attention: true, tone: "warn" }));
    expect(attentionRank({ attention: true, tone: "warn" })).toBeLessThan(attentionRank({ attention: false, tone: "ok" }));
    expect(attentionRank({ attention: false, tone: "ok" })).toBeLessThan(attentionRank(null));
  });
});
