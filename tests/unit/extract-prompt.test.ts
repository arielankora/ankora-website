import { describe, expect, it } from "vitest";
import { buildExtractPrompt } from "@/lib/extract-prompt";

const BASE = {
  requestedBy: "הדס",
  clientName: "NUX",
  facts: [{ id: "f1", label: "העדפה", text: "WhatsApp קודם" }],
  people: ["שני הלוי, VP Finance"],
  organizations: ["Nextage"],
  systems: ["Mercury"],
  sources: [{ code: "S1", title: "Nextage & Ankora", dateLabel: "2026-10-12", kindLabel: "הקלטה", firefliesId: "ff-1", topicsOnly: false }],
  domains: ["nux.ai"],
};

describe("buildExtractPrompt", () => {
  it("asks for approval before writing, and says nothing enters the file without a person", () => {
    const p = buildExtractPrompt(BASE);
    expect(p).toContain("אל תכתוב שום דבר למערכת לפני אישור מפורש שלי");
    expect(p).toContain("ממתין לאישור");
    expect(p).toContain('propose_knowledge עם client "NUX"');
  });

  it("carries the rules the server cannot enforce, and what is already in the file with ids", () => {
    const p = buildExtractPrompt(BASE);
    expect(p).toContain("שיחת חולין");
    expect(p).toContain("SUPERSEDE");
    expect(p).toContain("- העדפה: WhatsApp קודם (f1)");
    expect(p).toContain("- S1: Nextage & Ankora (הקלטה, 2026-10-12, Fireflies ff-1)");
    expect(p).toContain("nux.ai");
  });

  it("starts from the chosen source when there is one, and says when the file is empty", () => {
    expect(buildExtractPrompt({ ...BASE, focus: "S1" })).toContain("1. המקור: S1.");
    const empty = buildExtractPrompt({ ...BASE, facts: [], people: [], organizations: [], systems: [], sources: [], domains: [] });
    expect(empty).toContain("התיק עדיין ריק.");
    expect(empty).toContain("יירשם כ-S1");
  });
});

describe("approved guidance", () => {
  it("replaces the shipped guidance, one line per rule, and says which version", async () => {
    const { guideLines } = await import("@/lib/extract-prompt");
    expect(guideLines("- כלל אחד\n\n* כלל שני\n• כלל שלישי\n")).toEqual(["כלל אחד", "כלל שני", "כלל שלישי"]);
    const p = buildExtractPrompt({ ...BASE, guide: { version: 3, body: "רק מה שהלקוח אמר\nבלי שמועות" } });
    expect(p).toContain("- רק מה שהלקוח אמר\n- בלי שמועות");
    expect(p).toContain("(הנחיות גרסה 3)");
    expect(p).not.toContain("שיחת חולין");
  });
});
