import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listClients } from "@/lib/app-domain/clients";
import { listReportSchedulesForClient } from "@/lib/app-domain/report-schedules";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ClientPicker } from "./ClientPicker";
import { ScheduleForm } from "./ScheduleForm";
import { ScheduleActions } from "./ScheduleActions";

export const metadata = { robots: { index: false, follow: false } };

const REPORT_TYPE_LABEL: Record<string, string> = {
  MONTHLY_DETAILED: "דוח חודשי מפורט",
  WEEKLY_ACTIVITY: "פעילות שבועית",
  HOURS_BY_CATEGORY: "סיכום קטגוריות",
  HOUR_BANK_STATUS: "סטטוס בנק שעות",
};

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function describeCadence(schedule: { frequency: string; dayOfWeek: number | null; dayOfMonth: number | null }): string {
  if (schedule.frequency === "WEEKLY") return `שבועי - ${WEEKDAYS[schedule.dayOfWeek ?? 0]}`;
  return `חודשי - ה-${schedule.dayOfMonth ?? 1} לחודש`;
}

function formatDateTime(date: Date | null) {
  if (!date) return "טרם נשלח";
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(
    date
  );
}

// Spec 15 ("דוחות מתוזמנים במייל") + spec 12's admin screens table listing
// "Reports - internal and client reports, schedule/send/export." Gated on
// report.internal.view, same as /app/reports - see permissions.ts's Phase
// 5/6 comments for why scheduling stays bundled with that permission
// rather than a separate one the spec never names.
export default async function ReportSchedulesPage({ searchParams }: { searchParams: { clientId?: string } }) {
  const user = await requireUser();

  if (!can(user.role, "report.internal.view")) {
    return (
      <AppShell user={user}>
        <Forbidden />
      </AppShell>
    );
  }

  const clients = await listClients();
  const activeClients = clients.filter((c) => c.status !== "ARCHIVED");
  const clientId = searchParams.clientId || "";
  const selectedClient = clientId ? activeClients.find((c) => c.id === clientId) : undefined;

  const schedules = clientId && selectedClient ? await listReportSchedulesForClient(user, clientId) : [];

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-navy">דוחות מתוזמנים</h1>
          <p className="mt-1 text-sm text-navy/60">
            שליחת דוחות אוטומטית ללקוח או ל-Ankora לפי תדירות קבועה (ספירה 15).
          </p>
        </div>

        <ClientPicker clients={activeClients.map((c) => ({ id: c.id, name: c.name }))} current={clientId} />

        {!clientId && (
          <div className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-navy/50">
            בחרו לקוח כדי לצפות בדוחות המתוזמנים שלו וליצור דוח חדש.
          </div>
        )}

        {clientId && !selectedClient && (
          <div className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-navy/50">
            הלקוח לא נמצא או שהוא בארכיון.
          </div>
        )}

        {selectedClient && (
          <>
            <div>
              <h2 className="text-sm font-medium text-navy">דוח מתוזמן חדש - {selectedClient.name}</h2>
              <div className="mt-3">
                <ScheduleForm clientId={selectedClient.id} />
              </div>
            </div>

            <div className="space-y-4">
              {schedules.length === 0 && (
                <div className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-navy/50">
                  עדיין אין דוחות מתוזמנים ללקוח זה.
                </div>
              )}

              {schedules.map((schedule) => (
                <div key={schedule.id} className="overflow-hidden rounded-2xl border border-lineDark bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-lineDark px-5 py-4">
                    <div className="flex items-center gap-3">
                      <StatusBadge label={schedule.enabled ? "פעיל" : "מושבת"} tone={schedule.enabled ? "green" : "gray"} />
                      <span className="text-sm font-medium text-navy">
                        {REPORT_TYPE_LABEL[schedule.reportType]} · {describeCadence(schedule)}
                      </span>
                    </div>
                    <ScheduleActions scheduleId={schedule.id} enabled={schedule.enabled} />
                  </div>

                  <div className="grid grid-cols-1 gap-3 px-5 py-4 text-xs text-navy/60 sm:grid-cols-3">
                    <div>
                      <span className="font-medium text-navy/70">נמענים: </span>
                      {schedule.recipients.join(", ") || "אין"}
                    </div>
                    <div>
                      <span className="font-medium text-navy/70">נשלח לאחרונה: </span>
                      {formatDateTime(schedule.lastSentAt)}
                    </div>
                    <div>
                      <span className="font-medium text-navy/70">שליחות תקופתיות: </span>
                      {schedule.runs.length}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
