import { describe, expect, it } from "vitest";
import { answerFactBody, MAX_STRANGER_QUESTIONS, readStrangerQuestions, strangerLine, strangerPrompt } from "@/lib/stranger-test";

// 31.10.2026: the stranger test. What is still open is the readiness.

const q = (over: Partial<{ step: number | null; severity: "BLOCKER" | "SLOWS" | "IMPROVES"; askWho: "ANKORA" | "CLIENT"; question: string }> = {}) => ({
  step: 1,
  severity: "BLOCKER" as const,
  askWho: "ANKORA" as const,
  question: "למי שולחים את הקובץ?",
  ...over,
});

describe("stranger test", () => {
  it("takes questions about the procedure's steps, or about the whole process", () => {
    const r = readStrangerQuestions([q(), q({ step: null, question: "  מי מאשר?  " })], 5);
    expect(r).toEqual({ ok: true, questions: [{ step: 1, severity: "BLOCKER", askWho: "ANKORA", question: "למי שולחים את הקובץ?" }, { step: null, severity: "BLOCKER", askWho: "ANKORA", question: "מי מאשר?" }] });
  });

  it("refuses a step the procedure does not have, an empty question and too many", () => {
    expect(readStrangerQuestions([q({ step: 6 })], 5)).toMatchObject({ ok: false, error: expect.stringContaining("שלב 6") });
    expect(readStrangerQuestions([q({ step: 1 })], 0)).toMatchObject({ ok: false });
    expect(readStrangerQuestions([q({ question: "  " })], 5)).toMatchObject({ ok: false, error: expect.stringContaining("ריקה") });
    expect(readStrangerQuestions(Array.from({ length: MAX_STRANGER_QUESTIONS + 1 }, () => q()), 5)).toMatchObject({ ok: false });
  });

  it("says what is open, blockers first, or that it passed, or that it never ran", () => {
    expect(strangerLine(null)).toBe("מבחן הזר: עוד לא הורץ");
    expect(strangerLine({ at: "2026-10-31T10:00:00Z", open: 0, blockers: 0, answered: 4 })).toBe("מבחן הזר: עבר · 31.10");
    expect(strangerLine({ at: "2026-10-31T10:00:00Z", open: 5, blockers: 2, answered: 0 })).toBe("מבחן הזר: 2 חוסמים, 5 שאלות פתוחות · 31.10");
    expect(strangerLine({ at: "2026-11-03T10:00:00Z", open: 1, blockers: 0, answered: 0 })).toBe("מבחן הזר: שאלה פתוחה אחת · 3.11");
  });

  it("writes an answer into the file with the process and step it answers", () => {
    expect(answerFactBody("P2", 2, " לאיילה במייל ")).toBe("P2 שלב 2: לאיילה במייל");
    expect(answerFactBody("P2", null, "גיא עד 15.11")).toBe("P2: גיא עד 15.11");
  });

  it("names the process and the tools in the prompt", () => {
    const p = strangerPrompt("NUX", "P2", "תשלומי ספקים");
    expect(p).toContain("P2");
    expect(p).toContain("record_stranger_test");
    expect(p).toContain("answer_stranger_question");
  });
});
