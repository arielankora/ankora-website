import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listClients } from "@/lib/app-domain/clients";
import { listReportSchedulesForClient } from "@/lib/app-domain/report-schedules";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ClientPicker } from "./ClientPicker";
import { ScheduleForm } from "./ScheduleForm";
import { ScheduleActions } from "./ScheduleActions";


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
// 19.10.2026: the body of the old /app/report-schedules screen, now the
// "מתוזמנים" tab of /app/reports (see ../reports/page.tsx).
export async function ReportSchedulesView({ searchParams }: { searchParams: { clientId?: string } }) {
  const user = await requireUser();

  if (!can(user.role, "report.internal.view")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const clients = await listClients();
  const activeClients = clients.filter((c) => c.status !== "ARCHIVED");
  const clientId = searchParams.clientId || "";
  const selectedClient = clientId ? activeClients.find((c) => c.id === clientId) : undefined;

  const schedules = clientId && selectedClient ? await listReportSchedulesForClient(user, clientId) : [];

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-app-text-primary">דוחות מתוזמנים</h1>
          <p className="mt-1 text-sm text-app-text-secondary">
            שליחת דוחות אוטומטית ללקוח או ל-Ankora לפי תדירות קבועה (ספירה 15).
          </p>
        </div>

        <ClientPicker clients={activeClients.map((c) => ({ id: c.id, name: c.name }))} current={clientId} />

        {!clientId && (
          <div className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-tertiary">
            בחרו לקוח כדי לצפות בדוחות המתוזמנים שלו וליצור דוח חדש.
          </div>
        )}

        {clientId && !selectedClient && (
          <div className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-tertiary">
            הלקוח לא נמצא או שהוא בארכיון.
          </div>
        )}

        {selectedClient && (
          <>
            <div>
              <h2 className="text-sm font-medium text-app-text-primary">דוח מתוזמן חדש - {selectedClient.name}</h2>
              <div className="mt-3">
                <ScheduleForm clientId={selectedClient.id} />
              </div>
            </div>

            <div className="space-y-4">
              {schedules.length === 0 && (
                <div className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-tertiary">
                  עדיין אין דוחות מתוזמנים ללקוח זה.
                </div>
              )}

              {schedules.map((schedule) => (
                <div key={schedule.id} className="overflow-hidden rounded-2xl border border-app-border bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-border px-5 py-4">
                    <div className="flex items-center gap-3">
                      <StatusBadge label={schedule.enabled ? "פעיל" : "מושבת"} tone={schedule.enabled ? "green" : "gray"} />
                      <span className="text-sm font-medium text-app-text-primary">
                        {REPORT_TYPE_LABEL[schedule.reportType]} · {describeCadence(schedule)}
                      </span>
                    </div>
                    <ScheduleActions scheduleId={schedule.id} enabled={schedule.enabled} />
                  </div>

                  <div className="grid grid-cols-1 gap-3 px-5 py-4 text-xs text-app-text-secondary sm:grid-cols-3">
                    <div>
                      <span className="font-medium text-app-text-secondary">נמענים: </span>
                      {schedule.recipients.join(", ") || "אין"}
                    </div>
                    <div>
                      <span className="font-medium text-app-text-secondary">נשלח לאחרונה: </span>
                      {formatDateTime(schedule.lastSentAt)}
                    </div>
                    <div>
                      <span className="font-medium text-app-text-secondary">שליחות תקופתיות: </span>
                      {schedule.runs.length}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
