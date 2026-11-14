import { describe, expect, it } from "vitest";
import { buildGuideRules, oneLine, sameRules } from "@/lib/extraction-guide-rules";

// propose_extraction_guide_version (14.11.2026): the rule list Claude
// proposes, built from the version in use when it only adds rules.

const current = ["א", "ב", "ג"];

describe("buildGuideRules", () => {
  it("adds at the end when no place is given", () => {
    expect(buildGuideRules(current, { addRules: ["ד"] })).toEqual({ ok: true, rules: ["א", "ב", "ג", "ד"] });
  });

  it("adds after the rule numbered from 1, and first with 0", () => {
    expect(buildGuideRules(current, { addRules: ["חדש 1", "חדש 2"], afterRule: 1 })).toEqual({ ok: true, rules: ["א", "חדש 1", "חדש 2", "ב", "ג"] });
    expect(buildGuideRules(current, { addRules: ["חדש"], afterRule: 0 })).toEqual({ ok: true, rules: ["חדש", "א", "ב", "ג"] });
    expect(buildGuideRules(current, { addRules: ["חדש"], afterRule: 3 })).toEqual({ ok: true, rules: ["א", "ב", "ג", "חדש"] });
  });

  it("refuses a place outside the list", () => {
    const r = buildGuideRules(current, { addRules: ["חדש"], afterRule: 4 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain("from 0 (first) to 3");
    expect(buildGuideRules(current, { addRules: ["חדש"], afterRule: -1 }).ok).toBe(false);
    expect(buildGuideRules(current, { addRules: ["חדש"], afterRule: 1.5 }).ok).toBe(false);
  });

  it("takes the full list as given, one line per rule", () => {
    expect(buildGuideRules(current, { rules: ["  x\n y ", "", "z"] })).toEqual({ ok: true, rules: ["x y", "z"] });
  });

  it("refuses both, neither, afterRule with a full list, and only blank additions", () => {
    expect(buildGuideRules(current, {}).ok).toBe(false);
    expect(buildGuideRules(current, { rules: ["x"], addRules: ["y"] }).ok).toBe(false);
    expect(buildGuideRules(current, { rules: ["x"], afterRule: 1 }).ok).toBe(false);
    expect(buildGuideRules(current, { addRules: [" ", "\n"] }).ok).toBe(false);
  });
});

describe("oneLine and sameRules", () => {
  it("folds a rule onto one line and compares lists rule by rule", () => {
    expect(oneLine(" a\r\n\tb ")).toBe("a b");
    expect(sameRules(["a b", "c"], ["a  b", " c"])).toBe(true);
    expect(sameRules(["a", "c"], ["c", "a"])).toBe(false);
    expect(sameRules(["a"], ["a", "b"])).toBe(false);
  });
});
