import { describe, expect, it } from "vitest";
import { missingRequired, proposalProblems, reviewConfidence, reviewRank, reviewSummary } from "@/lib/knowledge-proposals";

// Spec 5.2: a normal batch in under five minutes. What a proposal must
// say, how sure it is as the reviewer should read it, and its place on
// the card.

describe("what a proposal must say", () => {
  it("a reason, and a status where the item has one", () => {
    expect(missingRequired("FACT", { kind: "NOTE", body: "x", knowledgeStatus: "CONFIRMED" }, " ")).toMatch("סיבה");
    expect(missingRequired("SYSTEM", { systemName: "Mercury" }, "נאמר ב-08:13")).toMatch("סטטוס");
    expect(missingRequired("SYSTEM", { systemName: "Mercury", knowledgeStatus: "CONFIRMED" }, "נאמר ב-08:13")).toBeNull();
    // A question is missing by nature; a text and a domain have no status.
    expect(missingRequired("FACT", { kind: "QUESTION", body: "מתי?" }, "עלה בפגישה")).toBeNull();
    expect(missingRequired("NARRATIVE", { kind: "OVERVIEW", body: "x" }, "סיכום")).toBeNull();
    expect(missingRequired("DOMAIN", { domain: "nux.ai", kind: "CLIENT" }, "המשתתפים")).toBeNull();
  });

  it("uncertain without what would close it is blocked until edited", () => {
    expect(proposalProblems("SYSTEM", { systemName: "Mercury", knowledgeStatus: "UNCERTAIN" }, [])).toEqual([expect.objectContaining({ code: "SHAPE", block: true })]);
    expect(proposalProblems("SYSTEM", { systemName: "Mercury", knowledgeStatus: "UNCERTAIN", toResolve: "לשאול את שני" }, [])).toEqual([]);
  });
});

describe("how sure", () => {
  it("is what Claude said, one lower for each thing the server sees, with why", () => {
    expect(reviewConfidence({ confidence: "HIGH", flags: [], payload: {}, at: "08:13", sourceKind: "TRANSCRIPT" })).toEqual({ level: "HIGH", why: [] });
    expect(reviewConfidence({ confidence: "HIGH", flags: [], payload: {}, at: null, sourceKind: "TRANSCRIPT" })).toEqual({ level: "MEDIUM", why: ["בלי דקה בהקלטה"] });
    expect(reviewConfidence({ confidence: "HIGH", flags: [{ code: "R14", message: "" }], payload: { knowledgeStatus: "UNCERTAIN" }, at: "01:00", sourceKind: "ANKORA_DOCUMENT" }).level).toBe("LOW");
    // A document has no minute.
    expect(reviewConfidence({ confidence: "HIGH", flags: [], payload: {}, sourceKind: "CLIENT_DOCUMENT" }).level).toBe("HIGH");
    expect(reviewConfidence({ flags: [], payload: {}, at: "01:00", sourceKind: "TRANSCRIPT" })).toEqual({ level: "MEDIUM", why: ["Claude לא ציין עד כמה הוא בטוח"] });
  });
});

describe("the card's order", () => {
  const base = { action: "CREATE" as const, flags: [], payload: {} };
  it("blocked, then one at a time, then low to high", () => {
    expect(reviewRank({ ...base, flags: [{ code: "R17", message: "", block: true }], level: "HIGH" })).toBe(0);
    expect(reviewRank({ ...base, action: "SUPERSEDE", level: "HIGH" })).toBe(1);
    expect(reviewRank({ ...base, payload: { sensitivity: "SENSITIVE" }, level: "HIGH" })).toBe(1);
    expect(reviewRank({ ...base, level: "LOW" })).toBe(2);
    expect(reviewRank({ ...base, level: "MEDIUM" })).toBe(3);
    expect(reviewRank({ ...base, level: "HIGH" })).toBe(4);
  });

  it("says on top how much goes together", () => {
    expect(reviewSummary([])).toBeNull();
    expect(reviewSummary([4, 4, 3])).toBe("אפשר לאשר את כל ה-3 יחד.");
    expect(reviewSummary([4])).toBe("הצעה אחת, אפשר לאשר ישר.");
    expect(reviewSummary([0, 1])).toBe("2 הצעות לבדוק אחת אחת.");
    expect(reviewSummary([1, 4, 4])).toBe("אחת לבדוק לבד, ו-2 אפשר לאשר יחד.");
    expect(reviewSummary([0, 1, 4])).toBe("2 לבדוק אחת אחת, ואחת אפשר לאשר יחד.");
  });
});
