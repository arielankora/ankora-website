import { NextResponse } from "next/server";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getMonthlyDetailed } from "@/lib/app-domain/client-portal";
import { monthlyDetailedToCsv } from "@/lib/app-domain/report-schedules";

// Spec 14.4: "CSV חובה... Export מופק server-side עם אותן הרשאות כמו
// המסך" — this route reuses getMonthlyDetailed's own resolvePortalClient
// scoping, so a client user can only ever export their own client's data.
export async function GET(request: Request) {
  const user = await requireUser();

  const { searchParams } = new URL(request.url);
  const monthOffset = Number(searchParams.get("monthOffset") || 0);
  const referenceDate = new Date();
  referenceDate.setUTCMonth(referenceDate.getUTCMonth() + monthOffset);

  try {
    const report = await getMonthlyDetailed(user, referenceDate);
    const csv = monthlyDetailedToCsv(report.rows);
    const filename = `report-${referenceDate.getUTCFullYear()}-${String(referenceDate.getUTCMonth() + 1).padStart(2, "0")}.csv`;

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
