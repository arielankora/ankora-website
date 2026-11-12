import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listClients } from "@/lib/app-domain/clients";
import { countEnabledRulesByClient, listAlertRulesForClient, listOpenAlertEvents } from "@/lib/app-domain/alerts";
import { isAutoClose } from "@/lib/app-domain/alert-closure";
import type { AlertCloseKind } from "@prisma/client";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { AlertsClientPicker } from "./AlertsClientPicker";
import { AlertRuleForm } from "./AlertRuleForm";
import { RuleActions } from "./RuleActions";
import { RetryDeliveryButton } from "./RetryDeliveryButton";
import { OpenAlertsPanel, type OpenAlertRow } from "./OpenAlertsPanel";

export const metadata = { robots: { index: false, follow: false } };

// App redesign (handoff README, screen 13): the prototype's open-alert
// cards show a relative "לפני 12 דקות" timestamp rather than an absolute
// one - this is the one screen where that reads more like an operational
// feed than a record, so it gets its own formatter instead of
// formatDateTime above.
type Ago = { key: "justNow" } | { key: "minutes" | "hours" | "days"; count: number };

function agoOf(date: Date): Ago {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return { key: "justNow" };
  if (minutes < 60) return { key: "minutes", count: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { key: "hours", count: hours };
  return { key: "days", count: Math.round(hours / 24) };
}

// ADR 0006: describeThreshold (lib/app-domain/alerts.ts) keeps its Hebrew
// for the home screen and emails; this screen says it with its own keys.
const THRESHOLD_KEY = {
  UTILIZATION_PCT: "utilizationPct",
  REMAINING_MINUTES: "remainingMinutes",
  CONSUMED_MINUTES: "consumedMinutes",
  OVERAGE: "overage",
} as const;

// closeReason is stored as Hebrew text (alert-closure.ts's CLOSE_REASON);
// the screen words it from closeKind instead, and falls back to the
// stored text for anything it does not know.
const CLOSE_REASON_KEY: Partial<Record<AlertCloseKind, "newCycle" | "hoursLoaded" | "belowThreshold">> = {
  NEW_CYCLE: "newCycle",
  HOURS_LOADED: "hoursLoaded",
  BELOW_THRESHOLD: "belowThreshold",
};

// Spec 9/9.1/9.2, 12's admin screens table: "Alerts - rule setup, event
// history, delivery status." Super-Admin only (alert.manage - ADR 11.2).
export default async function AlertsPage(props: { searchParams: Promise<{ clientId?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const t = await getTranslations("alerts");
  const format = await getFormatter();
  const formatDateTime = (date: Date) => format.dateTime(date, { dateStyle: "medium", timeStyle: "short" });
  const formatAgo = (date: Date) => {
    const ago = agoOf(date);
    return ago.key === "justNow" ? t("ago.justNow") : t(`ago.${ago.key}`, { count: ago.count });
  };
  const describeThreshold = (type: string, thresholdValue: number) => {
    const key = THRESHOLD_KEY[type as keyof typeof THRESHOLD_KEY];
    return key ? t(`threshold.${key}`, { value: String(thresholdValue) }) : `${type}: ${thresholdValue}`;
  };
  const closeReasonText = (kind: AlertCloseKind | null, stored: string | null) => {
    const key = kind ? CLOSE_REASON_KEY[kind] : undefined;
    if (key) return t(`closeReason.${key}`);
    const pct = kind === "SUPERSEDED" ? stored?.match(/(\d+)%/)?.[1] : undefined;
    if (pct) return t("closeReason.superseded", { pct });
    return stored;
  };

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

  const [rules, openEvents, rulesByClient] = await Promise.all([
    clientId && selectedClient ? listAlertRulesForClient(clientId) : Promise.resolve([]),
    listOpenAlertEvents(),
    countEnabledRulesByClient(),
  ]);

  // Counted over the clients this screen lists, so the sentence and the
  // overview below can never disagree.
  const watchedClients = activeClients.filter((c) => (rulesByClient.get(c.id) ?? 0) > 0);
  const ruleCount = watchedClients.reduce((sum, c) => sum + (rulesByClient.get(c.id) ?? 0), 0);
  const emptyText =
    ruleCount === 0
      ? t("page.emptyNoRules")
      : t("page.emptyWithRules", { rules: ruleCount, clients: watchedClients.length });

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
          <h1 className="text-xl font-medium text-app-text-primary">{t("page.title")}</h1>
          <p className="mt-1 text-sm text-app-text-secondary">{t("page.subtitle")}</p>
        </div>

        <OpenAlertsPanel alerts={openAlertRows} emptyText={emptyText} />

        <AlertsClientPicker clients={activeClients.map((c) => ({ id: c.id, name: c.name }))} current={clientId} />

        {/* 9.10.2026: an overview instead of an empty box. Which clients
            are watched, by how many rules, and one click into each. A
            client without rules is marked, because that is the one place
            a breach would go unseen. */}
        {!clientId && activeClients.length > 0 && (
          <div className="rounded-2xl border border-app-border bg-white p-5">
            <h2 className="text-sm font-medium text-app-text-secondary">{t("page.byClientTitle")}</h2>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {activeClients.map((c) => {
                const n = rulesByClient.get(c.id) ?? 0;
                return (
                  <Link
                    key={c.id}
                    href={`/app/alerts?clientId=${c.id}`}
                    className="rounded-full border border-app-border bg-white px-2.5 py-1 text-[11.5px] text-app-text-secondary transition-colors hover:border-gold"
                  >
                    <bdi dir="auto">{c.name}</bdi> ·{" "}
                    {n > 0 ? <span className="font-jbmono">{n}</span> : <span className="text-app-warning">{t("page.noRules")}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {clientId && !selectedClient && (
          <div className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-tertiary">
            {t("page.clientNotFound")}
          </div>
        )}

        {selectedClient && (
          <>
            <div>
              <h2 className="text-sm font-medium text-app-text-primary">{t("page.newRuleTitle", { client: selectedClient.name })}</h2>
              <div className="mt-3">
                <AlertRuleForm clientId={selectedClient.id} />
              </div>
            </div>

            <div className="space-y-4">
              {rules.length === 0 && (
                <div className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-tertiary">
                  {t("page.noClientRules")}
                </div>
              )}

              {rules.map((rule) => (
                <div key={rule.id} className="overflow-hidden rounded-2xl border border-app-border bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-border px-5 py-4">
                    <div className="flex items-center gap-3">
                      <StatusBadge label={rule.enabled ? t("page.active") : t("page.disabled")} tone={rule.enabled ? "green" : "gray"} />
                      <span className="text-sm font-medium text-app-text-primary">
                        {describeThreshold(rule.type, rule.thresholdValue)}
                      </span>
                      {rule.allowRetrigger && (
                        <span className="text-[11px] text-app-text-tertiary">{t("page.retriggerOn")}</span>
                      )}
                    </div>
                    <RuleActions ruleId={rule.id} enabled={rule.enabled} />
                  </div>

                  <div className="grid grid-cols-1 gap-3 px-5 py-4 text-xs text-app-text-secondary sm:grid-cols-2">
                    <div>
                      <span className="font-medium text-app-text-secondary">{t("page.recipientsAnkora")} </span>
                      {rule.recipientsAnkora.length || rule.notifyAccountManager ? (
                        [...rule.recipientsAnkora, ...(rule.notifyAccountManager ? [t("page.accountManager")] : [])].join(", ")
                      ) : (
                        <span className="text-app-text-tertiary">-</span>
                      )}
                    </div>
                    <div>
                      <span className="font-medium text-app-text-secondary">{t("page.recipientsClient")} </span>
                      {rule.recipientsClient.length ? rule.recipientsClient.join(", ") : <span className="text-app-text-tertiary">-</span>}
                    </div>
                  </div>

                  {rule.events.length > 0 && (
                    <div className="border-t border-app-border px-5 py-4">
                      <p className="mb-2 text-xs font-medium text-app-text-tertiary">{t("page.recentEvents")}</p>
                      <ul className="space-y-2">
                        {rule.events.map((event) => (
                          <li key={event.id} className="rounded-lg bg-app-surface-sunken px-3 py-2 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-app-text-secondary">
                                {t("page.eventValue", { date: formatDateTime(event.triggeredAt), value: String(event.value) })}
                              </span>
                              <StatusBadge
                                label={event.resolvedAt ? (isAutoClose(event.closeKind) ? t("page.autoClosed") : t("page.resolved")) : t("page.open")}
                                tone={event.resolvedAt ? "gray" : "amber"}
                              />
                            </div>
                            {event.resolvedAt && isAutoClose(event.closeKind) && (
                              <p className="mt-1 text-[11px] text-app-text-tertiary">
                                {closeReasonText(event.closeKind, event.closeReason)} · {formatDateTime(event.resolvedAt)}
                              </p>
                            )}
                            {event.emailDeliveries.length > 0 && (
                              <ul className="mt-2 space-y-1">
                                {event.emailDeliveries.map((d) => (
                                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-app-text-tertiary">
                                    <span>
                                      {t("page.deliveryLine", {
                                        audience: d.template === "ankora_internal" ? t("page.deliveryAnkora") : t("page.deliveryClient"),
                                        recipients: d.recipients.join(", "),
                                      })}
                                    </span>
                                    <span className="flex items-center gap-2">
                                      <StatusBadge label={d.status === "SENT" ? t("page.sent") : t("page.failed")} tone={d.status === "SENT" ? "green" : "red"} />
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
