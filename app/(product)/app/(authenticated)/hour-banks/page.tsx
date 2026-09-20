import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listClients } from "@/lib/app-domain/clients";
import { getBillingPolicy } from "@/lib/app-domain/billing";
import { listHourBanksForClient, getCurrentHourBank } from "@/lib/app-domain/hour-banks";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Drawer } from "@/components/app/Drawer";
import { HbClientPicker } from "./HbClientPicker";
import { BillingPolicyForm } from "./BillingPolicyForm";
import { OpenCycleForm } from "./OpenCycleForm";
import { AdjustmentForm } from "./AdjustmentForm";

export const metadata = { robots: { index: false, follow: false } };

const STATUS_LABEL: Record<string, { label: string; tone: "green" | "amber" | "gray" }> = {
  OPEN: { label: "פתוח", tone: "green" },
  CLOSED: { label: "סגור", tone: "gray" },
  RECALCULATED: { label: "חושב מחדש", tone: "amber" },
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeZone: "Asia/Jerusalem" }).format(date);
}

function formatMinutes(minutes: number) {
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  const sign = minutes < 0 ? "-" : "";
  return `${sign}${h}:${String(m).padStart(2, "0")}`;
}

// Spec 12 admin screens table: "Hour Banks - current/historical cycles,
// adjustments, utilization." Super-Admin only (hour_bank.manage) - spec
// 4's role table lists banks under Super Admin's row alone.
export default async function HourBanksPage(props: { searchParams: Promise<{ clientId?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();

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

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-appNavy">בנק שעות</h1>
          <p className="mt-1 text-sm text-appNavy/60">מדיניות חיוב, מחזורים והתאמות ידניות לכל לקוח (ספירה 8).</p>
        </div>

        <HbClientPicker clients={activeClients.map((c) => ({ id: c.id, name: c.name }))} current={clientId} />

        {!clientId && (
          <div className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-appNavy/50">
            בחרו לקוח כדי לצפות במדיניות החיוב ובבנק השעות שלו.
          </div>
        )}

        {clientId && !selectedClient && (
          <div className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-appNavy/50">
            הלקוח לא נמצא או שהוא בארכיון.
          </div>
        )}

        {selectedClient && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-medium text-appNavy">{selectedClient.name}</h2>
              <span className="flex-1" />
              <Drawer triggerLabel="פתיחת מחזור חדש" title={`פתיחת מחזור חדש - ${selectedClient.name}`}>
                <OpenCycleForm clientId={selectedClient.id} />
              </Drawer>
            </div>

            {/* App redesign (handoff README, screen 10 "בנק שעות"): the
                prototype's 3-card row - current cycle (dark `ink` hero,
                matching the Timer widget/Home KPI treatment), billing policy,
                manual adjustment. "פתיחת מחזור חדש" moved from an always-open
                form into the header button + drawer above, matching the
                prototype's placement (a button beside the client tabs, not a
                permanently-visible card). */}
            <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
              {current ? (
                <div className="rounded-[18px] bg-navy p-6 text-cream-warm">
                  <div className="flex items-baseline justify-between gap-2.5">
                    <span className="text-xs text-cream-warm/60">מחזור נוכחי</span>
                    <span
                      className={`font-jbmono text-[40px] font-medium leading-none ${
                        current.utilization.utilizationPct > 100 ? "text-error" : "text-cream-warm"
                      }`}
                      dir="ltr"
                    >
                      {current.utilization.utilizationPct}%
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-cream-warm/15">
                    <span
                      className={`block h-full rounded-full ${
                        current.utilization.utilizationPct > 100 ? "bg-error" : "bg-gold-gradient"
                      }`}
                      style={{ width: `${Math.min(100, current.utilization.utilizationPct)}%` }}
                    />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <span>
                      <span className="block text-[11px] text-cream-warm/50">סה&quot;כ</span>
                      <span className="mt-1 block font-jbmono text-[16px]" dir="ltr">
                        {formatMinutes(current.utilization.totalMinutes)}
                      </span>
                    </span>
                    <span>
                      <span className="block text-[11px] text-cream-warm/50">נוצל</span>
                      <span className="mt-1 block font-jbmono text-[16px]" dir="ltr">
                        {formatMinutes(current.utilization.consumedMinutes)}
                      </span>
                    </span>
                    <span>
                      <span className="block text-[11px] text-cream-warm/50">נותר</span>
                      <span
                        className={`mt-1 block font-jbmono text-[16px] ${
                          current.utilization.remainingMinutes < 0 ? "text-error" : "text-cream-warm"
                        }`}
                        dir="ltr"
                      >
                        {formatMinutes(current.utilization.remainingMinutes)}
                      </span>
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-lineDark bg-white p-6 text-center text-sm text-appNavy/50">
                  אין עדיין מחזור פתוח ללקוח זה. פתחו מחזור למעלה.
                </div>
              )}

              <div className="rounded-2xl border border-lineDark bg-white p-5">
                <p className="mb-1 text-sm font-medium text-appNavy">מדיניות חיוב</p>
                <p className="mb-3 text-[11px] text-appNavy/40">
                  ללא מדיניות מוגדרת, הזמן החייב זהה תמיד לזמן בפועל.
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

              <div className="rounded-2xl border border-lineDark bg-white p-5">
                <p className="mb-3 text-sm font-medium text-appNavy">התאמה ידנית</p>
                <AdjustmentForm clientId={selectedClient.id} currentHourBankId={current?.bank.id} />
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-lineDark bg-white">
              <table className="w-full min-w-[900px] text-start text-sm">
                <thead>
                  <tr className="border-b border-lineDark text-xs text-appNavy/50">
                    <th className="px-5 py-3 font-medium">מחזור</th>
                    <th className="px-5 py-3 font-medium">סטטוס</th>
                    <th className="px-5 py-3 font-medium">נרכש</th>
                    <th className="px-5 py-3 font-medium">Rollover</th>
                    <th className="px-5 py-3 font-medium">נוצל</th>
                    <th className="px-5 py-3 font-medium">נותר</th>
                    <th className="px-5 py-3 font-medium">ניצול</th>
                    <th className="px-5 py-3 font-medium">התאמות</th>
                  </tr>
                </thead>
                <tbody>
                  {banks.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-5 py-8 text-center text-appNavy/50">
                        עדיין אין מחזורי בנק שעות ללקוח זה. פתחו מחזור ראשון למעלה.
                      </td>
                    </tr>
                  )}
                  {banks.map(({ bank, utilization }) => {
                    const status = STATUS_LABEL[bank.status] ?? STATUS_LABEL.OPEN;
                    return (
                      <tr key={bank.id} className="border-b border-lineDark align-top last:border-0">
                        <td className="px-5 py-3 text-appNavy/80">
                          {formatDate(bank.cycleStart)} - {formatDate(bank.cycleEnd)}
                        </td>
                        <td className="px-5 py-3">
                          <StatusBadge label={status.label} tone={status.tone} />
                          {bank.recalculatedAt && (
                            <p className="mt-1 text-[11px] text-appNavy/40">חושב מחדש: {formatDate(bank.recalculatedAt)}</p>
                          )}
                        </td>
                        <td className="px-5 py-3 text-appNavy/70">{formatMinutes(bank.purchasedMinutes)}</td>
                        <td className="px-5 py-3 text-appNavy/70">{formatMinutes(bank.rolloverInMinutes)}</td>
                        <td className="px-5 py-3 text-appNavy/70">{formatMinutes(utilization.consumedMinutes)}</td>
                        {/* **קריטי ל-RTL** (handoff README): a signed number
                            (remaining minutes, adjustment amount) needs
                            dir="ltr" or the +/- renders on the wrong side. */}
                        <td
                          dir="ltr"
                          className={`px-5 py-3 text-end font-jbmono ${
                            utilization.remainingMinutes < 0 ? "text-error" : "text-appNavy/70"
                          }`}
                        >
                          {formatMinutes(utilization.remainingMinutes)}
                        </td>
                        <td className={`px-5 py-3 ${utilization.utilizationPct > 100 ? "text-error" : "text-appNavy/70"}`}>
                          {utilization.utilizationPct}%
                        </td>
                        <td className="px-5 py-3 text-appNavy/70">
                          {bank.adjustments.length === 0 ? (
                            <span className="text-appNavy/30">-</span>
                          ) : (
                            <ul className="space-y-1">
                              {bank.adjustments.map((a) => (
                                <li key={a.id} className="text-xs">
                                  <span dir="ltr" className={a.minutes < 0 ? "text-error" : "text-success"}>
                                    {a.minutes > 0 ? "+" : ""}
                                    {formatMinutes(a.minutes)}
                                  </span>{" "}
                                  <span className="text-appNavy/40">- {a.reason}</span>
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
