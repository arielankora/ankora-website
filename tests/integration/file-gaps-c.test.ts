import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestCategory, createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientFact } from "@/lib/app-domain/client-facts";
import { addProcess } from "@/lib/app-domain/processes";
import { createImportantDate } from "@/lib/app-domain/important-dates";
import { collectApprovals } from "@/lib/app-domain/approvals";
import { collectQuestionCards } from "@/lib/app-domain/client-questions";
import { runStep } from "@/lib/app-domain/process-next-steps";
import { confirmSourceWithClient, loweredBySource } from "@/lib/app-domain/source-confirmation";
import { closeTaskCoveredByProcess, coveredTasksForClient } from "@/lib/app-domain/process-overlap";
import { possibleDuplicates } from "@/lib/app-domain/name-duplicates";
import { approveProposal, listOpenBatches, proposalToTask, proposeKnowledge } from "@/lib/app-domain/knowledge-proposals";
import { SECONDARY_ONLY_TO_RESOLVE } from "@/lib/knowledge-sources";

// The gaps found in the production files on 21.10.2026: an approved
// process that runs by a date with none ahead, items uncertain only
// because Ankora wrote them down, a birthday twice, old tasks beside a
// process, and tasks titled as a fact or a question.

async function setup() {
  const client = await createTestClient({ name: "Grantor" });
  const { user: anna } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
  await prisma.userClientAccess.create({ data: { userId: anna.id, clientId: client.id } });
  await prisma.client.update({ where: { id: client.id }, data: { accountManagerId: anna.id } });
  await addClientSource(anna, { clientId: client.id, kind: "TRANSCRIPT", title: "נדב והדס" });
  return { client, anna, ariel };
}

const codes = (flags: unknown) => ((Array.isArray(flags) ? flags : []) as { code: string }[]).map((f) => f.code);

// 22.10.2026: these are decisions on "אישורים" now, as process rows.
const processRows = async (user: Parameters<typeof collectApprovals>[0], clientId: string) => (await collectApprovals(user)).filter((r) => r.clientId === clientId && r.kind === "process");

describe("a process that runs by a date, with no date ahead", () => {
  it("is listed to check until a date is linked", async () => {
    const { client, anna, ariel } = await setup();
    const p = await addProcess(anna, { clientId: client.id, title: "תשלומי ספקים", triggerKinds: ["SCHEDULED"], sources: [{ code: "S1" }], ownerId: anna.id });
    await prisma.process.update({ where: { id: p.id }, data: { status: "ACTIVE" } });
    const draft = await addProcess(anna, { clientId: client.id, title: "גבייה", triggerKinds: ["SCHEDULED"], sources: [{ code: "S1" }], ownerId: anna.id });

    const rows = (await processRows(ariel, client.id)).filter((r) => r.id.endsWith(":no_next_date"));
    expect(rows.map((r) => r.id)).toEqual([`${p.id}:no_next_date`]);
    expect(rows[0]).toMatchObject({ href: `/app/clients/${client.id}?tab=file#item-${p.id}`, blocking: true });
    expect(rows.map((r) => r.id)).not.toContain(`${draft.id}:no_next_date`);
    // The owner sees it too.
    expect((await processRows(anna, client.id)).some((r) => r.id.endsWith(":no_next_date"))).toBe(true);

    await createImportantDate(ariel, { clientId: client.id, title: "תשלום ספקים ה-25", type: "CLIENT", category: "BUSINESS_FINANCE", recurrence: "MONTHLY", month: 1, day: 25, responsibleUserId: anna.id });
    const date = await prisma.importantDate.findFirstOrThrow({ where: { clientId: client.id, title: "תשלום ספקים ה-25" } });
    // 22.10.2026: the date is in the file, unlinked, and its name is the
    // process's work: the row recommends linking it, and links it.
    const row = (await processRows(ariel, client.id)).find((r) => r.id === `${p.id}:no_next_date`);
    expect(row?.op).toEqual({ type: "link_date", processId: p.id, dateId: date.id });
    expect(await runStep(ariel, row!.op!)).toContain("קושר");
    expect((await prisma.importantDate.findUniqueOrThrow({ where: { id: date.id } })).processId).toBe(p.id);
    expect((await processRows(ariel, client.id)).some((r) => r.id.endsWith(":no_next_date"))).toBe(false);
  });
});

describe("items uncertain only because Ankora wrote them", () => {
  it("a manager confirms them with the client in one step, and the source stops lowering", async () => {
    const { client, anna, ariel } = await setup();
    await addClientSource(anna, { clientId: client.id, kind: "ANKORA_DOCUMENT", title: "תיק לקוח נדב (Word)" });
    const lowered = await addClientFact(anna, { clientId: client.id, kind: "PREFERENCE", body: "אוכל כשר בלבד", knowledgeStatus: "CONFIRMED", sources: [{ code: "S2" }] });
    expect(lowered).toMatchObject({ knowledgeStatus: "UNCERTAIN", toResolve: SECONDARY_ONLY_TO_RESOLVE });
    const other = await addClientFact(anna, { clientId: client.id, kind: "NOTE", body: "חמישה ילדים", knowledgeStatus: "UNCERTAIN", toResolve: "לשאול את נדב", sources: [{ code: "S2" }] });
    const fromMeeting = await addClientFact(anna, { clientId: client.id, kind: "NOTE", body: "וואטסאפ", knowledgeStatus: "CONFIRMED", sources: [{ code: "S1" }] });

    expect(await loweredBySource([client.id])).toEqual([{ clientId: client.id, code: "S2", title: "תיק לקוח נדב (Word)", count: 1 }]);
    // On the client's card of questions, for a manager.
    const cards = (await collectQuestionCards(ariel, { scope: "all" })).filter((c) => c.clientId === client.id);
    expect(cards.flatMap((c) => c.lowered)).toEqual([{ clientId: client.id, code: "S2", title: "תיק לקוח נדב (Word)", count: 1 }]);
    // Not a manager: neither the button nor the action.
    expect((await collectQuestionCards(anna)).filter((c) => c.clientId === client.id).flatMap((c) => c.lowered)).toEqual([]);
    await expect(confirmSourceWithClient(anna, client.id, "S2", "נדב אישר")).rejects.toThrow("רק מנהל");
    await expect(confirmSourceWithClient(ariel, client.id, "S2", "  ")).rejects.toThrow("בשורה אחת");

    expect(await confirmSourceWithClient(ariel, client.id, "S2", "נדב עבר על הרשימה בוואטסאפ")).toEqual({ confirmed: 1 });
    expect(await prisma.clientFact.findUniqueOrThrow({ where: { id: lowered.id } })).toMatchObject({ knowledgeStatus: "CONFIRMED", toResolve: null });
    expect(await prisma.clientFact.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ knowledgeStatus: "UNCERTAIN", toResolve: "לשאול את נדב" });
    expect((await prisma.clientFact.findUniqueOrThrow({ where: { id: fromMeeting.id } })).knowledgeStatus).toBe("CONFIRMED");
    expect((await prisma.clientSource.findFirstOrThrow({ where: { clientId: client.id, code: "S2" } })).weight).toBe("PRIMARY");
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "client_source.confirm_with_client", clientId: client.id } });
    expect(audit.afterJson).toMatchObject({ note: "נדב עבר על הרשימה בוואטסאפ", confirmed: 1 });

    // What comes from it now is not lowered.
    const next = await addClientFact(anna, { clientId: client.id, kind: "PREFERENCE", body: "מלון ליד בית חב\"ד", knowledgeStatus: "CONFIRMED", sources: [{ code: "S2" }] });
    expect(next.knowledgeStatus).toBe("CONFIRMED");
    expect(await loweredBySource([client.id])).toEqual([]);
  });

  it("Claude can register a summary of a conversation with the client as such", async () => {
    const { client, anna } = await setup();
    const r = await proposeKnowledge(anna, {
      clientId: client.id,
      source: { kind: "ANKORA_DOCUMENT", title: "סיכום פגישת היכרות", weight: "PRIMARY" },
      items: [{ target: "FACT", reason: "נדב אמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "PREFERENCE", body: "המלצה אחת ולא כמה" } }],
    });
    const source = await prisma.clientSource.findFirstOrThrow({ where: { clientId: client.id, code: r.sourceCode! } });
    expect(source).toMatchObject({ kind: "ANKORA_DOCUMENT", weight: "PRIMARY" });
    const [batch] = (await listOpenBatches(anna)).filter((b) => b.id === r.batchId);
    expect(codes(batch.proposals[0].flags)).not.toContain("R14");
  });
});

describe("the same date twice", () => {
  it("two rows for one birthday are listed, and a third is flagged before it is approved", async () => {
    const { client, anna, ariel } = await setup();
    const base = { clientId: client.id, type: "CLIENT", category: "PEOPLE_FAMILY" as const, recurrence: "ANNUAL" as const, month: 10, day: 26, responsibleUserId: anna.id };
    const a = await createImportantDate(ariel, { ...base, title: "יום הולדת של אורן מירון (ברכה בקבוצה ו-BuyMe 100 ₪)" });
    const b = await createImportantDate(ariel, { ...base, title: "יום הולדת של אורן מירון (לידה 26.10.1991)" });
    await createImportantDate(ariel, { ...base, title: "יום הולדת של יובל", day: 6 });

    const pairs = (await possibleDuplicates(anna, client.id)).filter((p) => p.kind === "DATE");
    expect(pairs.map((p) => [p.a.id, p.b.id])).toEqual([[a.id, b.id]]);

    const r = await proposeKnowledge(anna, {
      clientId: client.id,
      source: { code: "S1" },
      items: [
        { target: "DATE", reason: "הדס מסרה", payload: { title: "יום הולדת של אורן", recurrence: "ANNUAL", date: "1991-10-26", category: "PEOPLE_FAMILY" } },
        { target: "DATE", reason: "הדס מסרה", payload: { title: "יום הולדת של אורן", recurrence: "ANNUAL", date: "1991-03-02", category: "PEOPLE_FAMILY" } },
      ],
    });
    expect(r.possibleMatches.map((m) => [m.index, m.target, m.existing.map((e) => e.id).sort()])).toEqual([[0, "DATE", [a.id, b.id].sort()]]);
    const [batch] = (await listOpenBatches(anna)).filter((x) => x.id === r.batchId);
    const flagged = batch.proposals.find((p: { payload: unknown }) => (p.payload as { date?: string }).date === "1991-10-26")!;
    expect(codes(flagged.flags).filter((c) => c === "SIMILAR")).toHaveLength(2);
  });
});

describe("open tasks an approved process covers", () => {
  it("are offered to a manager, who closes them with a comment", async () => {
    const { client, anna, ariel } = await setup();
    const p = await addProcess(anna, { clientId: client.id, title: "מעקב חופשות, מחלות ושינויים בהעסקה ודיווח חודשי לשכר", triggerKinds: ["SCHEDULED"], sources: [{ code: "S1" }], ownerId: anna.id });
    await prisma.process.update({ where: { id: p.id }, data: { status: "ACTIVE" } });
    const old = await prisma.task.create({ data: { clientId: client.id, title: "מעקב חופשות, Leave ושינויים בהעסקה", status: "IN_PROGRESS", assignedToId: anna.id } });
    await prisma.task.create({ data: { clientId: client.id, title: "הזמנת טכנאי לבר מים", status: "OPEN" } });
    await prisma.task.create({ data: { clientId: client.id, title: "מעקב חופשות ושינויים בהעסקה", status: "OPEN", processId: p.id } });

    const covered = await coveredTasksForClient(anna, client.id);
    expect(covered.map((c) => [c.process.id, c.task.id])).toEqual([[p.id, old.id]]);
    const row = (await processRows(ariel, client.id)).find((r) => r.id === `${p.id}:covered_tasks`);
    expect(row?.op).toEqual({ type: "close_covered", processId: p.id, taskIds: [old.id] });

    await expect(closeTaskCoveredByProcess(anna, old.id, p.id)).rejects.toThrow("רק מנהל");
    await closeTaskCoveredByProcess(ariel, old.id, p.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("ARCHIVED");
    const comment = await prisma.taskComment.findFirstOrThrow({ where: { taskId: old.id } });
    expect(comment.body).toContain(`${p.code} ${p.title}`);
    expect(await prisma.auditEvent.count({ where: { action: "task.close_covered_by_process", entityId: old.id } })).toBe(1);
    expect(await coveredTasksForClient(anna, client.id)).toEqual([]);
    await expect(closeTaskCoveredByProcess(ariel, old.id, p.id)).rejects.toThrow("כבר לא פתוחה");
  });
});

describe("a task from a proposal says what to do, by when, under what", () => {
  it("a question opens as one to find out, with a date and a category", async () => {
    const { client, anna } = await setup();
    const category = await createTestCategory({ name: "תיוק וארגון מסמכים" });
    const r = await proposeKnowledge(anna, {
      clientId: client.id,
      source: { code: "S1" },
      items: [{ target: "TASK", reason: "נאמר בפגישה", payload: { title: "הדס ואריאל צריכים לחתום על מסמכים ב-Settle. בוצע?" } }],
    });
    const [batch] = (await listOpenBatches(anna)).filter((x) => x.id === r.batchId);
    const prop = batch.proposals[0];
    expect(codes(prop.flags)).toContain("TASK_TITLE");
    const id = (await approveProposal(anna, prop.id)).resultId!;
    const task = await prisma.task.findUniqueOrThrow({ where: { id } });
    expect(task.title).toBe("לברר: הדס ואריאל צריכים לחתום על מסמכים ב-Settle. בוצע");
    expect(task.dueDate).not.toBeNull();
    expect(task.categoryId).toBe(category.id);
  });

  it("a fact turned into a task needs a title of its own", async () => {
    const { client, anna } = await setup();
    const fact = "בנק לאומי, חשבון הבנק של החברה הישראלית: שכר ותשלומי ספקים";
    const r = await proposeKnowledge(anna, {
      clientId: client.id,
      source: { code: "S1" },
      items: [{ target: "FACT", reason: "גיא אמר", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: fact } }],
    });
    const [batch] = (await listOpenBatches(anna)).filter((x) => x.id === r.batchId);
    const prop = batch.proposals[0];
    await expect(proposalToTask(anna, prop.id, {})).rejects.toThrow("מה עושים");
    await expect(proposalToTask(anna, prop.id, { title: fact })).rejects.toThrow("לא לחזור");
    const { taskId } = await proposalToTask(anna, prop.id, { title: "לבקש מגיא את הרשאות הבנק לשכר" });
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.title).toBe("לבקש מגיא את הרשאות הבנק לשכר");
    expect(task.description).toContain(`מה שנאמר: ${fact}`);
    expect(task.dueDate).not.toBeNull();
  });
});
