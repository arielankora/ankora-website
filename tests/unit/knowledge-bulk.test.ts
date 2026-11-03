import { describe, expect, it } from "vitest";
import { AUTO_FACT_KINDS, approvalTier, bulkApproveBlocker, revertBlocker, type TierInput } from "@/lib/knowledge-proposals";

// "ממתין לאישור" (spec 5.2): which proposals may be approved together, and
// the approval tiers (3.11.2026): what may enter on its own (AUTO), what
// may be approved together (QUICK), and what is approved one at a time
// (INDIVIDUAL).

const p: TierInput = { target: "FACT", action: "CREATE", flags: [], payload: { kind: "NOTE" }, level: "HIGH" };

describe("bulkApproveBlocker", () => {
  it("a new item with no warning may be approved with others", () => {
    expect(bulkApproveBlocker(p)).toBeNull();
    expect(bulkApproveBlocker({ ...p, level: "MEDIUM" })).toBeNull();
    // An Ankora source or a proposed rule: information, not a reason to wait.
    expect(bulkApproveBlocker({ ...p, flags: [{ code: "R14", message: "" }, { code: "POLICY", message: "" }] })).toBeNull();
  });
  it("what changes an existing item, may already be there, or is sensitive, one at a time", () => {
    expect(bulkApproveBlocker({ ...p, action: "SUPERSEDE" })).toContain("בתיק");
    expect(bulkApproveBlocker({ ...p, action: "CONTRADICT" })).toContain("בתיק");
    expect(bulkApproveBlocker({ ...p, flags: [{ code: "DUPLICATE", message: "" }] })).toContain("כבר");
    expect(bulkApproveBlocker({ ...p, payload: { sensitivity: "SENSITIVE" } })).toContain("רגיש");
  });
  it("3.11.2026: a task and a low review level are no longer approved together", () => {
    expect(bulkApproveBlocker({ ...p, target: "TASK", payload: { title: "לשלוח חוזה" } })).toBe("משימה נפתחת לאדם אחר");
    expect(bulkApproveBlocker({ ...p, level: "LOW" })).toBe("רמת בדיקה נמוכה");
  });
});

describe("approvalTier", () => {
  it("AUTO: a new simple item at a high review level, with nothing to look at", () => {
    for (const kind of AUTO_FACT_KINDS) expect(approvalTier({ ...p, payload: { kind } }).tier).toBe("AUTO");
    for (const target of ["CONTACT", "ORGANIZATION", "ENTITY"] as const) expect(approvalTier({ ...p, target, payload: { name: "x" } }).tier).toBe("AUTO");
    expect(approvalTier(p).reason).toBe("פריט חדש ופשוט, ברמת בדיקה גבוהה");
    // Information on a flag is not a reason to wait.
    expect(approvalTier({ ...p, flags: [{ code: "POLICY", message: "" }] }).tier).toBe("AUTO");
    expect(approvalTier({ ...p, payload: { kind: "NOTE", doNotDisclose: "  ", clientVisible: false } }).tier).toBe("AUTO");
  });

  it("QUICK: a simple item at medium, a date, a question, temporary, and the other kinds at high or medium", () => {
    expect(approvalTier({ ...p, level: "MEDIUM" })).toEqual({ tier: "QUICK", reason: "רמת בדיקה בינונית" });
    expect(approvalTier({ ...p, target: "CONTACT", payload: { name: "x" }, level: "MEDIUM" }).tier).toBe("QUICK");
    expect(approvalTier({ ...p, payload: { kind: "QUESTION" } })).toEqual({ tier: "QUICK", reason: "שאלה פתוחה" });
    expect(approvalTier({ ...p, payload: { kind: "TEMPORARY" } })).toEqual({ tier: "QUICK", reason: "מידע זמני" });
    expect(approvalTier({ ...p, payload: { kind: "QUESTION" }, level: "MEDIUM" }).tier).toBe("QUICK");
    for (const target of ["DATE", "POLICY", "SYSTEM", "PROCESS", "NARRATIVE", "REQUEST_TYPE"] as const) {
      for (const level of ["HIGH", "MEDIUM"] as const) {
        const t = approvalTier({ ...p, target, payload: {}, level });
        expect(t.tier).toBe("QUICK");
        expect(t.reason).toContain("לא נכנס בלי אדם");
      }
    }
  });

  it("INDIVIDUAL: a change, a task, a domain, sensitive, not to tell, client-visible, blocked, maybe in the file, or low", () => {
    const one = (over: Partial<TierInput>) => approvalTier({ ...p, ...over });
    expect(one({ action: "SUPERSEDE" })).toEqual({ tier: "INDIVIDUAL", reason: "משנה פריט שכבר בתיק" });
    expect(one({ action: "CONTRADICT" }).tier).toBe("INDIVIDUAL");
    expect(one({ target: "TASK", payload: { title: "x" } })).toEqual({ tier: "INDIVIDUAL", reason: "משימה נפתחת לאדם אחר" });
    expect(one({ target: "DOMAIN", payload: { domain: "nux.ai", kind: "CLIENT" } }).tier).toBe("INDIVIDUAL");
    expect(one({ payload: { kind: "NOTE", sensitivity: "SENSITIVE" } })).toEqual({ tier: "INDIVIDUAL", reason: "מידע רגיש" });
    expect(one({ flags: [{ code: "R6", message: "" }] }).reason).toBe("מידע רגיש");
    expect(one({ payload: { kind: "NOTE", doNotDisclose: "לא לספר לאורן" } })).toEqual({ tier: "INDIVIDUAL", reason: "יש בה מה לא לספר" });
    expect(one({ payload: { kind: "NOTE", clientVisible: true } })).toEqual({ tier: "INDIVIDUAL", reason: "גלוי ללקוח" });
    expect(one({ flags: [{ code: "R17", message: "", block: true }] })).toEqual({ tier: "INDIVIDUAL", reason: "יש בה משהו שחוסם אישור" });
    expect(one({ flags: [{ code: "DUPLICATE", message: "" }] }).reason).toBe("ייתכן שכבר בתיק");
    expect(one({ flags: [{ code: "SIMILAR", message: "" }] }).reason).toBe("ייתכן שכבר בתיק");
    // Low, whatever the kind.
    for (const target of ["FACT", "CONTACT", "DATE", "POLICY", "PROCESS"] as const) {
      expect(one({ target, payload: { kind: "NOTE" }, level: "LOW" })).toEqual({ tier: "INDIVIDUAL", reason: "רמת בדיקה נמוכה" });
    }
  });

  it("the first reason to look is the one said, and a low level never hides a block", () => {
    expect(approvalTier({ ...p, level: "LOW", flags: [{ code: "R17", message: "", block: true }] }).reason).toBe("יש בה משהו שחוסם אישור");
    expect(approvalTier({ ...p, level: "LOW", target: "TASK", payload: {} }).reason).toBe("משימה נפתחת לאדם אחר");
  });

  it("is what bulk approval reads: INDIVIDUAL and only INDIVIDUAL waits", () => {
    const cases: TierInput[] = [p, { ...p, level: "MEDIUM" }, { ...p, level: "LOW" }, { ...p, target: "TASK" }, { ...p, target: "DATE", payload: {} }, { ...p, action: "SUPERSEDE" }];
    for (const c of cases) expect(bulkApproveBlocker(c) !== null).toBe(approvalTier(c).tier === "INDIVIDUAL");
  });
});

describe("revertBlocker", () => {
  const ok = { state: "APPROVED", action: "CREATE", target: "FACT", attached: false, resultId: "f1", revertedAt: null };
  it("a new fact, contact, provider or entity the approval created may be taken out, once", () => {
    for (const target of ["FACT", "CONTACT", "ORGANIZATION", "ENTITY"]) expect(revertBlocker({ ...ok, target })).toBeNull();
    expect(revertBlocker({ ...ok, revertedAt: new Date() })).toBe("ההצעה כבר בוטלה.");
  });
  it("anything else is refused, with why", () => {
    expect(revertBlocker({ ...ok, state: "PENDING" })).toContain("שאושרה");
    expect(revertBlocker({ ...ok, state: "REJECTED" })).toContain("שאושרה");
    expect(revertBlocker({ ...ok, action: "SUPERSEDE" })).toContain("לא לשינוי");
    expect(revertBlocker({ ...ok, attached: true })).toContain("כבר היה בתיק");
    expect(revertBlocker({ ...ok, resultId: null })).toContain("אין מה לבטל");
    expect(revertBlocker({ ...ok, target: "TASK" })).toContain("משימה");
    expect(revertBlocker({ ...ok, target: "DATE" })).toContain("מועד");
  });
});
