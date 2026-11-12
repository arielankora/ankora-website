import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { can, canManageClients } from "@/lib/app-auth/permissions";
import { engagementDeletesOn } from "@/lib/comms/engagement";
import { listClients, listArchivedClients } from "@/lib/app-domain/clients";
import { getCurrentHourBanksForClients, getPrepaidForecastsForClients, getRecentHourBanksForClients } from "@/lib/app-domain/hour-banks";
import { countApprovalsByClient } from "@/lib/app-domain/approvals";
import { countOpenTasksByClient } from "@/lib/app-domain/tasks";
import { assessClient, attentionRank, bankDisplay, LOW_REMAINING_SHARE, PACE_MIN_DAYS, PACKAGE_ENDING_DAYS, type ReasonCode } from "@/lib/client-attention";
import { formatDecimalHours } from "@/lib/hours-format";
import { Forbidden } from "@/components/app/Forbidden";
import { Drawer } from "@/components/app/Drawer";
import { CreateClientForm } from "./CreateClientForm";
import { ClientsGrid, type ClientCard, type HistoryBar } from "./ClientsGrid";
import { RestoreClientButton } from "./RestoreClientButton";
import { SubprocessorRecipientsPanel } from "./SubprocessorRecipientsPanel";
import { listSubprocessorRecipients } from "@/lib/app-domain/subprocessor-recipients";

export const metadata = { robots: { index: false, follow: false } };

// App redesign (handoff README, screen 5 "לקוחות"): "כרטיס לכל לקוח: שם,
// תג סטטוס, מנהל תיק, אחוז ניצול (אדום מעל 100%), פס התקדמות". There is
// no "portfolio manager" field anywhere in the domain (Client has no
// single-owner relation - UserClientAccess is a plain many-to-many), so
// the prototype's invented "מנהל תיק: X" line is replaced with the real
// number of employees assigned to the client (the same _count the old
// table already showed as "משתמשים מוקצים") - a real, honest number
// instead of fabricating a manager designation the schema doesn't have.
export default async function ClientsPage(props: { searchParams: Promise<{ q?: string | string[] }> }) {
  const user = await requireUser();
  // The search lives in the address bar (19.10.2026), so a client opened
  // from a narrowed list comes back to the same list. See ClientsGrid.
  const rawQ = (await props.searchParams).q;
  const initialQuery = typeof rawQ === "string" ? rawQ.slice(0, 200) : "";

  if (!can(user.role, "client.manage")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const canManageBanks = can(user.role, "hour_bank.manage");
  const canViewReports = can(user.role, "report.internal.view");
  const [clients, archived, noticeGroups] = await Promise.all([
    listClients(),
    listArchivedClients(user),
    // P8 step 8 (3.11.2026). The screen is client.manage only, as is this.
    listSubprocessorRecipients(user),
  ]);
  // 2.11.2026: an archived client's conversations and recordings are kept
  // 30 days for the export, then deleted. Managers export them from here.
  const manager = canManageClients(user.role);
  const t = await getTranslations("clients.list");
  const format = await getFormatter();
  const exportDeadline = (archivedAt: Date) => format.dateTime(engagementDeletesOn(archivedAt), { day: "numeric", month: "numeric" });

  // One batched lookup for the whole list.
  //
  // This was `await getCurrentHourBank(client.id)` inside the map, which
  // - because of the await - ran the per-client lookups one after
  // another rather than together. At six to nine round trips each, a
  // roster of a dozen clients meant the better part of a hundred
  // sequential queries before this screen rendered a single card.
  //
  // Archived clients are still skipped: their cycles are frozen and
  // irrelevant to a "current state" card, and leaving them out keeps the
  // query narrower.
  const liveIds = clients.filter((c) => c.status !== "ARCHIVED").map((c) => c.id);
  const now = new Date();
  const [snapshots, recent, openTasks, approvals] = await Promise.all([
    getCurrentHourBanksForClients(liveIds),
    getRecentHourBanksForClients(liveIds, 3, now),
    countOpenTasksByClient(liveIds),
    countApprovalsByClient(user).catch(() => new Map<string, number>()),
  ]);
  const forecasts = await getPrepaidForecastsForClients(
    [...snapshots.values()].map((s) => ({ clientId: s.bank.clientId, kind: s.bank.kind, remainingMinutes: s.utilization.remainingMinutes })),
    now,
  );

  // 3.11.2026 (Ariel): every client in one grid, the ones that need
  // attention first, each card with its hours "X of Y", why it needs
  // attention, and its last cycles. The rules: lib/client-attention.ts.
  const day = (d: Date, year = false) => format.dateTime(d, { day: "numeric", month: "numeric", ...(year ? { year: "numeric" } : {}) });
  const month = (d: Date) => format.dateTime(d, { month: "short" });
  const reasonText = (r: ReasonCode) => {
    const values: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(r.values)) values[k] = v instanceof Date ? day(v) : v;
    return t(`reasons.${r.key}`, values);
  };

  // Per client, what the figures at the top of the screen add up.
  const totals = new Map<string, { remaining: number; used: number; overran: boolean; ending: boolean }>();

  const cards: ClientCard[] = clients.map((client) => {
    const base = {
      id: client.id,
      name: client.name,
      status: client.status,
      employeeCount: client._count.employeeAccess,
      openTasks: openTasks.get(client.id) ?? 0,
      approvals: approvals.get(client.id) ?? 0,
    };
    const snap = snapshots.get(client.id);
    if (!snap) return { ...base, bank: null, assessment: null, rank: attentionRank(null), history: [] };

    const history = recent.get(client.id) ?? [];
    const at = history.findIndex((h) => h.id === snap.bank.id);
    const prev = at > 0 ? history[at - 1] : null;
    const forecast = forecasts.get(client.id) ?? null;
    const state = {
      kind: snap.bank.kind,
      cycleStart: snap.bank.cycleStart,
      cycleEnd: snap.bank.cycleEnd,
      purchasedMinutes: snap.utilization.purchasedMinutes,
      rolloverInMinutes: snap.utilization.rolloverInMinutes,
      totalMinutes: snap.utilization.totalMinutes,
      consumedMinutes: snap.utilization.consumedMinutes,
      remainingMinutes: snap.utilization.remainingMinutes,
      utilizationPct: snap.utilization.utilizationPct,
    };
    const assessment = assessClient({
      bank: state,
      previous: prev ? { kind: prev.kind, ...prev.utilization } : null,
      forecast,
      now,
    });
    const shown = bankDisplay(state);

    totals.set(client.id, {
      remaining: snap.utilization.remainingMinutes,
      used: shown.usedMinutes,
      overran: assessment.previousOverrun,
      ending: assessment.endingSoon,
    });

    const ended = snap.bank.cycleEnd.getTime() <= now.getTime();
    const kindLabel =
      snap.bank.kind === "PREPAID"
        ? t("bank.prepaid", { date: day(snap.bank.cycleEnd, true) })
        : ended
          ? t("bank.ended", { date: day(snap.bank.cycleEnd) })
          : t("bank.renews", { date: day(snap.bank.cycleEnd) });

    // The bars: hours used against the size of each cycle, on one scale.
    const bars = history.map((h) => {
      const d = bankDisplay({ kind: h.kind, ...h.utilization });
      return { h, d };
    });
    const top = Math.max(1, ...bars.map(({ d }) => Math.max(d.usedMinutes, d.sizeMinutes)));
    const historyBars: HistoryBar[] = bars.map(({ h, d }) => ({
      label: h.id === snap.bank.id ? (h.kind === "PREPAID" ? t("history.current") : month(h.cycleStart)) : month(h.cycleStart),
      usedShare: Math.max(0, d.usedMinutes) / top,
      sizeShare: d.sizeMinutes > 0 ? d.sizeMinutes / top : null,
      over: d.sizeMinutes > 0 && d.usedMinutes > d.sizeMinutes,
      current: h.id === snap.bank.id,
      title: t("history.title", { month: month(h.cycleStart), used: d.consumed, total: d.total }),
    }));

    return {
      ...base,
      bank: {
        kindLabel,
        used: shown.consumed,
        total: shown.total,
        remaining: shown.remaining,
        overdrawn: shown.overdrawn,
        pct: snap.utilization.utilizationPct,
        expectedPct: ended ? null : assessment.expectedPct,
      },
      assessment: { attention: assessment.attention, tone: assessment.tone, reasons: assessment.reasonCodes.map(reasonText) },
      rank: attentionRank(assessment),
      history: historyBars,
    };
  });

  // Needs attention first, then on track, then no bank; a paused client
  // last, whatever its bank says. Names break ties, as before.
  cards.sort((a, b) => {
    const ra = a.status === "ACTIVE" ? a.rank : 4;
    const rb = b.status === "ACTIVE" ? b.rank : 4;
    return ra - rb || a.name.localeCompare(b.name, "he");
  });

  const counted = cards.flatMap((c) => {
    const t = totals.get(c.id);
    return t ? [{ name: c.name, ...t }] : [];
  });
  const overran = counted.filter((t) => t.overran).map((t) => t.name);
  const ending = counted.filter((t) => t.ending).map((t) => t.name);
  const summary = {
    remaining: formatDecimalHours(counted.reduce((n, t) => n + t.remaining, 0)),
    used: formatDecimalHours(counted.reduce((n, t) => n + t.used, 0)),
    withBank: counted.length,
    overranCount: overran.length,
    overranNames: overran.slice(0, 2).join(", "),
    endingCount: ending.length,
    endingNames: ending.slice(0, 2).join(", "),
  };
  const rulesLine = t("rules", { pct: Math.round(LOW_REMAINING_SHARE * 100), paceDays: PACE_MIN_DAYS, endingDays: PACKAGE_ENDING_DAYS });

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-medium text-app-text-primary">{t("title")}</h1>
            <p className="mt-1 text-sm text-app-text-secondary">{t("subtitle")}</p>
          </div>
          <Drawer triggerLabel={t("newClient")} title={t("newClient")}>
            <CreateClientForm />
          </Drawer>
        </div>

        {/* Keyed on the roster, so a client restored below appears in the
            grid (which keeps its own copy of the list for the archive
            toast's undo) as soon as the screen refreshes. */}
        <ClientsGrid
          key={cards.map((c) => c.id).join(",")}
          cards={cards}
          initialQuery={initialQuery}
          canManageBanks={canManageBanks}
          canViewReports={canViewReports}
          summary={summary}
          rulesLine={rulesLine}
        />

        <SubprocessorRecipientsPanel groups={noticeGroups} />

        {archived.length > 0 && (
          <details className="rounded-2xl border border-app-border bg-white p-5">
            <summary className="cursor-pointer text-sm font-medium text-app-text-primary">
              {t("archived.summary", { count: archived.length })}
            </summary>
            <ul className="mt-3 divide-y divide-app-border">
              {archived.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span dir="auto" className="text-sm text-app-text-primary">{c.name}</span>
                  <span className="flex flex-wrap items-center gap-3">
                    {manager && c.deletedAt ? (
                      <a
                        href={`/api/clients/${c.id}/comms-export`}
                        className="inline-flex min-h-11 items-center text-sm text-app-text-accent hover:underline"
                        title={t("archived.exportTitle", { date: exportDeadline(c.deletedAt) })}
                      >
                        {t("archived.export", { date: exportDeadline(c.deletedAt) })}
                      </a>
                    ) : null}
                    <RestoreClientButton clientId={c.id} />
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
  );
}
