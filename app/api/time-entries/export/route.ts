import { NextRequest } from "next/server";
import { requireUserOrThrow, UnauthorizedError } from "@/lib/app-auth/session";
import { assertCan, ForbiddenError } from "@/lib/app-auth/permissions";
import { listTimeEntriesForAdmin } from "@/lib/app-domain/time-entries";
import { getClient } from "@/lib/app-domain/clients";
import { toCsv } from "@/lib/csv";
import { formatDuration, formatSource } from "@/lib/time-entry-format";

// Same additive `?format=` pattern as app/api/reports/export/route.ts
// (docs/adr/0001 section 17/18.14): csv stays the default for every
// existing/future caller, xlsx/pdf are opt-in and dynamically imported so
// their heavy dependency trees are only paid for by the relevant request.
type ExportFormat = "csv" | "xlsx" | "pdf";
function parseFormat(value: string | null): ExportFormat {
  return value === "xlsx" || value === "pdf" ? value : "csv";
}

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00`);
  return isNaN(d.getTime()) ? undefined : d;
}

// Overnight bug-hunt (docs/adr/0001 section 19.5): "to" must mean
// end-of-day, not midnight - same fix as page.tsx's parseDateEndOfDay and
// the reports export route, or the export would silently drop the whole
// last day of the selected range relative to what the on-screen table
// shows for the same filters.
function parseDateEndOfDay(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T23:59:59.999`);
  return isNaN(d.getTime()) ? undefined : d;
}

// Ariel (2026-09-11): admin Time Entries screen needs a per-client,
// row-by-row export that includes the free-text note on each entry - the
// on-screen table (app/(product)/app/time-entries/page.tsx +
// AdminEntryRow.tsx) already shows it as of this same change; this route
// is the export half, gated by the identical time_entry.edit_others
// permission the screen itself requires ("אותן הרשאות כמו המסך" - spec
// 14.4 - carried over from the reports export convention even though this
// screen predates the Reports feature).
export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUserOrThrow();
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  try {
    assertCan(user.role, "time_entry.edit_others");
  } catch (err) {
    if (err instanceof ForbiddenError) return Response.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  const params = req.nextUrl.searchParams;
  const clientId = params.get("clientId") || undefined;
  const filters = {
    clientId,
    userId: params.get("userId") || undefined,
    from: parseDate(params.get("from")),
    to: parseDateEndOfDay(params.get("to")),
  };

  // listTimeEntriesForAdmin has no internal permission check (see
  // lib/app-domain/time-entries.ts) - the assertCan() call above is what
  // gates this route, matching the page.tsx screen's own can() check.
  const entries = await listTimeEntriesForAdmin(filters);

  const headers = ["תאריך", "עובד", "לקוח", "קטגוריה", "משך", "הערה", "מקור", "נערך"];
  const rows = entries.map((e) => [
    new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(
      e.startAt
    ),
    e.user.name,
    e.client.name,
    e.category.name,
    formatDuration(e.actualSeconds),
    e.note ?? "",
    formatSource(e.source),
    e.isEdited ? "כן" : "",
  ]);

  const dateStr = new Date().toISOString().slice(0, 10);
  const clientSlug = clientId ? (await getClient(clientId))?.name ?? clientId : "all-clients";

  const format = parseFormat(params.get("format"));

  if (format === "xlsx") {
    // Dynamic import - see ADR 0001 section 18.14: exceljs is only loaded
    // for xlsx requests, same reasoning as app/api/reports/export/route.ts.
    const { toXlsx } = await import("@/lib/xlsx");
    const buf = await toXlsx("דיווחי זמן", headers, rows);
    const filename = `time-entries_${clientSlug}_${dateStr}.xlsx`.replace(/[^\w.\-֐-׿]+/g, "-");
    return new Response(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  if (format === "pdf") {
    // Dynamic import - see ADR 0001 section 18.14: pdfkit + fontkit are
    // only loaded for pdf requests.
    const { toPdfTable } = await import("@/lib/pdf");
    const rangeParts = [
      filters.from ? filters.from.toLocaleDateString("he-IL") : null,
      filters.to ? filters.to.toLocaleDateString("he-IL") : null,
    ].filter(Boolean);
    const buf = await toPdfTable({
      title: "דיווחי זמן",
      subtitle: rangeParts.length ? rangeParts.join(" - ") : undefined,
      headers,
      rows,
    });
    const filename = `time-entries_${clientSlug}_${dateStr}.pdf`.replace(/[^\w.\-֐-׿]+/g, "-");
    return new Response(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // toCsv (lib/csv.ts) - shared, unit-tested, dependency-free; prepends
  // the UTF-8 BOM Excel needs for Hebrew (spec 14.4).
  const csv = toCsv(headers, rows);
  const filename = `time-entries_${clientSlug}_${dateStr}.csv`.replace(/[^\w.\-֐-׿]+/g, "-");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
