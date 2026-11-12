import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import type { User } from "@prisma/client";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

// ADR 0006, outgoing channels, parts B and C. A client's people who have no
// account get the client's communication language; a person with an
// account inside the client's address list gets their own; a file follows
// whoever asked for it. A Hebrew client gets exactly the Hebrew it always
// got.

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

let currentUser: User | null = null;
vi.mock("@/lib/app-auth/session", () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    getCurrentUser: async () => currentUser,
    requireUser: async () => {
      if (!currentUser) throw new Error("NEXT_REDIRECT");
      return currentUser;
    },
    requireUserOrThrow: async () => {
      if (!currentUser) throw new UnauthorizedError();
      return currentUser;
    },
  };
});
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { prisma } from "./setup";
import { createTestCategory, createTestClient, createTestClientUser, createTestUser } from "./factories";
import { sendEmail } from "@/lib/email";
import { sendReportSchedule } from "@/lib/app-domain/report-schedules";
import { createAlertRule, evaluateAlertsForClient } from "@/lib/app-domain/alerts";
import { openHourBankCycle } from "@/lib/app-domain/hour-banks";
import { updateClient } from "@/lib/app-domain/clients";
import { reconcileImportantDates } from "@/lib/app-domain/important-dates-job";
import { localDateKey, localDateTimeToUtc } from "@/lib/timezone";

const reportsExport = await import("@/app/api/reports/export/route");
const timeEntriesExport = await import("@/app/api/time-entries/export/route");
const portalExport = await import("@/app/api/portal/export/route");

const BASE = "http://localhost";

beforeEach(() => {
  currentUser = null;
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue({ ok: true, providerMessageId: "msg" });
});
afterEach(() => {
  currentUser = null;
});

const calls = () => vi.mocked(sendEmail).mock.calls.map(([i]) => i);
const sentTo = (email: string) => calls().filter((i) => i.to.includes(email));

async function client(name: string, communicationLocale: "he" | "en") {
  const c = await createTestClient({ name });
  return prisma.client.update({ where: { id: c.id }, data: { communicationLocale } });
}

async function withLocale<T extends { id: string }>(user: T, locale: "he" | "en") {
  return prisma.user.update({ where: { id: user.id }, data: { locale } });
}

/// One category and one finished, billable entry this Israel month.
async function seedEntry(clientId: string, minutes: number) {
  const category = await createTestCategory({ clientId, name: "ייעוץ" });
  const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const startAt = localDateTimeToUtc(`${localDateKey(new Date()).slice(0, 7)}-01`, "09:00");
  await prisma.timeEntry.create({
    data: {
      userId: employee.id,
      clientId,
      categoryId: category.id,
      startAt,
      endAt: new Date(startAt.getTime() + minutes * 60_000),
      actualSeconds: minutes * 60,
      billableSeconds: minutes * 60,
    },
  });
  return { category, employee, startAt };
}

async function pdfText(res: Response) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
  const content = await (await doc.getPage(1)).getTextContent();
  return (content.items as { str: string }[]).map((i) => i.str).join(" ");
}

describe("the client's communication language", () => {
  it("is edited on the client card and recorded in the audit log", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const c = await createTestClient({ name: "Orbit" });
    expect(c.communicationLocale).toBe("he");

    await updateClient(admin, c.id, { communicationLocale: "en" });
    await updateClient(admin, c.id, { communicationLocale: "en" }); // unchanged: no second line

    const rows = await prisma.auditEvent.findMany({ where: { action: "client.communication_locale", entityId: c.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].beforeJson).toEqual({ communicationLocale: "he" });
    expect(rows[0].afterJson).toEqual({ communicationLocale: "en" });
  });
});

describe("a scheduled report email", () => {
  const period = { from: new Date("2026-09-30T21:00:00Z"), to: new Date("2026-10-31T22:00:00Z") };

  it("goes in English to an English client's outside addresses, and to an app user on the list in their own language", async () => {
    const c = await client("Orbit", "en");
    const { user: viewer } = await createTestClientUser({ clientId: c.id, email: "viewer@orbit.example" });
    await withLocale(viewer, "he");
    const schedule = await prisma.reportSchedule.create({
      data: { clientId: c.id, reportType: "HOURS_BY_CATEGORY", frequency: "MONTHLY", recipients: ["cfo@orbit.example", "viewer@orbit.example"], dayOfMonth: 1 },
    });

    const result = await sendReportSchedule(schedule, period, true);
    expect(result.sent).toBe(true);

    expect(calls()).toHaveLength(2);
    const [he] = sentTo("viewer@orbit.example");
    expect(he.to).toEqual(["viewer@orbit.example"]);
    expect(he.subject).toBe("Ankora - סיכום קטגוריות - Orbit (2026-10-01 - 2026-10-31)");
    const [en] = sentTo("cfo@orbit.example");
    expect(en.to).toEqual(["cfo@orbit.example"]);
    expect(en.subject).toBe("Ankora - Hours by category - Orbit (2026-10-01 - 2026-10-31)");
    expect(en.text.startsWith("Hours by category for Orbit\nPeriod: 2026-10-01 - 2026-10-31")).toBe(true);
    // One run, one delivery row per email, both on that run.
    const run = await prisma.reportRun.findFirstOrThrow({ where: { scheduleId: schedule.id } });
    expect(await prisma.emailDelivery.count({ where: { reportRunId: run.id } })).toBe(2);
  });

  it("is the Hebrew it always was for a Hebrew client, in one email", async () => {
    const c = await client("אורביט", "he");
    const schedule = await prisma.reportSchedule.create({
      data: { clientId: c.id, reportType: "HOURS_BY_CATEGORY", frequency: "MONTHLY", recipients: ["a@orbit.example", "b@orbit.example"], dayOfMonth: 1 },
    });

    await sendReportSchedule(schedule, period, false);

    expect(calls()).toHaveLength(1);
    expect(calls()[0].to).toEqual(["a@orbit.example", "b@orbit.example"]);
    expect(calls()[0].subject).toBe("Ankora - סיכום קטגוריות - אורביט (2026-10-01 - 2026-10-31)");
    expect(calls()[0].text).toBe("סיכום קטגוריות עבור אורביט\nתקופה: 2026-10-01 - 2026-10-31\n\n\nלצפייה מלאה: https://www.ankora.co.il/app/portal");
  });
});

describe("the client copy of an hour bank alert", () => {
  async function fire(locale: "he" | "en", clientRecipients: string[]) {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const c = await client(locale === "en" ? "Orbit" : "אורביט", locale);
    await openHourBankCycle(superAdmin, c.id, {
      cycleStart: new Date(Date.now() - 24 * 3600_000),
      cycleEnd: new Date(Date.now() + 30 * 24 * 3600_000),
      purchasedMinutes: 100,
      rolloverMode: "NONE",
    });
    const category = await createTestCategory({ clientId: c.id });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.timeEntry.create({
      data: {
        userId: employee.id,
        clientId: c.id,
        categoryId: category.id,
        startAt: new Date(),
        endAt: new Date(Date.now() + 90 * 60_000),
        actualSeconds: 90 * 60,
        billableSeconds: 90 * 60,
      },
    });
    await createAlertRule(superAdmin, c.id, { type: "UTILIZATION_PCT", thresholdValue: 80, recipientsAnkora: [], recipientsClient: clientRecipients });
    await evaluateAlertsForClient(c.id);
    return c;
  }

  it("is English for an English client; a client user on the list gets their own language", async () => {
    const c = await fire("en", ["finance@orbit.example"]);
    const { user: viewer } = await createTestClientUser({ clientId: c.id, email: "viewer2@orbit.example" });
    await withLocale(viewer, "he");

    const [en] = sentTo("finance@orbit.example");
    expect(en.subject).toBe("Hours usage update - Orbit");
    expect(en.text).toBe(
      "Hello,\n\nThis is an automatic update on the use of your hour bank with Ankora.\nCurrent usage: 90%\nMinutes remaining: 10\n\nBest regards,\nThe Ankora team"
    );

    // The list is split the same way for every client channel: an app
    // user on it is written to in their own language.
    const { groupEmailsByLocale } = await import("@/lib/i18n/recipients");
    const groups = await groupEmailsByLocale(["finance@orbit.example", "viewer2@orbit.example"], c.communicationLocale);
    expect(groups.map((g) => [g.out.locale, g.to])).toEqual([
      ["he", ["viewer2@orbit.example"]],
      ["en", ["finance@orbit.example"]],
    ]);
  });

  it("is the Hebrew it always was for a Hebrew client", async () => {
    await fire("he", ["finance@orbit-he.example"]);
    const [he] = sentTo("finance@orbit-he.example");
    expect(he.subject).toBe("עדכון ניצול שעות - אורביט");
    expect(he.text).toBe(
      "שלום,\n\nזהו עדכון אוטומטי על ניצול בנק השעות שלכם אצל Ankora.\nניצול נוכחי: 90%\nדקות שנותרו: 10\n\nבברכה,\nצוות Ankora"
    );
  });
});

describe("an important-date reminder", () => {
  it("goes to the date's extra addresses in the client's language, and to the owner in theirs", async () => {
    const { user: owner } = await createTestUser({ role: "ANKORA_EMPLOYEE", email: "owner-b@ankora.test" });
    const c = await client("Orbit", "en");
    await prisma.importantDate.create({
      data: {
        clientId: c.id,
        title: "חידוש ביטוח רכב",
        type: "חידוש ביטוח רכב",
        category: "VEHICLE_PROPERTY",
        month: 11,
        day: 1,
        recurrence: "ANNUAL",
        responsibleUserId: owner.id,
        additionalUserIds: [],
        extraEmailRecipients: ["office@orbit.example"],
        status: "ACTIVE",
        nextOccurrenceAt: new Date("2026-10-31T22:00:00Z"),
        reminderRules: { create: [{ daysBefore: 7, sendInApp: false, sendEmail: true, extraAnkoraRecipients: [], clientRecipients: [] }] },
      },
    });

    await reconcileImportantDates(new Date("2026-10-25T05:00:00Z"));

    expect(calls()).toHaveLength(2);
    const [toOwner] = sentTo(owner.email);
    expect(toOwner.to).toEqual([owner.email]);
    expect(toOwner.subject).toContain("Orbit");
    expect(/[֐-׿]/.test(toOwner.subject.replace("חידוש ביטוח רכב", ""))).toBe(true);
    const [toClient] = sentTo("office@orbit.example");
    expect(toClient.to).toEqual(["office@orbit.example"]);
    expect(/[֐-׿]/.test(toClient.subject.replace("חידוש ביטוח רכב", ""))).toBe(false);
  });
});

describe("files a staff member downloads", () => {
  it("follow the requester's language, whatever the client's", async () => {
    const c = await client("Orbit", "he");
    await seedEntry(c.id, 30);
    const { user: dana } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: hadas } = await createTestUser({ role: "SUPER_ADMIN" });
    const q = `type=hours_by_category&clientId=${c.id}`;

    currentUser = await withLocale(dana, "en");
    const enCsv = await (await reportsExport.GET(new NextRequest(`${BASE}/api/reports/export?${q}`))).text();
    expect(enCsv.split("\r\n")[0]).toContain("Category,Actual,Billable,% of total");
    expect(enCsv).toContain("ייעוץ"); // the category as it was written
    const enPdf = await reportsExport.GET(new NextRequest(`${BASE}/api/reports/export?${q}&format=pdf`));
    const enPdfText = await pdfText(enPdf);
    expect(enPdfText).toContain("Hours by category");
    expect(enPdfText).toContain("Billable");
    const enEntries = await timeEntriesExport.GET(new NextRequest(`${BASE}/api/time-entries/export?clientId=${c.id}&format=xlsx`));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await enEntries.arrayBuffer()) as unknown as ArrayBuffer);
    expect(wb.worksheets[0].name).toBe("Time entries");
    expect(wb.worksheets[0].views[0].rightToLeft).toBe(false);
    expect(wb.worksheets[0].getRow(1).values).toEqual([undefined, "Date", "Team member", "Client", "Category", "Duration", "Note", "Source", "Edited"]);
    // The file name does not change with the language.
    expect(enEntries.headers.get("content-disposition")).toContain(`time-entries_Orbit_`);

    currentUser = hadas; // Hebrew, as everyone who never chose
    const heCsv = await (await reportsExport.GET(new NextRequest(`${BASE}/api/reports/export?${q}`))).text();
    expect(heCsv.split("\r\n")[0]).toContain('קטגוריה,בפועל,לחיוב,"% מהסה""כ"');
    const heEntries = await timeEntriesExport.GET(new NextRequest(`${BASE}/api/time-entries/export?clientId=${c.id}`));
    expect((await heEntries.text()).split("\r\n")[0]).toContain("תאריך,איש צוות,לקוח,קטגוריה,משך,הערה,מקור,נערך");
  });
});

describe("the monthly report a client user downloads", () => {
  it("is in that user's language: English PDF headers for an English reader, Hebrew for a Hebrew one", async () => {
    const c = await client("Orbit", "en");
    await seedEntry(c.id, 45);
    const { user: en } = await createTestClientUser({ clientId: c.id });
    const { user: he } = await createTestClientUser({ clientId: c.id });

    currentUser = await withLocale(en, "en");
    const enText = await pdfText(await portalExport.GET(new Request(`${BASE}/api/portal/export?format=pdf`)));
    expect(enText).toContain("Monthly detailed report");
    expect(enText).toContain("Billable minutes");
    expect(enText).toContain("ייעוץ");

    currentUser = he;
    const heCsv = await (await portalExport.GET(new Request(`${BASE}/api/portal/export`))).text();
    expect(heCsv.split("\r\n")[0]).toContain("תאריך,פעילות,קטגוריה,דקות לחיוב");
  });
});
