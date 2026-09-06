import { NextResponse } from "next/server";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getMonthlyDetailed } from "@/lib/app-domain/client-portal";
import { monthlyDetailedToCsv } from "@/lib/app-domain/report-schedules";

// Phase 9 gap-fix (docs/adr/0001 section 17): same `?format=` addition as
// app/api/reports/export/route.ts - CSV stays the unchanged default.
type ExportFormat = "csv" | "xlsx" | "pdf";
function parseFormat(value: string | null): ExportFormat {
  return value === "xlsx" || value === "pdf" ? value : "csv";
}

// Spec 14.4: "CSV חובה... Export מופק server-side עם אותן הרשאות כמו
// המסך" — this route reuses getMonthlyDetailed's own resolvePortalClient
// scoping, so a client user can only ever export their own client's data.
export async function GET(request: Request) {
  const user = await requireUser();

  const { searchParams } = new URL(request.url);
  const monthOffset = Number(searchParams.get("monthOffset") || 0);
  const format = parseFormat(searchParams.get("format"));
  const referenceDate = new Date();
  referenceDate.setUTCMonth(referenceDate.getUTCMonth() + monthOffset);

  try {
    const report = await getMonthlyDetailed(user, referenceDate);
    const period = `report-${referenceDate.getUTCFullYear()}-${String(referenceDate.getUTCMonth() + 1).padStart(2, "0")}`;
    const showEmployee = report.rows.some((r) => r.employee !== undefined);
    const headers = showEmployee
      ? ["תאריך", "פעילות", "קטגוריה", "דקות לחיוב", "עובד"]
      : ["תאריך", "פעילות", "קטגוריה", "דקות לחיוב"];
    const rows = report.rows.map((r) =>
      showEmployee
        ? [r.date, r.activity, r.category, r.billableMinutes, r.employee ?? ""]
        : [r.date, r.activity, r.category, r.billableMinutes]
    );

    if (format === "xlsx") {
      // Dynamic import - see ADR 0001 section 18.14.
      const { toXlsx } = await import("@/lib/xlsx");
      const buf = await toXlsx("דוח חודשי מפורט", headers, rows);
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${period}.xlsx"`,
        },
      });
    }

    if (format === "pdf") {
      // Dynamic import - see ADR 0001 section 18.14.
      const { toPdfTable } = await import("@/lib/pdf");
      const buf = await toPdfTable({
        title: "דוח חודשי מפורט",
        subtitle: referenceDate.toLocaleDateString("he-IL", { year: "numeric", month: "long" }),
        headers,
        rows,
      });
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${period}.pdf"`,
        },
      });
    }

    const csv = monthlyDetailedToCsv(report.rows);
    const filename = `${period}.csv`;

    // toCsv() (lib/app-domain/report-schedules.ts -> lib/csv.ts) already
    // prepends the UTF-8 BOM Excel needs for Hebrew (spec 14.4) - do not
    // add a second one here (that was a bug caught before this shipped;
    // see the Phase 5 app/api/reports/export/route.ts precedent, which
    // passes its csv string through unmodified for the same reason).
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }
}
