import { describe, it, expect } from "vitest";
import { parsePageNumber, MAX_PAGE } from "../../lib/url-numbers";
import { rawUrlNumbers } from "../../qa/checks/boundary.mjs";

// `?page=` from the audit log, and the rule that stops the next one.
//
// The old line was `Math.max(1, Number(searchParams.page) || 1)`. It handles
// exactly the cases people think of, and neither of the two that break it.

describe("a page number out of a query string", () => {
  it("takes an ordinary page", () => {
    expect(parsePageNumber("3")).toBe(3);
    expect(parsePageNumber("1")).toBe(1);
  });

  it("falls back to the first page for the cases the old code did handle", () => {
    expect(parsePageNumber("abc")).toBe(1);
    expect(parsePageNumber("")).toBe(1);
    expect(parsePageNumber(undefined)).toBe(1);
    expect(parsePageNumber(null)).toBe(1);
    expect(parsePageNumber("-5")).toBe(1);
    expect(parsePageNumber("0")).toBe(1);
  });

  // The two that reached Prisma as a non-integer `skip` and 500'd the screen.
  it("refuses a fractional page", () => {
    expect(parsePageNumber("1.001")).toBe(1);
    expect(parsePageNumber("2.5")).toBe(2);
    expect(Number.isInteger(parsePageNumber("2.5"))).toBe(true);
  });

  it("refuses an infinite page", () => {
    expect(parsePageNumber("1e999")).toBe(1);
    expect(parsePageNumber("Infinity")).toBe(1);
    expect(parsePageNumber("-Infinity")).toBe(1);
  });

  it("always returns something that is safe to multiply into a skip", () => {
    const PAGE_SIZE = 25;
    for (const raw of ["abc", "1.001", "1e999", "-5", "0", "99999999999", "3", null, undefined]) {
      const skip = (parsePageNumber(raw) - 1) * PAGE_SIZE;
      expect(Number.isSafeInteger(skip), `?page=${raw}`).toBe(true);
      expect(skip).toBeGreaterThanOrEqual(0);
    }
  });

  it("treats a page past the end as the first page rather than an error", () => {
    expect(parsePageNumber(String(MAX_PAGE + 1))).toBe(1);
    expect(parsePageNumber(String(MAX_PAGE))).toBe(MAX_PAGE);
  });
});

describe("the rule that stops the next one", () => {
  it("flags a raw coercion of a URL value", () => {
    const hits = rawUrlNumbers(`const page = Math.max(1, Number(searchParams.page) || 1);`);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
  });

  it("flags the shape the portal shipped in September too", () => {
    expect(rawUrlNumbers(`const offset = Number(searchParams.monthOffset || 0);`)).toHaveLength(1);
    expect(rawUrlNumbers(`const n = parseInt(params.page, 10);`)).toHaveLength(1);
  });

  it("accepts the approved parsers", () => {
    expect(rawUrlNumbers(`const page = parsePageNumber(searchParams.page);`)).toEqual([]);
    expect(rawUrlNumbers(`const o = parsePeriodOffset(searchParams.monthOffset, MAX_MONTH_OFFSET);`)).toEqual([]);
  });

  it("leaves numbers that did not come from a URL alone", () => {
    expect(rawUrlNumbers(`const total = Number(row.minutes);`)).toEqual([]);
    expect(rawUrlNumbers(`const n = parseInt(process.env.PAGE_SIZE ?? "25", 10);`)).toEqual([]);
  });

  it("does not read a commented-out line as code", () => {
    expect(rawUrlNumbers(`// const page = Number(searchParams.page);`)).toEqual([]);
  });
});
