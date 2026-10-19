import { describe, expect, it } from "vitest";
import { describePick, pickCategory, tokenize, excludeDemoCategories, isDemoName } from "@/lib/mcp/category-pick";

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
    expect(describePick({ id: "q", name: "הצעת מחיר", basis: "title", confidence: "high" })).toContain("הצעת מחיר");
    expect(describePick({ id: "q", name: "x", basis: "similar", example: "y", confidence: "high" })).toContain('"y"');
  });

  it("asks the user to check a low-confidence pick, and only then", () => {
    expect(describePick({ id: "q", name: "x", basis: "client-usage", confidence: "low" })).toContain("Low confidence");
    expect(describePick({ id: "q", name: "x", basis: "title", confidence: "high" })).not.toContain("Low confidence");
  });
});

describe("demo categories", () => {
  const cats = [{ name: "[DEMO] פגישות ותיאומים" }, { name: "גיוס וhr" }, { name: " [DEMO] מחקר" }];

  it("are left out on a real client", () => {
    expect(excludeDemoCategories(cats, "Ankora פנימי").map((c) => c.name)).toEqual(["גיוס וhr"]);
    expect(excludeDemoCategories(cats, null).map((c) => c.name)).toEqual(["גיוס וhr"]);
  });

  it("stay available on a demo client", () => {
    expect(excludeDemoCategories(cats, "[DEMO] קבוצת מרידיאן")).toHaveLength(3);
  });

  it("are recognised by their prefix", () => {
    expect(isDemoName("[DEMO] x")).toBe(true);
    expect(isDemoName("DEMO x")).toBe(false);
  });
});

// 19.10.2026 (Ariel): a pick has to be earned. One shared word in two
// category names used to win on list order; now it is a low-confidence
// pick, and the internal client has categories for development and
// infrastructure work, described so that the picker can find them.
describe("confidence", () => {
  const INTERNAL = [
    ...CATS,
    { id: "mail", name: "מעבר וארגון על מייל ארגוני" },
    { id: "review", name: "מעבר על משימות ומענה" },
    { id: "staff", name: "מענה וטיפול - עובדים" },
    { id: "client", name: "תקשורת מול הלקוח" },
    { id: "handover", name: "חפיפה" },
    {
      id: "product",
      name: "פיתוח מוצר",
      description:
        "בנייה ושינוי של יכולות שמשתמשים מקבלים: מסכים, פיצ'רים, דוחות, כלים וחיבורים חדשים באפליקציה ובמחבר ה-MCP, כולל תיקון באגים ביכולת קיימת.",
    },
    {
      id: "infra",
      name: "תשתית ואבטחה",
      description:
        "שמירה על הבסיס יציב ומאובטח: סקירות אבטחה, הרשאות וטוקנים, גיבויים, שדרוגי גרסאות ותלויות, ריפו, דומיין ושרתים, ניטור והרצת בדיקות רגרסיה.",
    },
  ];
  const internal = (text: string, extra: Partial<Parameters<typeof pickCategory>[0]> = {}) =>
    pickCategory({ text, candidates: INTERNAL, ...extra });

  it("no longer files a repo migration under organisational email", () => {
    const out = internal("להחליט ולבצע: מעבר ankora-website לריפו פרטי");
    expect(out).toMatchObject({ id: "infra", confidence: "high" });
  });

  it("reads 'מעבר' as filler behind a prefix too", () => {
    expect(tokenize("המעבר ולבצע").length).toBe(0);
  });

  it("finds infrastructure work by its description", () => {
    expect(internal("גיבוי למערכת קלוד")).toMatchObject({ id: "infra", confidence: "high" });
    expect(internal("טיפול בנושאי אבטחה")).toMatchObject({ id: "infra" });
    expect(internal("לבדוק אם לרכוש את הדומיין ankora360.com")).toMatchObject({ id: "infra" });
  });

  it("finds product work by its description", () => {
    expect(internal("סידור ה-UI של האפליקציה: ניווט חזרה, תפריט צד וצבעים")).toMatchObject({ id: "product" });
    expect(internal('פיתוח יכולת "נהלי עבודה" ברמת לקוח')).toMatchObject({ id: "product" });
  });

  it("calls a tie between two names low confidence, and breaks it by usage", () => {
    const clientUsage = new Map([["orders", 12], ["files", 2]]);
    expect(pick("תיוק הזמנות", { clientUsage })).toMatchObject({ id: "orders", confidence: "low" });
    expect(pick("תיוק הזמנות")).toMatchObject({ id: "orders", confidence: "low" });
  });

  it("calls a pick with no evidence low confidence", () => {
    const clientUsage = new Map([["product", 9], ["handover", 4]]);
    expect(internal("שיחה עם יוסי", { clientUsage })).toMatchObject({
      id: "product",
      basis: "client-usage",
      confidence: "low",
    });
  });

  it("keeps a clear match high confidence", () => {
    expect(pick("להכין הצעת מחיר לספק")).toMatchObject({ id: "quote", confidence: "high" });
    expect(pick("תשלום לספק דרך הבנק")).toMatchObject({ id: "bank", confidence: "high" });
  });
});
