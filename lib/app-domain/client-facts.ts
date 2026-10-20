import "server-only";
import { teamRefs, withInternalRefs } from "@/lib/external-refs";
import { prisma } from "@/lib/prisma";
import { assertCan, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { canSeeKnowledgeItem, clientVisibleBlocker } from "@/lib/knowledge";
import { factShapeError, isQuestion } from "@/lib/client-facts";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { assertResolvable, knowledgeData, sourcedFields, type KnowledgeInput } from "@/lib/app-domain/knowledge-items";
import { createTask } from "@/lib/app-domain/tasks";
import { readSourceRefs, type SourceRef } from "@/lib/knowledge-sources";
import type { User, ClientFact, FactKind, FactTopic, Prisma } from "@prisma/client";

// Org brain, phase 2: the facts in a client's file
// (claude/org-brain-spec-2026-10-12.md, 3.4; sections 2, 4, 5, 7.3, 8,
// 11, 12 and 13 of Hadas's file).
//
// The rule that shapes this module is "nothing is overwritten" (spec 1.5).
// A fact's words never change in place. When something changes, the new
// fact is written and the old one is marked superseded and points at it,
// so the file can always answer "what did we think before, and since
// when". What can change in place is everything around the words: whether
// it is confirmed, where it is known from, who may see it.

export interface ClientFactInput extends KnowledgeInput {
  clientId: string;
  kind: FactKind;
  body: string;
  topic?: FactTopic | null;
  subjectContactId?: string | null;
  subjectOrgId?: string | null;
  referTo?: string | null;
  validUntil?: Date | null;
  validUntilEvent?: string | null;
  decidedAt?: Date | null;
  decidedBy?: string | null;
  assigneeId?: string | null;
}

function clean(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

/// A preference belongs to someone in this client's file, never to a
/// person or firm another client knows.
async function assertSubjects(clientId: string, input: Pick<ClientFactInput, "subjectContactId" | "subjectOrgId">) {
  if (input.subjectContactId) {
    const ok = await prisma.clientContact.count({ where: { id: input.subjectContactId, clientId, deletedAt: null } });
    if (!ok) throw new Error("איש הקשר לא נמצא בתיק של הלקוח.");
  }
  if (input.subjectOrgId) {
    const ok = await prisma.clientOrganization.count({ where: { id: input.subjectOrgId, clientId, deletedAt: null } });
    if (!ok) throw new Error("הארגון לא נמצא בתיק של הלקוח.");
  }
}

async function assertAssignee(assigneeId: string | null | undefined) {
  if (!assigneeId) return;
  const user = await prisma.user.findUnique({ where: { id: assigneeId }, select: { role: true, status: true, deletedAt: true } });
  if (!user || user.deletedAt || user.status !== "ACTIVE" || user.role === "CLIENT_USER") throw new Error("האחראי לא נמצא בצוות.");
}

/// Everything about a new fact except the words: checked and normalized
/// once, for both a fresh fact and the replacement of an old one.
async function prepare(clientId: string, input: Omit<ClientFactInput, "clientId">) {
  const shapeError = factShapeError(input);
  if (shapeError) throw new Error(shapeError);
  await assertSubjects(clientId, input);
  await assertAssignee(input.assigneeId);

  const question = isQuestion(input.kind);
  // A question is "missing" by nature, and what closes it is its answer.
  const knowledge: KnowledgeInput = question
    ? { ...input, knowledgeStatus: "MISSING", toResolve: clean(input.toResolve) ?? "תשובה לשאלה." }
    : input;
  assertResolvable(knowledge.knowledgeStatus, knowledge.toResolve);
  const sourced = await sourcedFields(clientId, knowledge, [input.body]);

  return {
    kind: input.kind,
    body: input.body.trim(),
    topic: input.topic ?? null,
    subjectContactId: input.subjectContactId || null,
    subjectOrgId: input.subjectOrgId || null,
    referTo: input.kind === "SCOPE_OUT" ? clean(input.referTo) : null,
    validUntil: input.kind === "TEMPORARY" ? input.validUntil ?? null : null,
    validUntilEvent: input.kind === "TEMPORARY" ? clean(input.validUntilEvent) : null,
    decidedAt: input.kind === "ONE_OFF_DECISION" ? input.decidedAt ?? null : null,
    decidedBy: input.kind === "ONE_OFF_DECISION" ? clean(input.decidedBy) : null,
    // Who chases it: a question's answer, or whether temporary information
    // is still true (spec 3.4, gap 11).
    assigneeId: question || input.kind === "TEMPORARY" ? input.assigneeId || null : null,
    ...knowledgeData(knowledge),
    ...sourced,
  };
}

export async function addClientFact(actor: User, input: ClientFactInput) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, input.clientId);
  const data = await prepare(input.clientId, input);
  const fact = await prisma.clientFact.create({ data: { ...data, clientId: input.clientId, createdById: actor.id } });
  await recordAudit({
    actorId: actor.id,
    action: "client_fact.add",
    entityType: "ClientFact",
    entityId: fact.id,
    clientId: input.clientId,
    after: fact,
  });
  return fact;
}

async function findLive(id: string): Promise<ClientFact> {
  const fact = await prisma.clientFact.findUnique({ where: { id } });
  if (!fact || fact.deletedAt) throw new Error("הפריט לא נמצא.");
  return fact;
}

function assertCurrent(fact: ClientFact) {
  if (fact.knowledgeStatus === "SUPERSEDED") throw new Error("הפריט כבר הוחלף. עובדים על הגרסה החדשה שלו.");
}

/// The fact changed. The new one is written, the old one stays, marked
/// superseded and pointing at its replacement. Both in one transaction, so
/// the file never shows two current versions or none.
export async function supersedeClientFact(actor: User, id: string, input: Omit<ClientFactInput, "clientId">) {
  assertCan(actor.role, "time_entry.create_self");
  const old = await findLive(id);
  await assertClientAccess(actor, old.clientId);
  assertCurrent(old);
  if (input.kind !== old.kind) throw new Error("החלפה היא של אותו סוג פריט. סוג אחר הוא פריט חדש.");
  // The new version keeps who keeps it, and whether the client sees it,
  // unless it says otherwise (and visibility still has to be allowed).
  const data = await prepare(old.clientId, {
    ...input,
    ownerId: input.ownerId !== undefined ? input.ownerId : old.ownerId,
    clientVisible: input.clientVisible ?? (old.clientVisible && !clientVisibleBlocker({ sensitivity: input.sensitivity ?? old.sensitivity, audience: input.audience ?? old.audience, doNotDisclose: input.doNotDisclose !== undefined ? input.doNotDisclose : old.doNotDisclose })),
    // Spec 3.1: the team's refs as given, or as they were; the product's
    // own (a date's question) always carried over.
    externalRefs: withInternalRefs(old.externalRefs, input.externalRefs ?? teamRefs(old.externalRefs)),
  });

  const now = new Date();
  const [replacement] = await prisma.$transaction(async (tx) => {
    const created = await tx.clientFact.create({
      data: { ...data, clientId: old.clientId, createdById: actor.id, taskId: old.taskId },
    });
    const retired = await tx.clientFact.update({
      where: { id: old.id },
      data: { knowledgeStatus: "SUPERSEDED", supersededById: created.id, supersededAt: now },
    });
    return [created, retired] as const;
  });
  await recordAudit({
    actorId: actor.id,
    action: "client_fact.supersede",
    entityType: "ClientFact",
    entityId: old.id,
    clientId: old.clientId,
    before: old,
    after: replacement,
  });
  return replacement;
}

/// Confirming is not a change of the fact, only of what we know about it:
/// it happens in place, with the source that confirms it. Ankora's own
/// documents still cannot confirm anything (R14).
export async function confirmClientFact(actor: User, id: string, sources: SourceRef[], manualConfirm = false) {
  assertCan(actor.role, "time_entry.create_self");
  const fact = await findLive(id);
  await assertClientAccess(actor, fact.clientId);
  assertCurrent(fact);
  if (isQuestion(fact.kind)) throw new Error("שאלה נסגרת בתשובה, לא באישור.");
  const sourced = await sourcedFields(fact.clientId, { knowledgeStatus: "CONFIRMED", sources, toResolve: null, manualConfirm }, [fact.body], fact);
  const updated = await prisma.clientFact.update({
    where: { id },
    data: { ...sourced, toResolve: sourced.knowledgeStatus === "CONFIRMED" ? null : sourced.toResolve, verifiedAt: new Date() },
  });
  await recordAudit({
    actorId: actor.id,
    action: "client_fact.confirm",
    entityType: "ClientFact",
    entityId: id,
    clientId: fact.clientId,
    before: fact,
    after: updated,
  });
  return updated;
}

/// More sources for a fact that is already right: another meeting said the
/// same (20.10.2026, "כבר בתיק" on the review screen). What we know about
/// it does not change; a new source on a confirmed fact counts as a new
/// confirmation, as anywhere else in the file.
export async function addClientFactSources(actor: User, id: string, added: SourceRef[]) {
  assertCan(actor.role, "time_entry.create_self");
  const fact = await findLive(id);
  await assertClientAccess(actor, fact.clientId);
  assertCurrent(fact);
  const sources = readSourceRefs(fact.sources);
  for (const r of added) if (!sources.some((o) => o.code === r.code && (o.at ?? null) === (r.at ?? null))) sources.push(r);
  if (sources.length === readSourceRefs(fact.sources).length) return fact;
  const sourced = await sourcedFields(fact.clientId, { sources }, [fact.body], fact);
  const updated = await prisma.clientFact.update({ where: { id }, data: sourced });
  await recordAudit({
    actorId: actor.id,
    action: "client_fact.add_sources",
    entityType: "ClientFact",
    entityId: id,
    clientId: fact.clientId,
    before: fact,
    after: updated,
  });
  return updated;
}

/// Somebody said something else (spec 5.2). Nothing is overwritten: the
/// other version joins the fact's alternatives, with its source, and the
/// fact becomes uncertain until somebody settles it. The bank in Israel is
/// "Leumi" according to S8 and S10 and "Bank Hapoalim" according to S11;
/// the file says exactly that, and asks.
export async function recordContradiction(actor: User, id: string, input: { value: string; sources: SourceRef[] }) {
  assertCan(actor.role, "time_entry.create_self");
  const fact = await findLive(id);
  await assertClientAccess(actor, fact.clientId);
  assertCurrent(fact);
  const value = input.value.trim();
  if (!value) throw new Error("צריך לכתוב מה נאמר אחרת.");
  // The other version must cite the register like anything else.
  const checked = await sourcedFields(fact.clientId, { knowledgeStatus: "UNCERTAIN", sources: input.sources, toResolve: "x" }, [value]);
  const alternatives = [
    ...(Array.isArray(fact.alternatives) ? (fact.alternatives as unknown[]) : []),
    { value, sources: checked.sources, at: new Date().toISOString(), byId: actor.id },
  ];
  const updated = await prisma.clientFact.update({
    where: { id },
    data: {
      alternatives: alternatives as Prisma.InputJsonValue,
      knowledgeStatus: fact.knowledgeStatus === "MISSING" ? "MISSING" : "UNCERTAIN",
      toResolve: fact.toResolve ?? "יש גרסאות סותרות. לברר מול הלקוח איזו נכונה.",
    },
  });
  await recordAudit({
    actorId: actor.id,
    action: "client_fact.contradict",
    entityType: "ClientFact",
    entityId: id,
    clientId: fact.clientId,
    before: fact,
    after: updated,
  });
  return updated;
}

/// A question answered becomes a confirmed item with a source (spec 3.4):
/// the answer is what we now know, and where we heard it.
export async function answerClientQuestion(actor: User, id: string, input: { answer: string; sources: SourceRef[]; manualConfirm?: boolean }) {
  assertCan(actor.role, "time_entry.create_self");
  const fact = await findLive(id);
  await assertClientAccess(actor, fact.clientId);
  assertCurrent(fact);
  if (!isQuestion(fact.kind)) throw new Error("רק שאלה פתוחה מקבלת תשובה.");
  if (fact.answeredAt) throw new Error("השאלה כבר נענתה.");
  const answer = input.answer.trim();
  if (!answer) throw new Error("צריך לכתוב את התשובה.");
  const sourced = await sourcedFields(fact.clientId, { knowledgeStatus: "CONFIRMED", sources: input.sources, toResolve: null, manualConfirm: input.manualConfirm }, [answer], fact);
  const updated = await prisma.clientFact.update({
    where: { id },
    data: {
      ...sourced,
      toResolve: sourced.knowledgeStatus === "CONFIRMED" ? null : sourced.toResolve,
      answer,
      answeredAt: new Date(),
      verifiedAt: new Date(),
    },
  });
  await recordAudit({
    actorId: actor.id,
    action: "client_fact.answer",
    entityType: "ClientFact",
    entityId: id,
    clientId: fact.clientId,
    before: fact,
    after: updated,
  });
  return updated;
}

/// "Make it a task" (spec 3.4): a question stays a question, and the work
/// of chasing it goes where work goes. The same for temporary information
/// that is also work (gap 11: "a 6,000$ gap with the tax authority, Ariel
/// is on it"): the fact stays in the file, the work sits in a task linked
/// to it. One task per fact.
export async function factToTask(actor: User, id: string) {
  assertCan(actor.role, "time_entry.create_self");
  const fact = await findLive(id);
  await assertClientAccess(actor, fact.clientId);
  assertCurrent(fact);
  const temporary = fact.kind === "TEMPORARY";
  if (!isQuestion(fact.kind) && !temporary) throw new Error("רק שאלה פתוחה או מידע זמני הופכים למשימה מכאן.");
  if (fact.answeredAt) throw new Error("השאלה כבר נענתה.");
  if (fact.closedAt) throw new Error("המידע הזמני כבר נסגר.");
  if (fact.taskId) throw new Error(temporary ? "כבר יש משימה למידע הזה." : "כבר יש משימה לשאלה הזו.");
  const title = fact.body.length > 120 ? `${fact.body.slice(0, 117)}...` : fact.body;
  const until = fact.validUntil ? new Intl.DateTimeFormat("he-IL", { timeZone: "UTC" }).format(fact.validUntil) : fact.validUntilEvent;
  const task = await createTask(actor, {
    clientId: fact.clientId,
    title: temporary ? `מידע זמני: ${title}` : `שאלה פתוחה: ${title}`,
    description: temporary
      ? [until ? `בתוקף עד ${until}.` : null, fact.toResolve ? `מה יסגור אותו: ${fact.toResolve}` : null].filter(Boolean).join(" ") || null
      : fact.toResolve
        ? `מה יסגור אותה: ${fact.toResolve}`
        : null,
    assignedToId: fact.assigneeId ?? actor.id,
  });
  const updated = await prisma.clientFact.update({ where: { id }, data: { taskId: task.id } });
  await recordAudit({
    actorId: actor.id,
    action: "client_fact.to_task",
    entityType: "ClientFact",
    entityId: id,
    clientId: fact.clientId,
    after: { taskId: task.id },
  });
  return { fact: updated, task };
}

/// A temporary fact that is over. Closed, not deleted: it is history, and
/// section 11 shows it under "closed" (spec 3.4).
export async function closeTemporaryFact(actor: User, id: string) {
  assertCan(actor.role, "time_entry.create_self");
  const fact = await findLive(id);
  await assertClientAccess(actor, fact.clientId);
  if (fact.kind !== "TEMPORARY") throw new Error("רק מידע זמני נסגר.");
  if (fact.closedAt) throw new Error("כבר נסגר.");
  const updated = await prisma.clientFact.update({ where: { id }, data: { closedAt: new Date() } });
  await recordAudit({
    actorId: actor.id,
    action: "client_fact.close",
    entityType: "ClientFact",
    entityId: id,
    clientId: fact.clientId,
    before: fact,
    after: updated,
  });
  return updated;
}

/// For a fact added by mistake. A fact that was true and changed is
/// superseded, not removed.
export async function removeClientFact(actor: User, id: string) {
  assertCan(actor.role, "time_entry.create_self");
  const fact = await findLive(id);
  await assertClientAccess(actor, fact.clientId);
  const removed = await prisma.clientFact.update({ where: { id }, data: { deletedAt: new Date() } });
  await recordAudit({
    actorId: actor.id,
    action: "client_fact.remove",
    entityType: "ClientFact",
    entityId: id,
    clientId: fact.clientId,
    before: fact,
  });
  return removed;
}

/// Current facts and their history, each filtered by its own audience.
/// Oldest first within a kind, the way the file reads.
export async function listClientFacts(actor: User, clientId: string) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, clientId);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { accountManagerId: true } });
  const viewer = { id: actor.id, isManager: canManageClients(actor.role) };
  const rows = await prisma.clientFact.findMany({
    where: { clientId, deletedAt: null },
    orderBy: [{ createdAt: "asc" }],
  });
  const visible = rows.filter((r) => canSeeKnowledgeItem(r, viewer, client?.accountManagerId ?? null));
  return {
    current: visible.filter((f) => f.knowledgeStatus !== "SUPERSEDED"),
    superseded: visible.filter((f) => f.knowledgeStatus === "SUPERSEDED"),
  };
}

/// The name the first callers used, from when only a question could
/// become a task.
export const questionToTask = factToTask;
