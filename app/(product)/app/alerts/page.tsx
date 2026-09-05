import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listClients } from "@/lib/app-domain/clients";
import { listAlertRulesForClient } from "@/lib/app-domain/alerts";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { AlertsClientPicker } from "./AlertsClientPicker";
import { AlertRuleForm } from "./AlertRuleForm";
import { RuleActions } from "./RuleActions";
import { RetryDeliveryButton } from "./RetryDeliveryButton";

export const metadata = { robots: { index: false, follow: false } };

const THRESHOLD_LABEL: Record<string, string> = {
  UTILIZATION_PCT: "אחוז ניצול",
  REMAINING_MINUTES: "דקות שנותרו",
  CONSUMED_MINUTES: "דקות שנוצלו",
  OVERAGE: "חריגה",
};

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(
    date
  );
}

// Spec 9/9.1/9.2, 12's admin screens table: "Alerts - rule setup, event
// history, delivery status." Super-Admin only (alert.manage - ADR 11.2).
export default async function AlertsPage({ searchParams }: { searchParams: { clientId?: string } }) {
  const user = await requireUser();

  if (!can(user.role, "alert.manage")) {
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

  const rules = clientId && selectedClient ? await listAlertRulesForClient(clientId) : [];

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-navy">התראות</h1>
          <p className="mt-1 text-sm text-navy/60">
            כללי התראה על ניצול בנק שעות, היסטוריית אירועים וסטטוס שליחת מיילים (ספירה 9).
          </p>
        </div>

        <AlertsClientPicker clients={activeClients.map((c) => ({ id: c.id, name: c.name }))} current={clientId} />

        {!clientId && (
          <div className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-navy/50">
            בחרו לקוח כדי לצפות בכללי ההתראה שלו וליצור כלל חדש.
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
              <h2 className="text-sm font-medium text-navy">כלל התראה חדש - {selectedClient.name}</h2>
              <div className="mt-3">
                <AlertRuleForm clientId={selectedClient.id} />
              </div>
            </div>

            <div className="space-y-4">
              {rules.length === 0 && (
                <div className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-navy/50">
                  עדיין אין כללי התראה ללקוח זה.
                </div>
              )}

              {rules.map((rule) => (
                <div key={rule.id} className="overflow-hidden rounded-2xl border border-lineDark bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-lineDark px-5 py-4">
                    <div className="flex items-center gap-3">
                      <StatusBadge label={rule.enabled ? "פעיל" : "מושבת"} tone={rule.enabled ? "green" : "gray"} />
                      <span className="text-sm font-medium text-navy">
                        {THRESHOLD_LABEL[rule.type] ?? rule.type} &ge; {rule.thresholdValue}
                      </span>
                      {rule.allowRetrigger && (
                        <span className="text-[11px] text-navy/40">(התראה חוזרת מופעלת)</span>
                      )}
                    </div>
                    <RuleActions ruleId={rule.id} enabled={rule.enabled} />
                  </div>

                  <div className="grid grid-cols-1 gap-3 px-5 py-4 text-xs text-navy/60 sm:grid-cols-2">
                    <div>
                      <span className="font-medium text-navy/70">נמענים Ankora: </span>
                      {rule.recipientsAnkora.length ? rule.recipientsAnkora.join(", ") : <span className="text-navy/30">-</span>}
                    </div>
                    <div>
                      <span className="font-medium text-navy/70">נמענים לקוח: </span>
                      {rule.recipientsClient.length ? rule.recipientsClient.join(", ") : <span className="text-navy/30">-</span>}
                    </div>
                  </div>

                  {rule.events.length > 0 && (
                    <div className="border-t border-lineDark px-5 py-4">
                      <p className="mb-2 text-xs font-medium text-navy/50">אירועים אחרונים</p>
                      <ul className="space-y-2">
                        {rule.events.map((event) => (
                          <li key={event.id} className="rounded-lg bg-navy/[0.03] px-3 py-2 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-navy/70">
                                {formatDateTime(event.triggeredAt)} - ערך {event.value}
                              </span>
                              <StatusBadge
                                label={event.resolvedAt ? "נפתר" : "פעיל"}
                                tone={event.resolvedAt ? "gray" : "amber"}
                              />
                            </div>
                            {event.emailDeliveries.length > 0 && (
                              <ul className="mt-2 space-y-1">
                                {event.emailDeliveries.map((d) => (
                                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-navy/50">
                                    <span>
                                      {d.template === "ankora_internal" ? "Ankora" : "לקוח"} - {d.recipients.join(", ")}
                                    </span>
                                    <span className="flex items-center gap-2">
                                      <StatusBadge label={d.status === "SENT" ? "נשלח" : "נכשל"} tone={d.status === "SENT" ? "green" : "red"} />
                                      {d.status === "FAILED" && <RetryDeliveryButton deliveryId={d.id} />}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
