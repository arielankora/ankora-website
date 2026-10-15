import { describe, expect, it } from "vitest";
import { changesSubstance, policyShapeError, ruleInForce, ruleLine, POLICY_KINDS, POLICY_KIND_HINTS, POLICY_KIND_LABELS } from "@/lib/client-policies";
import { PAYLOADS, proposalHeadline, TARGET_LABELS } from "@/lib/knowledge-proposals";

// Org brain, phase 3 (claude/org-brain-spec-2026-10-12.md, 3.11): what a
// client rule means right now, decided without a database.

const rule = { title: "תוכנה", statement: "עד 3,000$ בשנה מאושר", interimStatement: "כל הוצאה עוברת לאורן" };

describe("ruleInForce", () => {
  it("an approved rule applies as written; a retired one applies to nothing", () => {
    expect(ruleInForce({ ...rule, status: "ACTIVE" })).toEqual({ text: "עד 3,000$ בשנה מאושר", interim: false });
    expect(ruleInForce({ ...rule, status: "RETIRED" })).toBeNull();
  });

  it("a proposed rule applies through its interim rule, or as written when it has none", () => {
    expect(ruleInForce({ ...rule, status: "PROPOSED" })).toEqual({ text: "כל הוצאה עוברת לאורן", interim: true });
    expect(ruleInForce({ ...rule, status: "PROPOSED", interimStatement: " " })).toEqual({ text: "עד 3,000$ בשנה מאושר", interim: false });
  });

  it("reads as one line that says which rule applies and why", () => {
    expect(ruleLine({ ...rule, status: "PROPOSED" })).toBe("תוכנה: עד שהכלל יאושר, כל הוצאה עוברת לאורן (הכלל המוצע: עד 3,000$ בשנה מאושר)");
    expect(ruleLine({ ...rule, status: "PROPOSED", interimStatement: null })).toBe("תוכנה: עד 3,000$ בשנה מאושר (מוצע, עוד לא אושר)");
    expect(ruleLine({ ...rule, status: "ACTIVE" })).toBe("תוכנה: עד 3,000$ בשנה מאושר");
    expect(ruleLine({ ...rule, status: "RETIRED" })).toBeNull();
  });
});

describe("policyShapeError", () => {
  it("needs a name and the rule itself", () => {
    expect(policyShapeError({ kind: "INFO", status: "PROPOSED", title: " ", statement: "x" })).toContain("שם");
    expect(policyShapeError({ kind: "INFO", status: "PROPOSED", title: "x", statement: "" })).toContain("הכלל עצמו");
  });

  it("a proposed permission needs a careful interim rule; a restriction does not", () => {
    expect(policyShapeError({ kind: "THRESHOLD", status: "PROPOSED", title: "t", statement: "s" })).toContain("כלל ביניים");
    expect(policyShapeError({ kind: "APPROVAL_REQUIRED", status: "PROPOSED", title: "t", statement: "s", interimStatement: "i" })).toBeNull();
    expect(policyShapeError({ kind: "THRESHOLD", status: "ACTIVE", title: "t", statement: "s" })).toBeNull();
    expect(policyShapeError({ kind: "DATA_HANDLING", status: "PROPOSED", title: "t", statement: "s" })).toBeNull();
  });
});

describe("changesSubstance", () => {
  const before = { kind: "INFO", title: "פגישות", statement: "נושאים בלבד", interimStatement: null };
  it("counts what the rule says, not spacing", () => {
    expect(changesSubstance(before, { statement: " נושאים   בלבד " })).toBe(false);
    expect(changesSubstance(before, {})).toBe(false);
    expect(changesSubstance(before, { statement: "נושאים ופרטים" })).toBe(true);
    expect(changesSubstance(before, { kind: "DATA_HANDLING" })).toBe(true);
    expect(changesSubstance(before, { interimStatement: "x" })).toBe(true);
  });
});

describe("labels and proposals", () => {
  it("every kind has a label and a hint", () => {
    for (const k of POLICY_KINDS) {
      expect(POLICY_KIND_LABELS[k]).toBeTruthy();
      expect(POLICY_KIND_HINTS[k]).toBeTruthy();
    }
  });

  it("a rule can be proposed, and is named by its title and text", () => {
    expect(TARGET_LABELS.POLICY).toBe("כלל של הלקוח");
    expect(PAYLOADS.POLICY.safeParse({ kind: "DISCLOSURE", title: "עזיבת גיא", statement: "לא מספרים לעובדים" }).success).toBe(true);
    expect(PAYLOADS.POLICY.safeParse({ kind: "VENDOR", title: "x", statement: "y" }).success).toBe(false);
    expect(proposalHeadline("POLICY", { title: "עזיבת גיא", statement: "לא מספרים לעובדים" })).toBe("עזיבת גיא: לא מספרים לעובדים");
  });
});
