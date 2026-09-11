import { describe, expect, it } from "vitest";
import { buildClientActivityPrompt, type ActivityPromptEntry } from "@/lib/client-activity-prompt";

// docs/adr/0001 section 19.14. Zero project imports (no "server-only", no
// prisma), so - like lib/csv.ts and lib/time-entry-format.ts - this one
// actually runs in the sandbox (see tests/unit/reports.test.ts for the
// Prisma-test limitation everything else in this module hits).

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

  it("formats an entry line with pipe-separated fields and an em-dash-prefixed note", () => {
    const text = buildClientActivityPrompt({ clientName: "RIMED", entries: [baseEntry], totalDurationLabel: "0:24" });
    expect(text).toContain("10.09.2026 18:16 | Ariel | גיוס וhr | 0:24 | ידני — שיחה עם יוסי");
  });

  it("omits the em-dash suffix when an entry has no note (per Ariel: include the entry anyway)", () => {
    const entry: ActivityPromptEntry = { ...baseEntry, note: null };
    const text = buildClientActivityPrompt({ clientName: "RIMED", entries: [entry], totalDurationLabel: "0:24" });
    expect(text).toContain("10.09.2026 18:16 | Ariel | גיוס וhr | 0:24 | ידני");
    expect(text).not.toContain("—");
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
