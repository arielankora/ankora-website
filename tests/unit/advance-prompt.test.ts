import { describe, expect, it } from "vitest";
import {
  buildAdvancePrompt,
  buildLessonsPrompt,
  fileSizeLabel,
  fileTypeLabel,
  isEmptyBrief,
  MAX_COMMENT_CHARS,
  timerRules,
  type AdvancePromptInput,
} from "@/lib/advance-prompt";
import { PROPOSE_MAPPING_STEP_TITLE, PROPOSE_STEP_TITLE } from "@/lib/procedure-to-file";

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
  files: [],
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
      files: [{ documentId: "d1", title: "f.pdf", typeLabel: "PDF", sizeLabel: "12KB", atLabel: "1.1", by: "הדס", clientVisible: false }],
      clientVisible: true,
    });
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("the edge cases in the spec", () => {
  it("on a task with no description and no comments, starts with questions, not a plan", () => {
    const empty = { ...base, description: null, comments: [] };
    expect(isEmptyBrief(empty)).toBe(true);
    expect(buildAdvancePrompt(empty)).toContain("תתחיל בשאלות הבהרה");
    expect(buildAdvancePrompt(base)).not.toContain("תתחיל בשאלות הבהרה");
  });

  it("a comment alone is a brief", () => {
    expect(isEmptyBrief({ description: "  ", comments: [{ atLabel: "x", by: "הדס", body: "פרטים" }] })).toBe(false);
  });

  it("asks for a short comment on the task after every finished step", () => {
    const text = buildAdvancePrompt(base);
    expect(text).toContain("תסמן אותו עם set_task_step, ותוסיף הערה קצרה במשימה (add_task_comment)");
  });

  it("allows opening a client decision only after approval, and says the client is not notified", () => {
    const text = buildAdvancePrompt(base);
    expect(text).toContain("create_decision");
    expect(text).toContain("הלקוח לא מקבל הודעה אוטומטית");
  });
});

describe("buildLessonsPrompt()", () => {
  const closed = { ...base, statusLabel: "הושלמה", completedLabel: "09.10.2026", loggedLabel: "4.00 שעות" };

  it("asks for a summary and lessons, saved as an internal comment on the closed task", () => {
    const text = buildLessonsPrompt(closed);
    expect(text).toContain("נסגרה (הושלמה)");
    expect(text).toContain('add_task_comment: taskId "cmg1abc", includeDone: true');
    expect(text).toContain("**לקחים**");
    expect(text).not.toContain("save_task_plan");
  });

  it("a run of a process also asks about its procedure, and only then", () => {
    expect(buildLessonsPrompt(closed)).not.toContain("record_run_lesson");
    const text = buildLessonsPrompt({ ...closed, process: { code: "P1", title: "תשלומי ספקים" } });
    expect(text).toContain("ריצה של התהליך P1 תשלומי ספקים");
    expect(text).toContain('record_run_lesson: taskId "cmg1abc"');
  });

  it("carries when it opened and when it closed, and the hours", () => {
    const text = buildLessonsPrompt(closed);
    expect(text).toContain("- נפתחה: 01.10.2026");
    expect(text).toContain("- נסגרה: 09.10.2026");
    expect(text).toContain("- זמן שדווח: 4.00 שעות");
  });

  it("forbids reopening or changing the task", () => {
    expect(buildLessonsPrompt(closed)).toContain("אל תשנה שום דבר אחר במשימה, ואל תפתח אותה מחדש");
  });

  it("contains no em-dash or en-dash", () => {
    expect(buildLessonsPrompt(closed)).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("how Claude asks (11.10.2026)", () => {
  it("asks through the app's question cards first, and falls back to lettered text choices", () => {
    for (const text of [buildAdvancePrompt(base), buildLessonsPrompt(base)]) {
      expect(text).toContain("## איך שואלים אותי");
      expect(text).toContain("ask_user_input");
      expect(text).toContain("ואל תכתוב את אותן שאלות גם בטקסט");
      expect(text).toContain('"(מומלץ)"');
      expect(text).toContain("רק אם אין לך כלי כזה בשיחה");
      expect(text).toContain('"או לכתוב תשובה אחרת"');
    }
  });

  it("the clarifying questions on an empty task are asked the same way", () => {
    expect(buildAdvancePrompt({ ...base, description: null, comments: [] })).toContain("כל אחת עם תשובות לבחירה");
  });
});

describe("turning the plan into steps (11.10.2026)", () => {
  it("on a task with no steps, tells Claude the steps are added on save and not to ask", () => {
    const text = buildAdvancePrompt({ ...base, steps: [] });
    expect(text).toContain("השלבים שלה נוספים למשימה אוטומטית. אל תשאל על זה");
    expect(text).not.toContain("תשאל אם להחליף את השלבים הפתוחים");
  });

  it("on a task that already has steps, asks before replacing the open ones", () => {
    const text = buildAdvancePrompt({
      ...base,
      steps: [{ title: "s", statusLabel: "פתוחה", assignedTo: null, dueLabel: null }],
    });
    expect(text).toContain("תשאל אם להחליף את השלבים הפתוחים בשלבי התוכנית");
    expect(text).not.toContain("נוספים למשימה אוטומטית");
  });
});

describe("files on the task (12.10.2026)", () => {
  const withFiles: AdvancePromptInput = {
    ...base,
    files: [
      { documentId: "doc-1", title: "טופס 101 חתום", typeLabel: "PDF", sizeLabel: "320KB", atLabel: "05.10.2026", by: "הדס", clientVisible: false },
      { documentId: "doc-2", title: "הצעת מחיר", typeLabel: "Excel", sizeLabel: null, atLabel: "06.10.2026", by: null, clientVisible: true },
    ],
  };

  it("lists each file with the id read_document takes", () => {
    const text = buildAdvancePrompt(withFiles);
    expect(text).toContain("- טופס 101 חתום (PDF, 320KB, 05.10.2026, הדס, פנימי). documentId: doc-1");
    expect(text).toContain("- הצעת מחיר (Excel, 06.10.2026, גלוי ללקוח). documentId: doc-2");
  });

  it("tells Claude to read the relevant files before planning or asking", () => {
    const text = buildAdvancePrompt(withFiles);
    expect(text).toContain("למשימה מצורפים 2 קבצים");
    expect(text.indexOf("read_document")).toBeLessThan(text.indexOf("## נתוני המשימה"));
  });

  it("says nothing about reading files when there are none", () => {
    const text = buildAdvancePrompt(base);
    expect(text).not.toContain("למשימה מצורפים");
    expect(text).not.toContain("### קבצים מצורפים");
  });

  it("explains how to file a document, hidden from the client by default", () => {
    const text = buildAdvancePrompt(base);
    expect(text).toContain("start_document_upload");
    expect(text).toContain("מוסתר מהלקוח");
  });

  it("lets the lessons prompt read files too", () => {
    expect(buildLessonsPrompt(withFiles)).toContain("read_document");
  });

  it("names file types and sizes in a word", () => {
    expect(fileTypeLabel("application/pdf")).toBe("PDF");
    expect(fileTypeLabel("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("Word");
    expect(fileTypeLabel("image/png")).toBe("תמונה");
    expect(fileSizeLabel(320 * 1024)).toBe("320KB");
    expect(fileSizeLabel(1.4 * 1024 * 1024)).toBe("1.4MB");
    expect(fileSizeLabel(null)).toBeNull();
  });
});

describe("the timer around the conversation (19.10.2026)", () => {
  it("checks the running timers live, before anything else", () => {
    const text = buildAdvancePrompt(base);
    expect(text).toContain("## טיימר");
    expect(text).toContain("get_active_timer");
    expect(text.indexOf("## טיימר")).toBeLessThan(text.indexOf("## איך שואלים אותי"));
    expect(text.indexOf("## טיימר")).toBeLessThan(text.indexOf("## נתוני המשימה"));
  });

  it("starts the timer on this client and this task, named exactly", () => {
    const text = buildAdvancePrompt(base);
    expect(text).toContain(`start_timer עם client "NUX", task "${base.title}"`);
    expect(text).toContain("רץ טיימר על הלקוח NUX: לא שואלים");
  });

  it("never runs in parallel without an explicit choice", () => {
    expect(buildAdvancePrompt(base)).toContain("confirmParallel: true רק אם בחרתי במקביל");
  });

  it("reports a timer on another client without recommending what to do with it", () => {
    const rules = timerRules(base, "advance");
    const other = rules.find((l) => l.startsWith("- רץ טיימר על לקוח אחר"))!;
    expect(other).toContain("בלי המלצה");
    expect(other).not.toMatch(/"[^"]*" \(מומלץ\)/);
    const two = rules.find((l) => l.startsWith("- רצים כבר שני טיימרים"))!;
    expect(two).toContain("בלי המלצה");
  });

  it("offers to stop the timer when the work ends, after looking again", () => {
    const text = buildAdvancePrompt(base);
    expect(text).toContain("סוף העבודה: כשהמשימה נסגרת או עוברת לאישור");
    expect(text).toContain("תבדוק שוב עם get_active_timer");
  });

  it("says an approved plan moves an open task to in progress, without asking", () => {
    expect(buildAdvancePrompt(base)).toContain('משימה פתוחה עוברת ל"בביצוע" אוטומטית כשהתוכנית מאושרת');
  });

  it("shows every field before writing it", () => {
    expect(buildAdvancePrompt(base)).toContain("לא כותבים ערך שלא ראיתי");
  });

  it("puts the same block in the lessons prompt, ending when the summary is saved", () => {
    const text = buildLessonsPrompt({ ...base, completedLabel: "14.10.2026" });
    expect(text).toContain("## טיימר");
    expect(text).toContain("סוף העבודה: כשהסיכום נשמר");
    expect(text).not.toContain("כשמסומן השלב האחרון");
  });
});

describe("a new procedure reaches the client file (19.10.2026)", () => {
  it("files a procedure as POLICY and proposes it to the client file without asking", () => {
    const text = buildAdvancePrompt(base);
    expect(text).toContain("kind: POLICY");
    expect(text).toContain("propose_knowledge");
    expect(text).toContain("PROCESS");
    expect(text).toContain("newSource מסוג ANKORA_DOCUMENT");
    expect(text).toContain("מותר לשלוח אותן בלי לשאול");
    expect(text).toContain("להזכיר לי לאשר");
  });

  it("puts the fixed proposal step before closing into the plan's shape", () => {
    const text = buildAdvancePrompt(base);
    const shape = text.slice(text.indexOf("## מבנה התוכנית"), text.indexOf("## החיבור למערכת"));
    expect(shape).toContain(`"${PROPOSE_STEP_TITLE}"`);
    expect(shape).toContain("אישור: מנהל במסך הבדיקה");
    expect(shape).not.toContain(PROPOSE_MAPPING_STEP_TITLE);
  });

  it("on a mapping task, also proposes what was learned, sourced to the task itself", () => {
    const text = buildAdvancePrompt({ ...base, mapping: true });
    expect(text).toContain("המשימה בשלב מיפוי וצפייה");
    expect(text).toContain('newSource מסוג TASK עם taskId "cmg1abc"');
    expect(text).toContain(`"${PROPOSE_MAPPING_STEP_TITLE}"`);
  });

  it("says nothing about mapping on an ordinary task", () => {
    expect(buildAdvancePrompt(base)).not.toContain("מיפוי וצפייה");
  });

  it("still has no em-dash or en-dash with the new rules", () => {
    const text = buildAdvancePrompt({ ...base, mapping: true });
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});
