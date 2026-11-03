import { describe, expect, it } from "vitest";
import { detectVendorSignal, knownVendorsFromSite, vendorKey } from "@/lib/vendor-detection";

// P8 (3.11.2026): noticing a new vendor in a task's text. Pure, so every
// case is pinned here without a database.

const known = knownVendorsFromSite();

describe("knownVendorsFromSite", () => {
  it("reads the subprocessors the security page names", () => {
    expect(known).toEqual(expect.arrayContaining(["Vercel", "Neon", "Resend", "Fireflies", "Unipile", "Anthropic"]));
  });
});

describe("detectVendorSignal", () => {
  it("finds a new vendor next to a Hebrew verb of connecting", () => {
    expect(detectVendorSignal("לחבר את Pipedrive לאפליקציה", known)).toEqual({
      vendor: "Pipedrive",
      existingVendor: null,
      matched: "לחבר + Pipedrive",
    });
  });

  it("finds a new vendor next to a Latin technology word", () => {
    expect(detectVendorSignal("Twilio API לשיחות של לקוחות", known)?.vendor).toBe("Twilio");
    expect(detectVendorSignal("להוסיף MCP של Notion", known)?.vendor).toBe("Notion");
  });

  it("keeps two capitalised words together as one name", () => {
    expect(detectVendorSignal("חיבור Meet Alfred דרך MCP", known)?.vendor).toBe("Meet Alfred");
  });

  it("reads Hebrew prefixes on the verb", () => {
    expect(detectVendorSignal("ובחיבור Dialpad נבדוק הקלטות", known)?.vendor).toBe("Dialpad");
    expect(detectVendorSignal("האינטגרציה עם Commbox", known)?.vendor).toBe("Commbox");
  });

  it("reports a known vendor as existing, not new", () => {
    const s = detectVendorSignal("לחבר את Fireflies לתיק הלקוח", known);
    expect(s?.vendor).toBe("Fireflies");
    expect(s?.existingVendor).toBe("Fireflies");
  });

  it("maps a channel to the vendor it runs through", () => {
    expect(detectVendorSignal("לחבר WhatsApp נוסף ללקוח", known)?.existingVendor).toBe("Unipile");
    expect(detectVendorSignal("לחבר וואטסאפ לאנה", known)?.existingVendor).toBe("Unipile");
  });

  it("treats extra known names (a vendor that already had a run) as existing", () => {
    expect(detectVendorSignal("להירשם ל-Apollo", [...known, "Apollo"])?.existingVendor).toBe("Apollo");
  });

  it("asks about a Hebrew verb of connecting even without a name", () => {
    expect(detectVendorSignal("לחבר את המערכת של הבנק", known)).toEqual({
      vendor: null,
      existingVendor: null,
      matched: "לחבר",
    });
  });

  it("stays quiet on technology words alone", () => {
    expect(detectVendorSignal("MCP אישורים: תיקונים מבדיקה מול האפליקציה", known)).toBeNull();
    expect(detectVendorSignal("להוסיף API לייצוא", known)).toBeNull();
  });

  it("stays quiet when nothing is being connected", () => {
    expect(detectVendorSignal("רשימת משימות: עריכת תאריך יעד מהשורה", known)).toBeNull();
    expect(detectVendorSignal("", known)).toBeNull();
  });

  it("does not take a Hebrew word that merely contains the verb", () => {
    // "מחברת" (a notebook) is not "מחבר".
    expect(detectVendorSignal("לסדר את המחברת של Hadas", known)).toBeNull();
  });
});

// 3.11.2026: three questions asked about vendors that were not there.
describe("detectVendorSignal, false alarms of 3.11.2026", () => {
  it("does not take a step letter from another sentence (\"N\")", () => {
    const text = [
      "- תהליך עם שלבים אוטומטיים: חמש הערות זהות, \"שלב N אוטומטי: צריך לכתוב איך אדם מוודא שזה קרה\".",
      "7. לכתוב בדיקות יחידה, אינטגרציה וזרימה במסך. מבצע: קלוד.",
    ].join("\n");
    expect(detectVendorSignal(text, known)).toBeNull();
  });

  it("does not read a path as an integration of \"tests\"", () => {
    expect(detectVendorSignal("הבדיקה `tests/integration/backup-restore-roundtrip.test.ts` נעצרת ב-main.", known)).toBeNull();
    expect(detectVendorSignal("הבדיקה tests/integration/backup-restore-roundtrip.test.ts נעצרת ב-main.", known)).toBeNull();
  });

  it("does not take a process code (\"P14\") or a quoted detection for a vendor", () => {
    const text = [
      "לחדד את הזיהוי האוטומטי של ספק חדש (P14), כדי שלא ייתפס על מילים נפוצות",
      "- \"N\" (התאמה \"אינטגרציה + N\"), בשמירת תוכנית.",
      "- \"tests\" (התאמה \"integration + tests\"), ביצירת המשימה.",
    ].join("\n");
    expect(detectVendorSignal(text, known)).toBeNull();
  });

  it("does not take code identifiers for names", () => {
    // The verb still asks, as any "חיבור" does, but with no name taken from the code.
    expect(detectVendorSignal("חיבור השדה clients.subprocessorNoticeDocumentId ל-client_documents", known)?.vendor).toBeNull();
    expect(detectVendorSignal("integration של subprocessorNoticeDocumentId עם client_documents", known)).toBeNull();
  });
});

describe("detectVendorSignal, still finds real vendors", () => {
  it("in the same sentence as the action word", () => {
    expect(detectVendorSignal("רקע על המשימה.\nלחבר את HubSpot לפורטל הלקוח.", known)?.vendor).toBe("HubSpot");
    expect(detectVendorSignal("integration with Salesforce for client data", known)?.vendor).toBe("Salesforce");
  });

  it("a lower-case name right next to the action word", () => {
    expect(detectVendorSignal("לחבר את pipedrive לאפליקציה", known)?.vendor).toBe("pipedrive");
  });

  it("not a name from a sentence that connects nothing", () => {
    expect(detectVendorSignal("השבוע דיברנו עם Pipedrive. צריך לחבר את המערכת של הבנק.", known)).toEqual({
      vendor: null,
      existingVendor: null,
      matched: "לחבר",
    });
  });
});

describe("vendorKey", () => {
  it("is case and space insensitive", () => {
    expect(vendorKey("  Meet   Alfred ")).toBe("meet alfred");
  });
});
