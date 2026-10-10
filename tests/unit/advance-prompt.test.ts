import { describe, expect, it } from "vitest";
import { buildAdvancePrompt, MAX_COMMENT_CHARS, type AdvancePromptInput } from "@/lib/advance-prompt";

// "קדם עם קלוד" (10.10.2026). The prompt the task screen copies. Pure, so
// it runs in the sandbox like client-activity-prompt.test.ts.

const base: AdvancePromptInput = {
  taskId: "cmg1abc",
  url: "https://www.ankora.co.il/app/tasks/cmg1abc",
  title: "התאמת עסקאות כרטיסי אשראי",
  clientName: "NUX",
  statusLabel: "בביצוע",
  priorityLabel: "גבוהה",
  categoryName: "כספים",
  assignedTo: "הדס",
  supervisor: "אריאל",
  requiresApproval: true,
  dueLabel: "15.10.2026",
  createdLabel: "01.10.2026",
  description: "להתאים את העסקאות של ספטמבר מול הדוח.",
  clientVisible: false,
  clientTitle: null,
  clientRequest: null,
  clientOutcome: null,
  waiting: null,
  steps: [],
  comments: [],
  commentsOmitted: 0,
  decisions: [],
  fileTitles: [],
  loggedLabel: null,
  plan: null,
  requestedBy: "אריאל",
  todayLabel: "10.10.2026",
};

describe("buildAdvancePrompt()", () => {
  it("names the task by its exact id for every write", () => {
    const text = buildAdvancePrompt(base);
    expect(text).toContain('taskId "cmg1abc"');
    expect(text).toContain("- מזהה: cmg1abc");
    expect(text).toContain(base.url);
  });

  it("asks for a plan first and forbids writing before explicit approval", () => {
    const text = buildAdvancePrompt(base);
    expect(text).toContain("אל תבצע שום פעולה ואל תכתוב למערכת לפני שאני מאשר במפורש");
    expect(text).toContain("save_task_plan");
    expect(text).toContain("approved: true");
    expect(text).toContain("baseVersion: 0");
  });

  it("never lets Claude send anything to a client on its own", () => {
    expect(buildAdvancePrompt(base)).toContain("אף פעם: לשלוח משהו ללקוח או לספק בעצמך");
  });

  it("carries the task's fields, and leaves out the ones that are empty", () => {
    const text = buildAdvancePrompt({ ...base, categoryName: null });
    expect(text).toContain("- אחראי: הדס");
    expect(text).toContain("- מפקח: אריאל (נדרש אישור שלו לסגירה)");
    expect(text).toContain("- תאריך יעד: 15.10.2026");
    expect(text).not.toContain("- קטגוריה:");
  });

  it("asks for the client's outcome sentence only on a task the client sees", () => {
    expect(buildAdvancePrompt(base)).not.toContain("משפט התוצאה שהלקוח יקרא");
    expect(buildAdvancePrompt({ ...base, clientVisible: true })).toContain("משפט התוצאה שהלקוח יקרא");
  });

  it("puts comments in, oldest first as given, and says when older ones were left out", () => {
    const text = buildAdvancePrompt({
      ...base,
      comments: [
        { atLabel: "02.10.2026 09:00", by: "הדס", body: "ביקשתי את הדוח" },
        { atLabel: "05.10.2026 12:00", by: null, body: "הדוח הגיע" },
      ],
      commentsOmitted: 4,
    });
    expect(text.indexOf("ביקשתי את הדוח")).toBeLessThan(text.indexOf("הדוח הגיע"));
    expect(text).toContain("> ביקשתי את הדוח");
    expect(text).toContain("לא ידוע:");
    expect(text).toContain("4 הערות ישנות יותר לא נכללו");
  });

  it("cuts a very long comment instead of dropping it", () => {
    const text = buildAdvancePrompt({
      ...base,
      comments: [{ atLabel: "x", by: "הדס", body: "א".repeat(MAX_COMMENT_CHARS + 500) }],
    });
    expect(text).toContain("הטקסט קוצר");
  });

  it("with an existing plan: shows it, and saves against its version", () => {
    const text = buildAdvancePrompt({
      ...base,
      plan: { version: 3, approved: true, body: "**מטרה**\nלסגור", steps: ["לבקש דוח"] },
    });
    expect(text).toContain("גרסה 3");
    expect(text).toContain("baseVersion: 3");
    expect(text).toContain("**מטרה**\nלסגור");
    expect(text).toContain("1. לבקש דוח");
    expect(text).toContain("תתחיל בהצגת התוכנית הקיימת בקצרה.");
  });

  it("says what the task is waiting on, and since when", () => {
    const text = buildAdvancePrompt({
      ...base,
      waiting: { onLabel: "ממתין ללקוח", reason: "אישור תקציב", sinceLabel: "03.10.2026" },
    });
    expect(text).toContain("- ממתינה ל: ממתין ללקוח, מאז 03.10.2026. הסיבה: אישור תקציב");
  });

  it("contains no em-dash or en-dash, ever", () => {
    const text = buildAdvancePrompt({
      ...base,
      plan: { version: 1, approved: false, body: "x", steps: [] },
      steps: [{ title: "s", statusLabel: "פתוחה", assignedTo: "הדס", dueLabel: "1.1" }],
      decisions: [{ question: "q", statusLabel: "ממתינה", dueLabel: null }],
      fileTitles: ["f.pdf"],
      clientVisible: true,
    });
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});
