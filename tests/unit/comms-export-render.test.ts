import { describe, expect, it } from "vitest";
import { renderCommsExport } from "@/lib/comms/export-render";

const base = {
  clientName: "לוי בע\"מ",
  generatedAt: new Date("2026-11-02T10:00:00Z"),
  deletesOn: new Date("2026-12-02T10:00:00Z"),
};

describe("communications export file", () => {
  it("writes the conversations and calls in order, with the deletion date", () => {
    const md = renderCommsExport({
      ...base,
      conversations: [
        {
          name: "דנה",
          phone: "+972542222222",
          isGroup: false,
          messages: [
            { at: new Date("2026-10-01T08:00:00Z"), fromUs: false, sender: null, text: "שלום", attachments: [] },
            { at: new Date("2026-10-01T08:05:00Z"), fromUs: true, sender: "הדס", text: "היי", attachments: ["תמונה"] },
          ],
        },
      ],
      calls: [{ at: new Date("2026-10-02T09:00:00Z"), direction: "IN", phone: "+972542222222", durationSec: 75, transcript: "תמלול" }],
    });
    expect(md).toContain("# שיחות והקלטות: לוי בע\"מ");
    expect(md).toContain("יימחקו אצלנו");
    expect(md).toContain("### דנה (+972542222222)");
    expect(md).toMatch(/דנה:\*\* שלום/);
    expect(md).toMatch(/אנקורה:\*\* היי \[תמונה\]/);
    expect(md).toContain("שיחה נכנסת, +972542222222");
    expect(md).toContain("(1:15)");
    expect(md.indexOf("שלום")).toBeLessThan(md.indexOf("היי"));
  });

  it("keeps a message from turning into a heading, and says when there is nothing", () => {
    const md = renderCommsExport({
      ...base,
      deletesOn: null,
      conversations: [{ name: "קבוצה", phone: null, isGroup: true, messages: [{ at: base.generatedAt, fromUs: false, sender: "x", text: "# כותרת\n- רשימה", attachments: [] }] }],
      calls: [],
    });
    expect(md).not.toContain("יימחקו");
    expect(md).toContain("\\# כותרת");
    expect(md).toContain("\\- רשימה");
    expect(md).toContain("### קבוצה (קבוצה)");
    expect(md).toContain("אין הקלטות.");
  });
});
