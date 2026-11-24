import "server-only";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";
import { assertCan, canManageClients, ForbiddenError } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { DomainError } from "@/lib/domain-error";

// Agents (24.11.2026): categories on the agents screen, to filter and group
// by. A manager edits the list and puts each agent in as many as fit. Not
// part of an agent's version: a category says how the team sorts its
// agents, not what an agent does, so changing one needs no approval.

const PROPOSE = "time_entry.create_self" as const;
const NAME_MAX = 40;

function assertManager(actor: User) {
  if (!canManageClients(actor.role)) throw new ForbiddenError("רק מנהל עורך את הקטגוריות של הסוכנים.");
}

async function cleanName(name: string, exceptId?: string) {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean || clean.length > NAME_MAX) throw new DomainError("agents.categoryName", "צריך שם לקטגוריה, עד 40 תווים.");
  const same = await prisma.agentCategory.findFirst({
    where: { archivedAt: null, name: { equals: clean, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (same) throw new DomainError("agents.categoryExists", "כבר יש קטגוריה בשם הזה.");
  return clean;
}

async function categoryById(id: string) {
  const category = await prisma.agentCategory.findUnique({ where: { id } });
  if (!category) throw new DomainError("agents.categoryNotFound", "הקטגוריה לא נמצאה.");
  return category;
}

/// The list in its order, with how many agents are in each. Archived ones
/// last, only when asked for (the management drawer shows them to restore).
export async function listAgentCategories(actor: User, opts: { withArchived?: boolean } = {}) {
  assertCan(actor.role, PROPOSE);
  const [rows, agents] = await Promise.all([
    prisma.agentCategory.findMany({ where: opts.withArchived ? {} : { archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.agent.findMany({ where: { archivedAt: null }, select: { categoryIds: true } }),
  ]);
  return rows
    .map((c) => ({ id: c.id, name: c.name, archived: !!c.archivedAt, agents: agents.filter((a) => a.categoryIds.includes(c.id)).length }))
    .sort((a, b) => Number(a.archived) - Number(b.archived));
}

/// Every active category, in the list's order: what an agent's ids are
/// read against, so an archived one drops out of the screens.
export async function activeAgentCategories() {
  return prisma.agentCategory.findMany({ where: { archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } });
}

/// The agent's active categories, in the list's order.
export function categoriesOf(ids: string[], active: { id: string; name: string }[]) {
  return active.filter((c) => ids.includes(c.id));
}

export async function createAgentCategory(actor: User, name: string) {
  assertManager(actor);
  const clean = await cleanName(name);
  const last = await prisma.agentCategory.aggregate({ _max: { sortOrder: true } });
  const category = await prisma.agentCategory.create({ data: { name: clean, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
  await recordAudit({ actorId: actor.id, action: "agent_category.create", entityType: "AgentCategory", entityId: category.id, after: { name: clean } });
  return category;
}

export async function renameAgentCategory(actor: User, id: string, name: string) {
  assertManager(actor);
  const category = await categoryById(id);
  const clean = await cleanName(name, id);
  await prisma.agentCategory.update({ where: { id }, data: { name: clean } });
  await recordAudit({ actorId: actor.id, action: "agent_category.rename", entityType: "AgentCategory", entityId: id, before: { name: category.name }, after: { name: clean } });
}

/// One step up or down among the active ones. Rewrites the order of the
/// whole active list, so old equal sortOrders cannot make a move a no-op.
export async function moveAgentCategory(actor: User, id: string, direction: "up" | "down") {
  assertManager(actor);
  const list = await prisma.agentCategory.findMany({ where: { archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true } });
  const at = list.findIndex((c) => c.id === id);
  if (at < 0) throw new DomainError("agents.categoryNotFound", "הקטגוריה לא נמצאה.");
  const to = direction === "up" ? at - 1 : at + 1;
  if (to < 0 || to >= list.length) return;
  [list[at], list[to]] = [list[to], list[at]];
  await prisma.$transaction(list.map((c, i) => prisma.agentCategory.update({ where: { id: c.id }, data: { sortOrder: i } })));
}

/// Archives (true) or restores (false). Its agents keep it, so a restore
/// brings them back as they were.
export async function setAgentCategoryArchived(actor: User, id: string, archived: boolean) {
  assertManager(actor);
  const category = await categoryById(id);
  if (!archived) await cleanName(category.name, id);
  const last = archived ? null : await prisma.agentCategory.aggregate({ where: { archivedAt: null }, _max: { sortOrder: true } });
  await prisma.agentCategory.update({
    where: { id },
    data: archived ? { archivedAt: new Date() } : { archivedAt: null, sortOrder: (last?._max.sortOrder ?? -1) + 1 },
  });
  await recordAudit({ actorId: actor.id, action: archived ? "agent_category.archive" : "agent_category.restore", entityType: "AgentCategory", entityId: id, after: { name: category.name } });
}

/// The agent's categories, as a whole list. Archived categories it is in
/// stay as they are: they are not on the form, so they are not removed.
export async function setAgentCategories(actor: User, agentId: string, categoryIds: string[]) {
  assertManager(actor);
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { archivedAt: true, categoryIds: true } });
  if (!agent || agent.archivedAt) throw new DomainError("agents.notFound", "הסוכן לא נמצא.");
  const wanted = [...new Set(categoryIds)];
  const found = await prisma.agentCategory.findMany({ where: { id: { in: wanted }, archivedAt: null }, select: { id: true } });
  if (found.length !== wanted.length) throw new DomainError("agents.categoryNotFound", "הקטגוריה לא נמצאה.");
  const archived = await prisma.agentCategory.findMany({ where: { id: { in: agent.categoryIds }, archivedAt: { not: null } }, select: { id: true } });
  const kept = archived.map((c) => c.id);
  await prisma.agent.update({ where: { id: agentId }, data: { categoryIds: [...kept, ...wanted] } });
  await recordAudit({ actorId: actor.id, action: "agent.categories", entityType: "Agent", entityId: agentId, before: { categoryIds: agent.categoryIds.filter((id) => !kept.includes(id)) }, after: { categoryIds: wanted } });
}
