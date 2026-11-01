import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { loweredBySource, type LoweredSource } from "@/lib/app-domain/source-confirmation";
import { createTask } from "@/lib/app-domain/tasks";
import { factToTask } from "@/lib/app-domain/client-facts";
import { ASK_CLIENT, SNOOZED, cardOwner, cardTitle, checkTaskTitle, dismissedAnswer, readAskFlags, readSnoozes, sendTaskTitle, snoozeError, type QuestionItem } from "@/lib/client-questions";
import { internalClientIds } from "@/lib/app-domain/internal-client";
import { SECONDARY_ONLY_TO_RESOLVE } from "@/lib/knowledge-sources";

// "שאלות ללקוח" (lib/client-questions.ts says why): per client, the open
// questions and the uncertain items someone chose to ask about, on the
// card of whoever owns them, on the client's page. Marking them asked,
// putting an item on the card and putting a line off are audit events, so
// no column is added for them: the latest event that names an item wins.

const ASKED = "client_file.questions_asked";

export type QuestionCard = {
  clientId: string;
  clientName: string;
  contactName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  title: string;
  items: QuestionItem[];
  /// Lines put off to a date, out of the card until then.
  snoozed: { id: string; title: string; until: Date }[];
  /// Sources whose items are uncertain only because Ankora wrote them,
  /// for a manager to confirm with the client in one step.
  lowered: LoweredSource[];
};

/// An uncertain item in the file that is not on the card: it can be put
/// there with "לשאול את הלקוח".
export type UncertainItem = { id: string; what: string; title: string; toResolve: string | null; href: string };

const itemHref = (clientId: string, id: string) => `/app/clients/${clientId}?tab=file#item-${id}`;

type Row = {
  id: string;
  clientId: string;
  ownerId: string | null;
  toResolve: string | null;
  doNotDisclose: string | null;
  sensitivity: string;
  updatedAt: Date;
};

async function eventsOf(action: string, clientIds: string[]) {
  if (clientIds.length === 0) return [];
  return prisma.auditEvent.findMany({ where: { action, clientId: { in: clientIds } }, select: { afterJson: true, createdAt: true }, orderBy: { createdAt: "asc" } });
}

/// When each item was last marked asked.
async function askedAt(clientIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  for (const e of await eventsOf(ASKED, clientIds)) {
    const ids = (e.afterJson as { itemIds?: unknown } | null)?.itemIds;
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") out.set(id, e.createdAt);
  }
  return out;
}

type Entry = { owner: string | null; item: QuestionItem; updatedAt: Date };

/// Everything that could be a question, per client: the open questions
/// (always on the card), and the uncertain items, marked whether someone
/// put them on the card.
async function gather(clientIds: string[]) {
  const unsure = { deletedAt: null, clientId: { in: clientIds }, knowledgeStatus: { in: ["UNCERTAIN" as const, "MISSING" as const] } };
  const base = { id: true, clientId: true, ownerId: true, toResolve: true, doNotDisclose: true, sensitivity: true, updatedAt: true } as const;
  const [facts, questions, contacts, orgs, systems, entities, requestTypes, processes, policies, asked, flagged, snoozes] = await Promise.all([
    prisma.clientFact.findMany({ where: { ...unsure, kind: { not: "QUESTION" } }, select: { ...base, body: true } }),
    // A question that became a task is chased there, not on the card.
    prisma.clientFact.findMany({ where: { deletedAt: null, clientId: { in: clientIds }, kind: "QUESTION", answeredAt: null, taskId: null, knowledgeStatus: { not: "SUPERSEDED" } }, select: { ...base, body: true, assigneeId: true } }),
    prisma.clientContact.findMany({ where: unsure, select: { ...base, role: true, person: { select: { name: true } } } }),
    prisma.clientOrganization.findMany({ where: unsure, select: { ...base, organization: { select: { name: true } } } }),
    prisma.systemAccess.findMany({ where: unsure, select: { ...base, systemName: true } }),
    prisma.clientEntity.findMany({ where: unsure, select: { ...base, name: true } }),
    prisma.requestType.findMany({ where: unsure, select: { ...base, title: true } }),
    prisma.process.findMany({ where: { ...unsure, status: { not: "RETIRED" } }, select: { ...base, code: true, title: true } }),
    prisma.clientPolicy.findMany({ where: { ...unsure, status: { not: "RETIRED" } }, select: { ...base, title: true } }),
    askedAt(clientIds),
    eventsOf(ASK_CLIENT, clientIds).then(readAskFlags),
    eventsOf(SNOOZED, clientIds).then(readSnoozes),
  ]);
  return { facts, questions, contacts, orgs, systems, entities, requestTypes, processes, policies, asked, flagged, snoozes };
}

/// The cards. By default the person's own (`scope: "mine"`); a manager may
/// ask for everyone's (`"all"`); and on a client's page (`"client"`, with
/// `clientId`) everyone who works on the client sees all of its cards.
export async function collectQuestionCards(user: User, options: { scope?: "mine" | "all" | "client"; clientId?: string | null; now?: Date } = {}): Promise<QuestionCard[]> {
  if (!can(user.role, "time_entry.create_self")) return [];
  const all = (options.scope === "all" && canManageClients(user.role)) || (options.scope === "client" && !!options.clientId);
  const now = options.now ?? new Date();
  let clients = await listAccessibleClients(user);
  if (options.clientId) clients = clients.filter((c) => c.id === options.clientId);
  if (clients.length === 0) return [];
  const ids = clients.map((c) => c.id);
  const am = new Map(clients.map((c) => [c.id, c.accountManagerId ?? null]));

  const [g, primary, lowered] = await Promise.all([
    gather(ids),
    prisma.clientContact.findMany({ where: { clientId: { in: ids }, deletedAt: null, isPrimary: true }, select: { clientId: true, person: { select: { name: true } } } }),
    canManageClients(user.role) ? loweredBySource(ids).catch(() => [] as LoweredSource[]) : Promise.resolve([] as LoweredSource[]),
  ]);

  const byClient = new Map<string, Entry[]>();
  const later = new Map<string, { owner: string | null; id: string; title: string; until: Date }[]>();
  // 22.10.2026: in Ankora's own file there is no client to ask. What is
  // uncertain there only because Ankora wrote it is a manager's decision,
  // on "אישורים" (lib/app-domain/internal-client.ts).
  const internal = await internalClientIds(clients);
  const add = (r: Row & { assigneeId?: string | null }, what: string, title: string, isQuestion: boolean) => {
    if (internal.has(r.clientId) && r.toResolve === SECONDARY_ONLY_TO_RESOLVE) return;
    // 1.11.2026: an uncertain item is a question only once someone chose
    // to ask the client about it.
    if (!isQuestion && !g.flagged.has(r.id)) return;
    const owner = cardOwner(r, am.get(r.clientId) ?? null);
    const clean = title.replace(/\s+/g, " ").trim();
    const until = g.snoozes.get(r.id);
    if (until && until.getTime() > now.getTime()) {
      const list = later.get(r.clientId) ?? [];
      list.push({ owner, id: r.id, title: clean, until });
      later.set(r.clientId, list);
      return;
    }
    const list = byClient.get(r.clientId) ?? [];
    list.push({
      owner,
      updatedAt: r.updatedAt,
      item: {
        id: r.id,
        what,
        title: clean,
        toResolve: r.toResolve,
        isQuestion,
        internal: r.sensitivity === "SENSITIVE" || !!r.doNotDisclose?.trim(),
        href: itemHref(r.clientId, r.id),
        askedAt: g.asked.get(r.id) ?? null,
      },
    });
    byClient.set(r.clientId, list);
  };
  for (const r of g.questions) add(r, "שאלה פתוחה", r.body, true);
  for (const r of g.facts) add(r, "פריט", r.body, false);
  for (const r of g.contacts) add(r, "איש קשר", r.person.name ?? r.role ?? "איש קשר", false);
  for (const r of g.orgs) add(r, "ארגון", r.organization.name, false);
  for (const r of g.systems) add(r, "מערכת", r.systemName, false);
  for (const r of g.entities) add(r, "ישות", r.name, false);
  for (const r of g.requestTypes) add(r, "סוג פנייה", r.title, false);
  for (const r of g.processes) add(r, "תהליך", `${r.code} ${r.title}`, false);
  for (const r of g.policies) add(r, "כלל", r.title, false);

  const ownerIds = new Set<string>();
  for (const list of byClient.values()) for (const e of list) if (e.owner) ownerIds.add(e.owner);
  for (const list of later.values()) for (const e of list) if (e.owner) ownerIds.add(e.owner);
  const names = new Map((await prisma.user.findMany({ where: { id: { in: [...ownerIds] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const contactOf = new Map(primary.map((p) => [p.clientId, p.person.name ?? null]));

  const cards: QuestionCard[] = [];
  for (const c of clients) {
    const list = byClient.get(c.id) ?? [];
    const put = later.get(c.id) ?? [];
    // One card per owner of the client: whoever owns the items asks.
    const owners = [...new Set([...list.map((e) => e.owner), ...put.map((e) => e.owner)])];
    for (const owner of owners) {
      if (!all && owner !== user.id) continue;
      const entries = list
        .filter((e) => e.owner === owner)
        // Not yet asked first, open questions before the rest, oldest first.
        .sort((a, b) => Number(!!a.item.askedAt) - Number(!!b.item.askedAt) || Number(b.item.isQuestion) - Number(a.item.isQuestion) || a.updatedAt.getTime() - b.updatedAt.getTime());
      const contactName = contactOf.get(c.id) ?? null;
      const open = entries.filter((e) => !e.item.askedAt).length;
      cards.push({
        clientId: c.id,
        clientName: c.name,
        contactName,
        ownerId: owner,
        ownerName: owner ? (names.get(owner) ?? null) : null,
        title: cardTitle(open || entries.length, contactName),
        items: entries.map((e) => e.item),
        snoozed: put.filter((e) => e.owner === owner).map(({ id, title, until }) => ({ id, title, until })).sort((a, b) => a.until.getTime() - b.until.getTime()),
        lowered: internal.has(c.id) ? [] : lowered.filter((l) => l.clientId === c.id && (all || owner === user.id)),
      });
    }
  }
  return cards.sort((a, b) => b.items.length - a.items.length || a.clientName.localeCompare(b.clientName, "he"));
}

/// How many questions wait on the person, not yet asked.
export async function countMyQuestions(user: User): Promise<number> {
  const cards = await collectQuestionCards(user);
  return cards.reduce((n, c) => n + c.items.filter((i) => !i.askedAt).length, 0);
}

/// The uncertain items of a client not on its card, to put there with
/// "לשאול את הלקוח". Not Ankora's own file: there is no client to ask.
export async function listUncertainItems(user: User, clientId: string): Promise<UncertainItem[]> {
  if (!can(user.role, "time_entry.create_self")) return [];
  const clients = (await listAccessibleClients(user)).filter((c) => c.id === clientId);
  if (clients.length === 0) return [];
  if ((await internalClientIds(clients)).has(clientId)) return [];
  const g = await gather([clientId]);
  const out: UncertainItem[] = [];
  const add = (r: Row, what: string, title: string) => {
    if (g.flagged.has(r.id)) return;
    out.push({ id: r.id, what, title: title.replace(/\s+/g, " ").trim(), toResolve: r.toResolve, href: itemHref(clientId, r.id) });
  };
  for (const r of g.facts) add(r, "פריט", r.body);
  for (const r of g.contacts) add(r, "איש קשר", r.person.name ?? r.role ?? "איש קשר");
  for (const r of g.orgs) add(r, "ארגון", r.organization.name);
  for (const r of g.systems) add(r, "מערכת", r.systemName);
  for (const r of g.entities) add(r, "ישות", r.name);
  for (const r of g.requestTypes) add(r, "סוג פנייה", r.title);
  for (const r of g.processes) add(r, "תהליך", `${r.code} ${r.title}`);
  for (const r of g.policies) add(r, "כלל", r.title);
  return out;
}

async function assertItemsOfClient(clientId: string, itemIds: string[]): Promise<string[]> {
  const unique = [...new Set(itemIds.filter(Boolean))].slice(0, 200);
  if (unique.length === 0) throw new Error("לא נבחרו שאלות.");
  const where = { id: { in: unique }, clientId, deletedAt: null };
  const counts = await Promise.all([
    prisma.clientFact.count({ where }),
    prisma.clientContact.count({ where }),
    prisma.clientOrganization.count({ where }),
    prisma.systemAccess.count({ where }),
    prisma.clientEntity.count({ where }),
    prisma.requestType.count({ where }),
    prisma.process.count({ where }),
    prisma.clientPolicy.count({ where }),
  ]);
  if (counts.reduce((a, b) => a + b, 0) !== unique.length) throw new Error("שאלה שנבחרה לא נמצאה בתיק של הלקוח.");
  return unique;
}

/// "נשאלו": the items were put to the client, by whom and when.
export async function markQuestionsAsked(actor: User, clientId: string, itemIds: string[], taskId: string | null = null): Promise<number> {
  await assertClientAccess(actor, clientId);
  const ids = await assertItemsOfClient(clientId, itemIds);
  await recordAudit({ actorId: actor.id, action: "client_file.questions_asked", entityType: "Client", entityId: clientId, clientId, after: { itemIds: ids, taskId } });
  return ids.length;
}

/// A task to send the message, on whoever sends it, with the message in it.
/// The items are marked asked with the task, so they leave the card's count.
export async function createQuestionsTask(actor: User, clientId: string, itemIds: string[], draft: string, contactName: string | null): Promise<{ taskId: string }> {
  await assertClientAccess(actor, clientId);
  const ids = await assertItemsOfClient(clientId, itemIds);
  const body = draft.trim();
  if (!body) throw new Error("ההודעה ריקה.");
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + 2);
  due.setUTCHours(0, 0, 0, 0);
  const task = await createTask(actor, {
    clientId,
    title: sendTaskTitle(ids.length, contactName),
    description: `ההודעה, לשלוח ללקוח אחרי עריכה:\n\n${body}`,
    assignedToId: actor.id,
    dueDate: due,
  });
  await markQuestionsAsked(actor, clientId, ids, task.id);
  return { taskId: task.id };
}

/// One uncertain item of the client, with what the actions need, or why
/// it cannot be acted on. Questions are facts; anything else is found in
/// whichever table holds it.
async function findItem(clientId: string, id: string): Promise<{ kind: "question"; body: string; taskId: string | null } | { kind: "item"; title: string; toResolve: string | null }> {
  const fact = await prisma.clientFact.findFirst({ where: { id, clientId, deletedAt: null }, select: { kind: true, body: true, taskId: true, answeredAt: true, toResolve: true } });
  if (fact?.kind === "QUESTION") {
    if (fact.answeredAt) throw new Error("השאלה כבר נסגרה.");
    return { kind: "question", body: fact.body, taskId: fact.taskId };
  }
  if (fact) return { kind: "item", title: fact.body, toResolve: fact.toResolve };
  const where = { id, clientId, deletedAt: null };
  const [contact, org, system, entity, requestType, process, policy] = await Promise.all([
    prisma.clientContact.findFirst({ where, select: { role: true, toResolve: true, person: { select: { name: true } } } }),
    prisma.clientOrganization.findFirst({ where, select: { toResolve: true, organization: { select: { name: true } } } }),
    prisma.systemAccess.findFirst({ where, select: { systemName: true, toResolve: true } }),
    prisma.clientEntity.findFirst({ where, select: { name: true, toResolve: true } }),
    prisma.requestType.findFirst({ where, select: { title: true, toResolve: true } }),
    prisma.process.findFirst({ where, select: { code: true, title: true, toResolve: true } }),
    prisma.clientPolicy.findFirst({ where, select: { title: true, toResolve: true } }),
  ]);
  const title = contact
    ? contact.person.name ?? contact.role ?? "איש קשר"
    : org?.organization.name ?? system?.systemName ?? entity?.name ?? requestType?.title ?? (process ? `${process.code} ${process.title}` : policy?.title);
  const toResolve = (contact ?? org ?? system ?? entity ?? requestType ?? process ?? policy)?.toResolve ?? null;
  if (!title) throw new Error("הפריט לא נמצא בתיק של הלקוח.");
  return { kind: "item", title, toResolve };
}

/// "לשאול את הלקוח": uncertain items onto the client's card.
export async function askClientAbout(actor: User, clientId: string, itemIds: string[]): Promise<number> {
  await assertClientAccess(actor, clientId);
  const ids = await assertItemsOfClient(clientId, itemIds);
  await recordAudit({ actorId: actor.id, action: "client_file.ask_client", entityType: "Client", entityId: clientId, clientId, after: { itemIds: ids, on: true } });
  return ids.length;
}

/// "לא רלוונטי", with one line saying why. An open question is closed, and
/// keeps the reason as its answer; an uncertain item only leaves the card,
/// and stays uncertain in the file.
export async function dismissQuestion(actor: User, clientId: string, itemId: string, reason: string): Promise<void> {
  await assertClientAccess(actor, clientId);
  const why = reason.replace(/\s+/g, " ").trim();
  if (!why) throw new Error("צריך לכתוב בשורה אחת למה זה לא רלוונטי.");
  const [id] = await assertItemsOfClient(clientId, [itemId]);
  const item = await findItem(clientId, id);
  if (item.kind === "question") {
    const before = await prisma.clientFact.findUniqueOrThrow({ where: { id } });
    const updated = await prisma.clientFact.update({
      where: { id },
      data: { answer: dismissedAnswer(why), answeredAt: new Date(), knowledgeStatus: "CONFIRMED", toResolve: null, verifiedAt: new Date() },
    });
    await recordAudit({ actorId: actor.id, action: "client_fact.dismiss_question", entityType: "ClientFact", entityId: id, clientId, before, after: updated });
    return;
  }
  await recordAudit({ actorId: actor.id, action: "client_file.ask_client", entityType: "Client", entityId: clientId, clientId, after: { itemIds: [id], on: false, reason: why } });
}

/// "נבדוק אצלנו": the line becomes a task for us, on the person who
/// pressed, and leaves the card. An open question keeps its link to the
/// task (factToTask); an uncertain item gets a task that points at it.
export async function checkQuestionOurselves(actor: User, clientId: string, itemId: string): Promise<{ taskId: string }> {
  await assertClientAccess(actor, clientId);
  const [id] = await assertItemsOfClient(clientId, [itemId]);
  const item = await findItem(clientId, id);
  if (item.kind === "question") {
    if (item.taskId) throw new Error("כבר יש משימה לשאלה הזו.");
    const { task } = await factToTask(actor, id);
    return { taskId: task.id };
  }
  const task = await createTask(actor, {
    clientId,
    title: checkTaskTitle(item.title),
    description: [item.toResolve ? `מה יסגור את זה: ${item.toResolve}` : null, `הפריט בתיק: ${itemHref(clientId, id)}`].filter(Boolean).join("\n"),
    assignedToId: actor.id,
  });
  await recordAudit({ actorId: actor.id, action: "client_file.ask_client", entityType: "Client", entityId: clientId, clientId, after: { itemIds: [id], on: false, taskId: task.id } });
  return { taskId: task.id };
}

/// "לדחות עד": the line leaves the card until the date, then comes back.
export async function snoozeQuestion(actor: User, clientId: string, itemIds: string[], until: Date, now = new Date()): Promise<number> {
  await assertClientAccess(actor, clientId);
  const error = snoozeError(until, now);
  if (error) throw new Error(error);
  const ids = await assertItemsOfClient(clientId, itemIds);
  await recordAudit({ actorId: actor.id, action: "client_file.question_snoozed", entityType: "Client", entityId: clientId, clientId, after: { itemIds: ids, until: until.toISOString() } });
  return ids.length;
}
