import { describe, expect, it } from "vitest";
import { describePick, pickCategory, tokenize } from "@/lib/mcp/category-pick";

// 15.10.2026 (Ariel): choosing a category for a task nobody gave one.
// The candidates are the real global categories on production.

const CATS = [
  { id: "auto", name: "אוטומציות" },
  { id: "data", name: "בירור נתונים" },
  { id: "bank", name: "בנקאות ותשלומים" },
  { id: "collect", name: "גבייה" },
  { id: "hr", name: "גיוס וhr" },
  { id: "fin", name: "דיווח פיננסי" },
  { id: "orders", name: "הזמנות" },
  { id: "books", name: "הנהלת חשבונות" },
  { id: "quote", name: "הצעת מחיר" },
  { id: "files", name: "תיוק וארגון מסמכים" },
  { id: "office", name: "ניהול משרד", description: "ספקים, ציוד, מנויים ותחזוקה של המשרד" },
];

const pick = (text: string, extra: Partial<Parameters<typeof pickCategory>[0]> = {}) =>
  pickCategory({ text, candidates: CATS, ...extra });

describe("tokenize", () => {
  it("strips one-letter prefixes and folds final letters", () => {
    const forms = tokenize("והחשבונות").flat();
    expect(forms).toContain("חשבונות");
  });

  it("drops filler words", () => {
    expect(tokenize("לבדוק את זה").length).toBe(0);
  });
});

describe("pickCategory", () => {
  it("follows the task's own words to a category name", () => {
    expect(pick("להכין הצעת מחיר לספק")).toMatchObject({ id: "quote", basis: "title" });
    expect(pick("גיוס מנהלת חשבונות")).toMatchObject({ basis: "title" });
    expect(pick("תשלום לספק דרך הבנק")).toMatchObject({ id: "bank", basis: "title" });
  });

  it("matches a word through its prefix and a different ending", () => {
    expect(pick("לתייק את המסמכים של הרבעון")).toMatchObject({ id: "files" });
    expect(pick("ובהזמנה של הלקוח")).toMatchObject({ id: "orders" });
  });

  it("reads the admin's description of a category", () => {
    expect(pick("לחדש מנוי לתוכנה")).toMatchObject({ id: "office", basis: "title" });
  });

  it("learns from how similar work was filed when the name says nothing", () => {
    const history = [
      { categoryId: "books", text: "התאמת עסקאות כרטיסי אשראי" },
      { categoryId: "auto", text: "חיבור זאפייר" },
    ];
    const out = pick("התאמת כרטיסי אשראי לספטמבר", { history });
    expect(out).toMatchObject({ id: "books", basis: "similar", example: "התאמת עסקאות כרטיסי אשראי" });
  });

  it("falls back to what this client's work usually is", () => {
    const clientUsage = new Map([["collect", 40], ["data", 3]]);
    expect(pick("שיחה עם יוסי", { clientUsage })).toMatchObject({ id: "collect", basis: "client-usage" });
  });

  it("never lets usage outvote the task's own words", () => {
    const clientUsage = new Map([["collect", 500]]);
    expect(pick("הצעת מחיר", { clientUsage })).toMatchObject({ id: "quote" });
  });

  it("takes the first category when nothing points anywhere", () => {
    expect(pick("שיחה עם יוסי")).toMatchObject({ id: "auto", basis: "default" });
  });

  it("returns null only when there is nothing to choose from", () => {
    expect(pickCategory({ text: "x", candidates: [] })).toBeNull();
  });
});

describe("describePick", () => {
  it("says why, in one line", () => {
    expect(describePick({ id: "q", name: "הצעת מחיר", basis: "title" })).toContain("הצעת מחיר");
    expect(describePick({ id: "q", name: "x", basis: "similar", example: "y" })).toContain('"y"');
  });
});
