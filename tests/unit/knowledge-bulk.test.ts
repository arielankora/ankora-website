import { describe, expect, it } from "vitest";
import { AUTO_FACT_KINDS, approvalTier, bulkApproveBlocker, isAutoSupersede, revertBlocker, revertBlockerOf, type TierInput } from "@/lib/knowledge-proposals";

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
  it("what changes an existing item or may already be there, one at a time", () => {
    expect(bulkApproveBlocker({ ...p, action: "SUPERSEDE", level: "MEDIUM" })).toContain("בתיק");
    expect(bulkApproveBlocker({ ...p, action: "CONTRADICT" })).toContain("בתיק");
    expect(bulkApproveBlocker({ ...p, flags: [{ code: "DUPLICATE", message: "" }] })).toContain("כבר");
  });
  it("19.11.2026: sensitive goes with others, since only its approvers see it", () => {
    expect(bulkApproveBlocker({ ...p, payload: { kind: "NOTE", sensitivity: "SENSITIVE" } })).toBeNull();
    expect(bulkApproveBlocker({ ...p, flags: [{ code: "R6", message: "" }] })).toBeNull();
    // What else keeps it on its own still does.
    expect(bulkApproveBlocker({ ...p, action: "SUPERSEDE", payload: { sensitivity: "SENSITIVE" } })).toContain("בתיק");
    expect(bulkApproveBlocker({ ...p, level: "LOW", payload: { kind: "NOTE", sensitivity: "SENSITIVE" } })).toBe("רמת בדיקה נמוכה");
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

  it("INDIVIDUAL: a change, a task, a domain, not to tell, client-visible, blocked, maybe in the file, or low", () => {
    const one = (over: Partial<TierInput>) => approvalTier({ ...p, ...over });
    expect(one({ action: "SUPERSEDE", level: "MEDIUM" })).toEqual({ tier: "INDIVIDUAL", reason: "משנה פריט שכבר בתיק" });
    expect(one({ action: "CONTRADICT" }).tier).toBe("INDIVIDUAL");
    expect(one({ target: "TASK", payload: { title: "x" } })).toEqual({ tier: "INDIVIDUAL", reason: "משימה נפתחת לאדם אחר" });
    expect(one({ target: "DOMAIN", payload: { domain: "nux.ai", kind: "CLIENT" } }).tier).toBe("INDIVIDUAL");
    // 19.11.2026: sensitive is QUICK, never AUTO.
    expect(one({ payload: { kind: "NOTE", sensitivity: "SENSITIVE" } })).toEqual({ tier: "QUICK", reason: "מידע רגיש" });
    expect(one({ flags: [{ code: "R6", message: "" }] })).toEqual({ tier: "QUICK", reason: "מידע רגיש" });
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
    const cases: TierInput[] = [p, { ...p, level: "MEDIUM" }, { ...p, level: "LOW" }, { ...p, target: "TASK" }, { ...p, target: "DATE", payload: {} }, { ...p, action: "SUPERSEDE" }, { ...p, action: "SUPERSEDE", level: "MEDIUM" }];
    for (const c of cases) expect(bulkApproveBlocker(c) !== null).toBe(approvalTier(c).tier === "INDIVIDUAL");
  });
});

describe("approvalTier: an update (SUPERSEDE), 28.11.2026", () => {
  const up: TierInput = { target: "CONTACT", action: "SUPERSEDE", flags: [], payload: { role: "CFO" }, level: "HIGH" };
  const auto = { tier: "AUTO", reason: "עדכון פשוט לפריט שבתיק, ברמת בדיקה גבוהה" };
  const individual = { tier: "INDIVIDUAL", reason: "משנה פריט שכבר בתיק" };

  it("AUTO: an update of a contact, provider, entity, system, request type or simple fact at a high level", () => {
    for (const target of ["CONTACT", "ORGANIZATION", "ENTITY", "SYSTEM", "REQUEST_TYPE"] as const) {
      expect(approvalTier({ ...up, target }), target).toEqual(auto);
      expect(isAutoSupersede({ ...up, target }), target).toBe(true);
    }
    for (const kind of AUTO_FACT_KINDS) expect(approvalTier({ ...up, target: "FACT", payload: { kind, body: "x" } }), kind).toEqual(auto);
    // Information on a flag, and fields that are empty or false, are no reason to wait.
    expect(approvalTier({ ...up, flags: [{ code: "R14", message: "" }], payload: { role: "CFO", doNotDisclose: " ", clientVisible: false } })).toEqual(auto);
    // Approved together like any AUTO: it is no longer one at a time.
    expect(bulkApproveBlocker(up)).toBeNull();
  });

  it("INDIVIDUAL: a question or temporary fact, a process or a rule, and a contradiction", () => {
    expect(approvalTier({ ...up, target: "FACT", payload: { kind: "QUESTION", body: "x" } })).toEqual(individual);
    expect(approvalTier({ ...up, target: "FACT", payload: { kind: "TEMPORARY", body: "x" } })).toEqual(individual);
    expect(approvalTier({ ...up, target: "FACT", payload: { body: "x" } })).toEqual(individual);
    for (const target of ["PROCESS", "POLICY", "NARRATIVE", "DATE", "DOMAIN", "TASK"] as const) expect(approvalTier({ ...up, target }), target).toEqual(individual);
    expect(approvalTier({ ...up, action: "CONTRADICT" })).toEqual(individual);
    expect(approvalTier({ ...up, target: "FACT", action: "CONTRADICT", payload: { kind: "NOTE", body: "x" } })).toEqual(individual);
  });

  it("INDIVIDUAL: medium or low, sensitive, not to tell, client-visible", () => {
    expect(approvalTier({ ...up, level: "MEDIUM" })).toEqual(individual);
    expect(approvalTier({ ...up, level: "LOW" })).toEqual(individual);
    expect(approvalTier({ ...up, payload: { role: "CFO", sensitivity: "SENSITIVE" } })).toEqual(individual);
    expect(approvalTier({ ...up, flags: [{ code: "R6", message: "" }] })).toEqual(individual);
    expect(approvalTier({ ...up, payload: { role: "CFO", doNotDisclose: "לא לספר לאורן" } })).toEqual(individual);
    expect(approvalTier({ ...up, payload: { role: "CFO", clientVisible: true } })).toEqual(individual);
  });

  it("INDIVIDUAL: a blocking flag, or maybe already in the file", () => {
    expect(approvalTier({ ...up, flags: [{ code: "R17", message: "", block: true }] })).toEqual({ tier: "INDIVIDUAL", reason: "יש בה משהו שחוסם אישור" });
    expect(approvalTier({ ...up, flags: [{ code: "DUPLICATE", message: "" }] })).toEqual(individual);
    expect(approvalTier({ ...up, flags: [{ code: "SIMILAR", message: "" }] })).toEqual(individual);
  });

  it("enters on its own only where \"ביטול\" would put it back once approved", () => {
    for (const target of ["FACT", "CONTACT", "ORGANIZATION", "ENTITY", "SYSTEM", "REQUEST_TYPE", "PROCESS", "POLICY"] as const) {
      const input: TierInput = { ...up, target, payload: target === "FACT" ? { kind: "NOTE", body: "x" } : { role: "x" } };
      const revertible = revertBlocker({ state: "APPROVED", action: "SUPERSEDE", target, attached: false, resultId: "r", revertedAt: null }) === null;
      if (!revertible) expect(approvalTier(input).tier, target).toBe("INDIVIDUAL");
      if (approvalTier(input).tier === "AUTO") expect(revertible, target).toBe(true);
    }
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
    expect(revertBlocker({ ...ok, attached: true })).toContain("כבר היה בתיק");
    expect(revertBlocker({ ...ok, resultId: null })).toContain("אין מה לבטל");
    expect(revertBlocker({ ...ok, target: "TASK" })).toContain("משימה");
    expect(revertBlocker({ ...ok, target: "DATE" })).toContain("מועד");
    // A new system or request type is not taken out (no CREATE revert for them).
    expect(revertBlocker({ ...ok, target: "SYSTEM" })).toContain("למערכת");
    expect(revertBlocker({ ...ok, target: "REQUEST_TYPE" })).toContain("לסוג פנייה");
  });
  it("19.11.2026: an approved change of a fact, contact, provider, entity, system or request type is put back, once", () => {
    for (const action of ["SUPERSEDE", "CONTRADICT"]) {
      for (const target of ["FACT", "CONTACT", "ORGANIZATION", "ENTITY", "SYSTEM", "REQUEST_TYPE"]) expect(revertBlocker({ ...ok, action, target })).toBeNull();
      expect(revertBlocker({ ...ok, action, revertedAt: new Date() })).toBe("ההצעה כבר בוטלה.");
      expect(revertBlocker({ ...ok, action, state: "PENDING" })).toContain("שאושרה");
    }
  });
  it("a change of a process or a rule is a decision by hand, and says why", () => {
    for (const action of ["SUPERSEDE", "CONTRADICT"]) {
      expect(revertBlockerOf({ ...ok, action, target: "PROCESS" })).toEqual({ code: "manualUndo", message: expect.stringContaining("טיוטת נוהל") });
      expect(revertBlockerOf({ ...ok, action, target: "POLICY" })).toEqual({ code: "manualUndo", message: expect.stringContaining("מוצע") });
    }
  });
  it("a change that changed nothing, or of another kind, is refused", () => {
    expect(revertBlockerOf({ ...ok, action: "SUPERSEDE", target: "CONTACT", attached: true })?.code).toBe("nothingChanged");
    expect(revertBlockerOf({ ...ok, action: "SUPERSEDE", target: "CONTACT", resultId: null })?.code).toBe("nothingChanged");
    expect(revertBlockerOf({ ...ok, action: "SUPERSEDE", target: "NARRATIVE" })).toEqual({ code: "changeWrongKind", message: expect.stringContaining("לסקירה") });
    // A PROCESS change is refused for being a process, before anything else.
    expect(revertBlockerOf({ ...ok, action: "SUPERSEDE", target: "PROCESS", attached: true })?.code).toBe("manualUndo");
  });
});
