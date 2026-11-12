import { NextRequest } from "next/server";
import { requireUserOrThrow, UnauthorizedError } from "@/lib/app-auth/session";
import { assertCan, ForbiddenError } from "@/lib/app-auth/permissions";
import { listTimeEntriesForAdmin } from "@/lib/app-domain/time-entries";
import { getClient } from "@/lib/app-domain/clients";
import { toCsv } from "@/lib/csv";
import { attachmentDisposition } from "@/lib/http-headers";
import { formatDuration, sourceKey } from "@/lib/time-entry-format";
import { outgoingOf } from "@/lib/i18n/recipients";
import { dayEndInZone, dayStartInZone } from "@/lib/timezone";

// Same additive `?format=` pattern as app/api/reports/export/route.ts
// (docs/adr/0001 section 17/18.14): csv stays the default for every
// existing/future caller, xlsx/pdf are opt-in and dynamically imported so
// their heavy dependency trees are only paid for by the relevant request.
type ExportFormat = "csv" | "xlsx" | "pdf";
function parseFormat(value: string | null): ExportFormat {
  return value === "xlsx" || value === "pdf" ? value : "csv";
}

function parseDate(value: string | null): Date | undefined {
  // Israel's midnight, not the server's (UTC on Vercel). See dayStartInZone.
  return dayStartInZone(value);
}

// Overnight bug-hunt (docs/adr/0001 section 19.5): "to" must mean
// end-of-day, not midnight - same fix as page.tsx's parseDateEndOfDay and
// the reports export route, or the export would silently drop the whole
// last day of the selected range relative to what the on-screen table
// shows for the same filters.
function parseDateEndOfDay(value: string | null): Date | undefined {
  return dayEndInZone(value);
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

  // ADR 0006, part C: in the language and time zone of whoever asked for
  // it. Names, categories and notes are what people wrote, as written.
  const out = outgoingOf(user);
  const t = out.t;
  const when = new Intl.DateTimeFormat(out.tag, { dateStyle: "short", timeStyle: "short", timeZone: out.timeZone });
  const headers = [
    t("exports.timeEntries.date"),
    t("exports.timeEntries.employee"),
    t("exports.timeEntries.client"),
    t("exports.timeEntries.category"),
    t("exports.timeEntries.duration"),
    t("exports.timeEntries.note"),
    t("exports.timeEntries.source"),
    t("exports.timeEntries.edited"),
  ];
  const rows = entries.map((e) => {
    const source = sourceKey(e.source);
    return [
      when.format(e.startAt),
      e.user.name,
      e.client.name,
      e.category.name,
      e.actualSeconds === null ? t("exports.timeEntries.running") : formatDuration(e.actualSeconds),
      e.note ?? "",
      source ? t(`exports.timeEntries.sources.${source}`) : e.source,
      e.isEdited ? t("exports.yes") : "",
    ];
  });

  const dateStr = new Date().toISOString().slice(0, 10);
  const clientSlug = clientId ? (await getClient(clientId))?.name ?? clientId : "all-clients";

  const format = parseFormat(params.get("format"));

  if (format === "xlsx") {
    // Dynamic import - see ADR 0001 section 18.14: exceljs is only loaded
    // for xlsx requests, same reasoning as app/api/reports/export/route.ts.
    const { toXlsx } = await import("@/lib/xlsx");
    const buf = await toXlsx(t("exports.timeEntries.title"), headers, rows, out.dir);
    const filename = `time-entries_${clientSlug}_${dateStr}.xlsx`;
    return new Response(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": attachmentDisposition(filename),
      },
    });
  }

  if (format === "pdf") {
    // Dynamic import - see ADR 0001 section 18.14: pdfkit + fontkit are
    // only loaded for pdf requests.
    const { toPdfTable } = await import("@/lib/pdf");
    // The requester's time zone, not the server's (UTC on Vercel, which
    // showed an Israeli midnight as the day before until 12.11.2026).
    const day = (d: Date) => d.toLocaleDateString(out.tag, { timeZone: out.timeZone });
    const rangeParts = [filters.from ? day(filters.from) : null, filters.to ? day(filters.to) : null].filter(Boolean);
    const buf = await toPdfTable({
      title: t("exports.timeEntries.title"),
      subtitle: rangeParts.length ? rangeParts.join(" - ") : undefined,
      headers,
      rows,
      dir: out.dir,
      emptyText: t("exports.noData"),
    });
    const filename = `time-entries_${clientSlug}_${dateStr}.pdf`;
    return new Response(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": attachmentDisposition(filename),
      },
    });
  }

  // toCsv (lib/csv.ts) - shared, unit-tested, dependency-free; prepends
  // the UTF-8 BOM Excel needs for Hebrew (spec 14.4).
  const csv = toCsv(headers, rows);
  const filename = `time-entries_${clientSlug}_${dateStr}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachmentDisposition(filename),
    },
  });
}
