import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientPolicy, approveClientPolicy, retireClientPolicy, updateClientPolicy } from "@/lib/app-domain/client-policies";
import { approveException, requestException } from "@/lib/app-domain/policy-exceptions";
import { addProcess, approveProcessVersion, listProcesses, saveProcessVersion } from "@/lib/app-domain/processes";
import { startProcessRun } from "@/lib/app-domain/process-runs";
import { NEEDS_REVIEW, rescanAllProcesses } from "@/lib/app-domain/process-review";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { toMarkdown } from "@/lib/client-file-document";

// Org brain (claude/org-brain-spec-2026-10-12.md, 7.2, 7.3).
//
// What is worth holding here: a rule the server can check holds back a
// procedure that breaks it, unless an exception to the rule is in force;
// a rule that changes after a procedure was approved marks it for review,
// tells its owner and writes in its open runs; a fix or a retired rule
// clears it; and an exception that runs out is caught by the nightly pass.

const S1 = [{ code: "S1" }];
const DAY = 24 * 60 * 60 * 1000;
const dayFromNow = (n: number) => new Date(`${new Date(Date.now() + n * DAY).toISOString().slice(0, 10)}T00:00:00Z`);

const MAIL = { title: "מייל מרוכז לאיילה", mode: "ASSISTED", actionTags: ["CLIENT_MESSAGE"], requiresApproval: true };

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
  const ariel = await prisma.user.update({ where: { id: admin.id }, data: { canApproveExceptions: true } });
  await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  const process = await addProcess(hadas, { clientId: client.id, title: "דיווח חודשי", triggerKinds: ["ON_DEMAND"], ownerId: hadas.id, sources: S1 });
  await saveProcessVersion(hadas, process.id, { steps: [MAIL], baseVersion: 0 });
  await approveProcessVersion(ariel, process.id, 1);
  return { client, hadas, ariel, process };
}

describe("a rule the server checks", () => {
  it("is refused half written, and changing what it checks sends an approved rule back", async () => {
    const { client, hadas, ariel } = await setup();
    await expect(
      addClientPolicy(hadas, { clientId: client.id, kind: "REQUIRED_STEP", title: "Doka", statement: "כל חשבונית ב-Doka", check: { requiredTags: ["INVOICE"] }, sources: S1 })
    ).rejects.toThrow("על איזו פעולה");
    const rule = await addClientPolicy(hadas, { clientId: client.id, kind: "COMMUNICATION", title: "ערוצים", statement: "החלטות רק במייל", check: { channels: ["EMAIL"], checkTags: ["PAYMENT"] }, sources: S1 });
    // A kind keeps only the fields it takes.
    expect(rule.checkTags).toEqual([]);
    await approveClientPolicy(ariel, rule.id);
    const after = await updateClientPolicy(hadas, rule.id, { check: { channels: ["EMAIL", "WHATSAPP"] } });
    expect(after.status).toBe("PROPOSED");
    expect(after.version).toBe(2);
  });
});

describe("when a rule changes", () => {
  it("an approved procedure that breaks it needs review: the owner hears, the open run gets a note", async () => {
    const { client, hadas, process } = await setup();
    const run = await startProcessRun(hadas, process.id, new Date());
    await addClientPolicy(hadas, { clientId: client.id, kind: "COMMUNICATION", title: "ערוצים", statement: "מול איילה רק במייל", check: { channels: ["EMAIL"] }, sources: S1 });

    const [p] = await listProcesses(hadas, client.id);
    expect(p.needsReview).toBe(true);
    expect(p.reviewFindings.map((f) => f.code)).toEqual(["R10"]);
    expect(await prisma.notification.count({ where: { userId: hadas.id, type: NEEDS_REVIEW } })).toBe(1);
    const notes = await prisma.taskComment.findMany({ where: { taskId: run.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain("הנוהל דורש סקירה");
    expect(toMarkdown(await buildClientFile(hadas, client.id, { audience: "ai" }))).toContain("דורש סקירה:");

    // A new run says it up front.
    const next = await startProcessRun(hadas, process.id, new Date());
    expect(next.description).toContain("הנוהל דורש סקירה");
  });

  it("a fixed version clears it; so does retiring the rule", async () => {
    const { client, hadas, ariel, process } = await setup();
    const rule = await addClientPolicy(hadas, { clientId: client.id, kind: "COMMUNICATION", title: "ערוצים", statement: "רק במייל", check: { channels: ["EMAIL"] }, sources: S1 });
    await saveProcessVersion(hadas, process.id, { steps: [{ ...MAIL, channel: "WHATSAPP" }], baseVersion: 1 });
    await expect(approveProcessVersion(ariel, process.id, 2)).rejects.toThrow("מתיר רק מייל");
    await saveProcessVersion(hadas, process.id, { steps: [{ ...MAIL, channel: "EMAIL" }], baseVersion: 2 });
    await approveProcessVersion(ariel, process.id, 3);
    expect((await prisma.process.findUniqueOrThrow({ where: { id: process.id } })).needsReview).toBe(false);

    await updateClientPolicy(hadas, rule.id, { check: { channels: ["PORTAL"] } });
    expect((await prisma.process.findUniqueOrThrow({ where: { id: process.id } })).needsReview).toBe(true);
    await retireClientPolicy(ariel, rule.id, "הלקוח ביטל");
    const p = await prisma.process.findUniqueOrThrow({ where: { id: process.id } });
    expect(p.needsReview).toBe(false);
    expect(p.reviewFindings).toEqual([]);
  });
});

describe("an exception to the rule", () => {
  it("lets a procedure through while it holds, and the nightly pass catches it when it ends", async () => {
    const { client, hadas, ariel, process } = await setup();
    const rule = await addClientPolicy(hadas, { clientId: client.id, kind: "FORBIDDEN", title: "בלי תשלומים", statement: "אנקורה לא משלמת", check: { checkTags: ["PAYMENT"] }, sources: S1 });
    await saveProcessVersion(hadas, process.id, { steps: [MAIL, { title: "תשלום לספק", actionTags: ["PAYMENT"], requiresApproval: true }], baseVersion: 1 });
    await expect(approveProcessVersion(ariel, process.id, 2)).rejects.toThrow("אסור לפי הכלל");

    const req = await requestException(hadas, { policyId: rule.id, what: "תשלום אחד לספק השכר", reason: "שני בחופשה", validUntil: dayFromNow(3) });
    await approveException(ariel, req.id);
    const [draft] = await listProcesses(hadas, client.id);
    expect(draft.draft!.checks).toEqual([]);
    expect(draft.draft!.excepted.map((f) => f.code)).toEqual(["R15"]);
    await approveProcessVersion(ariel, process.id, 2);
    expect((await prisma.process.findUniqueOrThrow({ where: { id: process.id } })).needsReview).toBe(false);

    // Five days on, the exception is over.
    await rescanAllProcesses(new Date(Date.now() + 5 * DAY));
    const p = await prisma.process.findUniqueOrThrow({ where: { id: process.id } });
    expect(p.needsReview).toBe(true);
    expect(JSON.stringify(p.reviewFindings)).toContain("R15");
  });
});

describe("separation between entities", () => {
  it("a procedure with invoices says whose", async () => {
    const { client, hadas, ariel, process } = await setup();
    await addClientPolicy(hadas, { clientId: client.id, kind: "SEPARATION", title: "Inc ו-LTD", statement: "לא מערבבים", sources: S1 });
    await saveProcessVersion(hadas, process.id, { steps: [{ title: "מעלים חשבונית", actionTags: ["INVOICE"] }], baseVersion: 1 });
    await expect(approveProcessVersion(ariel, process.id, 2)).rejects.toThrow("לא נקבעה ישות");
  });
});
