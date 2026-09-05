import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listClients } from "@/lib/app-domain/clients";
import { getBillingPolicy } from "@/lib/app-domain/billing";
import { listHourBanksForClient, getCurrentHourBank } from "@/lib/app-domain/hour-banks";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
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
export default async function HourBanksPage({ searchParams }: { searchParams: { clientId?: string } }) {
  const user = await requireUser();

  if (!can(user.role, "hour_bank.manage")) {
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

  const [policy, banks, current] = clientId
    ? await Promise.all([getBillingPolicy(clientId), listHourBanksForClient(clientId), getCurrentHourBank(clientId)])
    : [null, [], null];

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-navy">בנק שעות</h1>
          <p className="mt-1 text-sm text-navy/60">מדיניות חיוב, מחזורים והתאמות ידניות לכל לקוח (ספירה 8).</p>
        </div>

        <HbClientPicker clients={activeClients.map((c) => ({ id: c.id, name: c.name }))} current={clientId} />

        {!clientId && (
          <div className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-navy/50">
            בחרו לקוח כדי לצפות במדיניות החיוב ובבנק השעות שלו.
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
              <h2 className="text-sm font-medium text-navy">מדיניות חיוב - {selectedClient.name}</h2>
              <p className="mt-1 text-xs text-navy/40">
                ללא מדיניות מוגדרת, הזמן החייב זהה תמיד לזמן בפועל (ברירת מחדל נייטרלית).
              </p>
              <div className="mt-3">
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
            </div>

            {current && (
              <div className="rounded-2xl border border-lineDark bg-white p-6">
                <h2 className="text-sm font-medium text-navy">מחזור נוכחי</h2>
                <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-navy/40">סה"כ זמין</p>
                    <p className="mt-1 text-lg font-medium text-navy">{formatMinutes(current.utilization.totalMinutes)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-navy/40">נוצל</p>
                    <p className="mt-1 text-lg font-medium text-navy">{formatMinutes(current.utilization.consumedMinutes)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-navy/40">נותר</p>
                    <p className={`mt-1 text-lg font-medium ${current.utilization.remainingMinutes < 0 ? "text-red-600" : "text-navy"}`}>
                      {formatMinutes(current.utilization.remainingMinutes)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-navy/40">ניצול</p>
                    <p className={`mt-1 text-lg font-medium ${current.utilization.utilizationPct > 100 ? "text-red-600" : "text-navy"}`}>
                      {current.utilization.utilizationPct}%
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <h2 className="text-sm font-medium text-navy">פתיחת מחזור חדש</h2>
              <div className="mt-3">
                <OpenCycleForm clientId={selectedClient.id} />
              </div>
            </div>

            <div>
              <h2 className="text-sm font-medium text-navy">התאמה ידנית למחזור הנוכחי</h2>
              <div className="mt-3">
                <AdjustmentForm clientId={selectedClient.id} currentHourBankId={current?.bank.id} />
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-lineDark bg-white">
              <table className="w-full min-w-[900px] text-start text-sm">
                <thead>
                  <tr className="border-b border-lineDark text-xs text-navy/50">
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
                      <td colSpan={8} className="px-5 py-8 text-center text-navy/50">
                        עדיין אין מחזורי בנק שעות ללקוח זה. פתחו מחזור ראשון למעלה.
                      </td>
                    </tr>
                  )}
                  {banks.map(({ bank, utilization }) => {
                    const status = STATUS_LABEL[bank.status] ?? STATUS_LABEL.OPEN;
                    return (
                      <tr key={bank.id} className="border-b border-lineDark align-top last:border-0">
                        <td className="px-5 py-3 text-navy/80">
                          {formatDate(bank.cycleStart)} - {formatDate(bank.cycleEnd)}
                        </td>
                        <td className="px-5 py-3">
                          <StatusBadge label={status.label} tone={status.tone} />
                          {bank.recalculatedAt && (
                            <p className="mt-1 text-[11px] text-navy/40">חושב מחדש: {formatDate(bank.recalculatedAt)}</p>
                          )}
                        </td>
                        <td className="px-5 py-3 text-navy/70">{formatMinutes(bank.purchasedMinutes)}</td>
                        <td className="px-5 py-3 text-navy/70">{formatMinutes(bank.rolloverInMinutes)}</td>
                        <td className="px-5 py-3 text-navy/70">{formatMinutes(utilization.consumedMinutes)}</td>
                        <td className={`px-5 py-3 ${utilization.remainingMinutes < 0 ? "text-red-600" : "text-navy/70"}`}>
                          {formatMinutes(utilization.remainingMinutes)}
                        </td>
                        <td className={`px-5 py-3 ${utilization.utilizationPct > 100 ? "text-red-600" : "text-navy/70"}`}>
                          {utilization.utilizationPct}%
                        </td>
                        <td className="px-5 py-3 text-navy/70">
                          {bank.adjustments.length === 0 ? (
                            <span className="text-navy/30">-</span>
                          ) : (
                            <ul className="space-y-1">
                              {bank.adjustments.map((a) => (
                                <li key={a.id} className="text-xs">
                                  <span className={a.minutes < 0 ? "text-red-600" : "text-emerald-700"}>
                                    {a.minutes > 0 ? "+" : ""}
                                    {formatMinutes(a.minutes)}
                                  </span>{" "}
                                  <span className="text-navy/40">- {a.reason}</span>
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
    </AppShell>
  );
}
