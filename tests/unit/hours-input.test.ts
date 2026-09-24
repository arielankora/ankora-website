import { describe, expect, it } from "vitest";
import { parseHoursInput } from "@/lib/hours-input";

describe("parseHoursInput()", () => {
  it("reads a whole number as hours, which is what 111 meant for Grantor", () => {
    expect(parseHoursInput("111")).toBe(6660);
  });

  it("reads decimal hours, with a dot or a comma", () => {
    expect(parseHoursInput("7.5")).toBe(450);
    expect(parseHoursInput("7,5")).toBe(450);
  });

  it("reads hours and minutes", () => {
    expect(parseHoursInput("98:04")).toBe(5884);
    expect(parseHoursInput("0:45")).toBe(45);
  });

  it("refuses a negative amount unless it is an adjustment", () => {
    expect(parseHoursInput("-1:30")).toBeNull();
    expect(parseHoursInput("-1:30", { allowNegative: true })).toBe(-90);
    expect(parseHoursInput("-2", { allowNegative: true })).toBe(-120);
  });

  it("returns null for anything else, rather than guessing", () => {
    expect(parseHoursInput("")).toBeNull();
    expect(parseHoursInput("abc")).toBeNull();
    expect(parseHoursInput("1:75")).toBeNull();
    expect(parseHoursInput(null)).toBeNull();
  });
});
