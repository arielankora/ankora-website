import { describe, expect, it } from "vitest";
import { proposalProblems, suggestedFix, SUGGESTED_INTERIM, suggestedToResolve, suggestedVerification } from "@/lib/knowledge-proposals";

// 3.11.2026: a missing-field note says why the field is needed and offers
// a wording that is approved in one press. Notes that repeat on several
// steps are one line.
describe("missing-field notes with a suggested wording", () => {
  it("a proposed approval rule without its interim rule: why, and the approved wording", () => {
    const [f] = proposalProblems("POLICY", { kind: "APPROVAL_REQUIRED", title: "כניסה אוטומטית", statement: "רק ברמה האוטומטית" }, []);
    expect(f).toMatchObject({ code: "SHAPE", block: true, fix: { label: SUGGESTED_INTERIM, edits: { interimStatement: "כמו היום, עד שהכלל מאושר." } } });
    expect(f.why).toContain("בינתיים");
    expect(suggestedFix([f])).toEqual({ interimStatement: SUGGESTED_INTERIM });
  });

  it("five automated steps without a check are one line, with the steps and a wording for each", () => {
    const steps = [
      { title: "איסוף", mode: "MANUAL" },
      { title: "שליחה", mode: "AUTOMATED", output: "מייל בתיבת היוצאים" },
      { title: "תיוק", mode: "AUTOMATED" },
      { title: "תזכורת", mode: "AUTOMATED", verification: "הדס רואה ביומן" },
      { title: "סיכום", mode: "AUTOMATED" },
    ];
    const flags = proposalProblems("PROCESS", { name: "P1", steps }, []);
    const r3 = flags.filter((f) => f.code === "R3");
    expect(r3).toHaveLength(1);
    expect(r3[0].steps).toEqual([2, 3, 5]);
    expect(r3[0].block).toBeFalsy();
    expect(r3[0].message).toContain("שלבים 2, 3 ו-5 אוטומטיים");
    expect(r3[0].fix!.label).toBe("שלב 2: אדם בודק שמייל בתיבת היוצאים קיים. שלב 3: אדם בודק שהשלב בוצע. שלב 5: אדם בודק שהשלב בוצע.");
    const filled = (r3[0].fix!.edits.steps as Record<string, unknown>[]).map((s) => s.verification ?? null);
    expect(filled).toEqual([null, "אדם בודק שמייל בתיבת היוצאים קיים.", "אדם בודק שהשלב בוצע.", "הדס רואה ביומן", "אדם בודק שהשלב בוצע."]);
    // Filled in, the process has nothing left to say.
    expect(proposalProblems("PROCESS", { name: "P1", ...r3[0].fix!.edits }, []).filter((f) => f.code === "R3")).toEqual([]);
  });

  it("one automated step says 'שלב', not 'שלבים'", () => {
    const [f] = proposalProblems("PROCESS", { name: "P1", steps: [{ title: "שליחה", mode: "AUTOMATED" }] }, []);
    expect(f.message).toMatch(/^שלב 1 אוטומטי:/);
  });

  it("not confirmed without what would close it: the source's name in the wording", () => {
    const [f] = proposalProblems("FACT", { kind: "NOTE", body: "x", knowledgeStatus: "UNCERTAIN" }, [], { sourceTitle: "פגישת היכרות" });
    expect(f.fix).toEqual({ label: "אישור מפגישת היכרות.", edits: { toResolve: "אישור מפגישת היכרות." } });
    expect(suggestedToResolve(null)).toBe("אישור מהמקור של ההצעה.");
  });

  it("shown to the client when it may not be: the wording takes it off", () => {
    const [f] = proposalProblems("FACT", { kind: "NOTE", body: "x", clientVisible: true, sensitivity: "SENSITIVE" }, []);
    expect(f.fix?.edits).toEqual({ clientVisible: false });
  });

  it("no ready wording where none is safe: only why, and the edit", () => {
    const [f] = proposalProblems("FACT", { kind: "TEMPORARY", body: "x" }, []);
    expect(f.why).toBeTruthy();
    expect(f.fix).toBeUndefined();
    expect(suggestedFix([f])).toBeNull();
    // One problem with no wording holds back the one-press approval.
    const interim = proposalProblems("POLICY", { kind: "THRESHOLD", title: "t", statement: "s [S9]" }, []);
    expect(interim.map((x) => x.code).sort()).toEqual(["R17", "SHAPE"]);
    expect(suggestedFix(interim)).toBeNull();
  });

  it("a long output falls back to the plain wording", () => {
    expect(suggestedVerification("א".repeat(201))).toBe("אדם בודק שהשלב בוצע.");
  });
});

// 3.11.2026: an open question from a meeting, marked missing and without
// "what closes it", could not be approved: the edit has no status field
// for a question, and the file fills "תשובה לשאלה." on its own.
describe("an open question without what closes it", () => {
  it("is not blocked by rule 1", () => {
    const flags = proposalProblems("FACT", { kind: "QUESTION", body: "מה הקשר בין ISG לאגרו-נגב?", knowledgeStatus: "MISSING" }, []);
    expect(flags.filter((f) => f.block)).toEqual([]);
  });

  it("any other uncertain fact still is", () => {
    const flags = proposalProblems("FACT", { kind: "NOTE", body: "ISG היא חברת בת", knowledgeStatus: "UNCERTAIN" }, []);
    expect(flags.some((f) => f.block && f.code === "SHAPE")).toBe(true);
  });
});
