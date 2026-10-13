import { describe, expect, it } from "vitest";
import { itemLine, toMarkdown, type ClientFileDoc } from "@/lib/client-file-document";

describe("itemLine", () => {
  it("writes the line, its details, its status and its sources, in that order", () => {
    expect(
      itemLine({
        text: "Mercury",
        details: ["בנק של Inc", null, "  "],
        status: "UNCERTAIN",
        toResolve: "אישור מהמנכ״ל",
        sources: ["S1 08:13", "S3"],
      })
    ).toBe("Mercury (בנק של Inc) **לא ודאי: אישור מהמנכ״ל** [S1 08:13, S3]");
  });

  it("says nothing about a confirmed item's status, and always about what not to tell", () => {
    expect(itemLine({ text: "גיא", status: "CONFIRMED", doNotDisclose: "עובדי הלקוח" })).toBe("גיא **לא לספר: עובדי הלקוח**");
  });
});

describe("toMarkdown", () => {
  const doc: ClientFileDoc = {
    clientName: "NUX",
    generatedAt: new Date("2026-10-14T09:00:00Z"),
    audience: "ai",
    sections: [
      { number: "3", title: "אנשים ויחסים", empty: "אין.", items: [{ text: "שני\nהלוי", sources: ["S1"] }] },
      {
        number: "4",
        title: "העדפות",
        empty: "אין.",
        items: [
          { text: "WhatsApp קודם", group: "תקשורת" },
          { text: "Google Docs", group: "מסמכים" },
        ],
      },
      { number: "13", title: "שאלות פתוחות", empty: "אין שאלות פתוחות.", items: [] },
    ],
    legend: [{ code: "S1", title: "Nextage & Ankora", details: "הקלטה, 12.10.2026" }],
  };

  it("keeps the order, groups by topic, says when a section is empty, and ends with the legend", () => {
    const md = toMarkdown(doc);
    expect(md).toContain("# תיק לקוח: NUX");
    expect(md).toContain("גרסה ל-Claude");
    expect(md).toContain("- שני הלוי [S1]");
    expect(md.indexOf("## 3. אנשים ויחסים")).toBeLessThan(md.indexOf("## 4. העדפות"));
    expect(md).toContain("### תקשורת");
    expect(md).toContain("### מסמכים");
    expect(md).toContain("## 13. שאלות פתוחות\n\nאין שאלות פתוחות.");
    expect(md.trimEnd().endsWith("- **S1**: Nextage & Ankora (הקלטה, 12.10.2026)")).toBe(true);
  });
});
