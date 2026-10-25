import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  buildProcedureDoc,
  fingerprintSource,
  readControlRefs,
  readSnapshot,
  readTranslation,
  textBlocks,
  translationGaps,
  type ProcedureSnapshot,
  type ProcedureVersionInfo,
} from "@/lib/procedure-document";
import { visualSegments } from "@/lib/pdf";
import { scriptRuns, xmlEscape } from "@/lib/docx";
import { renderProcedurePdf, renderProcedurePackPdf } from "@/lib/procedure-pdf";
import { renderProcedureDocx, renderProcedurePackDocx } from "@/lib/procedure-docx";
import { readSteps } from "@/lib/process-rules";

// The procedure as a document (23.10.2026): what goes into it, what the
// English version may not leave in Hebrew, and that the PDF and the Word
// file both carry it.

const snapshot: ProcedureSnapshot = {
  v: 1,
  frozenAt: "2026-10-21T08:00:00.000Z",
  frozenBy: "approval",
  clientName: "NUX",
  code: "P1",
  title: "ניהול משתמשים והרשאות ב-Google Workspace",
  purpose: "פתיחה, סגירה ושינוי של משתמשים והרשאות, עם תיעוד לצורך SOC 2.",
  scope: "כל עובדי NUX בישראל ובארה\"ב.\n- לא כולל ספקים חיצוניים",
  definitions: "Onboarding: קליטת עובד חדש\nOffboarding: עזיבת עובד",
  triggerKinds: ["EVENT", "ON_DEMAND"],
  triggerText: "עובד חדש, עובד שעוזב, או בקשת הרשאה מהמנהל הישיר.",
  slaText: "טל מבצע תוך 24 שעות.",
  owner: "Hadas Vinogura",
  backupOwner: "Ariel",
  executor: "טל (IT)",
  approver: "אין אישור נפרד.",
  approvalText: null,
  externalParty: null,
  systems: [{ name: "Google Workspace", permission: "Admin" }],
  systemNames: { sys1: "Google Workspace", sys2: "Slack" },
  exceptionPlaybook: "טל לא ביצע תוך 24 שעות: פונים לאורן.",
  controlRefs: ["CC6.2", "CC6.3"],
  classification: "CONFIDENTIAL",
  relatedDocs: null,
  reviewEveryDays: 365,
  // A v1 snapshot froze no contact ids. See SnapshotPeople.
  people: null,
};

const steps = [
  { title: "לאסוף את פרטי הבקשה", mode: "MANUAL", offsetBusinessDays: null, actionTags: [], systemIds: [], output: "שם, תפקיד, מנהל ישיר", verification: null, requiresApproval: false, amountMaxMinor: null, currency: null, channel: null },
  { title: "לשלוח לטל בקשה ב-Slack", mode: "ASSISTED", offsetBusinessDays: 0, actionTags: [], systemIds: ["sys2"], output: null, verification: "טל אישר ב-Slack", requiresApproval: true, amountMaxMinor: 150000, currency: "USD", channel: "SLACK" },
];

const version: ProcedureVersionInfo = {
  version: 2,
  status: "APPROVED",
  steps,
  highlights: null,
  outputs: "כרטיס מעודכן ב-Settle",
  changeNote: "נוסף אימות",
  createdAt: new Date("2026-10-20T08:00:00Z"),
  approvedAt: new Date("2026-10-21T08:00:00Z"),
  approvedBy: "אריאל",
};

const history = [
  { version: 1, status: "SUPERSEDED" as const, approvedAt: new Date("2026-10-15T08:00:00Z"), approvedBy: "אריאל", changeNote: null },
  { version: 2, status: "APPROVED" as const, approvedAt: version.approvedAt, approvedBy: "אריאל", changeNote: "נוסף אימות" },
];

const translation = {
  title: "Google Workspace user and access management",
  purpose: "Opening, closing and changing users and permissions, documented for SOC 2.",
  scope: "All NUX employees in Israel and the US.\n- Excludes external vendors",
  definitions: "Onboarding: hiring a new employee\nOffboarding: an employee leaving",
  triggerText: "A new hire, a leaver, or an access request from the direct manager.",
  slaText: "Tal executes within 24 hours.",
  owner: "Hadas Vinogura",
  backupOwner: "Ariel Utnik",
  executor: "Tal (IT)",
  approver: "No separate approval.",
  exceptionPlaybook: "Tal did not execute within 24 hours: escalate to Oren.",
  systems: [{ name: "Google Workspace", permission: "Admin" }],
  steps: [
    { title: "Collect the request details", output: "Name, role, direct manager" },
    { title: "Send Tal the request on Slack", verification: "Tal confirmed on Slack" },
  ],
  outputs: "Ticket updated in Settle",
  changeNotes: { "2": "Added verification" },
  names: { "אריאל": "Ariel Utnik" },
};

describe("readControlRefs", () => {
  it("splits, trims, dedupes and drops what is not a control code", () => {
    expect(readControlRefs("CC6.2, cc6.2,  CC6.3\nA.5.18, <script>, ")).toEqual(["CC6.2", "CC6.3", "A.5.18"]);
    expect(readControlRefs(["CC7.1", 3, "x".repeat(30)])).toEqual(["CC7.1"]);
  });
});

describe("readSnapshot", () => {
  it("round-trips and rejects what is not a snapshot", () => {
    expect(readSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    // 25.10.2026: v2 is a real version now (contact ids, see
    // SnapshotPeople), so the "not a snapshot" case moved up.
    expect(readSnapshot({ v: 9, title: "x", code: "P1" })).toBeNull();
    expect(readSnapshot(null)).toBeNull();
  });
});

describe("textBlocks", () => {
  it("turns list lines into bullets and the rest into paragraphs", () => {
    expect(textBlocks("**א**\n- ב\n2. ג\n\nד")).toEqual([
      { kind: "para", text: "א" },
      { kind: "bullets", items: ["ב", "ג"] },
      { kind: "para", text: "ד" },
    ]);
  });
});

describe("buildProcedureDoc", () => {
  const he = buildProcedureDoc({ lang: "he", snapshot, version, history, live: false, omitEmpty: true });

  it("has the SOC 2 sections in order, numbered, and ends with the approval", () => {
    const headings = he.blocks.filter((b) => b.kind === "heading" && b.level === 1).map((b) => (b as { text: string }).text);
    expect(headings).toEqual([
      "1. מטרה",
      "2. תחולה",
      "3. הגדרות",
      "4. תפקידים ואחריות",
      "5. הפעלה וזמני תגובה",
      "6. מערכות והרשאות",
      "7. הנוהל",
      "8. חריגות והסלמה",
      "9. תיעוד וראיות",
      "10. מיפוי לבקרות",
      "11. היסטוריית גרסאות",
      "12. אישור המסמך",
    ]);
    expect(he.gaps).toEqual(["דגשים", "מסמכים קשורים"]);
  });

  it("keeps empty sections, marked, when asked to (the read view)", () => {
    const view = buildProcedureDoc({ lang: "he", snapshot, version, history, live: false, omitEmpty: false });
    expect(view.blocks.some((b) => b.kind === "heading" && b.text.endsWith("דגשים"))).toBe(true);
    expect(view.blocks.some((b) => b.kind === "para" && b.text === "לא הוגדר" && b.muted)).toBe(true);
  });

  it("puts the header facts in the meta table, review date included", () => {
    const meta = Object.fromEntries(he.meta);
    expect(meta["מזהה מסמך"]).toBe("P1");
    expect(meta["גרסה"]).toBe("2");
    expect(meta["סטטוס"]).toBe("מאושר ובתוקף");
    expect(meta["סיווג"]).toBe("סודי");
    expect(meta["סקירה הבאה"]).toContain("2027");
    expect(he.footer).toBe("NUX · P1 v2 · סודי");
  });

  it("describes a step fully: mode, timing, systems, approval, amount and channel", () => {
    const i = he.blocks.findIndex((b) => b.kind === "heading" && b.text === "2. לשלוח לטל בקשה ב-Slack");
    const table = he.blocks[i + 1];
    expect(table.kind).toBe("table");
    const rows = Object.fromEntries((table as { rows: string[][] }).rows);
    expect(rows["אופן ביצוע"]).toBe("Claude מכין, אדם בודק");
    expect(rows["מתי"]).toBe("ביום המועד");
    expect(rows["מערכות"]).toBe("Slack");
    expect(rows["דורש אישור לפני ביצוע"]).toBe("כן");
    expect(rows["סכום מרבי"]).toBe("1,500 USD");
    expect(rows["ערוץ"]).toBe("Slack");
  });

  it("says a draft is not in effect, and leaves its dates empty", () => {
    const draft = buildProcedureDoc({ lang: "he", snapshot, version: { ...version, status: "DRAFT", approvedAt: null, approvedBy: null }, history, live: false, omitEmpty: true });
    expect(draft.blocks.at(-1)).toEqual({ kind: "para", text: "טיוטה. הגרסה הזו עדיין לא אושרה, ואינה בתוקף." });
    expect(Object.fromEntries(draft.meta)["בתוקף מ-"]).toBe("");
    expect(draft.footer).toBe("NUX · P1 v2 · טיוטה");
  });

  it("notes a version drawn from the live process", () => {
    expect(buildProcedureDoc({ lang: "he", snapshot, version, history, live: true, omitEmpty: true }).liveNote).toContain("כפי שהוא היום");
  });

  it("refuses English without a translation, and draws it in English with one", () => {
    expect(() => buildProcedureDoc({ lang: "en", snapshot, version, history, live: false, omitEmpty: true })).toThrow();
    const en = buildProcedureDoc({ lang: "en", snapshot, version, history, translation: readTranslation(translation), live: false, omitEmpty: true });
    expect(en.dir).toBe("ltr");
    expect(en.title).toBe("Google Workspace user and access management");
    expect(Object.fromEntries(en.meta)["Approved by"]).toBe("Ariel Utnik");
    const text = JSON.stringify(en.blocks);
    expect(text).toContain("Prepared by AI, reviewed by a person");
    expect(text).toContain("Added verification");
    // Nothing Hebrew left but the client's own name, which is not Hebrew here.
    expect(/[֐-׿]/.test(JSON.stringify({ meta: en.meta, blocks: en.blocks }))).toBe(false);
  });

  it("prints the same fingerprint source on every day", () => {
    const again = buildProcedureDoc({ lang: "he", snapshot, version, history, live: false, omitEmpty: true });
    expect(fingerprintSource(again)).toBe(fingerprintSource(he));
  });
});

describe("translationGaps", () => {
  const v = { steps: readSteps(steps), highlights: null, outputs: version.outputs };

  it("is empty for a complete translation", () => {
    expect(translationGaps(snapshot, v, readTranslation(translation)!)).toEqual([]);
  });

  it("names every field left out or left in Hebrew", () => {
    const partial = readTranslation({ ...translation, scope: null, steps: [{ title: "Collect" }, { title: "שליחה" }] })!;
    const gaps = translationGaps(snapshot, v, partial);
    expect(gaps).toContain("scope");
    expect(gaps).toContain("steps[0].output");
    expect(gaps).toContain("steps[1].verification");
    expect(gaps).toContain("steps[1].title (still in Hebrew)");
  });
});

describe("bidi for an LTR line", () => {
  it("keeps English in order and reads a Hebrew name inside it right to left", () => {
    const segs = visualSegments("Owner: הדס, CC6.2", "ltr");
    expect(segs.map((s) => s.text).join("")).toBe("Owner: הדס, CC6.2");
    // The RTL default is unchanged.
    expect(visualSegments("גרסה 2").map((s) => s.text).join("")).toBe("2 גרסה");
  });
});

describe("docx helpers", () => {
  it("marks Hebrew runs and escapes XML", () => {
    expect(scriptRuns("נוהל SOC 2 גרסה")).toEqual([
      { text: "נוהל ", rtl: true },
      { text: "SOC 2 ", rtl: false },
      { text: "גרסה", rtl: true },
    ]);
    expect(xmlEscape(`a<b>&"\u0001`)).toBe("a&lt;b&gt;&amp;&quot;");
  });
});

async function pdfText(buf: Buffer): Promise<{ pages: number; text: string }> {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    text += content.items.map((it) => ("str" in it ? it.str : "")).join("") + "\n";
  }
  return { pages: doc.numPages, text };
}

describe("files", () => {
  const he = buildProcedureDoc({ lang: "he", snapshot, version, history, live: false, omitEmpty: true });
  const en = buildProcedureDoc({ lang: "en", snapshot, version, history, translation: readTranslation(translation), live: false, omitEmpty: true });
  const hash = "a".repeat(64);

  it("renders the Hebrew and English PDF with the footer and the fingerprint", async () => {
    const heBuf = await renderProcedurePdf(he, hash);
    expect(heBuf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const enText = (await pdfText(await renderProcedurePdf(en, hash))).text;
    expect(enText).toContain("Google Workspace user and access management");
    expect(enText).toContain("CC6.2");
    expect(enText).toContain("page 1/");
    expect(enText.replace(/\s/g, "")).toContain(hash.slice(0, 32));
  });

  it("renders a pack with a cover and every procedure", async () => {
    const buf = await renderProcedurePackPdf({ clientName: "NUX", lang: "en", generatedAt: new Date("2026-10-23T08:00:00Z"), docs: [{ doc: en, fingerprint: hash }, { doc: en, fingerprint: hash }], skipped: [{ code: "P4", title: "Receipts", reason: "no translation" }] });
    const { pages, text } = await pdfText(buf);
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(text).toContain("Procedures");
    expect(text).toContain("P4 Receipts");
  });

  it("writes a Word file that is right to left in Hebrew, with headings, tables and page numbers", async () => {
    const zip = await JSZip.loadAsync(await renderProcedureDocx(he, hash));
    const body = await zip.file("word/document.xml")!.async("string");
    expect(body).toContain('<w:pStyle w:val="Heading1"/>');
    expect(body).toContain("<w:bidiVisual/>");
    expect(body).toContain("<w:rtl/>");
    expect(body).toContain("ניהול משתמשים והרשאות ב-");
    expect(body).toContain(hash);
    expect(body).toMatch(/<w:sectPr>.*<w:bidi\/><\/w:sectPr>/);
    const footer = await zip.file("word/footer1.xml")!.async("string");
    expect(footer).toContain("NUMPAGES");
    expect(await zip.file("word/styles.xml")!.async("string")).toContain('w:styleId="Heading2"');
  });

  it("writes an English Word file without right-to-left marks in its layout", async () => {
    const zip = await JSZip.loadAsync(await renderProcedureDocx(en, hash));
    const body = await zip.file("word/document.xml")!.async("string");
    expect(body).not.toContain("<w:bidi/>");
    expect(body).not.toContain("<w:bidiVisual/>");
    expect(body).toContain("Records and evidence");
  });

  it("writes a pack Word file with a page break before each procedure", async () => {
    const zip = await JSZip.loadAsync(await renderProcedurePackDocx({ clientName: "NUX", lang: "he", generatedAt: new Date(), docs: [{ doc: he, fingerprint: hash }, { doc: he, fingerprint: hash }], skipped: [] }));
    const body = await zip.file("word/document.xml")!.async("string");
    expect(body.match(/<w:pageBreakBefore\/>/g)?.length).toBe(2);
  });
});

// A contact marked sensitive after the version was approved (25.10.2026).
//
// The filter that keeps a sensitive contact out of a document used to run
// in one place: the query inside buildSnapshot, at the moment of
// approval. A procedure approved in March and a contact marked sensitive
// in April therefore never met, and that procedure is the one that goes
// to a client, to an auditor, and to Claude for the translation.
//
// These cover the document half. The database half, where the mark is
// actually read, is in tests/integration/procedure-documents.test.ts.
describe("a contact who may no longer be named", () => {
  const v2: ProcedureSnapshot = {
    ...snapshot,
    v: 2,
    executor: "טל (IT). רינת כהן (מנהלת משרד)",
    people: {
      executorUser: "טל (IT)",
      executorContactId: "contact_rinat",
      executorText: null,
      approverUser: null,
      approverContactId: null,
      approverText: "אין אישור נפרד.",
      externalPartyContactIds: [],
      externalPartyText: null,
    },
  };

  it("reads a v2 snapshot's parts back, and a v1 snapshot as having none", () => {
    const back = readSnapshot(JSON.parse(JSON.stringify(v2)));
    expect(back?.v).toBe(2);
    expect(back?.people?.executorContactId).toBe("contact_rinat");
    expect(back?.people?.externalPartyContactIds).toEqual([]);

    const old = readSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(old?.v).toBe(1);
    expect(old?.people).toBeNull();
    // And the frozen line is still readable, which is what a v1 version
    // keeps being read through.
    expect(old?.executor).toBe("טל (IT)");
  });

  it("refuses a snapshot whose version it does not know", () => {
    expect(readSnapshot({ ...snapshot, v: 3 })).toBeNull();
  });

  it("says so in the document instead of printing one name fewer", () => {
    const doc = buildProcedureDoc({
      lang: "he",
      snapshot: { ...v2, executor: "טל (IT)" },
      version,
      history: [],
      live: false,
      omitEmpty: true,
      withheldPeople: ["executor"],
    });
    const roles = doc.blocks.map((b) => JSON.stringify(b)).join("\n");
    expect(roles).toContain("הושמט");
    // The name itself is gone.
    expect(roles).not.toContain("רינת");
  });

  it("prints nothing about it on an ordinary document", () => {
    const doc = buildProcedureDoc({ lang: "he", snapshot, version, history: [], live: false, omitEmpty: true });
    expect(doc.blocks.map((b) => JSON.stringify(b)).join("\n")).not.toContain("הושמט");
  });

  it("does not let the English keep a name the Hebrew dropped", () => {
    // The translation was approved before the contact was marked, so it
    // still carries the name. Withholding in one language only publishes
    // it in the other.
    const stale = { ...translation, executor: "Tal (IT). Rinat Cohen (office manager)" };
    const doc = buildProcedureDoc({
      lang: "en",
      snapshot: { ...v2, executor: "טל (IT)" },
      version,
      history: [],
      translation: stale,
      live: false,
      omitEmpty: true,
      withheldPeople: ["executor"],
    });
    const text = doc.blocks.map((b) => JSON.stringify(b)).join("\n");
    expect(text).not.toContain("Rinat");
    expect(text).toContain("withheld");
  });

  it("leaves the English alone when nothing was withheld", () => {
    const fresh = { ...translation, executor: "Tal (IT)" };
    const doc = buildProcedureDoc({ lang: "en", snapshot: v2, version, history: [], translation: fresh, live: false, omitEmpty: true });
    const text = doc.blocks.map((b) => JSON.stringify(b)).join("\n");
    expect(text).toContain("Tal (IT)");
    expect(text).not.toContain("withheld");
  });
});
