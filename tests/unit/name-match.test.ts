import { describe, expect, it } from "vitest";
import { duplicatePairs, findNameMatches, namesMatch, normalizeName } from "@/lib/name-match";

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
