import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addSystemAccess } from "@/lib/app-domain/system-map";
import { addClientPolicy, approveClientPolicy } from "@/lib/app-domain/client-policies";
import { approveException, requestException } from "@/lib/app-domain/policy-exceptions";
import {
  addProcess,
  approveProcessVersion,
  linkProcessDates,
  listProcesses,
  removeProcess,
  saveProcessVersion,
  setProcessStatus,
  ProcessVersionConflictError,
} from "@/lib/app-domain/processes";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { toMarkdown } from "@/lib/client-file-document";

// Org brain, phase 1 (claude/org-brain-spec-2026-10-12.md, 3.8, 3.9, 7.2).
//
// What is worth holding here: a process is numbered P1, P2 for good, its
// procedure is versioned and two people cannot overwrite each other, only
// a manager approves, a procedure that fails a blocking check is never
// approved, and completeness and gaps are what a reader sees.

const S1 = [{ code: "S1" }];

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
  await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  return { client, hadas, ariel };
}

const PAY = { title: "מייל מרוכז לאיילה", mode: "ASSISTED", offsetBusinessDays: -2, actionTags: ["PAYMENT", "CLIENT_MESSAGE"], requiresApproval: false };

describe("processes", () => {
  it("are numbered P1, P2 per client and never reuse a number", async () => {
    const { client, hadas } = await setup();
    const p1 = await addProcess(hadas, { clientId: client.id, title: "תשלומי ספקים, LTD", sources: S1 });
    const p2 = await addProcess(hadas, { clientId: client.id, title: "החזר הוצאות", sources: S1 });
    expect([p1.code, p2.code]).toEqual(["P1", "P2"]);
    await removeProcess(hadas, p2.id);
    expect((await addProcess(hadas, { clientId: client.id, title: "דורון", sources: S1 })).code).toBe("P3");
  });

  it("need a source, refuse a secret and another client's systems, and are closed to strangers", async () => {
    const { client, hadas } = await setup();
    await expect(addProcess(hadas, { clientId: client.id, title: "x" })).rejects.toThrow("צריך מקור");
    await expect(addProcess(hadas, { clientId: client.id, title: "x", exceptionPlaybook: "password: hunter2", sources: S1 })).rejects.toThrow("בכספת");
    const other = await createTestClient({ name: "Other" });
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const theirs = await addSystemAccess(admin, { clientId: other.id, systemName: "Mercury", sources: [] , knowledgeStatus: "MISSING", toResolve: "x" });
    await expect(addProcess(hadas, { clientId: client.id, title: "x", requiredSystemIds: [theirs.id], sources: S1 })).rejects.toThrow("מערכת");
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(listProcesses(stranger, client.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("show completeness and gaps: a system without access, no backup, missing fields", async () => {
    const { client, hadas } = await setup();
    const bank = await addSystemAccess(hadas, { clientId: client.id, systemName: "בנק LTD", accessStatus: "NO_ACCESS", sources: S1 });
    await addProcess(hadas, {
      clientId: client.id,
      title: "תשלומי ספקים, LTD",
      triggerKinds: ["SCHEDULED"],
      triggerText: "10 ו-25 לחודש",
      ownerId: hadas.id,
      slaBusinessDays: 2,
      requiredSystemIds: [bank.id],
      externalPartyText: "Nextage",
      sources: S1,
    });
    const [p] = await listProcesses(hadas, client.id);
    expect(p.completeness.score).toBe(5);
    expect(p.completeness.missing).toEqual(["permissions", "approvals", "exceptions", "next"]);
    expect(p.gaps).toEqual(expect.arrayContaining(["חסר: נוהל חריגים", "חסר: מועד הבא", "אין לנו גישה ל: בנק LTD", "אין מחליף: הידע אצל אדם אחד"]));
  });
});

describe("procedures", () => {
  it("are saved as versions against the one they started from; a stale save is refused", async () => {
    const { client, hadas } = await setup();
    const p = await addProcess(hadas, { clientId: client.id, title: "P", sources: S1 });
    await saveProcessVersion(hadas, p.id, { steps: [{ title: "א" }], baseVersion: 0 });
    await expect(saveProcessVersion(hadas, p.id, { steps: [{ title: "ב" }], baseVersion: 0 })).rejects.toBeInstanceOf(ProcessVersionConflictError);
    const v2 = await saveProcessVersion(hadas, p.id, { steps: [{ title: "ב" }], baseVersion: 1 });
    expect(v2.version).toBe(2);
    await expect(saveProcessVersion(hadas, p.id, { steps: [], baseVersion: 2 })).rejects.toThrow("לפחות שלב");
    await expect(saveProcessVersion(hadas, p.id, { steps: [{ title: "סיסמה: password: hunter2" }], baseVersion: 2 })).rejects.toThrow("בכספת");
  });

  it("only a manager approves, and never a procedure that fails a blocking check", async () => {
    const { client, hadas, ariel } = await setup();
    await addClientPolicy(hadas, {
      clientId: client.id,
      kind: "APPROVAL_REQUIRED",
      title: "ספק חדש",
      statement: 'ספק חדש מחייב אישור רו"ח',
      interimStatement: "כל תשלום לספק חדש עובר לאורן",
      sources: S1,
    });
    const p = await addProcess(hadas, { clientId: client.id, title: "תשלומי ספקים, LTD", sources: S1 });
    await saveProcessVersion(hadas, p.id, { steps: [PAY], baseVersion: 0 });

    await expect(approveProcessVersion(hadas, p.id, 1)).rejects.toThrow("רק מנהל");
    const [listed] = await listProcesses(hadas, client.id);
    expect(listed.draft!.checks.map((c) => c.code)).toEqual(["R1", "R2"]);
    await expect(approveProcessVersion(ariel, p.id, 1)).rejects.toThrow("לא עובר את הבדיקות");

    await saveProcessVersion(hadas, p.id, { steps: [{ ...PAY, requiresApproval: true }], baseVersion: 1 });
    await expect(approveProcessVersion(ariel, p.id, 1)).rejects.toThrow("לא הגרסה האחרונה");
    await approveProcessVersion(ariel, p.id, 2);
    const [after] = await listProcesses(hadas, client.id);
    expect(after.status).toBe("ACTIVE");
    expect(after.current!.version).toBe(2);
    expect(after.draft).toBeNull();

    // A newer approved version supersedes the old one; the old one stays.
    await saveProcessVersion(hadas, p.id, { steps: [{ ...PAY, requiresApproval: true }, { title: "לוודא שהועלה" }], baseVersion: 2 });
    await approveProcessVersion(ariel, p.id, 3);
    const versions = await prisma.processVersion.findMany({ where: { processId: p.id }, orderBy: { version: "asc" }, select: { status: true } });
    expect(versions.map((v) => v.status)).toEqual(["DRAFT", "SUPERSEDED", "APPROVED"]);
    await expect(removeProcess(hadas, p.id)).rejects.toThrow("מבטלים");
  });

  it("checks the client's rules that say what to check: a threshold blocks, a missing required step needs an exception", async () => {
    const { client, hadas, ariel: before } = await setup();
    const ariel = await prisma.user.update({ where: { id: before.id }, data: { canApproveExceptions: true } });
    const threshold = await addClientPolicy(hadas, {
      clientId: client.id,
      kind: "THRESHOLD",
      title: "תוכנה",
      statement: "תוכנה עד 3,000$ בשנה מאושרת",
      interimStatement: "כל הוצאה עוברת לאורן",
      params: { amountMinor: 300000, currency: "USD", appliesToTags: ["PURCHASE"] },
      sources: S1,
    });
    await approveClientPolicy(ariel, threshold.id);
    const required = await addClientPolicy(hadas, {
      clientId: client.id,
      kind: "REQUIRED_STEP",
      title: "ספק חדש",
      statement: "לספק חדש מציינים סיווג ומחלקה",
      params: { mustInclude: "סיווג ומחלקה", appliesToTags: ["SUPPLIER_NEW"] },
      sources: S1,
    });
    await approveClientPolicy(ariel, required.id);
    const p = await addProcess(hadas, { clientId: client.id, title: "רכישת תוכנה", sources: S1 });

    // Below the threshold: no approval needed. A new supplier without the words: an exception is.
    await saveProcessVersion(hadas, p.id, {
      steps: [{ title: "רוכשים", actionTags: ["PURCHASE", "SUPPLIER_NEW"], amountMaxMinor: 200000, currency: "USD" }],
      baseVersion: 0,
    });
    let [listed] = await listProcesses(hadas, client.id);
    expect(listed.draft!.checks.map((c) => [c.code, c.severity, c.excepted])).toEqual([["R7", "EXCEPTION", false]]);
    await expect(approveProcessVersion(ariel, p.id, 1)).rejects.toThrow("סיווג ומחלקה");

    // Above it: blocked, whatever exceptions exist.
    await saveProcessVersion(hadas, p.id, {
      steps: [{ title: "רוכשים", actionTags: ["PURCHASE", "SUPPLIER_NEW"], amountMaxMinor: 500000, currency: "USD" }],
      baseVersion: 1,
    });
    [listed] = await listProcesses(hadas, client.id);
    expect(listed.draft!.checks.map((c) => c.code).sort()).toEqual(["R2", "R7"]);

    // An approved exception to the required step lets the approval through once nothing blocks.
    const ex = await requestException(hadas, { policyId: required.id, what: "בלי סיווג החודש", reason: "המחלקות עוד לא הוגדרו", validUntil: new Date(Date.now() + 10 * 86400000) });
    await approveException(ariel, ex.id);
    await saveProcessVersion(hadas, p.id, {
      steps: [{ title: "אורן מאשר", requiresApproval: true }, { title: "רוכשים", actionTags: ["PURCHASE", "SUPPLIER_NEW"], amountMaxMinor: 500000, currency: "USD" }],
      baseVersion: 2,
    });
    [listed] = await listProcesses(hadas, client.id);
    expect(listed.draft!.checks).toEqual([expect.objectContaining({ code: "R7", excepted: true })]);
    await approveProcessVersion(ariel, p.id, 3);

    // A rule added after the approval shows on the procedure in force.
    const forbidden = await addClientPolicy(hadas, {
      clientId: client.id,
      kind: "FORBIDDEN",
      title: "בלי ספקים חדשים",
      statement: "לא פותחים ספק חדש עד סוף השנה",
      params: { appliesToTags: ["SUPPLIER_NEW"] },
      sources: S1,
    });
    [listed] = await listProcesses(hadas, client.id);
    expect(listed.current!.checks.filter((c) => !c.excepted)).toEqual([expect.objectContaining({ code: "R15", policyId: forbidden.id })]);
  });

  it("a process with an approved procedure can be paused and resumed by a manager", async () => {
    const { client, hadas, ariel } = await setup();
    const p = await addProcess(hadas, { clientId: client.id, title: "P", sources: S1 });
    await expect(setProcessStatus(ariel, p.id, "ACTIVE")).rejects.toThrow("אין נוהל מאושר");
    await saveProcessVersion(hadas, p.id, { steps: [{ title: "א" }], baseVersion: 0 });
    await approveProcessVersion(ariel, p.id, 1);
    await expect(setProcessStatus(hadas, p.id, "PAUSED")).rejects.toThrow("רק מנהל");
    expect((await setProcessStatus(ariel, p.id, "PAUSED")).status).toBe("PAUSED");
  });
});

describe("dates and the file", () => {
  it("links the client's own dates, gives the next one, and reads in section 7.4", async () => {
    const { client, hadas, ariel } = await setup();
    const p = await addProcess(hadas, {
      clientId: client.id,
      title: "תשלומי ספקים, LTD",
      triggerKinds: ["SCHEDULED"],
      triggerText: "10 ו-25 לחודש",
      ownerId: hadas.id,
      sources: S1,
    });
    const next = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const date = await prisma.importantDate.create({
      data: { clientId: client.id, title: "פעימת 10", type: "custom", category: "BUSINESS_FINANCE", month: 1, day: 10, recurrence: "MONTHLY", responsibleUserId: hadas.id, nextOccurrenceAt: next },
    });
    const other = await createTestClient({ name: "Other" });
    const theirs = await prisma.importantDate.create({
      data: { clientId: other.id, title: "x", type: "custom", category: "BUSINESS_FINANCE", month: 1, day: 1, responsibleUserId: hadas.id },
    });
    await expect(linkProcessDates(hadas, p.id, [theirs.id])).rejects.toThrow("לא נמצא");
    await linkProcessDates(hadas, p.id, [date.id]);
    const [listed] = await listProcesses(hadas, client.id);
    expect(listed.nextDate?.getTime()).toBe(next.getTime());
    expect(listed.completeness.missing).not.toContain("next");

    await saveProcessVersion(hadas, p.id, { steps: [{ title: "מעלים כל חשבונית ל-Doka", actionTags: ["INVOICE"] }], highlights: "רישום ותשלום הם שני ערוצים נפרדים", baseVersion: 0 });
    await approveProcessVersion(ariel, p.id, 1);
    const md = toMarkdown(await buildClientFile(hadas, client.id, { audience: "ai" }));
    expect(md).toContain("## 7.4. תהליכים");
    expect(md).toContain("P1 תשלומי ספקים, LTD");
    expect(md).toContain("נוהל גרסה 1: 1. מעלים כל חשבונית ל-Doka (ידני)");
    expect(md).toContain("דגשים: רישום ותשלום הם שני ערוצים נפרדים");
  });
});
