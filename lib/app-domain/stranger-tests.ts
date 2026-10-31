import "server-only";
import type { FactTopic, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { assertClientAccess, addClientSource } from "@/lib/app-domain/client-sources";
import { addClientFact } from "@/lib/app-domain/client-facts";
import { approveClientPolicy, updateClientPolicy } from "@/lib/app-domain/client-policies";
import { readSteps } from "@/lib/process-rules";
import { readSourceRefs } from "@/lib/knowledge-sources";
import { approvesProceduresOf } from "@/lib/procedure-approval";
import { answerFactBody, ANSWER_FACT_KINDS, MAX_STRANGER_TEXT, readStrangerQuestions, type AnswerFactKind, type StrangerQuestionInput, type StrangerState } from "@/lib/stranger-test";

// The stranger test (31.10.2026, lib/stranger-test.ts says what it is).
//
// Two promises, both Ariel's:
// 1. An answer goes into the client's file as it was given: a confirmed
//    fact, sourced to the person who answered, with no proposal and no
//    approval round.
// 2. An answer that changes one of the client's rules changes it only on
//    an explicit yes, from someone who approves the client's rules (a
//    manager, or the client's account manager). The yes is the approval:
//    the rule is updated and approved in one step, and its old version
//    stays in its history.

export const RULE_CHANGE_NEEDS_YES =
  'התשובה משנה כלל של הלקוח. לפני שמעדכנים, שואלים את המשתמש במפורש: "זה משנה את הכלל <שם> מ-<עכשיו> ל-<חדש>. אתה מאשר את השינוי?", ומעבירים userConfirmed רק אחרי כן.';

/// Records a test of a process: Claude's questions, against the version
/// it walked. The questions of the last test that were not answered are
/// replaced by these.
export async function recordStrangerTest(actor: User, processId: string, input: { summary?: string | null; questions: StrangerQuestionInput[] }) {
  assertCan(actor.role, "time_entry.create_self");
  const process = await prisma.process.findUnique({
    where: { id: processId },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!process || process.deletedAt) throw new Error("התהליך לא נמצא.");
  await assertClientAccess(actor, process.clientId);
  const latest = process.versions[0] ?? null;
  const read = readStrangerQuestions(input.questions, latest ? readSteps(latest.steps).length : 0);
  if (!read.ok) throw new Error(read.error);
  const summary = input.summary?.trim().slice(0, MAX_STRANGER_TEXT * 2) || null;

  const test = await prisma.$transaction(async (tx) => {
    await tx.processStrangerQuestion.updateMany({ where: { processId, status: "OPEN" }, data: { status: "REPLACED" } });
    return tx.processStrangerTest.create({
      data: {
        processId,
        clientId: process.clientId,
        version: latest?.version ?? null,
        summary,
        ranById: actor.id,
        questions: { create: read.questions.map((q) => ({ ...q, processId, clientId: process.clientId })) },
      },
      include: { questions: { orderBy: { createdAt: "asc" } } },
    });
  });
  await recordAudit({
    actorId: actor.id,
    action: "process.stranger_test",
    entityType: "Process",
    entityId: processId,
    clientId: process.clientId,
    after: { testId: test.id, version: test.version, questions: test.questions.length, blockers: test.questions.filter((q) => q.severity === "BLOCKER").length },
  });
  return test;
}

export type StrangerAnswerInput = {
  answer?: string | null;
  /// What the answer is, in the file. Default NOTE.
  kind?: AnswerFactKind | null;
  topic?: FactTopic | null;
  /// Who said it, when it is not the person answering ("נדב").
  toldBy?: string | null;
  /// The question does not apply. Nothing goes into the file.
  notRelevant?: boolean;
  /// The answer changes a rule of the client.
  ruleChange?: { policyId: string; statement: string; interimStatement?: string | null; userConfirmed: boolean } | null;
};

/// The source answers of one test are recorded under: one per test, made
/// with its first answer, naming who answered.
async function sourceFor(actor: User, test: { id: string; clientId: string; sourceCode: string | null; processId: string }, code: string, toldBy: string | null) {
  const names = [actor.name, toldBy].filter((n): n is string => !!n?.trim());
  if (test.sourceCode) {
    const source = await prisma.clientSource.findFirst({ where: { clientId: test.clientId, code: test.sourceCode, deletedAt: null } });
    if (source) {
      const missing = names.filter((n) => !source.participants.includes(n));
      if (missing.length) await prisma.clientSource.update({ where: { id: source.id }, data: { participants: [...source.participants, ...missing] } });
      return source.code;
    }
  }
  const day = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const source = await addClientSource(actor, {
    clientId: test.clientId,
    kind: "PERSON",
    title: `מבחן הזר, ${code}: תשובות`,
    occurredAt: day,
    participants: names,
  });
  await prisma.processStrangerTest.update({ where: { id: test.id }, data: { sourceCode: source.code } });
  return source.code;
}

/// Answers one question. The answer becomes a confirmed fact in the file,
/// or, on an explicit yes, a change to a rule; "not relevant" closes it.
export async function answerStrangerQuestion(actor: User, questionId: string, input: StrangerAnswerInput) {
  assertCan(actor.role, "time_entry.create_self");
  const question = await prisma.processStrangerQuestion.findUnique({ where: { id: questionId }, include: { test: true } });
  if (!question) throw new Error("השאלה לא נמצאה.");
  await assertClientAccess(actor, question.clientId);
  if (question.status !== "OPEN") throw new Error("השאלה כבר נסגרה.");
  const process = await prisma.process.findUnique({ where: { id: question.processId }, select: { code: true, deletedAt: true } });
  if (!process || process.deletedAt) throw new Error("התהליך לא נמצא.");
  const now = new Date();

  if (input.notRelevant) {
    const closed = await prisma.processStrangerQuestion.update({
      where: { id: questionId },
      data: { status: "NOT_RELEVANT", answer: input.answer?.trim() || null, answeredById: actor.id, answeredAt: now },
    });
    await recordAudit({ actorId: actor.id, action: "process.stranger_not_relevant", entityType: "Process", entityId: question.processId, clientId: question.clientId, after: { questionId, question: question.question } });
    return { question: closed, factId: null, policyId: null };
  }

  const answer = input.answer?.trim();
  if (!answer) throw new Error("צריך תשובה, או לסמן שהשאלה לא רלוונטית.");
  if (answer.length > MAX_STRANGER_TEXT * 2) throw new Error("התשובה ארוכה מדי.");
  const kind = input.kind ?? "NOTE";
  if (!ANSWER_FACT_KINDS.includes(kind)) throw new Error("סוג התשובה לא מתאים לתיק.");

  let factId: string | null = null;
  let policyId: string | null = null;

  if (input.ruleChange) {
    if (!input.ruleChange.userConfirmed) throw new Error(RULE_CHANGE_NEEDS_YES);
    const policy = await prisma.clientPolicy.findFirst({ where: { id: input.ruleChange.policyId, clientId: question.clientId, deletedAt: null } });
    if (!policy) throw new Error("הכלל לא נמצא בתיק של הלקוח.");
    if (policy.status === "RETIRED") throw new Error("הכלל בוטל. כותבים כלל חדש.");
    const client = await prisma.client.findUnique({ where: { id: question.clientId }, select: { accountManagerId: true } });
    if (!approvesProceduresOf({ userId: actor.id, isManager: canManageClients(actor.role), accountManagerId: client?.accountManagerId ?? null })) {
      throw new Error("רק מנהל או מנהל התיק של הלקוח משנים כלל של לקוח. רושמים את התשובה בלי שינוי הכלל, והם יחליטו.");
    }
    const code = await sourceFor(actor, question.test, process.code, input.toldBy ?? null);
    const refs = readSourceRefs(policy.sources).filter((r) => r.code !== code);
    const updated = await updateClientPolicy(actor, policy.id, {
      statement: input.ruleChange.statement,
      ...(input.ruleChange.interimStatement !== undefined ? { interimStatement: input.ruleChange.interimStatement } : {}),
      sources: [...refs, { code }],
      knowledgeStatus: "CONFIRMED",
      toResolve: null,
      manualConfirm: true,
    });
    // The yes was the approval.
    if (updated.status === "PROPOSED") await approveClientPolicy(actor, policy.id);
    policyId = policy.id;
  } else {
    const code = await sourceFor(actor, question.test, process.code, input.toldBy ?? null);
    const fact = await addClientFact(actor, {
      clientId: question.clientId,
      kind,
      topic: input.topic ?? null,
      body: answerFactBody(process.code, question.step, answer),
      sources: [{ code }],
      knowledgeStatus: "CONFIRMED",
      manualConfirm: true,
    });
    factId = fact.id;
  }

  const answered = await prisma.processStrangerQuestion.update({
    where: { id: questionId },
    data: { status: "ANSWERED", answer, answeredById: actor.id, answeredAt: now, factId, policyId },
  });
  await recordAudit({
    actorId: actor.id,
    action: "process.stranger_answer",
    entityType: "Process",
    entityId: question.processId,
    clientId: question.clientId,
    after: { questionId, factId, policyId },
  });
  return { question: answered, factId, policyId };
}

/// The latest test of each process: when, and what is still open.
export async function strangerStates(processIds: string[]): Promise<Map<string, StrangerState & { testId: string; version: number | null }>> {
  if (processIds.length === 0) return new Map();
  const tests = await prisma.processStrangerTest.findMany({
    where: { processId: { in: processIds } },
    orderBy: { createdAt: "desc" },
    include: { questions: { select: { status: true, severity: true } } },
  });
  const out = new Map<string, StrangerState & { testId: string; version: number | null }>();
  for (const t of tests) {
    if (out.has(t.processId)) continue;
    const open = t.questions.filter((q) => q.status === "OPEN");
    out.set(t.processId, {
      testId: t.id,
      version: t.version,
      at: t.createdAt,
      open: open.length,
      blockers: open.filter((q) => q.severity === "BLOCKER").length,
      answered: t.questions.filter((q) => q.status === "ANSWERED").length,
    });
  }
  return out;
}

/// The questions of a process: what is open, and what was answered, from
/// every test (an answer stays true after a new test).
export async function strangerQuestionsOf(processId: string) {
  const rows = await prisma.processStrangerQuestion.findMany({
    where: { processId, status: { in: ["OPEN", "ANSWERED"] } },
    orderBy: [{ step: "asc" }, { createdAt: "asc" }],
  });
  return { open: rows.filter((q) => q.status === "OPEN"), answered: rows.filter((q) => q.status === "ANSWERED") };
}

/// For the processes screen: each process's latest test and its open
/// questions, BLOCKER first.
export async function strangerPanel(processIds: string[]) {
  const [states, open] = await Promise.all([
    strangerStates(processIds),
    processIds.length
      ? prisma.processStrangerQuestion.findMany({ where: { processId: { in: processIds }, status: "OPEN" }, orderBy: [{ step: "asc" }, { createdAt: "asc" }] })
      : Promise.resolve([]),
  ]);
  const rank = { BLOCKER: 0, SLOWS: 1, IMPROVES: 2 } as const;
  const out = new Map<string, { state: StrangerState | null; open: { id: string; step: number | null; severity: "BLOCKER" | "SLOWS" | "IMPROVES"; askWho: "ANKORA" | "CLIENT"; question: string }[] }>();
  for (const id of processIds) {
    const s = states.get(id);
    out.set(id, {
      state: s ? { at: s.at, open: s.open, blockers: s.blockers, answered: s.answered } : null,
      open: open
        .filter((q) => q.processId === id)
        .sort((a, b) => rank[a.severity] - rank[b.severity])
        .map((q) => ({ id: q.id, step: q.step, severity: q.severity, askWho: q.askWho, question: q.question })),
    });
  }
  return out;
}
