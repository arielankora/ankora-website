import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listClients } from "@/lib/app-domain/clients";
import { getBillingPolicy } from "@/lib/app-domain/billing";
import { listHourBanksForClient, getCurrentHourBank, getPrepaidForecast } from "@/lib/app-domain/hour-banks";
import type { PrepaidForecast } from "@/lib/app-domain/hour-banks";
import { TIMEZONE } from "@/lib/timezone";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Drawer } from "@/components/app/Drawer";
import { HbClientPicker } from "./HbClientPicker";
import { BillingPolicyForm } from "./BillingPolicyForm";
import { OpenCycleForm } from "./OpenCycleForm";
import { LoadPackageForm } from "./LoadPackageForm";
import { AdjustmentForm } from "./AdjustmentForm";
import { bankFigures, formatDecimalHours, packageFigures } from "@/lib/hours-format";

export const metadata = { robots: { index: false, follow: false } };

const STATUS_LABEL: Record<string, { key: "open" | "closed" | "recalculated"; tone: "green" | "amber" | "gray" }> = {
  OPEN: { key: "open", tone: "green" },
  CLOSED: { key: "closed", tone: "gray" },
  RECALCULATED: { key: "recalculated", tone: "amber" },
};

// Figures on this screen are decimal hours (lib/hours-format.ts). Each one is
// wrapped in <bdi dir="ltr">: the minus sign of an overdrawn balance stays on
// the left, while the block itself keeps the page's RTL alignment and sits
// under its label. dir="ltr" on the block, as before, pushed the number to
// the far side of its column, away from the label above it.
function Hours({ children }: { children: ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}

// Spec 12 admin screens table: "Hour Banks - current/historical cycles,
// adjustments, utilization." Super-Admin only (hour_bank.manage) - spec
// 4's role table lists banks under Super Admin's row alone.
export default async function HourBanksPage(props: { searchParams: Promise<{ clientId?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const t = await getTranslations("hourBanks");
  const format = await getFormatter();
  // ADR 0006: in the reader's language. A bank's start and end are Israeli
  // days (dayStartInZone), so they are written in Israel time wherever the
  // reader is: a reader abroad would otherwise see the day before.
  const formatDate = (date: Date) => format.dateTime(date, { dateStyle: "medium", timeZone: TIMEZONE });
  // describeForecast (lib/prepaid-format.ts) words the same forecast for
  // the client portal and stays Hebrew; this is the screen's own wording.
  const describe = (forecast: PrepaidForecast | null): string | null => {
    if (!forecast) return null;
    switch (forecast.status) {
      case "depleted":
        return t("forecast.depleted");
      case "insufficient_data":
        return t("forecast.insufficientData");
      case "projected":
        return t("forecast.projected", {
          weekly: formatDecimalHours(forecast.weeklyMinutes),
          date: format.dateTime(forecast.depletionDate, { dateStyle: "medium" }),
        });
    }
  };
  const hours = (chunks: ReactNode) => <Hours>{chunks}</Hours>;

  if (!can(user.role, "hour_bank.manage")) {
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

  const [policy, banks, current] = clientId
    ? await Promise.all([getBillingPolicy(clientId), listHourBanksForClient(clientId), getCurrentHourBank(clientId)])
    : [null, [], null];
  const isPrepaid = current?.bank.kind === "PREPAID";
  const forecastText = describe(await getPrepaidForecast(current));
  // A prepaid package's tiles are its size, how much of it is gone and what
  // is left: the same arithmetic as its percentage (packageFigures).
  const currentFigures = current
    ? isPrepaid
      ? packageFigures(current.bank.purchasedMinutes, current.utilization.remainingMinutes)
      : bankFigures(current.utilization.totalMinutes, current.utilization.consumedMinutes)
    : null;

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-app-text-primary">{t("page.title")}</h1>
          <p className="mt-1 text-sm text-app-text-secondary">
            {t("page.subtitle")}
          </p>
        </div>

        <HbClientPicker clients={activeClients.map((c) => ({ id: c.id, name: c.name }))} current={clientId} />

        {!clientId && (
          <div className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-tertiary">
            {t("page.pickClientPrompt")}
          </div>
        )}

        {clientId && !selectedClient && (
          <div className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-tertiary">
            {t("page.clientNotFound")}
          </div>
        )}

        {selectedClient && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h2 dir="auto" className="text-sm font-medium text-app-text-primary">{selectedClient.name}</h2>
              <span className="flex-1" />
              <Drawer triggerLabel={t("page.loadPackage")} title={t("page.loadPackageTitle", { client: selectedClient.name })}>
                <LoadPackageForm clientId={selectedClient.id} />
              </Drawer>
              {!isPrepaid && (
                <Drawer triggerLabel={t("page.openCycle")} title={t("page.openCycleTitle", { client: selectedClient.name })}>
                  <OpenCycleForm clientId={selectedClient.id} />
                </Drawer>
              )}
            </div>

            {/* App redesign (handoff README, screen 10 "בנק שעות"): the
                prototype's 3-card row - current cycle (dark `ink` hero,
                matching the Timer widget/Home KPI treatment), billing policy,
                manual adjustment. "פתיחת מחזור חדש" moved from an always-open
                form into the header button + drawer above, matching the
                prototype's placement (a button beside the client tabs, not a
                permanently-visible card). */}
            <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
              {current && currentFigures ? (
                <div className="rounded-[18px] bg-navy p-6 text-cream-warm">
                  <div className="flex items-baseline justify-between gap-2.5">
                    <span className="text-xs text-cream-warm/60">{isPrepaid ? t("page.currentPackage") : t("page.currentCycle")}</span>
                    <span
                      className={`font-jbmono text-[40px] font-medium leading-none ${
                        current.utilization.utilizationPct > 100 ? "text-app-error" : "text-cream-warm"
                      }`}
                      dir="ltr"
                    >
                      {current.utilization.utilizationPct}%
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-cream-warm/15">
                    <span
                      className={`block h-full rounded-full ${
                        current.utilization.utilizationPct > 100 ? "bg-app-error" : "bg-gold-gradient"
                      }`}
                      style={{ width: `${Math.min(100, current.utilization.utilizationPct)}%` }}
                    />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <div>
                      <span className="block text-[11px] text-cream-warm/50">{isPrepaid ? t("page.packageSize") : t("page.total")}</span>
                      <span className="mt-1 block font-jbmono text-[16px]">
                        <Hours>{currentFigures.total}</Hours>
                      </span>
                    </div>
                    <div>
                      <span className="block text-[11px] text-cream-warm/50">{t("page.consumed")}</span>
                      <span className="mt-1 block font-jbmono text-[16px]">
                        <Hours>{currentFigures.consumed}</Hours>
                      </span>
                    </div>
                    <div>
                      <span className="block text-[11px] text-cream-warm/50">{t("page.remaining")}</span>
                      <span
                        className={`mt-1 block font-jbmono text-[16px] ${
                          currentFigures.overdrawn ? "text-app-error" : "text-cream-warm"
                        }`}
                      >
                        <Hours>{currentFigures.remaining}</Hours>
                      </span>
                    </div>
                  </div>
                  {isPrepaid && (
                    <div className="mt-4 space-y-1 border-t border-cream-warm/10 pt-3 text-[12px] leading-relaxed text-cream-warm/75">
                      <p>
                        {t.rich("page.loaded", {
                          h: hours,
                          hours: formatDecimalHours(current.bank.purchasedMinutes),
                          date: formatDate(current.bank.cycleStart),
                        })}
                        {current.bank.rolloverInMinutes !== 0 &&
                          t.rich(current.bank.rolloverInMinutes < 0 ? "page.rolloverMinus" : "page.rolloverPlus", {
                            h: hours,
                            hours: formatDecimalHours(Math.abs(current.bank.rolloverInMinutes)),
                          })}
                        {t("page.loadedEnd", { date: formatDate(current.bank.cycleEnd) })}
                      </p>
                      {forecastText && <p>{forecastText}</p>}
                    </div>
                  )}
                  <p className="mt-4 border-t border-cream-warm/10 pt-3 text-[11px] leading-relaxed text-cream-warm/45">
                    {t("page.decimalNote")}
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-app-border bg-white p-6 text-center text-sm text-app-text-tertiary">
                  {t("page.noBank")}
                </div>
              )}

              <div className="rounded-2xl border border-app-border bg-white p-5">
                <p className="mb-1 text-sm font-medium text-app-text-primary">{t("page.policyTitle")}</p>
                <p className="mb-3 text-[11px] text-app-text-tertiary">
                  {t("page.policyNote")}
                </p>
                <BillingPolicyForm
                  clientId={selectedClient.id}
                  policy={
                    policy && {
                      minimumMinutes: policy.minimumMinutes,
                      incrementMinutes: policy.incrementMinutes,
                      roundingMode: policy.roundingMode,
                      aggregationScope: policy.aggregationScope,
                    }
                  }
                />
              </div>

              <div className="rounded-2xl border border-app-border bg-white p-5">
                <p className="mb-3 text-sm font-medium text-app-text-primary">{t("page.adjustmentTitle")}</p>
                <AdjustmentForm clientId={selectedClient.id} currentHourBankId={current?.bank.id} />
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-app-border bg-white">
              <table className="w-full min-w-[900px] text-start text-sm">
                <thead>
                  <tr className="border-b border-app-border text-xs text-app-text-tertiary">
                    <th className="px-5 py-3 font-medium">{t("table.period")}</th>
                    <th className="px-5 py-3 font-medium">{t("table.status")}</th>
                    <th className="px-5 py-3 font-medium">{t("table.purchased")}</th>
                    <th className="px-5 py-3 font-medium">{t("table.rolloverIn")}</th>
                    <th className="px-5 py-3 font-medium">{t("table.consumed")}</th>
                    <th className="px-5 py-3 font-medium">{t("table.remaining")}</th>
                    <th className="px-5 py-3 font-medium">{t("table.utilization")}</th>
                    <th className="px-5 py-3 font-medium">{t("table.adjustments")}</th>
                  </tr>
                </thead>
                <tbody>
                  {banks.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-5 py-8 text-center text-app-text-tertiary">
                        {t("table.empty")}
                      </td>
                    </tr>
                  )}
                  {banks.map(({ bank, utilization }) => {
                    const status = STATUS_LABEL[bank.status] ?? STATUS_LABEL.OPEN;
                    const figures = bankFigures(utilization.totalMinutes, utilization.consumedMinutes);
                    return (
                      <tr key={bank.id} className="border-b border-app-border align-top last:border-0">
                        <td className="px-5 py-3 text-app-text-primary">
                          <span className="block text-[11px] text-app-text-tertiary">{bank.kind === "PREPAID" ? t("table.kindPackage") : t("table.kindCycle")}</span>
                          {t("table.range", { start: formatDate(bank.cycleStart), end: formatDate(bank.cycleEnd) })}
                        </td>
                        <td className="px-5 py-3">
                          <StatusBadge label={t(`status.${status.key}`)} tone={status.tone} />
                          {bank.recalculatedAt && (
                            <p className="mt-1 text-[11px] text-app-text-tertiary">{t("table.recalculatedAt", { date: format.dateTime(bank.recalculatedAt, { dateStyle: "medium" }) })}</p>
                          )}
                        </td>
                        <td className="px-5 py-3 font-jbmono text-app-text-secondary">
                          <Hours>{formatDecimalHours(bank.purchasedMinutes)}</Hours>
                        </td>
                        <td
                          className={`px-5 py-3 font-jbmono ${bank.rolloverInMinutes < 0 ? "text-app-error" : "text-app-text-secondary"}`}
                        >
                          <Hours>{formatDecimalHours(bank.rolloverInMinutes)}</Hours>
                        </td>
                        <td className="px-5 py-3 font-jbmono text-app-text-secondary">
                          <Hours>{figures.consumed}</Hours>
                        </td>
                        {/* **קריטי ל-RTL** (handoff README): a signed number
                            needs an LTR context or the minus renders on the
                            wrong side. <Hours> gives it one without moving
                            the figure away from its column header. */}
                        <td
                          className={`px-5 py-3 font-jbmono ${figures.overdrawn ? "text-app-error" : "text-app-text-secondary"}`}
                        >
                          <Hours>{figures.remaining}</Hours>
                        </td>
                        <td className={`px-5 py-3 ${utilization.utilizationPct > 100 ? "text-app-error" : "text-app-text-secondary"}`}>
                          {utilization.utilizationPct}%
                        </td>
                        <td className="px-5 py-3 text-app-text-secondary">
                          {bank.adjustments.length === 0 ? (
                            <span className="text-app-text-tertiary">-</span>
                          ) : (
                            <ul className="space-y-1">
                              {bank.adjustments.map((a) => (
                                <li key={a.id} className="text-xs">
                                  <bdi dir="ltr" className={`font-jbmono ${a.minutes < 0 ? "text-app-error" : "text-app-success"}`}>
                                    {a.minutes > 0 ? "+" : ""}
                                    {formatDecimalHours(a.minutes)}
                                  </bdi>{" "}
                                  <span className="text-app-text-tertiary">
                                    - <bdi dir="auto">{a.reason}</bdi>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
