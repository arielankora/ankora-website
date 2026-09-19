import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import type { User, CategoryVisibility } from "@prisma/client";

export async function listCategories() {
  return prisma.category.findMany({
    where: { deletedAt: null },
    orderBy: [{ visibility: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    include: { client: true },
  });
}

// App redesign (handoff README, screen 6 "קטגוריות"): "טבלה: ... שעות
// החודש". Month boundaries computed the same lightweight UTC-calendar-
// month way important-dates/page.tsx already does for its "thisMonth" KPI
// (getUTCMonth/getUTCFullYear) - consistent with that existing precedent
// rather than introducing a new Asia/Jerusalem month-boundary helper for
// one screen's summary column.
export async function getCategoryMonthlyHours(): Promise<Map<string, number>> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const rows = await prisma.timeEntry.groupBy({
    by: ["categoryId"],
    where: { deletedAt: null, startAt: { gte: monthStart, lt: monthEnd }, actualSeconds: { not: null } },
    _sum: { actualSeconds: true },
  });
  return new Map(rows.map((r) => [r.categoryId, r._sum.actualSeconds ?? 0]));
}

export async function createCategory(
  actor: User,
  input: { name: string; description?: string; visibility: CategoryVisibility; clientId?: string | null }
) {
  assertCan(actor.role, "category.manage");
  if (input.visibility === "CLIENT" && !input.clientId) {
    throw new Error("A client-specific category requires a client.");
  }

  const category = await prisma.category.create({
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      visibility: input.visibility,
      clientId: input.visibility === "CLIENT" ? input.clientId : null,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "category.create",
    entityType: "Category",
    entityId: category.id,
    clientId: category.clientId,
    after: category,
  });
  return category;
}

export async function updateCategory(
  actor: User,
  categoryId: string,
  input: { name?: string; description?: string; active?: boolean; sortOrder?: number }
) {
  assertCan(actor.role, "category.manage");
  const before = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });
  const category = await prisma.category.update({
    where: { id: categoryId },
    data: {
      name: input.name?.trim(),
      description: input.description?.trim(),
      active: input.active,
      sortOrder: input.sortOrder,
    },
  });
  await recordAudit({
    actorId: actor.id,
    action: "category.update",
    entityType: "Category",
    entityId: categoryId,
    clientId: category.clientId,
    before,
    after: category,
  });
  return category;
}

export async function archiveCategory(actor: User, categoryId: string) {
  assertCan(actor.role, "category.manage");
  const category = await prisma.category.update({
    where: { id: categoryId },
    data: { active: false, deletedAt: new Date() },
  });
  await recordAudit({
    actorId: actor.id,
    action: "category.archive",
    entityType: "Category",
    entityId: categoryId,
    clientId: category.clientId,
  });
  return category;
}
