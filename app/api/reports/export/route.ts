import { NextRequest } from "next/server";
import { requireUserOrThrow, UnauthorizedError } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { runReport, REPORT_DEFINITIONS, type ReportType } from "@/lib/app-domain/reports";
import { getClient } from "@/lib/app-domain/clients";
import { toCsv } from "@/lib/csv";
import { localizedReportTable } from "@/lib/i18n/report-words";
import { outgoingOf } from "@/lib/i18n/recipients";
import { attachmentDisposition } from "@/lib/http-headers";
import type { TimeEntrySource } from "@prisma/client";
import { dayEndInZone, dayStartInZone } from "@/lib/timezone";

// Phase 9 gap-fix (docs/adr/0001 section 17): spec 14.4 marks XLSX/PDF as
// "מומלץ" (recommended, not mandatory) alongside the mandatory CSV - this
// was deferred at Phase 5 and is added here via a `?format=` query param
// so the mandatory CSV default (no format param) is unchanged for every
// existing caller/link.
type ExportFormat = "csv" | "xlsx" | "pdf";
function parseFormat(value: string | null): ExportFormat {
  return value === "xlsx" || value === "pdf" ? value : "csv";
}

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
  // Israel's midnight, not the server's. See dayStartInZone.
  return dayStartInZone(value);
}

// Overnight bug-hunt (docs/adr/0001 section 19.5): see the identical fix
// in app/(product)/app/reports/page.tsx - "to" must mean end-of-day, not
// midnight, or the export silently drops the entire last day of the
// selected range (same runReport() callees, same gte/lte bug).
function parseDateEndOfDay(value: string | null): Date | undefined {
  return dayEndInZone(value);
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
    to: parseDateEndOfDay(params.get("to")),
  };

  // ADR 0006, part C: the file is in the language of whoever asked for it,
  // headers, title, the words in the rows and the dates alike. The file
  // name stays as it was.
  const out = outgoingOf(user);

  let result;
  try {
    result = await runReport(user, type, filters, { locale: out.tag, timeZone: out.timeZone });
  } catch (err) {
    if (err instanceof ForbiddenError) return Response.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  const format = parseFormat(params.get("format"));
  const { headers, rows } = localizedReportTable(out, type, result.columns, result.rows);

  const dateStr = new Date().toISOString().slice(0, 10);
  const clientSlug = filters.clientId ? (await getClient(filters.clientId))?.name ?? filters.clientId : "all-clients";
  const reportLabel = localizedReportTable(out, type, [], []).title;

  if (format === "xlsx") {
    // Dynamic import: exceljs (~23MB with its archiver/unzipper/jszip/tmp
    // dependency tree) is only pulled into memory for xlsx requests, not
    // paid for by the mandatory CSV default or by pdf requests. See ADR
    // 0001 section 18.14 - a static top-of-file import made every request
    // to this route (including CSV) load both exceljs and pdfkit, which is
    // suspected to have caused the whole route to 503 under Vercel's
    // Node.js function cold-start.
    const { toXlsx } = await import("@/lib/xlsx");
    const buf = await toXlsx(reportLabel, headers, rows, out.dir);
    const filename = `${type}_${clientSlug}_${dateStr}.xlsx`;
    return new Response(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": attachmentDisposition(filename),
      },
    });
  }

  if (format === "pdf") {
    // Dynamic import - see the comment on the xlsx branch above (ADR 0001
    // section 18.14): pdfkit + fontkit are only loaded for pdf requests.
    const { toPdfTable } = await import("@/lib/pdf");
    // CSV and XLSX keep raw integer minutes for calculation (spec 21). A
    // PDF is only ever read, so it gets the same text as the screen: bank
    // figures in decimal hours, an overrun as "חריגה 0.35", durations as
    // H:MM. Before October 2026 it printed raw minutes ("1507", "-21").
    const pdfRows = localizedReportTable(out, type, result.columns, result.rows, { pdf: true }).rows;
    // The days in the requester's language and time zone. (Until 12.11.2026
    // they were written in the server's zone, which is UTC on Vercel, so an
    // Israeli midnight showed as the day before.)
    const day = (d: Date) => d.toLocaleDateString(out.tag, { timeZone: out.timeZone });
    const rangeParts = [filters.from ? day(filters.from) : null, filters.to ? day(filters.to) : null].filter(Boolean);
    const buf = await toPdfTable({
      title: reportLabel,
      subtitle: rangeParts.length ? rangeParts.join(" - ") : undefined,
      headers,
      rows: pdfRows,
      dir: out.dir,
      emptyText: out.t("exports.noData"),
    });
    const filename = `${type}_${clientSlug}_${dateStr}.pdf`;
    return new Response(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": attachmentDisposition(filename),
      },
    });
  }

  // toCsv (lib/csv.ts) owns escaping + the UTF-8 BOM Excel needs for
  // Hebrew (spec 14.4, explicit) - shared, unit-tested, dependency-free.
  const csv = toCsv(headers, rows);
  const filename = `${type}_${clientSlug}_${dateStr}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachmentDisposition(filename),
    },
  });
}
