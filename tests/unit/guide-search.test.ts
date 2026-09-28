import { describe, expect, it } from "vitest";
import { GUIDE_GROUPS } from "@/app/(product)/app/(authenticated)/guide/content";
import { filterGuide, highlightParts, queryWords } from "@/app/(product)/app/(authenticated)/guide/search";

// Ariel, 26.9.2026: search in the user guide. Tested against the real
// guide content, because a search that works on a fixture and finds
// nothing in the actual text is the failure a person would notice.

const titles = (groups: ReturnType<typeof filterGuide>) => groups.flatMap((g) => g.sections.map((s) => s.title));

describe("the guide search", () => {
  it("shows everything for an empty query", () => {
    expect(filterGuide(GUIDE_GROUPS, "  ")).toEqual(GUIDE_GROUPS);
  });

  it("finds a section by a word in its body, not only its title", () => {
    // "מפקח" is explained inside the tasks section; no section is titled
    // with it.
    expect(titles(filterGuide(GUIDE_GROUPS, "מפקח"))).toContain("משימות");
  });

  it("needs every word, not any word, so more words narrow the result", () => {
    const one = titles(filterGuide(GUIDE_GROUPS, "משימה"));
    const two = titles(filterGuide(GUIDE_GROUPS, "משימה ייצוא"));
    expect(two.length).toBeLessThanOrEqual(one.length);
    expect(two.every((t) => one.includes(t))).toBe(true);
  });

  it("ignores case for the English words in the guide", () => {
    expect(titles(filterGuide(GUIDE_GROUPS, "claude")).length).toBeGreaterThan(0);
    expect(titles(filterGuide(GUIDE_GROUPS, "claude"))).toEqual(titles(filterGuide(GUIDE_GROUPS, "CLAUDE")));
  });

  it("drops groups with nothing left in them", () => {
    const groups = filterGuide(GUIDE_GROUPS, "מילה-שלא-קיימת-בשום-מקום");
    expect(groups).toEqual([]);
  });

  it("marks the matched words for highlighting, whole", () => {
    const parts = highlightParts("חיבור Claude פעיל", queryWords("claude"));
    expect(parts).toEqual([
      { text: "חיבור ", match: false },
      { text: "Claude", match: true },
      { text: " פעיל", match: false },
    ]);
  });

  it("does not choke on characters that mean something in a regex", () => {
    expect(() => highlightParts("מחיר (כולל מע\"מ)", queryWords("(כולל"))).not.toThrow();
  });
});
