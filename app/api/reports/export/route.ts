import { NextRequest } from "next/server";
import { requireUserOrThrow, UnauthorizedError } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { runReport, REPORT_DEFINITIONS, type ReportType } from "@/lib/app-domain/reports";
import { getClient } from "@/lib/app-domain/clients";
import { toCsv } from "@/lib/csv";
import type { TimeEntrySource } from "@prisma/client";

// Spec 14.4: "CSV חובה... Export מופק server-side עם אותן הרשאות כמו
// המסך. שם הקובץ כולל client/report/date. עברית חייבת להישאר קריאה, כולל
// UTF-8 BOM ב-CSV אם נדרש ל-Excel." XLSX/PDF are marked "מומלץ"
// (recommended), not mandatory, in the same spec line - deferred, see the
// ADR addendum for Phase 5.
//
// "אותן הרשאות כמו המסך" (same permissions as the screen) is why this
// route re-runs the exact same runReport() the /app/reports page calls -
// one function, one permission check (report.internal.view), used by
// both - rather than a parallel query path that could silently drift from
// what the on-screen table shows.

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00`);
  return isNaN(d.getTime()) ? undefined : d;
}

function isReportType(value: string | null): value is ReportType {
  return REPORT_DEFINITIONS.some((r) => r.id === value);
}

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUserOrThrow();
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  const params = req.nextUrl.searchParams;
  const type = params.get("type");
  if (!isReportType(type)) {
    return Response.json({ error: "Invalid or missing report type" }, { status: 400 });
  }

  const filters = {
    clientId: params.get("clientId") || undefined,
    userId: params.get("userId") || undefined,
    categoryId: params.get("categoryId") || undefined,
    source: (params.get("source") as TimeEntrySource | null) || undefined,
    editedOnly: params.get("editedOnly") === "1",
    manualOnly: params.get("manualOnly") === "1",
    from: parseDate(params.get("from")),
    to: parseDate(params.get("to")),
  };

  let result;
  try {
    result = await runReport(user, type, filters);
  } catch (err) {
    if (err instanceof ForbiddenError) return Response.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  // toCsv (lib/csv.ts) owns escaping + the UTF-8 BOM Excel needs for
  // Hebrew (spec 14.4, explicit) - shared, unit-tested, dependency-free.
  const csv = toCsv(
    result.columns.map((c) => c.label),
    result.rows.map((row) => result.columns.map((c) => row[c.key] ?? ""))
  );

  const dateStr = new Date().toISOString().slice(0, 10);
  const clientSlug = filters.clientId ? (await getClient(filters.clientId))?.name ?? filters.clientId : "all-clients";
  const filename = `${type}_${clientSlug}_${dateStr}.csv`.replace(/[^\w.\-֐-׿]+/g, "-");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
