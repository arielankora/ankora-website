import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listClients } from "@/lib/app-domain/clients";
import { listReportSchedulesForClient } from "@/lib/app-domain/report-schedules";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ClientPicker } from "./ClientPicker";
import { ScheduleForm } from "./ScheduleForm";
import { ScheduleActions } from "./ScheduleActions";
import { REPORT_TYPE_KEY, WEEKDAY_KEYS } from "./labels";
import { getFormatter, getTranslations } from "next-intl/server";

// Spec 15 ("דוחות מתוזמנים במייל") + spec 12's admin screens table listing
// "Reports - internal and client reports, schedule/send/export." Gated on
// report.internal.view, same as /app/reports - see permissions.ts's Phase
// 5/6 comments for why scheduling stays bundled with that permission
// rather than a separate one the spec never names.
// 19.10.2026: the body of the old /app/report-schedules screen, now the
// "מתוזמנים" tab of /app/reports (see ../reports/page.tsx).
export async function ReportSchedulesView({ searchParams }: { searchParams: { clientId?: string } }) {
  const user = await requireUser();
  const t = await getTranslations("reportSchedules");
  const format = await getFormatter();

  // ADR 0006: in the reader's language. The email itself keeps its own
  // Hebrew labels (lib/app-domain/report-schedules.ts).
  const describeCadence = (schedule: { frequency: string; dayOfWeek: number | null; dayOfMonth: number | null }): string => {
    if (schedule.frequency === "WEEKLY") return t("view.weekly", { day: t(`weekdays.${WEEKDAY_KEYS[schedule.dayOfWeek ?? 0] ?? "sunday"}`) });
    return t("view.monthly", { day: String(schedule.dayOfMonth ?? 1) });
  };
  const formatDateTime = (date: Date | null) =>
    date ? format.dateTime(date, { dateStyle: "medium", timeStyle: "short" }) : t("view.notSentYet");
  const reportTypeLabel = (type: string) => {
    const key = REPORT_TYPE_KEY[type as keyof typeof REPORT_TYPE_KEY];
    return key ? t(`types.${key}`) : type;
  };

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
          <h1 className="text-xl font-medium text-app-text-primary">{t("view.title")}</h1>
          <p className="mt-1 text-sm text-app-text-secondary">{t("view.subtitle")}</p>
        </div>

        <ClientPicker clients={activeClients.map((c) => ({ id: c.id, name: c.name }))} current={clientId} />

        {!clientId && (
          <div className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-tertiary">
            {t("view.pickClientPrompt")}
          </div>
        )}

        {clientId && !selectedClient && (
          <div className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-tertiary">
            {t("view.clientNotFound")}
          </div>
        )}

        {selectedClient && (
          <>
            <div>
              <h2 className="text-sm font-medium text-app-text-primary">
                {t("view.newTitle", { client: selectedClient.name })}
              </h2>
              <div className="mt-3">
                <ScheduleForm clientId={selectedClient.id} />
              </div>
            </div>

            <div className="space-y-4">
              {schedules.length === 0 && (
                <div className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-tertiary">
                  {t("view.empty")}
                </div>
              )}

              {schedules.map((schedule) => (
                <div key={schedule.id} className="overflow-hidden rounded-2xl border border-app-border bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-border px-5 py-4">
                    <div className="flex items-center gap-3">
                      <StatusBadge label={schedule.enabled ? t("view.active") : t("view.disabled")} tone={schedule.enabled ? "green" : "gray"} />
                      <span className="text-sm font-medium text-app-text-primary">
                        {reportTypeLabel(schedule.reportType)} · {describeCadence(schedule)}
                      </span>
                    </div>
                    <ScheduleActions scheduleId={schedule.id} enabled={schedule.enabled} />
                  </div>

                  <div className="grid grid-cols-1 gap-3 px-5 py-4 text-xs text-app-text-secondary sm:grid-cols-3">
                    <div>
                      <span className="font-medium text-app-text-secondary">{t("view.recipients")} </span>
                      {schedule.recipients.length ? <bdi dir="ltr">{schedule.recipients.join(", ")}</bdi> : t("view.none")}
                    </div>
                    <div>
                      <span className="font-medium text-app-text-secondary">{t("view.lastSent")} </span>
                      {formatDateTime(schedule.lastSentAt)}
                    </div>
                    <div>
                      <span className="font-medium text-app-text-secondary">{t("view.runs")} </span>
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
