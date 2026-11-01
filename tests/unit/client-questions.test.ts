import { describe, expect, it } from "vitest";
import { cardOwner, cardTitle, checkTaskTitle, dismissedAnswer, questionText, questionsDraft, readAskFlags, readSnoozes, sendTaskTitle, snoozeError } from "@/lib/client-questions";

// "שאלות ללקוח" (22.10.2026): the items not yet confirmed as questions,
// and the message to send, without anything internal in it.

describe("client questions", () => {
  it("asks an open question as it is", () => {
    expect(questionText({ title: "מי יהיה מורשה החתימה בבנק לאומי במקום גיא", toResolve: null, isQuestion: true })).toBe("מי יהיה מורשה החתימה בבנק לאומי במקום גיא?");
    expect(questionText({ title: "נחתם?", toResolve: null, isQuestion: true })).toBe("נחתם?");
  });

  it("asks about an uncertain item by what would confirm it", () => {
    expect(questionText({ title: "מועד תשלום השכר: ב-9 לחודש", toResolve: "לבדוק מול דקלה אם ב-1 או ב-9.", isQuestion: false })).toBe('לגבי "מועד תשלום השכר: ב-9 לחודש": לבדוק מול דקלה אם ב-1 או ב-9?');
  });

  it("asks whether it is right when only Ankora wrote it, or nothing says what would close it", () => {
    const ankora = "אישור מהלקוח או מספק שלו: כל המקורות הם מסמכים של אנקורה.";
    expect(questionText({ title: "ערוץ מועדף: וואטסאפ", toResolve: ankora, isQuestion: false })).toBe('האם זה נכון: "ערוץ מועדף: וואטסאפ"?');
    expect(questionText({ title: "אוכל כשר בלבד", toResolve: null, isQuestion: false })).toBe('האם זה נכון: "אוכל כשר בלבד"?');
  });

  it("drafts one message, numbered, and leaves internal items out", () => {
    const draft = questionsDraft({
      contactName: "נדב יעקב דדון",
      senderName: "Anna Kozlov",
      items: [
        { title: "אוכל כשר בלבד", toResolve: null, isQuestion: false, internal: false },
        { title: "משפחה: נשוי לרעות", toResolve: null, isQuestion: false, internal: true },
        { title: "מתי הפגישה השבועית", toResolve: null, isQuestion: true, internal: false },
      ],
    });
    expect(draft.startsWith("היי נדב,")).toBe(true);
    expect(draft).toContain("יש לי 2 שאלות קצרות:");
    expect(draft).toContain('1. האם זה נכון: "אוכל כשר בלבד"?');
    expect(draft).toContain("2. מתי הפגישה השבועית?");
    expect(draft).not.toContain("רעות");
    expect(draft.endsWith("Anna")).toBe(true);
  });

  it("says one question in the singular, and greets without a name when there is none", () => {
    const draft = questionsDraft({ contactName: null, senderName: null, items: [{ title: "x", toResolve: null, isQuestion: true, internal: false }] });
    expect(draft.startsWith("היי,")).toBe(true);
    expect(draft).toContain("יש לי שאלה אחת קצרה:");
  });

  it("names the card and the task by the contact", () => {
    expect(cardTitle(9, "Oren Rubin")).toBe("9 שאלות ל-Oren");
    expect(cardTitle(3, "אורן רובין")).toBe("3 שאלות לאורן");
    expect(cardTitle(1, null)).toBe("שאלה אחת ללקוח");
    expect(sendTaskTitle(9, "אורן רובין")).toBe("לשלוח לאורן 9 שאלות לתיק");
  });

  it("puts an item on its chaser's card, then its owner's, then the account manager's", () => {
    expect(cardOwner({ ownerId: "anna", assigneeId: "hadas" }, "ariel")).toBe("hadas");
    expect(cardOwner({ ownerId: "anna" }, "ariel")).toBe("anna");
    expect(cardOwner({ ownerId: null }, "ariel")).toBe("ariel");
    expect(cardOwner({ ownerId: null }, null)).toBeNull();
  });

  it("puts an uncertain item on the card and takes it off by the latest word on it", () => {
    const at = (d: string) => new Date(d);
    const flags = readAskFlags([
      { afterJson: { itemIds: ["a", "b"], on: true }, createdAt: at("2026-10-01") },
      { afterJson: { itemIds: ["b"], on: false, reason: "לא רלוונטי" }, createdAt: at("2026-10-02") },
      { afterJson: { itemIds: ["c"] }, createdAt: at("2026-10-03") },
      { afterJson: null, createdAt: at("2026-10-04") },
    ]);
    expect([...flags].sort()).toEqual(["a", "c"]);
  });

  it("reads until when each line is put off, the latest date winning", () => {
    const snoozes = readSnoozes([
      { afterJson: { itemIds: ["a"], until: "2026-11-10T06:00:00.000Z" }, createdAt: new Date("2026-11-01") },
      { afterJson: { itemIds: ["a"], until: "2026-11-20T06:00:00.000Z" }, createdAt: new Date("2026-11-02") },
      { afterJson: { itemIds: ["b"], until: "nonsense" }, createdAt: new Date("2026-11-02") },
    ]);
    expect(snoozes.get("a")?.toISOString()).toBe("2026-11-20T06:00:00.000Z");
    expect(snoozes.has("b")).toBe(false);
  });

  it("puts a line off only to a date ahead, and a year at most", () => {
    const now = new Date("2026-11-01T10:00:00Z");
    expect(snoozeError(new Date("2026-11-02T06:00:00Z"), now)).toBeNull();
    expect(snoozeError(new Date("2026-11-01T06:00:00Z"), now)).toBe("התאריך צריך להיות בעתיד.");
    expect(snoozeError(new Date("2028-01-01T06:00:00Z"), now)).toBe("אפשר לדחות עד שנה קדימה.");
    expect(snoozeError(new Date("x"), now)).toBe("צריך לבחור תאריך.");
  });

  it("keeps why a question was not relevant, and names the task we check", () => {
    expect(dismissedAnswer("  לא נבדק,  ואין זמן. ")).toBe("לא רלוונטי: לא נבדק, ואין זמן.");
    expect(checkTaskTitle("הבנק בישראל")).toBe("לבדוק בתיק: הבנק בישראל");
    expect(checkTaskTitle("א".repeat(200))).toHaveLength("לבדוק בתיק: ".length + 110);
  });
});
