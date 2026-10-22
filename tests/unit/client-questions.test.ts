import { describe, expect, it } from "vitest";
import { cardOwner, cardTitle, questionText, questionsDraft, sendTaskTitle } from "@/lib/client-questions";

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
});
