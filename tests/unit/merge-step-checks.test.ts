import { describe, expect, it } from "vitest";
import { automatedStepsMessage, blockingChecks, mergeStepChecks, readSteps, stepList } from "@/lib/process-rules";

// 3.11.2026: a procedure with several automated steps and no check said
// the same line once per step. One line names the steps, wherever the
// checks are listed (the approvals row, get_process, the review card).
describe("mergeStepChecks", () => {
  const steps = readSteps([
    { title: "איסוף", mode: "MANUAL" },
    { title: "שליחה", mode: "AUTOMATED" },
    { title: "תיוק", mode: "AUTOMATED", verification: "רואים בתיקייה" },
    { title: "תזכורת", mode: "AUTOMATED" },
    { title: "סיכום", mode: "AUTOMATED", actionTags: ["CLIENT_MESSAGE"] },
  ]);

  it("one line for R3 on several steps, in the place of the first, other checks kept in order", () => {
    const checks = blockingChecks({ steps }, []);
    expect(checks.filter((c) => c.code === "R3")).toHaveLength(3);
    const merged = mergeStepChecks(checks);
    expect(merged.map((c) => c.code)).toEqual(["R3", "R1"]);
    expect(merged[0]).toMatchObject({ steps: [2, 4, 5], message: "שלבים 2, 4 ו-5 אוטומטיים: צריך לכתוב בכל אחד איך אדם מוודא שהשלב קרה." });
    expect(merged[1].message).toMatch(/^שלב 5: הודעה ללקוח/);
  });

  it("a single R3 stays as the client's file says it", () => {
    const one = blockingChecks({ steps: readSteps([{ title: "שליחה", mode: "AUTOMATED" }]) }, []);
    expect(mergeStepChecks(one)).toEqual(one);
    expect(one[0].message).toBe(automatedStepsMessage([1]));
  });

  it("keeps the extra fields of the checks it passes through", () => {
    const merged = mergeStepChecks([
      { code: "R3", step: 1, message: "a", severity: "BLOCK" },
      { code: "R3", step: 2, message: "b", severity: "BLOCK" },
      { code: "R9", message: "c", severity: "EXCEPTION", excepted: false },
    ]);
    expect(merged).toEqual([
      { code: "R3", step: undefined, steps: [1, 2], message: "שלבים 1 ו-2 אוטומטיים: צריך לכתוב בכל אחד איך אדם מוודא שהשלב קרה.", severity: "BLOCK" },
      { code: "R9", message: "c", severity: "EXCEPTION", excepted: false },
    ]);
  });

  it("stepList", () => {
    expect(stepList([3])).toBe("שלב 3");
    expect(stepList([1, 2, 4])).toBe("שלבים 1, 2 ו-4");
  });
});
