import "server-only";
import { prisma } from "@/lib/prisma";
import { localDateKey, TIMEZONE } from "@/lib/timezone";
import { businessDaysBetween, STALE_BUSINESS_DAYS } from "@/lib/client-control";

// Org brain (claude/org-brain-spec-2026-10-12.md, 7.6; mapping gap 17):
// when the extraction last delivered to a client, and the daily reminder
// to the account manager when it stopped.

export const EXTRACTION_STALE = "client.extraction_stale";

/// Business days (Israel) since the client's last batch of proposals, or
/// null when there was never one.
export async function daysSinceLastBatch(clientId: string, now = new Date()): Promise<number | null> {
  const last = await prisma.knowledgeBatch.findFirst({ where: { clientId, awaitingAssignment: false }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (!last) return null;
  return businessDaysBetween(localDateKey(last.createdAt, TIMEZONE), localDateKey(now, TIMEZONE));
}

/// The daily job. A client that has had batches and has had none for more
/// than STALE_BUSINESS_DAYS tells its account manager, once per silence:
/// a reminder sent after the last batch is the same reminder. A client
/// that never had a batch is not reminded: the extraction was never on.
export async function notifyStaleExtraction(now = new Date()): Promise<{ notified: number }> {
  const clients = await prisma.client.findMany({
    where: { status: "ACTIVE", isInternal: false, accountManagerId: { not: null }, knowledgeBatches: { some: {} } },
    select: { id: true, name: true, accountManagerId: true },
  });
  let notified = 0;
  for (const c of clients) {
    const last = await prisma.knowledgeBatch.findFirst({ where: { clientId: c.id, awaitingAssignment: false }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (!last) continue;
    const days = businessDaysBetween(localDateKey(last.createdAt, TIMEZONE), localDateKey(now, TIMEZONE));
    if (days <= STALE_BUSINESS_DAYS) continue;
    const sent = await prisma.notification.count({ where: { userId: c.accountManagerId!, type: EXTRACTION_STALE, entityId: c.id, createdAt: { gt: last.createdAt } } });
    if (sent) continue;
    await prisma.notification.create({
      data: {
        userId: c.accountManagerId!,
        type: EXTRACTION_STALE,
        title: `לא הגיע חילוץ ל-${c.name} כבר ${days} ימי עבודה`.slice(0, 200),
        body: "ההצעה האחרונה לתיק הלקוח הגיעה לפני יותר משלושה ימי עבודה. כדאי לבדוק שהחילוץ היומי רץ, ושהפגישות של הלקוח משויכות אליו לפי הדומיינים.",
        entityType: "Knowledge",
        entityId: c.id,
      },
    });
    notified++;
  }
  return { notified };
}
