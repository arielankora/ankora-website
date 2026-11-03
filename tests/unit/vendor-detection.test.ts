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

  it("needs a name: a verb of connecting alone is not a vendor", () => {
    // 3.11.2026: asking "which vendor?" on every "חיבור" was the noise.
    expect(detectVendorSignal("לחבר את המערכת של הבנק", known)).toBeNull();
  });

  it("stays quiet on technology words alone", () => {
    expect(detectVendorSignal("MCP אישורים: תיקונים מבדיקה מול האפליקציה", known)).toBeNull();
    expect(detectVendorSignal("להוסיף API לייצוא", known)).toBeNull();
  });

  it("does not take a process, source, PR or version code for a vendor", () => {
    // 3.11.2026, in production: "MCP + P15" read as a vendor called P15.
    expect(detectVendorSignal("אישור אחד לתהליך: MCP + P15", known)).toBeNull();
    expect(detectVendorSignal("לחבר את S28 ל-P8", known)).toBeNull();
    expect(detectVendorSignal("API v2 ל-PR400", known)).toBeNull();
    expect(detectVendorSignal("MCP 1.0", known)).toBeNull();
  });

  it("still finds a real name next to a code", () => {
    expect(detectVendorSignal("לחבר את Pipedrive ל-P15", known)?.vendor).toBe("Pipedrive");
    expect(detectVendorSignal("חיבור MCP של Pipedrive ל-P15", known)?.vendor).toBe("Pipedrive");
  });

  it("stays quiet on the false alarms seen in production (3.11.2026)", () => {
    expect(detectVendorSignal("תיקון integration tests שנכשלים ב-qa", known)).toBeNull();
    expect(detectVendorSignal("Integration tests: להוסיף בדיקה לחיבור", known)).toBeNull();
    expect(detectVendorSignal("חיבור ariel@ankora.co.il לחשבון", known)).toBeNull();
    expect(detectVendorSignal("להוסיף integration עם tests", known)).toBeNull();
    expect(detectVendorSignal("Claude MCP: כלי חדש לאישורים", known)).toBeNull();
    expect(detectVendorSignal("חיבור הכפתור למסך ב-https://www.ankora.co.il/app", known)).toBeNull();
  });

  it("finds a name after an English verb of connecting", () => {
    expect(detectVendorSignal("Connect Pipedrive to the app", known)?.vendor).toBe("Pipedrive");
    expect(detectVendorSignal("integrate with HubSpot", known)?.vendor).toBe("HubSpot");
    expect(detectVendorSignal("sign up for Aircall", known)?.vendor).toBe("Aircall");
    expect(detectVendorSignal("connect tests", known)).toBeNull();
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

describe("vendorKey", () => {
  it("is case and space insensitive", () => {
    expect(vendorKey("  Meet   Alfred ")).toBe("meet alfred");
  });
});
