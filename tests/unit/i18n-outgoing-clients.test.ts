import { describe, expect, it } from "vitest";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { translatorFor, HEBREW } from "@/lib/i18n/outgoing";
import { buildMessage, MESSAGE_KINDS } from "@/lib/app-domain/client-messages";
import { clientAlertEmail } from "@/lib/app-domain/alerts";
import { renderEmailBody, monthlyDetailedToCsv } from "@/lib/app-domain/report-schedules";
import { toPdfTable } from "@/lib/pdf";

// ADR 0006, outgoing channels, part B and C: what goes to a client's people
// who have no account follows the client's communication language, and a
// file follows whoever asked for it. The Hebrew is pinned character for
// character, because that is what every client received before.

const EN = translatorFor("en");
const HEBREW_LETTER = /[֐-׿]/;

describe("message drafts to a client", () => {
  const ctx = { clientName: "אורביט", fromName: "Dana", subject: "Vendor switch", portalUrl: "https://www.ankora.co.il/app/portal" };

  it("keeps the Hebrew draft as it was", () => {
    const d = buildMessage("decision_waiting", { ...ctx, fromName: "הדס", subject: "החלפת ספק" });
    expect(d.emailSubject).toBe("משהו מחכה להחלטה שלך");
    expect(d.body).toBe(
      "היי,\n\nיש החלטה אחת שמחכה לך בנושא החלפת ספק. ריכזנו את האפשרויות והמחירים, ויש גם המלצה שלנו.\n\n" +
        "אפשר לאשר בלחיצה אחת, ואפשר לענות לי כאן אם עדיף לדבר על זה.\n\nhttps://www.ankora.co.il/app/portal/decisions\n\nהדס"
    );
    expect(buildMessage("delay", { clientName: "x", fromName: "הדס" }).body).toBe(
      "היי,\n\nרציתי לעדכן לפני שתשים לב בעצמך: מתעכב. [למה, במשפט].\n\nהמועד המעודכן הוא [מתי], ואני מלווה את זה עד הסוף.\n\nהדס"
    );
  });

  it("writes every draft in English for an English client, signed by the person", () => {
    for (const kind of MESSAGE_KINDS) {
      const d = buildMessage(kind, ctx, EN);
      expect(d.body.startsWith("Hi,"), kind).toBe(true);
      expect(d.body.trimEnd().endsWith("Dana"), kind).toBe(true);
      expect(HEBREW_LETTER.test(d.emailSubject), kind).toBe(false);
      expect(HEBREW_LETTER.test(d.body), kind).toBe(false);
      if (kind !== "decision_waiting") expect(d.body, kind).toContain("Vendor switch");
    }
  });

  it("puts the outcome the person wrote in as written", () => {
    const d = buildMessage("promise_done", { ...ctx, outcome: "הספק הוחלף." }, EN);
    expect(d.body).toBe("Hi,\n\nהספק הוחלף.\n\nIs there anything else we can take off your plate?\n\nDana");
  });
});

describe("the client copy of an hour bank alert", () => {
  const prepaid = {
    clientName: "אורביט",
    isPrepaid: true,
    rule: { type: "UTILIZATION_PCT" as const, thresholdValue: 80 },
    utilization: { utilizationPct: 82, remainingMinutes: 108 },
  };

  it("keeps the Hebrew as it was", () => {
    expect(clientAlertEmail(prepaid)).toEqual({
      subject: "עדכון חבילת שעות - אורביט",
      text: "שלום,\n\nנוצלו 82% מחבילת השעות האחרונה שלכם.\nנותרו 1.80 שעות.\n\nבברכה,\nצוות Ankora",
    });
    expect(clientAlertEmail({ ...prepaid, isPrepaid: false, utilization: { utilizationPct: 104, remainingMinutes: -21 } }, HEBREW.t).text).toBe(
      "שלום,\n\nזהו עדכון אוטומטי על ניצול בנק השעות שלכם אצל Ankora.\nניצול נוכחי: 104%\nחריגה מהבנק: 21 דקות\n\nבברכה,\nצוות Ankora"
    );
  });

  it("is English for an English client, the client's name as written", () => {
    const { subject, text } = clientAlertEmail(prepaid, EN.t);
    expect(subject).toBe("Hour package update - אורביט");
    expect(text).toBe("Hello,\n\n82% of your latest hour package has been used.\n1.80 hours remain.\n\nBest regards,\nThe Ankora team");
  });
});

describe("the scheduled report email", () => {
  const from = new Date("2026-09-30T21:00:00Z"); // 1.10.2026, Israel
  const to = new Date("2026-10-31T22:00:00Z"); // 1.11.2026, Israel
  const snapshot = { rows: [{ category: "ייעוץ", minutes: 90 }] };

  it("keeps the Hebrew as it was", () => {
    expect(renderEmailBody("HOURS_BY_CATEGORY", "אורביט", from, to, snapshot, null)).toEqual({
      subject: "Ankora - סיכום קטגוריות - אורביט (2026-10-01 - 2026-10-31)",
      text: "סיכום קטגוריות עבור אורביט\nתקופה: 2026-10-01 - 2026-10-31\n\nייעוץ: 90 דקות\n\nלצפייה מלאה: https://www.ankora.co.il/app/portal",
    });
    const rows = { rows: [{ date: "2026-10-02", activity: "פגישה", category: "ייעוץ", billableMinutes: 30 }] };
    expect(renderEmailBody("WEEKLY_ACTIVITY", "אורביט", from, to, rows, null).text).toContain("2026-10-02 | פגישה | ייעוץ | 30 דק'");
  });

  it("is English for an English client; the approved summary and the categories go in as written", () => {
    const { subject, text } = renderEmailBody("HOURS_BY_CATEGORY", "Orbit", from, to, snapshot, "סיכום שאושר", EN);
    expect(subject).toBe("Ankora - Hours by category - Orbit (2026-10-01 - 2026-10-31)");
    expect(text).toBe(
      "Hours by category for Orbit\nPeriod: 2026-10-01 - 2026-10-31\n\nסיכום שאושר\n\nייעוץ: 90 minutes\n\nFull view: https://www.ankora.co.il/app/portal"
    );
  });
});

describe("files a person downloads", () => {
  const rows = [{ date: "2026-10-02", activity: "פגישה", category: "ייעוץ", billableMinutes: 30 }];

  it("heads the monthly CSV in the requester's language", () => {
    expect(monthlyDetailedToCsv(rows).split("\n")[0]).toContain("תאריך,פעילות,קטגוריה,דקות לחיוב");
    const en = monthlyDetailedToCsv(rows, EN);
    expect(en.split("\n")[0]).toContain("Date,Activity,Category,Billable minutes");
    expect(en).toContain("פגישה");
  });

  it("lays an English PDF table out left to right, keeping Hebrew names", async () => {
    const buf = await toPdfTable({ title: "Time entries", headers: ["Client", "Minutes"], rows: [["אורביט", 120]], dir: "ltr" });
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const content = await (await doc.getPage(1)).getTextContent();
    const items = content.items as { str: string; transform: number[] }[];
    const x = (s: string) => items.find((i) => i.str === s)?.transform[4] ?? NaN;
    // First column on the left, and the title starts at the left margin.
    expect(x("Client")).toBeLessThan(x("Minutes"));
    expect(Math.round(x("Time entries"))).toBe(40);
    // The Hebrew name is painted with the Hebrew subset, so it is there.
    expect(items.some((i) => HEBREW_LETTER.test(i.str))).toBe(true);
  });

  it("says there is no data in the file's language", async () => {
    const buf = await toPdfTable({ title: "Empty", headers: ["A"], rows: [], dir: "ltr", emptyText: EN.t("exports.noData") });
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const text = (await (await doc.getPage(1)).getTextContent()).items.map((i) => (i as { str: string }).str).join("");
    expect(text).toContain("No");
    expect(text).toContain("selected");
  });
});
