import { describe, expect, it } from "vitest";
import { dateCore, dateDuplicatePairs, datesMatch, duplicatePairs, findDateMatches, findNameMatches, namesMatch, normalizeName, sameSchedule, type DateCandidate, type DateKey } from "@/lib/name-match";

// Two names for the same thing: the cases that put two items in the NUX
// file for one, and the ones that must stay two.

describe("namesMatch", () => {
  it("a first name is the full name", () => {
    expect(namesMatch("איילה", "איילה מנצור")).toBe("PARTIAL");
    expect(namesMatch("שני", "שני הלוי")).toBe("PARTIAL");
    expect(namesMatch("Tal", "Tal Cohen")).toBe("PARTIAL");
  });

  it("geresh, quotes and spacing do not make two names", () => {
    expect(namesMatch("ג'נאן", "ג׳נאן עאמר")).toBe("PARTIAL");
    expect(namesMatch("ג'נאן עאמר", "ג׳נאן  עאמר")).toBe("SAME");
    expect(namesMatch("בנק לאומי", "בנק  לאומי.")).toBe("SAME");
    expect(normalizeName("  Doka, Inc. ")).toBe("doka inc");
  });

  it("an abbreviation stands for the words", () => {
    expect(namesMatch("Washington DOR", "Washington Department of Revenue")).toBe("SAME");
    expect(namesMatch("Washington Department of Revenue", "WA DOR")).toBeNull();
  });

  it("a typo in a long word is the same word", () => {
    expect(namesMatch("JustWorks", "Justworkss")).toBe("SAME");
  });

  it("keeps two names two", () => {
    expect(namesMatch("אורן", "אורנה")).toBeNull();
    expect(namesMatch("אורן רובין", "אורנה כהן")).toBeNull();
    expect(namesMatch("NUX Inc", "NUX LTD")).toBeNull();
    expect(namesMatch("בנק לאומי", "בנק הפועלים")).toBeNull();
    expect(namesMatch("דני", "דניאל")).toBeNull();
    expect(namesMatch("", "דני")).toBeNull();
  });
});

describe("findNameMatches and duplicatePairs", () => {
  const file = [
    { id: "a", name: "איילה מנצור" },
    { id: "b", name: "איילה" },
    { id: "c", name: "ג'נאן עאמר" },
    { id: "d", name: "אורנה" },
  ];

  it("finds the existing items, the same name first", () => {
    expect(findNameMatches("איילה", file).map((m) => [m.id, m.kind])).toEqual([
      ["b", "SAME"],
      ["a", "PARTIAL"],
    ]);
    expect(findNameMatches("אורן", file)).toEqual([]);
  });

  it("pairs what is already twice in the file", () => {
    expect(duplicatePairs("CONTACT", file).map((p) => [p.a.id, p.b.id])).toEqual([["a", "b"]]);
  });
});

describe("dates that may be one date", () => {
  const annual = (month: number, day: number): DateKey => ({ recurrence: "ANNUAL", month, day });
  it("the same birthday from two meetings, with different notes", () => {
    expect(datesMatch({ name: "יום הולדת של אורן מירון (ברכה בקבוצה ו-BuyMe 100 ₪)", key: annual(10, 26) }, { name: "יום הולדת של אורן מירון (לידה 26.10.1991)", key: annual(10, 26) })).toBe("SAME");
  });
  it("the first name and the full name on the same day", () => {
    expect(datesMatch({ name: "יום הולדת של אורן", key: annual(10, 26) }, { name: "יום הולדת של אורן מירון", key: annual(10, 26) })).toBe("PARTIAL");
  });
  it("the same title on two days is two dates", () => {
    const m = (day: number): DateKey => ({ recurrence: "MONTHLY", day });
    expect(datesMatch({ name: "תשלום ספקים LTD (ה-10 לחודש)", key: m(10) }, { name: "תשלום ספקים LTD (ה-25 לחודש)", key: m(25) })).toBeNull();
  });
  it("two people on the same day are two dates", () => {
    expect(datesMatch({ name: "יום הולדת של יובל", key: annual(10, 6) }, { name: "יום הולדת של מור", key: annual(10, 6) })).toBeNull();
  });
  it("the next occurrence decides across calendars", () => {
    const a: DateKey = { recurrence: "ANNUAL", calendarType: "HEBREW", month: 2, day: 13, next: "2026-10-25" };
    const b: DateKey = { recurrence: "ANNUAL", month: 10, day: 25, next: "2026-10-25" };
    expect(sameSchedule(a, b)).toBe(true);
    expect(sameSchedule({ ...a, next: null }, { ...b, next: null })).toBe(false);
  });
  it("once, weekly and a different rule", () => {
    expect(sameSchedule({ recurrence: "ONCE", once: "2026-11-02" }, { recurrence: "ONCE", once: "2026-11-02" })).toBe(true);
    expect(sameSchedule({ recurrence: "WEEKLY", weekday: 2 }, { recurrence: "WEEKLY", weekday: 3 })).toBe(false);
    expect(sameSchedule({ recurrence: "MONTHLY", day: 1 }, { recurrence: "ANNUAL", month: 1, day: 1 })).toBe(false);
  });
  it("a title that is only brackets keeps its words", () => {
    expect(dateCore("(חג)")).toBe("(חג)");
  });
  it("lists the pairs in one client's dates", () => {
    const items: DateCandidate[] = [
      { id: "1", name: "יום הולדת של אורן מירון (BuyMe)", key: annual(10, 26) },
      { id: "2", name: "יום הולדת של אורן מירון (לידה 26.10.1991)", key: annual(10, 26) },
      { id: "3", name: "יום הולדת של יובל", key: annual(10, 6) },
    ];
    expect(dateDuplicatePairs("DATE", items).map((p) => [p.a.id, p.b.id])).toEqual([["1", "2"]]);
    expect(findDateMatches({ name: "יום הולדת של יובל (ברכה)", key: annual(10, 6) }, items).map((m) => m.id)).toEqual(["3"]);
  });
});
