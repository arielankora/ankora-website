import { describe, expect, it } from "vitest";
import { buildClientActivityPrompt, type ActivityPromptEntry } from "@/lib/client-activity-prompt";

// docs/adr/0001 section 19.14. Zero project imports (no "server-only", no
// prisma), so - like lib/csv.ts and lib/time-entry-format.ts - this one
// actually runs in the sandbox (see tests/unit/reports.test.ts for the
// Prisma-test limitation everything else in this module hits).

/// The entry lines only, without the instruction header (which itself
/// mentions "משימה:" when it tells the AI how to group by task).
function entryLines(text: string): string[] {
  return text.split("\n").filter((l) => /^\d{2}\.\d{2}\.\d{4}/.test(l));
}

const baseEntry: ActivityPromptEntry = {
  dateLabel: "10.09.2026 18:16",
  userName: "Ariel",
  categoryName: "גיוס וhr",
  durationLabel: "0:24",
  sourceLabel: "ידני",
  note: "שיחה עם יוסי",
};

describe("buildClientActivityPrompt()", () => {
  it("includes the client name, date range, entry count and total in the header", () => {
    const text = buildClientActivityPrompt({
      clientName: "RIMED",
      fromLabel: "01.09.2026",
      toLabel: "10.09.2026",
      entries: [baseEntry],
      totalDurationLabel: "0:24",
    });
    expect(text).toContain('"RIMED"');
    expect(text).toContain("בין 01.09.2026 ל-10.09.2026");
    expect(text).toContain("1 דיווחים");
    expect(text).toContain('סה"כ 0:24 שעות עבודה');
  });

  it("always includes an instruction for the AI to write a client-facing Hebrew summary", () => {
    const text = buildClientActivityPrompt({
      clientName: "RIMED",
      entries: [],
      totalDurationLabel: "0:00",
    });
    expect(text).toContain("סיכום קצר, ברור ומקצועי בעברית");
  });

  it("handles a missing date range with a generic label", () => {
    const text = buildClientActivityPrompt({ clientName: "RIMED", entries: [], totalDurationLabel: "0:00" });
    expect(text).toContain("בכל התקופה הזמינה");
  });

  it("handles a from-only range", () => {
    const text = buildClientActivityPrompt({
      clientName: "RIMED",
      fromLabel: "01.09.2026",
      entries: [],
      totalDurationLabel: "0:00",
    });
    expect(text).toContain("החל מ-01.09.2026");
  });

  it("handles a to-only range", () => {
    const text = buildClientActivityPrompt({
      clientName: "RIMED",
      toLabel: "10.09.2026",
      entries: [],
      totalDurationLabel: "0:00",
    });
    expect(text).toContain("עד 10.09.2026");
  });

  it("says so explicitly when there are no entries in range", () => {
    const text = buildClientActivityPrompt({ clientName: "RIMED", entries: [], totalDurationLabel: "0:00" });
    expect(text).toContain("לא נמצאו דיווחים בטווח שנבחר");
  });

  it("formats an entry line with pipe-separated fields and a labelled note", () => {
    const text = buildClientActivityPrompt({ clientName: "RIMED", entries: [baseEntry], totalDurationLabel: "0:24" });
    expect(text).toContain("10.09.2026 18:16 | Ariel | גיוס וhr | 0:24 | ידני | הערה: שיחה עם יוסי");
  });

  it("omits the note field when an entry has no note (per Ariel: include the entry anyway)", () => {
    const entry: ActivityPromptEntry = { ...baseEntry, note: null };
    const text = buildClientActivityPrompt({ clientName: "RIMED", entries: [entry], totalDurationLabel: "0:24" });
    expect(entryLines(text)).toEqual(["10.09.2026 18:16 | Ariel | גיוס וhr | 0:24 | ידני"]);
  });

  it("uses no em-dash or en-dash anywhere in the text", () => {
    const entry: ActivityPromptEntry = { ...baseEntry, taskTitle: "תעודת מקור" };
    const text = buildClientActivityPrompt({ clientName: "RIMED", entries: [entry], totalDurationLabel: "0:24" });
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });

  // 7.10.2026: time reported on a task with no note reached the AI as a
  // bare category, and the summary could not say what the work was.
  describe("the task an entry was reported against", () => {
    it("names the task even when the entry has no note", () => {
      const entry: ActivityPromptEntry = { ...baseEntry, note: null, taskTitle: "תעודת מקור לברזיל" };
      const text = buildClientActivityPrompt({ clientName: "RIMED", entries: [entry], totalDurationLabel: "0:24" });
      expect(entryLines(text)).toEqual(["10.09.2026 18:16 | Ariel | גיוס וhr | 0:24 | ידני | משימה: תעודת מקור לברזיל"]);
    });

    it("prints both the task and a note that says something else", () => {
      const entry: ActivityPromptEntry = {
        ...baseEntry,
        note: "שיחה עם לשכת המסחר",
        taskTitle: "תעודת מקור לברזיל",
        taskInternalTitle: "תעודת מקור לברזיל",
      };
      const text = buildClientActivityPrompt({ clientName: "RIMED", entries: [entry], totalDurationLabel: "0:24" });
      expect(text).toContain("| משימה: תעודת מקור לברזיל | הערה: שיחה עם לשכת המסחר");
    });

    it("does not repeat a note that is just the pre-filled task name", () => {
      const entry: ActivityPromptEntry = {
        ...baseEntry,
        note: " תעודת מקור לברזיל ",
        taskTitle: "תעודת מקור לברזיל",
        taskInternalTitle: "תעודת מקור לברזיל",
      };
      const text = buildClientActivityPrompt({ clientName: "RIMED", entries: [entry], totalDurationLabel: "0:24" });
      expect(entryLines(text)).toEqual(["10.09.2026 18:16 | Ariel | גיוס וhr | 0:24 | ידני | משימה: תעודת מקור לברזיל"]);
    });

    it("keeps the internal title out when the task has a client-facing one", () => {
      const entry: ActivityPromptEntry = {
        ...baseEntry,
        note: "לברר מול לשכת המסחר ת\"א",
        taskTitle: "הנפקת תעודת מקור לייצוא לברזיל",
        taskInternalTitle: "לברר מול לשכת המסחר ת\"א",
      };
      const text = buildClientActivityPrompt({ clientName: "RIMED", entries: [entry], totalDurationLabel: "0:24" });
      expect(entryLines(text)).toEqual([
        "10.09.2026 18:16 | Ariel | גיוס וhr | 0:24 | ידני | משימה: הנפקת תעודת מקור לייצוא לברזיל",
      ]);
    });

    it("prints a note as before when the entry has no task", () => {
      const entry: ActivityPromptEntry = { ...baseEntry, taskTitle: null, taskInternalTitle: null };
      const text = buildClientActivityPrompt({ clientName: "RIMED", entries: [entry], totalDurationLabel: "0:24" });
      expect(entryLines(text)).toEqual(["10.09.2026 18:16 | Ariel | גיוס וhr | 0:24 | ידני | הערה: שיחה עם יוסי"]);
    });

    it("tells the AI to group entries of the same task into one item", () => {
      const text = buildClientActivityPrompt({ clientName: "RIMED", entries: [], totalDurationLabel: "0:00" });
      expect(text).toContain('דיווחים עם אותה "משימה:" שייכים לאותה עבודה');
    });
  });

  it("marks edited entries", () => {
    const entry: ActivityPromptEntry = { ...baseEntry, isEdited: true, note: null };
    const text = buildClientActivityPrompt({ clientName: "RIMED", entries: [entry], totalDurationLabel: "0:24" });
    expect(text).toContain("0:24 | ידני (נערך)");
  });

  it("includes every entry passed in, in order, regardless of note presence", () => {
    const entries: ActivityPromptEntry[] = [
      baseEntry,
      { ...baseEntry, dateLabel: "09.09.2026 10:00", note: null },
      { ...baseEntry, dateLabel: "08.09.2026 09:00", note: "" },
    ];
    const text = buildClientActivityPrompt({ clientName: "RIMED", entries, totalDurationLabel: "1:00" });
    const lines = text.split("\n").filter((l) => l.startsWith("10.09") || l.startsWith("09.09") || l.startsWith("08.09"));
    expect(lines).toHaveLength(3);
  });
});
