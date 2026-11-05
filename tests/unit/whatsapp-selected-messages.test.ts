import { describe, it, expect } from "vitest";
import {
  MAX_SELECTED_MESSAGES,
  formatSelectedMessages,
  parseSelectedMessages,
  proposeSelectedTitle,
} from "@/lib/whatsapp-poc/selected-messages";
import { checkPortalNote, MAX_PORTAL_NOTE_LENGTH } from "@/lib/task-portal-note-text";

const msg = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  at: "2026-11-04T08:31:00.000Z",
  text: "היי, אפשר לקבוע פגישה?",
  mine: false,
  senderName: null,
  files: [],
  ...over,
});

describe("parseSelectedMessages", () => {
  it("reads a JSON string and sorts by time, whatever the click order", () => {
    const parsed = parseSelectedMessages(
      JSON.stringify([msg({ id: "b", at: "2026-11-04T08:40:00.000Z" }), msg({ id: "a", at: "2026-11-04T08:31:00.000Z" })]),
    );
    expect(parsed.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("drops malformed entries, duplicates and bad dates instead of trusting them", () => {
    const parsed = parseSelectedMessages([msg(), msg(), msg({ id: "x", at: "not a date" }), null, 7, msg({ id: "" })]);
    expect(parsed).toHaveLength(1);
  });

  it("returns nothing for something that is not a list", () => {
    expect(parseSelectedMessages("{")).toEqual([]);
    expect(parseSelectedMessages({ id: "m1" })).toEqual([]);
  });

  it("caps the number of messages", () => {
    const many = Array.from({ length: MAX_SELECTED_MESSAGES + 10 }, (_, i) => msg({ id: `m${i}` }));
    expect(parseSelectedMessages(many)).toHaveLength(MAX_SELECTED_MESSAGES);
  });

  it("keeps only files with an id and a type", () => {
    const [m] = parseSelectedMessages([msg({ files: [{ id: "f1", type: "img", label: "תמונה" }, { id: "", type: "img" }, "x"] })]);
    expect(m.files).toEqual([{ id: "f1", type: "img", label: "תמונה" }]);
  });
});

describe("formatSelectedMessages", () => {
  it("writes a header and one line per message, in Israel time", () => {
    const body = formatSelectedMessages({
      contactName: "רותם כהן",
      phone: "+972501234567",
      messages: parseSelectedMessages([
        msg(),
        msg({ id: "m2", at: "2026-11-04T08:35:00.000Z", text: "רביעי 11:00?", mine: true }),
      ]),
      maxLength: 4000,
    });
    expect(body.split("\n")[0]).toBe("**וואטסאפ · רותם כהן · +972501234567 · 4.11.2026**");
    expect(body).toContain("- 10:31 רותם כהן: היי, אפשר לקבוע פגישה?");
    expect(body).toContain("- 10:35 אנחנו: רביעי 11:00?");
  });

  it("says when an image was filed on the task, and only then", () => {
    const messages = parseSelectedMessages([msg({ text: "", files: [{ id: "f1", type: "img", label: "תמונה" }] })]);
    const filed = formatSelectedMessages({ contactName: "רותם", phone: null, messages, filedImages: new Set(["m1:f1"]), maxLength: 4000 });
    const notFiled = formatSelectedMessages({ contactName: "רותם", phone: null, messages, maxLength: 4000 });
    expect(filed).toContain("[תמונה, תויקה במשימה]");
    expect(notFiled).toContain("[תמונה]");
    expect(notFiled).not.toContain("תויקה");
  });

  it("puts a voice message's transcript into the comment, and says when it has none (4.11.2026)", () => {
    const voice = { id: "a1", type: "audio", label: "הודעה קולית" };
    const body = formatSelectedMessages({
      contactName: "רותם",
      phone: null,
      messages: parseSelectedMessages([
        msg({ id: "v1", text: "", files: [voice], transcript: "אני בגב לגב,\nאחזור בשש" }),
        msg({ id: "v2", at: "2026-11-04T08:40:00.000Z", text: "", files: [voice] }),
      ]),
      maxLength: 4000,
    });
    expect(body).toContain("- 10:31 רותם: [הודעה קולית] תמלול: אני בגב לגב, אחזור בשש");
    expect(body).toContain("- 10:40 רותם: [הודעה קולית, לא תומללה]");
  });

  it("never runs past the comment limit", () => {
    const long = parseSelectedMessages(Array.from({ length: 10 }, (_, i) => msg({ id: `m${i}`, text: "א".repeat(1500) })));
    const body = formatSelectedMessages({ contactName: "רותם", phone: null, messages: long, maxLength: 4000 });
    expect(body.length).toBeLessThanOrEqual(4000);
    expect(body).toContain("קוצר");
  });
});

describe("proposeSelectedTitle", () => {
  it("falls back to the phone, then to a generic name", () => {
    expect(proposeSelectedTitle("רותם", null)).toBe("מעקב: שיחה עם רותם");
    expect(proposeSelectedTitle(" ", "+972501234567")).toBe("מעקב: שיחה עם +972501234567");
    expect(proposeSelectedTitle("", null)).toBe("מעקב: שיחה עם איש קשר");
  });
});

describe("checkPortalNote", () => {
  it("folds a multi-line note to one line", () => {
    expect(checkPortalNote("רותם כהן\nפגישה ברביעי")).toEqual({ ok: true, text: "רותם כהן פגישה ברביעי" });
  });
  it("refuses an empty or too long note", () => {
    expect(checkPortalNote("   ").ok).toBe(false);
    expect(checkPortalNote("א".repeat(MAX_PORTAL_NOTE_LENGTH + 1)).ok).toBe(false);
  });
});
