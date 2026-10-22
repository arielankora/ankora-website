import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientPolicy } from "@/lib/app-domain/client-policies";
import { requestException } from "@/lib/app-domain/policy-exceptions";
import { collectApprovals, countApprovals, countApprovalsForClient } from "@/lib/app-domain/approvals";
import { collectQuestionCards, createQuestionsTask, markQuestionsAsked } from "@/lib/app-domain/client-questions";
import { approveRulesTogether, runStep } from "@/lib/app-domain/process-next-steps";
import { addClientFact } from "@/lib/app-domain/client-facts";
import { sentForApprovalAt } from "@/lib/app-domain/task-approval-times";
import { updateTask } from "@/lib/app-domain/tasks";
import type { User } from "@prisma/client";

// "אישורים" (20.10.2026): each row goes to who may decide it, the same
// person the screen it came from would let decide, and nobody else.

const DAY = 24 * 60 * 60 * 1000;

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: anna } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
  for (const u of [hadas, anna]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: client.id } });
  // Hadas approves exceptions on this client, nobody else.
  await prisma.client.update({ where: { id: client.id }, data: { ruleApproverIds: [hadas.id] } });
  await addClientSource(anna, { clientId: client.id, kind: "TRANSCRIPT", title: "חפיפה" });

  const confirmed = await addClientPolicy(anna, { clientId: client.id, kind: "SEPARATION", title: "Inc ו-LTD", statement: "לא מערבבים", sources: [{ code: "S1" }] });
  const unsure = await addClientPolicy(anna, { clientId: client.id, kind: "SEPARATION", title: "מתנות", statement: "עד 200 ש\"ח", sources: [{ code: "S1" }] });
  await prisma.clientPolicy.update({ where: { id: unsure.id }, data: { knowledgeStatus: "UNCERTAIN", toResolve: "לשאול את אורן" } });
  await prisma.clientPolicy.update({ where: { id: confirmed.id }, data: { status: "ACTIVE" } });
  const proposed = await addClientPolicy(anna, { clientId: client.id, kind: "SEPARATION", title: "ספק חדש", statement: "רק אחרי רואה חשבון", sources: [{ code: "S1" }] });

  await requestException(anna, { policyId: confirmed.id, what: "לשלוח חשבונית אחת", reason: "דחוף", validUntil: new Date(Date.now() + 3 * DAY) });

  const task = await prisma.task.create({
    data: { clientId: client.id, title: "לסגור את הבנק", status: "PENDING_APPROVAL", requiresApproval: true, supervisorId: hadas.id, assignedToId: anna.id },
  });

  const process = await prisma.process.create({ data: { clientId: client.id, seq: 1, code: "P1", title: "תשלומי ספקים" } });
  await prisma.processVersion.create({ data: { processId: process.id, version: 1, status: "DRAFT", steps: [], changeNote: "גרסה ראשונה" } });

  await prisma.portalSummary.create({ data: { clientId: client.id, periodStart: new Date("2026-10-01T00:00:00Z"), periodEnd: new Date("2026-10-31T00:00:00Z"), draft: "החודש סגרנו את הבנק." } });

  return { client, hadas, anna, ariel, unsure, proposed, task, process };
}

const mine = async (user: User, clientId: string) => (await collectApprovals(user)).filter((i) => i.clientId === clientId);

describe("approvals", () => {
  it("gives each kind to who may decide it", async () => {
    const { client, hadas, anna, ariel, unsure, proposed, task, process } = await setup();

    // The supervisor signs the task; the client's approver decides the exception.
    const forHadas = await mine(hadas, client.id);
    expect(forHadas.map((i) => i.kind).sort()).toEqual(["exception", "task"]);
    expect(forHadas.find((i) => i.kind === "task")).toMatchObject({ id: task.id, by: anna.name, href: `/app/tasks/${task.id}` });

    // The person who did the work and asked waits; nothing is hers to approve.
    expect(await mine(anna, client.id)).toEqual([]);

    // A manager: rules, the procedure and the summary. Not the task (not
    // the supervisor) and not the exception (the client named Hadas).
    const forAriel = (await mine(ariel, client.id)).filter((i) => i.kind !== "process");
    expect(forAriel.map((i) => i.kind).sort()).toEqual(["procedure", "rule", "rule", "summary"]);
    // Every row says what to do.
    expect(forAriel.every((i) => !!i.recommend?.text)).toBe(true);
    const rules = forAriel.filter((i) => i.kind === "rule");
    expect(rules.find((r) => r.id === proposed.id)?.actions.approve).toBe("אישור הכלל");
    // Not confirmed: no approve button, and what would confirm it.
    const blocked = rules.find((r) => r.id === unsure.id);
    expect(blocked?.actions.approve).toBeNull();
    expect(blocked?.blocked).toContain("לשאול את אורן");
    expect(forAriel.find((i) => i.kind === "procedure")).toMatchObject({ id: process.id, version: 1, href: `/app/clients/${client.id}?tab=file#item-${process.id}` });

    // And P1's missing backup, as a decision of its own.
    expect((await mine(ariel, client.id)).filter((i) => i.kind === "process").map((i) => i.id)).toEqual([`${process.id}:backup`]);
    expect(await countApprovalsForClient(ariel, client.id)).toBe(5);
    expect(await countApprovals(hadas)).toBeGreaterThanOrEqual(2);
  });

  it("drops a procedure once it is approved, and an exception once it is decided", async () => {
    const { client, ariel, hadas, process } = await setup();
    await prisma.processVersion.updateMany({ where: { processId: process.id }, data: { status: "APPROVED" } });
    await prisma.policyException.updateMany({ where: { clientId: client.id }, data: { status: "APPROVED" } });
    expect((await mine(ariel, client.id)).some((i) => i.kind === "procedure")).toBe(false);
    expect((await mine(hadas, client.id)).some((i) => i.kind === "exception")).toBe(false);
  });

  it("puts what is not yet confirmed on its owner's card, as questions to the client", async () => {
    const { client, ariel, anna, hadas, unsure } = await setup();
    // No owner and no account manager: on nobody's own card, only in everyone's.
    expect((await collectQuestionCards(ariel)).filter((c) => c.clientId === client.id)).toEqual([]);
    const all = (await collectQuestionCards(ariel, { scope: "all" })).filter((c) => c.clientId === client.id);
    expect(all.flatMap((c) => c.items.map((i) => i.id))).toContain(unsure.id);
    // Not a manager: never everyone's.
    expect((await collectQuestionCards(hadas, { scope: "all" })).filter((c) => c.clientId === client.id)).toEqual([]);

    await prisma.clientPolicy.update({ where: { id: unsure.id }, data: { ownerId: hadas.id } });
    const [card] = (await collectQuestionCards(hadas)).filter((c) => c.clientId === client.id);
    expect(card).toMatchObject({ ownerId: hadas.id, clientName: "NUX" });
    expect(card.items.find((i) => i.id === unsure.id)).toMatchObject({ what: "כלל", toResolve: "לשאול את אורן", href: `/app/clients/${client.id}?tab=file#item-${unsure.id}`, askedAt: null });
    expect((await collectQuestionCards(anna)).filter((c) => c.clientId === client.id)).toEqual([]);

    // An open question goes on the card of whoever chases it.
    const q = await addClientFact(anna, { clientId: client.id, kind: "QUESTION", body: "מי מורשה החתימה בבנק", assigneeId: hadas.id, sources: [{ code: "S1" }] });
    const again = (await collectQuestionCards(hadas)).find((c) => c.clientId === client.id)!;
    expect(again.items.map((i) => i.id)).toEqual(expect.arrayContaining([unsure.id, q.id]));
    expect(again.items.find((i) => i.id === q.id)?.isQuestion).toBe(true);
  });

  it("marks questions asked, by a copy or by a task to send them, and refuses items of another client", async () => {
    const { client, hadas, unsure } = await setup();
    await prisma.clientPolicy.update({ where: { id: unsure.id }, data: { ownerId: hadas.id } });
    const other = await createTestClient({ name: "RIMED" });
    await expect(markQuestionsAsked(hadas, other.id, [unsure.id])).rejects.toThrow();

    expect(await markQuestionsAsked(hadas, client.id, [unsure.id])).toBe(1);
    const card = (await collectQuestionCards(hadas)).find((c) => c.clientId === client.id)!;
    expect(card.items.find((i) => i.id === unsure.id)?.askedAt).toBeInstanceOf(Date);

    const { taskId } = await createQuestionsTask(hadas, client.id, [unsure.id], "היי אורן,\n1. מתנות?", "Oren Rubin");
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task).toMatchObject({ clientId: client.id, assignedToId: hadas.id, title: "לשלוח ל-Oren שאלה אחת לתיק" });
    expect(task.description).toContain("1. מתנות?");
    const events = await prisma.auditEvent.findMany({ where: { action: "client_file.questions_asked", clientId: client.id } });
    expect(events).toHaveLength(2);
    expect(events.some((e) => (e.afterJson as { taskId?: string }).taskId === taskId)).toBe(true);
  });

  it("recommends a backup who already works on the client, and sets it in one click", async () => {
    const { client, hadas, anna, ariel, process } = await setup();
    await prisma.process.update({ where: { id: process.id }, data: { ownerId: anna.id } });
    await prisma.client.update({ where: { id: client.id }, data: { accountManagerId: hadas.id } });
    const row = (await mine(ariel, client.id)).find((i) => i.id === `${process.id}:backup`);
    expect(row?.recommend?.text).toBe(`לקבוע את ${hadas.name}`);
    expect(row?.op).toEqual({ type: "set_backup", processId: process.id, userId: hadas.id });
    // The owner sees the decision too, and may carry it out.
    expect((await mine(anna, client.id)).some((i) => i.id === `${process.id}:backup`)).toBe(true);
    expect(await runStep(anna, row!.op!)).toContain("נקבע כמחליף");
    expect((await prisma.process.findUniqueOrThrow({ where: { id: process.id } })).backupOwnerId).toBe(hadas.id);
    expect((await mine(ariel, client.id)).some((i) => i.id === `${process.id}:backup`)).toBe(false);
  });

  it("approves the confirmed rules of a client together, each one checked on its own", async () => {
    const { client, anna, ariel, unsure, proposed } = await setup();
    const second = await addClientPolicy(anna, { clientId: client.id, kind: "SEPARATION", title: "חשבונית", statement: "על שם החברה הנכונה", sources: [{ code: "S1" }] });
    await expect(approveRulesTogether(anna, client.id, [proposed.id, second.id])).rejects.toThrow("רק מנהל");
    const r = await approveRulesTogether(ariel, client.id, [proposed.id, second.id, unsure.id]);
    expect(r.approved).toBe(2);
    // The unconfirmed one is refused on its own, and stops nothing else.
    expect(r.failed).toHaveLength(1);
    expect((await prisma.clientPolicy.findUniqueOrThrow({ where: { id: proposed.id } })).status).toBe("ACTIVE");
    expect((await prisma.clientPolicy.findUniqueOrThrow({ where: { id: unsure.id } })).status).toBe("PROPOSED");
    expect(await prisma.auditEvent.count({ where: { action: "client_policy.approve_together", clientId: client.id } })).toBe(1);
  });

  it("dates a signature from the moment the task was handed over, not from its last edit", async () => {
    const { client, anna, hadas } = await setup();
    const task = await prisma.task.create({ data: { clientId: client.id, title: "דוח שנתי", status: "IN_PROGRESS", requiresApproval: true, supervisorId: hadas.id, assignedToId: anna.id } });
    expect((await sentForApprovalAt([task.id])).has(task.id)).toBe(false);
    await updateTask(anna, task.id, { status: "PENDING_APPROVAL" });
    const handed = (await sentForApprovalAt([task.id])).get(task.id);
    expect(handed).toBeInstanceOf(Date);
    await updateTask(anna, task.id, { title: "דוח שנתי 2026" });
    expect((await sentForApprovalAt([task.id])).get(task.id)?.getTime()).toBe(handed!.getTime());
    expect((await mine(hadas, client.id)).find((i) => i.id === task.id)?.since.getTime()).toBe(handed!.getTime());
  });

  it("shows a stranger nothing", async () => {
    const { client } = await setup();
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    expect(await mine(stranger, client.id)).toEqual([]);
    expect((await collectQuestionCards(stranger)).filter((c) => c.clientId === client.id)).toEqual([]);
  });

  // 22.10.2026: a procedure is read on its row, and the row says what
  // holds it back instead of a button that would fail.
  it("shows a procedure's steps, and holds back one that does not pass its checks", async () => {
    const { client, ariel } = await setup();
    const step = (over: Record<string, unknown>) => ({ title: "שלב", mode: "MANUAL", offsetBusinessDays: null, actionTags: [], systemIds: [], output: null, verification: null, requiresApproval: false, amountMaxMinor: null, currency: null, channel: null, ...over });
    const ok = await prisma.process.create({ data: { clientId: client.id, seq: 2, code: "P2", title: "קליטת עובד" } });
    await prisma.processVersion.create({ data: { processId: ok.id, version: 1, status: "DRAFT", steps: [step({ title: "אוספים טופס 101" })], highlights: "בלי רטרו" } });
    const held = await prisma.process.create({ data: { clientId: client.id, seq: 3, code: "P3", title: "העברה לספק" } });
    await prisma.processVersion.create({ data: { processId: held.id, version: 1, status: "DRAFT", steps: [step({ title: "מעבירים תשלום", mode: "AUTOMATED", actionTags: ["PAYMENT"] })] } });

    const rows = await mine(ariel, client.id);
    const good = rows.find((r) => r.id === ok.id);
    expect(good?.actions.approve).toBe("אישור הנוהל");
    expect(good?.preview?.sections[0].lines[0]).toContain("אוספים טופס 101");
    expect(good?.preview?.sections.map((x) => x.heading)).toContain("דגשים");
    expect(good?.preview?.problems).toEqual([]);

    const bad = rows.find((r) => r.id === held.id);
    expect(bad?.actions.approve).toBeNull();
    expect(bad?.blocked).toContain("לא עובר את הבדיקות");
    expect(bad?.preview?.problems.length).toBeGreaterThan(0);
  });
});
