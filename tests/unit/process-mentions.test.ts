import { describe, expect, it } from "vitest";
import { mentionedIn, processTexts } from "@/lib/process-mentions";

// 25.10.2026: what a process's own words already name, offered to link.

const systems = [
  { id: "leumi", name: "בנק לאומי" },
  { id: "jw", name: "JustWorks" },
  { id: "mercury", name: "Mercury" },
  { id: "it", name: "IT" },
  { id: "or", name: "אורנה" },
];

describe("mentionedIn", () => {
  it("finds a name in a step, with a Hebrew prefix letter", () => {
    const texts = processTexts({ steps: [{ title: "אישור התשלומים באפליקציה של בנק לאומי" }, { title: "להעלות לבנק לאומי" }], triggerText: "פעמיים בחודש" });
    expect(mentionedIn(texts, systems).map((x) => x.id)).toEqual(["leumi"]);
  });

  it("matches Latin names in any case, as whole words", () => {
    expect(mentionedIn(["לבדוק Time Off ב-justworks לפני השכר"], systems).map((x) => x.id)).toEqual(["jw"]);
    expect(mentionedIn(["Mercurylike"], systems)).toEqual([]);
  });

  it("does not match a name inside another word, or a short one", () => {
    expect(mentionedIn(["אורן מאשר"], systems)).toEqual([]);
    expect(mentionedIn(["תמיכת IT"], systems)).toEqual([]);
  });

  it("needs every word of the name, in order", () => {
    expect(mentionedIn(["הבנק מעביר"], systems)).toEqual([]);
    expect(mentionedIn(["לאומי בנק"], systems)).toEqual([]);
  });

  it("reads the process's texts and its steps' outputs", () => {
    expect(processTexts({ externalPartyText: "Nextage", slaText: null, steps: [{ title: "שליחה", output: "קובץ ב-Mercury" }] })).toEqual(["Nextage", "שליחה", "קובץ ב-Mercury"]);
    expect(mentionedIn(processTexts({ steps: [{ title: "שליחה", output: "קובץ ב Mercury" }] }), systems).map((x) => x.id)).toEqual(["mercury"]);
  });
});
