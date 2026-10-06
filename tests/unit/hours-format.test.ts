import { describe, expect, it } from "vitest";
import { bankFigures, formatDecimalHours, formatHundredths, minutesToHundredths } from "@/lib/hours-format";

describe("formatDecimalHours", () => {
  it("reads a bank the way it is bought", () => {
    expect(formatDecimalHours(900)).toBe("15.00");
    expect(formatDecimalHours(90)).toBe("1.50");
    expect(formatDecimalHours(15)).toBe("0.25");
    expect(formatDecimalHours(0)).toBe("0.00");
    expect(formatDecimalHours(8148)).toBe("135.80");
  });

  it("keeps the sign on negative amounts and rounds them like positive ones", () => {
    expect(formatDecimalHours(-90)).toBe("-1.50");
    expect(minutesToHundredths(-1)).toBe(-minutesToHundredths(1));
    expect(formatHundredths(-5)).toBe("-0.05");
  });
});

describe("bankFigures", () => {
  it("Gilad Komorov, October 2026: 15:00 total, 3:04 used, adds up as shown", () => {
    const f = bankFigures(900, 184);
    expect(f).toEqual({ total: "15.00", consumed: "3.07", remaining: "11.93", overdrawn: false });
  });

  it("total always equals consumed plus remaining, to the hundredth", () => {
    for (let total = 0; total <= 1200; total += 7) {
      for (let consumed = 0; consumed <= 1500; consumed += 11) {
        const f = bankFigures(total, consumed);
        const sum = Math.round((Number(f.consumed) + Number(f.remaining)) * 100);
        expect(sum).toBe(Math.round(Number(f.total) * 100));
      }
    }
  });

  it("flags an overdrawn bank", () => {
    expect(bankFigures(600, 630)).toMatchObject({ remaining: "-0.50", overdrawn: true });
  });
});
