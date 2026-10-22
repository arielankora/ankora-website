import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { loweredBySource, type LoweredSource } from "@/lib/app-domain/source-confirmation";
import { createTask } from "@/lib/app-domain/tasks";
import { cardOwner, cardTitle, sendTaskTitle, type QuestionItem } from "@/lib/client-questions";

// "שאלות ללקוח" (lib/client-questions.ts says why): per client, what is
// not yet confirmed and the open questions, on the card of whoever owns
// them. Marking them asked is an audit event, so no column is added for
// it: the latest "client_file.questions_asked" that names an item is when
// it was asked.

const ASKED = "client_file.questions_asked";

export type QuestionCard = {
  clientId: string;
  clientName: string;
  contactName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  title: string;
  items: QuestionItem[];
  /// Sources whose items are uncertain only because Ankora wrote them,
  /// for a manager to confirm with the client in one step.
  lowered: LoweredSource[];
};

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

/// When each item was last marked asked.
async function askedAt(clientIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (clientIds.length === 0) return out;
  const events = await prisma.auditEvent.findMany({ where: { action: ASKED, clientId: { in: clientIds } }, select: { afterJson: true, createdAt: true }, orderBy: { createdAt: "asc" } });
  for (const e of events) {
    const ids = (e.afterJson as { itemIds?: unknown } | null)?.itemIds;
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") out.set(id, e.createdAt);
  }
  return out;
}

/// The cards: by default the person's own (`scope: "mine"`); a manager may
/// ask for everyone's.
export async function collectQuestionCards(user: User, options: { scope?: "mine" | "all"; clientId?: string | null } = {}): Promise<QuestionCard[]> {
  if (!can(user.role, "time_entry.create_self")) return [];
  const all = options.scope === "all" && canManageClients(user.role);
  let clients = await listAccessibleClients(user);
  if (options.clientId) clients = clients.filter((c) => c.id === options.clientId);
  if (clients.length === 0) return [];
  const ids = clients.map((c) => c.id);
  const am = new Map(clients.map((c) => [c.id, c.accountManagerId ?? null]));

  const unsure = { deletedAt: null, clientId: { in: ids }, knowledgeStatus: { in: ["UNCERTAIN" as const, "MISSING" as const] } };
  const base = { id: true, clientId: true, ownerId: true, toResolve: true, doNotDisclose: true, sensitivity: true, updatedAt: true } as const;
  const [facts, questions, contacts, orgs, systems, entities, requestTypes, processes, policies, primary, asked, lowered] = await Promise.all([
    prisma.clientFact.findMany({ where: { ...unsure, kind: { not: "QUESTION" } }, select: { ...base, body: true } }),
    prisma.clientFact.findMany({ where: { deletedAt: null, clientId: { in: ids }, kind: "QUESTION", answeredAt: null, knowledgeStatus: { not: "SUPERSEDED" } }, select: { ...base, body: true, assigneeId: true } }),
    prisma.clientContact.findMany({ where: unsure, select: { ...base, role: true, person: { select: { name: true } } } }),
    prisma.clientOrganization.findMany({ where: unsure, select: { ...base, organization: { select: { name: true } } } }),
    prisma.systemAccess.findMany({ where: unsure, select: { ...base, systemName: true } }),
    prisma.clientEntity.findMany({ where: unsure, select: { ...base, name: true } }),
    prisma.requestType.findMany({ where: unsure, select: { ...base, title: true } }),
    prisma.process.findMany({ where: { ...unsure, status: { not: "RETIRED" } }, select: { ...base, code: true, title: true } }),
    prisma.clientPolicy.findMany({ where: { ...unsure, status: { not: "RETIRED" } }, select: { ...base, title: true } }),
    prisma.clientContact.findMany({ where: { clientId: { in: ids }, deletedAt: null, isPrimary: true }, select: { clientId: true, person: { select: { name: true } } } }),
    askedAt(ids),
    canManageClients(user.role) ? loweredBySource(ids).catch(() => [] as LoweredSource[]) : Promise.resolve([] as LoweredSource[]),
  ]);

  type Entry = { owner: string | null; item: QuestionItem; updatedAt: Date };
  const byClient = new Map<string, Entry[]>();
  const add = (r: Row & { assigneeId?: string | null }, what: string, title: string, isQuestion: boolean) => {
    const owner = cardOwner(r, am.get(r.clientId) ?? null);
    const list = byClient.get(r.clientId) ?? [];
    list.push({
      owner,
      updatedAt: r.updatedAt,
      item: {
        id: r.id,
        what,
        title: title.replace(/\s+/g, " ").trim(),
        toResolve: r.toResolve,
        isQuestion,
        internal: r.sensitivity === "SENSITIVE" || !!r.doNotDisclose?.trim(),
        href: itemHref(r.clientId, r.id),
        askedAt: asked.get(r.id) ?? null,
      },
    });
    byClient.set(r.clientId, list);
  };
  for (const r of questions) add(r, "שאלה פתוחה", r.body, true);
  for (const r of facts) add(r, "פריט", r.body, false);
  for (const r of contacts) add(r, "איש קשר", r.person.name ?? r.role ?? "איש קשר", false);
  for (const r of orgs) add(r, "ארגון", r.organization.name, false);
  for (const r of systems) add(r, "מערכת", r.systemName, false);
  for (const r of entities) add(r, "ישות", r.name, false);
  for (const r of requestTypes) add(r, "סוג פנייה", r.title, false);
  for (const r of processes) add(r, "תהליך", `${r.code} ${r.title}`, false);
  for (const r of policies) add(r, "כלל", r.title, false);

  const ownerIds = new Set<string>();
  for (const list of byClient.values()) for (const e of list) if (e.owner) ownerIds.add(e.owner);
  const names = new Map((await prisma.user.findMany({ where: { id: { in: [...ownerIds] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const contactOf = new Map(primary.map((p) => [p.clientId, p.person.name ?? null]));

  const cards: QuestionCard[] = [];
  for (const c of clients) {
    const list = byClient.get(c.id) ?? [];
    // One card per owner of the client: whoever owns the items asks.
    const owners = [...new Set(list.map((e) => e.owner))];
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
        lowered: lowered.filter((l) => l.clientId === c.id && (all || owner === user.id)),
      });
    }
  }
  return cards.sort((a, b) => b.items.length - a.items.length || a.clientName.localeCompare(b.clientName, "he"));
}

/// How many questions wait on the person: the tab's number. Not part of
/// the menu's count, which is decisions only.
export async function countMyQuestions(user: User): Promise<number> {
  const cards = await collectQuestionCards(user);
  return cards.reduce((n, c) => n + c.items.filter((i) => !i.askedAt).length, 0);
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
