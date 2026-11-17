import { describe, expect, it } from "vitest";
import { briefMarkdown, changesMarkdown, readSince } from "@/lib/client-file-live";
import type { ClientFileDoc } from "@/lib/client-file-document";

// The brief and the changes are cut from the document Claude already
// gets; what matters is what each keeps.

const DOC: ClientFileDoc = {
  clientName: "NUX",
  generatedAt: new Date("2026-10-20T08:00:00Z"),
  audience: "ai",
  sections: [
    { number: "1", title: "זהות הלקוח", empty: "", items: [{ text: "NUX.AI, סטארט-אפ" }] },
    { number: "2", title: "סקירה, רקע ותפקידנו", empty: "", items: [{ text: "סקירה ארוכה" }] },
    { number: "3", title: "אנשים ויחסים", empty: "", items: [{ ref: "c1", text: "איילה מנצור", details: ["מנהלת חשבונות"], doNotDisclose: "המעבר ל-Doka" }] },
    { number: "6", title: "כללים והגבלות", empty: "", items: [{ ref: "r1", text: "תשלום מעל 10,000 באישור המנכ\"ל", sources: ["S1 08:13"] }] },
    { number: "7.4", title: "תהליכים", empty: "", items: [{ ref: "p1", text: "P1 תשלומי ספקים", details: ["חודשי", "שלמות 8 מתוך 9"] }] },
    { number: "16", title: "יומן עדכונים", empty: "", items: [{ text: "אצווה" }] },
  ],
  legend: [{ code: "S1", title: "פגישת NUX", details: "" }],
};

describe("brief", () => {
  const md = briefMarkdown(DOC);
  it("keeps the rules in full, without source codes, owner or id (17.11.2026)", () => {
    expect(md).toContain('- תשלום מעל 10,000 באישור המנכ"ל');
    expect(md).not.toContain("[S1 08:13]");
    expect(md).not.toContain("(id: r1)");
    expect(md).not.toContain("בעלים:");
  });
  it("keeps the status, the client-visible mark and the do-not-tell of a rule", () => {
    const doc: ClientFileDoc = {
      ...DOC,
      sections: [{ number: "6", title: "כללים והגבלות", empty: "", items: [{ ref: "r2", text: "כלל", status: "UNCERTAIN", toResolve: "לוודא עם אורן", clientVisible: true, owner: "הדס", doNotDisclose: "לא לספק" } as never] }],
    };
    const line = briefMarkdown(doc).split("\n").find((l) => l.startsWith("- כלל"))!;
    expect(line).toContain("לוודא עם אורן");
    expect(line).toContain("גלוי ללקוח");
    expect(line).toContain("לא לספר: לא לספק");
    expect(line).not.toContain("הדס");
  });
  it("names people and processes only, and leaves the log and the narrative out", () => {
    expect(md).toContain("- P1 תשלומי ספקים (id: p1)");
    expect(md).not.toContain("שלמות 8");
    expect(md).not.toContain("סקירה ארוכה");
    expect(md).not.toContain("אצווה");
  });
  it('carries every "do not tell", even of a line cut short', () => {
    expect(md).toContain("## לא לספר");
    expect(md).toContain("איילה מנצור: המעבר ל-Doka");
  });
  it('lists a "do not tell" once, even when its item sits in two sections', () => {
    const twice = { ref: "c1", text: "איילה מנצור", doNotDisclose: "המעבר ל-Doka" };
    const doc: ClientFileDoc = {
      ...DOC,
      sections: [
        { number: "3", title: "אנשים ויחסים", empty: "", items: [twice] },
        { number: "7.2", title: "ספקים", empty: "", items: [twice] },
      ],
    };
    expect(briefMarkdown(doc).split("איילה מנצור: המעבר ל-Doka").length - 1).toBe(1);
  });
  it("keeps the ids of people and processes, and of dates", () => {
    expect(md).toContain("איילה מנצור (id: c1)");
    const doc: ClientFileDoc = { ...DOC, sections: [{ number: "10", title: "תאריכים", empty: "", items: [{ ref: "d1", text: "דוח שנתי", sources: ["S2"], owner: "הדס" } as never] }] };
    const line = briefMarkdown(doc);
    expect(line).toContain("(id: d1)");
    expect(line).not.toContain("[S2]");
  });
});

describe("changes", () => {
  const now = new Date("2026-10-20T08:00:00Z");
  it("only what changed, as it is now, and what left", () => {
    const md = changesMarkdown(DOC, { since: new Date("2026-10-13T00:00:00Z"), changed: new Set(["r1"]), narrativesChanged: false, removed: [{ label: "מערכת", text: "Mercury", how: "removed" }], now });
    expect(md).toContain("## 6. כללים והגבלות");
    expect(md).not.toContain("P1 תשלומי ספקים");
    expect(md).toContain("- מערכת: Mercury (הוסר)");
    expect(md).toContain("2026-10-13");
  });
  it("says so when nothing changed", () => {
    const md = changesMarkdown(DOC, { since: new Date("2026-10-13T00:00:00Z"), changed: new Set(), narrativesChanged: false, removed: [], now });
    expect(md).toContain("לא השתנה כלום");
  });
  it("brings the narratives whole when one changed", () => {
    const md = changesMarkdown(DOC, { since: new Date("2026-10-13T00:00:00Z"), changed: new Set(), narrativesChanged: true, removed: [], now });
    expect(md).toContain("סקירה ארוכה");
  });
});

describe("since", () => {
  const now = new Date("2026-10-20T08:00:00Z");
  it("a week by default, a day or a time, never the future or past 90 days", () => {
    expect(readSince(undefined, now)).toEqual({ since: new Date("2026-10-13T08:00:00Z") });
    expect(readSince("2026-10-18", now)).toEqual({ since: new Date("2026-10-18T00:00:00Z") });
    expect("error" in readSince("2026-10-21", now)).toBe(true);
    expect("error" in readSince("2026-01-01", now)).toBe(true);
    expect("error" in readSince("nope", now)).toBe(true);
  });
});
