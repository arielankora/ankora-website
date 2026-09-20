import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listClients } from "@/lib/app-domain/clients";
import { listAlertRulesForClient, listOpenAlertEvents } from "@/lib/app-domain/alerts";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { AlertsClientPicker } from "./AlertsClientPicker";
import { AlertRuleForm } from "./AlertRuleForm";
import { RuleActions } from "./RuleActions";
import { RetryDeliveryButton } from "./RetryDeliveryButton";
import { OpenAlertsPanel, type OpenAlertRow } from "./OpenAlertsPanel";

export const metadata = { robots: { index: false, follow: false } };

const THRESHOLD_LABEL: Record<string, string> = {
  UTILIZATION_PCT: "אחוז ניצול",
  REMAINING_MINUTES: "דקות שנותרו",
  CONSUMED_MINUTES: "דקות שנוצלו",
  OVERAGE: "חריגה",
};

// Spelled out in words rather than with a >=/<= symbol: a comparison
// symbol embedded directly in RTL Hebrew text gets visually mirrored by
// the browser's bidi algorithm (>= renders as <= on screen even though
// the underlying character is unchanged), which would show the opposite
// of the real breach condition from lib/app-domain/alerts.ts's
// isThresholdBreached(). REMAINING_MINUTES breaches at-or-below the
// threshold; every other type breaches at-or-above it.
function describeThreshold(type: string, thresholdValue: number): string {
  const label = THRESHOLD_LABEL[type] ?? type;
  if (type === "REMAINING_MINUTES") {
    return `${label}: ${thresholdValue} או פחות`;
  }
  return `${label}: ${thresholdValue} או יותר`;
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(
    date
  );
}

// App redesign (handoff README, screen 13): the prototype's open-alert
// cards show a relative "לפני 12 דקות" timestamp rather than an absolute
// one - this is the one screen where that reads more like an operational
// feed than a record, so it gets its own formatter instead of
// formatDateTime above.
function formatAgo(date: Date): string {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "הרגע";
  if (minutes < 60) return `לפני ${minutes} דקות`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.round(hours / 24);
  return `לפני ${days} ימים`;
}

// Spec 9/9.1/9.2, 12's admin screens table: "Alerts - rule setup, event
// history, delivery status." Super-Admin only (alert.manage - ADR 11.2).
export default async function AlertsPage(props: { searchParams: Promise<{ clientId?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();

  if (!can(user.role, "alert.manage")) {
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

  const [rules, openEvents] = await Promise.all([
    clientId && selectedClient ? listAlertRulesForClient(clientId) : Promise.resolve([]),
    listOpenAlertEvents(),
  ]);

  const openAlertRows: OpenAlertRow[] = openEvents.map((e) => ({
    id: e.id,
    clientId: e.rule.clientId,
    clientName: e.rule.client.name,
    description: describeThreshold(e.rule.type, e.rule.thresholdValue),
    triggeredAgo: formatAgo(e.triggeredAt),
  }));

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-appNavy">התראות</h1>
          <p className="mt-1 text-sm text-appNavy/60">
            כללי התראה על ניצול בנק שעות, היסטוריית אירועים וסטטוס שליחת מיילים (ספירה 9).
          </p>
        </div>

        <OpenAlertsPanel alerts={openAlertRows} />

        <AlertsClientPicker clients={activeClients.map((c) => ({ id: c.id, name: c.name }))} current={clientId} />

        {!clientId && (
          <div className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-appNavy/50">
            בחרו לקוח כדי לצפות בכללי ההתראה שלו וליצור כלל חדש.
          </div>
        )}

        {clientId && !selectedClient && (
          <div className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-appNavy/50">
            הלקוח לא נמצא או שהוא בארכיון.
          </div>
        )}

        {selectedClient && (
          <>
            <div>
              <h2 className="text-sm font-medium text-appNavy">כלל התראה חדש - {selectedClient.name}</h2>
              <div className="mt-3">
                <AlertRuleForm clientId={selectedClient.id} />
              </div>
            </div>

            <div className="space-y-4">
              {rules.length === 0 && (
                <div className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-appNavy/50">
                  עדיין אין כללי התראה ללקוח זה.
                </div>
              )}

              {rules.map((rule) => (
                <div key={rule.id} className="overflow-hidden rounded-2xl border border-lineDark bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-lineDark px-5 py-4">
                    <div className="flex items-center gap-3">
                      <StatusBadge label={rule.enabled ? "פעיל" : "מושבת"} tone={rule.enabled ? "green" : "gray"} />
                      <span className="text-sm font-medium text-appNavy">
                        {describeThreshold(rule.type, rule.thresholdValue)}
                      </span>
                      {rule.allowRetrigger && (
                        <span className="text-[11px] text-appNavy/40">(התראה חוזרת מופעלת)</span>
                      )}
                    </div>
                    <RuleActions ruleId={rule.id} enabled={rule.enabled} />
                  </div>

                  <div className="grid grid-cols-1 gap-3 px-5 py-4 text-xs text-appNavy/60 sm:grid-cols-2">
                    <div>
                      <span className="font-medium text-appNavy/70">נמענים Ankora: </span>
                      {rule.recipientsAnkora.length ? rule.recipientsAnkora.join(", ") : <span className="text-appNavy/30">-</span>}
                    </div>
                    <div>
                      <span className="font-medium text-appNavy/70">נמענים לקוח: </span>
                      {rule.recipientsClient.length ? rule.recipientsClient.join(", ") : <span className="text-appNavy/30">-</span>}
                    </div>
                  </div>

                  {rule.events.length > 0 && (
                    <div className="border-t border-lineDark px-5 py-4">
                      <p className="mb-2 text-xs font-medium text-appNavy/50">אירועים אחרונים</p>
                      <ul className="space-y-2">
                        {rule.events.map((event) => (
                          <li key={event.id} className="rounded-lg bg-appNavy/[0.03] px-3 py-2 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-appNavy/70">
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
                                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-appNavy/50">
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
    </>
  );
}
