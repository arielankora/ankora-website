import { NextRequest } from "next/server";
import { requireUserOrThrow, UnauthorizedError } from "@/lib/app-auth/session";
import { assertCan, ForbiddenError } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { toCsv } from "@/lib/csv";
import { auditSearchWhere } from "@/app/(product)/app/(authenticated)/audit-log/labels";

// App redesign (handoff README, screen 14 "יומן פעולות"): "חיפוש + סינון
// סוג פעולה + ייצוא." Same query shape (entityType/q filter) as the
// on-screen table in page.tsx, and the same additive export-route pattern
// as app/api/time-entries/export/route.ts and app/api/reports/export/
// route.ts - gated on the identical audit.view permission the screen
// itself requires, with no page limit (an export is meant to capture the
// full filtered set, not one page of it).
export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUserOrThrow();
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  try {
    assertCan(user.role, "audit.view");
  } catch (err) {
    if (err instanceof ForbiddenError) return Response.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  const params = req.nextUrl.searchParams;
  const entityType = params.get("entityType") || undefined;
  const q = params.get("q")?.trim() || undefined;

  const events = await prisma.auditEvent.findMany({
    where: {
      ...(entityType ? { entityType } : {}),
      // The same search as the screen, so the file holds what was shown.
      ...(q ? auditSearchWhere(q) : {}),
    },
    include: { actor: true, client: true },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  const csv = toCsv(
    ["מועד", "פעולה", "בוצע ע\"י", "ישות", "מזהה ישות", "לקוח"],
    events.map((e) => [
      e.createdAt.toISOString(),
      e.action,
      e.actor?.name ?? "מערכת",
      e.entityType,
      e.entityId ?? "",
      e.client?.name ?? "",
    ])
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log.csv"`,
    },
  });
}
