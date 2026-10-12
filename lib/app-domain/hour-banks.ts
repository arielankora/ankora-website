import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { afterResponse } from "@/lib/after-response";
import {
  computeConsumedMinutesForRange,
  consumedMinutesFromEntries,
  type ConsumableEntry,
} from "@/lib/app-domain/billing";
import { addDaysToKey, localDateKey, localDateTimeToUtc } from "@/lib/timezone";
import type { User, HourBank, HourBankStatus, RolloverMode } from "@prisma/client";

// Phase 3 domain service: spec section 8 ("לקוחות ובנק שעות"). Owns cycle
// lifecycle (open/close/recalculate), rollover computation between
// consecutive cycles, manual adjustments, and the live utilization
// formula (8.3). lib/app-domain/billing.ts owns the separate question of
// how much of a client's *actual* time counts as *billable*; this file
// only ever consumes that number (via computeConsumedMinutesForRange) -
// it never re-derives billing math itself.

export interface HourBankUtilization {
  purchasedMinutes: number;
  rolloverInMinutes: number;
  adjustmentMinutes: number;
  /// purchased + rolloverIn + adjustments (spec 8.3's "total").
  totalMinutes: number;
  consumedMinutes: number;
  remainingMinutes: number;
  /// consumed/total*100, guarded against a divide-by-zero when a client
  /// somehow has a zero-minute bank (spec 8.3 requires this guard
  /// explicitly - an empty bank must show 0%, not NaN/Infinity).
  utilizationPct: number;
}

/// Spec 8.3's live formula, applied to one cycle. Pure function over
/// already-fetched numbers so it's unit-testable without touching the
/// database.
export function computeUtilization(
  bank: Pick<HourBank, "purchasedMinutes" | "rolloverInMinutes"> & Partial<Pick<HourBank, "kind">>,
  adjustmentMinutes: number,
  consumedMinutes: number
): HourBankUtilization {
  const totalMinutes = bank.purchasedMinutes + bank.rolloverInMinutes + adjustmentMinutes;
  const remainingMinutes = totalMinutes - consumedMinutes;
  const utilizationPct =
    bank.kind === "PREPAID"
      ? prepaidUtilizationPct(bank.purchasedMinutes, remainingMinutes)
      : totalMinutes > 0
        ? Math.round((consumedMinutes / totalMinutes) * 1000) / 10
        : 0;
  return {
    purchasedMinutes: bank.purchasedMinutes,
    rolloverInMinutes: bank.rolloverInMinutes,
    adjustmentMinutes,
    totalMinutes,
    consumedMinutes,
    remainingMinutes,
    utilizationPct,
  };
}

/// A prepaid package's utilization: how much of the hours bought in this
/// load is gone, (purchased - remaining) / purchased. A balance carried
/// in is used first, so it never shows below 0%; an overrun carried in
/// counts as used. See the prepaid section below.
export function prepaidUtilizationPct(purchasedMinutes: number, remainingMinutes: number): number {
  if (purchasedMinutes <= 0) return remainingMinutes < 0 ? 100 : 0;
  const used = purchasedMinutes - remainingMinutes;
  return Math.max(0, Math.round((used / purchasedMinutes) * 1000) / 10);
}

/// How far through its cycle a bank is, from 0 (just started) to 1
/// (ended). The Home screen's "צפי להיום" weights this by each bank's
/// size. A cycle with no length counts as finished rather than dividing
/// by zero.
export function cycleElapsedShare(cycleStart: Date, cycleEnd: Date, now: Date): number {
  const span = cycleEnd.getTime() - cycleStart.getTime();
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - cycleStart.getTime()) / span));
}

async function sumAdjustments(hourBankId: string): Promise<number> {
  const agg = await prisma.hourBankAdjustment.aggregate({
    where: { hourBankId },
    _sum: { minutes: true },
  });
  return agg._sum.minutes ?? 0;
}

/// Lazily flips OPEN -> CLOSED once cycleEnd has passed (spec 8.2: "cycle
/// הופך ל-CLOSED לאחר תאריך הסיום"). No cron/scheduled job exists in this
/// engagement, so every read path that touches a cycle calls this first -
/// the transition is a pure function of "now" vs. cycleEnd, so computing
/// it lazily on read is equivalent to a background job and needs no extra
/// infrastructure.
async function closeIfExpired<T extends Pick<HourBank, "id" | "status" | "cycleEnd">>(bank: T): Promise<T> {
  if (bank.status === "OPEN" && bank.cycleEnd.getTime() <= Date.now()) {
    await prisma.hourBank.update({ where: { id: bank.id }, data: { status: "CLOSED" } });
    // Generic over T (rather than always returning a plain HourBank) so
    // callers that pass in a bank enriched with `adjustments` (the admin
    // screen's list/current-cycle queries) keep that relation on the
    // object they get back - a second round-trip `update()` return value
    // would NOT carry `adjustments` unless re-included, so we patch the
    // one field that actually changed instead of re-fetching.
    return { ...bank, status: "CLOSED" as HourBankStatus };
  }
  return bank;
}

/// Snapshot returned to the Hour Banks admin screen: the cycle row plus
/// its live-recomputed consumption/utilization. consumedMinutes on the
/// HourBank row itself is only a cache (refreshed here, not trusted as
/// the source of truth) - see the schema comment on HourBank.
export async function getHourBankSnapshot<T extends HourBank>(bank: T) {
  const [refreshedBank, adjustmentMinutes, consumedMinutes] = await Promise.all([
    closeIfExpired(bank),
    sumAdjustments(bank.id),
    computeConsumedMinutesForRange(bank.clientId, { from: bank.cycleStart, to: bank.cycleEnd }),
  ]);

  if (refreshedBank.consumedMinutes !== consumedMinutes) {
    await prisma.hourBank.update({ where: { id: bank.id }, data: { consumedMinutes } });
  }

  return {
    bank: refreshedBank,
    utilization: computeUtilization(refreshedBank, adjustmentMinutes, consumedMinutes),
  };
}

/// All cycles for a client, newest first, each with a live snapshot.
/// Powers the Hour Banks admin screen's "current/historical cycles" list
/// (spec 12).
export async function listHourBanksForClient(clientId: string) {
  const banks = await prisma.hourBank.findMany({
    where: { clientId, deletedAt: null },
    orderBy: { cycleStart: "desc" },
    include: { adjustments: { orderBy: { effectiveAt: "desc" } } },
  });
  return Promise.all(banks.map((b) => getHourBankSnapshot(b)));
}

/// The cycle covering "now" if one exists, else the most recently started
/// cycle (covers a client whose admin hasn't opened the next cycle yet -
/// spec doesn't define this edge case, so falling back to "last known
/// cycle" rather than throwing keeps the snapshot screen from erroring
/// out for a client between cycles).
///
/// No `adjustments` include, deliberately: both queries used to pull
/// every adjustment row for the cycle, and
/// getHourBankSnapshot then ignored them and asked the database for the
/// sum separately. Nothing that calls this function reads `.adjustments`
/// off the result - listHourBanksForClient, which does need them, keeps
/// its own include - so fetching them here was two round trips of rows
/// nobody looked at, on every call, on five different screens.
export async function getCurrentHourBank(clientId: string) {
  const now = new Date();
  const current = await prisma.hourBank.findFirst({
    where: { clientId, deletedAt: null, cycleStart: { lte: now }, cycleEnd: { gt: now } },
  });
  const bank =
    current ??
    (await prisma.hourBank.findFirst({
      where: { clientId, deletedAt: null },
      orderBy: { cycleStart: "desc" },
    }));
  if (!bank) return null;
  return getHourBankSnapshot(bank);
}

/// The same answer as getCurrentHourBank, for many clients, in a bounded
/// number of queries - and without writing anything.
///
/// WHY THIS EXISTS
///
/// getCurrentHourBank is the right shape for a screen about one client.
/// It is the wrong shape for a screen about all of them, and two screens
/// were calling it in a loop: the dashboard (in parallel) and the clients
/// list (sequentially, which is worse). Each call costs, per client:
///
///   1-2  hourBank.findFirst, each with an `adjustments` include that
///        getHourBankSnapshot then ignores in favour of its own aggregate
///     1  hourBankAdjustment.aggregate
///     1  billingPolicy.findUnique
///     1  timeEntry.findMany - every entry in the cycle, in full
///   0-2  hourBank.update - a WRITE, on a page render
///
/// So roughly six to nine round trips per client, two of them writes, one
/// of them unbounded in the number of rows it materialises. Twelve
/// clients is around eighty round trips against a pool of five
/// connections, which is how a dashboard render, and every write that
/// revalidates it, came to take tens of seconds. Measured at over ninety
/// on a CI runner; see claude/perf-dashboard-n-plus-one-2026-09.
///
/// This version is five queries whatever the client count.
///
/// READ-ONLY, DELIBERATELY
///
/// getHourBankSnapshot writes twice: closeIfExpired flips an expired
/// cycle to CLOSED, and the consumedMinutes cache is refreshed when it
/// has drifted. Both are reasonable on the Hour Banks admin screen, which
/// is about one client and is where an admin is actually looking at that
/// cycle. Neither belongs on a page that renders a summary of everyone:
/// writing N rows on every render of a read-only screen turns a dashboard
/// into a source of lock contention, and makes two people loading the
/// same page fight each other.
///
/// So this computes the expired-cycle status in memory - the same value
/// closeIfExpired would have persisted - and leaves the write to the
/// screens that own the cycle. The number a viewer sees is identical; the
/// difference is that looking at it no longer changes it.
export async function getCurrentHourBanksForClients(
  clientIds: string[]
): Promise<Map<string, { bank: HourBank; utilization: HourBankUtilization }>> {
  const out = new Map<string, { bank: HourBank; utilization: HourBankUtilization }>();
  if (clientIds.length === 0) return out;

  const now = new Date();

  // 1. The cycle covering now, for whichever clients have one.
  const covering = await prisma.hourBank.findMany({
    where: { clientId: { in: clientIds }, deletedAt: null, cycleStart: { lte: now }, cycleEnd: { gt: now } },
  });

  // 2. For the rest, their most recent cycle - same fallback
  //    getCurrentHourBank makes for a client between cycles. Done as a
  //    groupBy for the max cycleStart and then one fetch of those rows,
  //    rather than reading every cycle a client has ever had: this runs
  //    on a page render, and history grows without bound.
  const covered = new Set(covering.map((b) => b.clientId));
  const uncovered = clientIds.filter((id) => !covered.has(id));

  let fallbacks: HourBank[] = [];
  if (uncovered.length > 0) {
    const latest = await prisma.hourBank.groupBy({
      by: ["clientId"],
      where: { clientId: { in: uncovered }, deletedAt: null },
      _max: { cycleStart: true },
    });
    const pairs = latest
      .filter((r): r is typeof r & { _max: { cycleStart: Date } } => r._max.cycleStart !== null)
      .map((r) => ({ clientId: r.clientId, cycleStart: r._max.cycleStart }));

    if (pairs.length > 0) {
      fallbacks = await prisma.hourBank.findMany({ where: { deletedAt: null, OR: pairs } });
    }
  }

  // A client can in principle have two cycles starting at the same
  // instant; keep one, the same way findFirst would.
  const banks = new Map<string, HourBank>();
  for (const b of [...covering, ...fallbacks]) {
    if (!banks.has(b.clientId)) banks.set(b.clientId, b);
  }
  if (banks.size === 0) return out;

  const bankList = [...banks.values()];

  // 3-5. Adjustments, policies and entries, one query each for the whole
  //      set rather than one each per client.
  const [adjustmentRows, policies, entries] = await Promise.all([
    prisma.hourBankAdjustment.groupBy({
      by: ["hourBankId"],
      where: { hourBankId: { in: bankList.map((b) => b.id) } },
      _sum: { minutes: true },
    }),
    prisma.billingPolicy.findMany({ where: { clientId: { in: bankList.map((b) => b.clientId) } } }),
    // One window covering every cycle, narrowed per client below. The
    // alternative - a query per cycle range - is the N+1 this function
    // exists to remove, and the widest window is bounded by the cycles
    // themselves rather than by history.
    prisma.timeEntry.findMany({
      where: {
        clientId: { in: bankList.map((b) => b.clientId) },
        deletedAt: null,
        endAt: { not: null },
        startAt: {
          gte: new Date(Math.min(...bankList.map((b) => b.cycleStart.getTime()))),
          lt: new Date(Math.max(...bankList.map((b) => b.cycleEnd.getTime()))),
        },
      },
      select: { clientId: true, actualSeconds: true, billableSeconds: true, taskId: true, startAt: true },
    }),
  ]);

  const adjustmentMinutesByBank = new Map(adjustmentRows.map((r) => [r.hourBankId, r._sum.minutes ?? 0]));
  const policyByClient = new Map(policies.map((p) => [p.clientId, p]));
  const entriesByClient = new Map<string, ConsumableEntry[]>();
  for (const e of entries) {
    const list = entriesByClient.get(e.clientId);
    if (list) list.push(e);
    else entriesByClient.set(e.clientId, [e]);
  }

  for (const bank of bankList) {
    // The same per-client window getCurrentHourBank would have queried,
    // applied to the batch instead of asking the database again.
    const mine = (entriesByClient.get(bank.clientId) ?? []).filter(
      (e) => e.startAt >= bank.cycleStart && e.startAt < bank.cycleEnd,
    );
    const consumedMinutes = consumedMinutesFromEntries(mine, policyByClient.get(bank.clientId) ?? null);
    const adjustmentMinutes = adjustmentMinutesByBank.get(bank.id) ?? 0;

    // closeIfExpired's answer, computed rather than written.
    const effective: HourBank =
      bank.status === "OPEN" && bank.cycleEnd.getTime() <= now.getTime()
        ? { ...bank, status: "CLOSED" as HourBankStatus }
        : bank;

    out.set(bank.clientId, {
      bank: { ...effective, consumedMinutes },
      utilization: computeUtilization(effective, adjustmentMinutes, consumedMinutes),
    });
  }

  return out;
}

/// Spec 8.2's four rollover modes, applied to the cycle that is ENDING to
/// determine how many minutes carry into the NEXT cycle. rolloverMode and
/// rolloverCapMinutes are documented (schema.prisma) as living on the
/// producing cycle, not on a separate settings row the spec never
/// describes - so this function reads them off `previous`, never off the
/// new cycle being created.
export function computeRolloverInMinutes(
  previous: Pick<HourBank, "purchasedMinutes" | "rolloverInMinutes" | "consumedMinutes" | "rolloverMode" | "rolloverCapMinutes">,
  previousAdjustmentMinutes: number,
  manualOverrideMinutes: number | undefined
): number {
  const previousTotal = previous.purchasedMinutes + previous.rolloverInMinutes + previousAdjustmentMinutes;
  const previousRemaining = Math.max(0, previousTotal - previous.consumedMinutes);

  switch (previous.rolloverMode) {
    case "FULL":
      return previousRemaining;
    case "CAPPED":
      return Math.min(previousRemaining, Math.max(0, previous.rolloverCapMinutes ?? 0));
    case "MANUAL":
      // Spec 8.2: manual rollover is an admin decision per cycle, not a
      // formula - the caller must supply the number explicitly.
      return Math.max(0, Math.round(manualOverrideMinutes ?? 0));
    case "NONE":
    default:
      return 0;
  }
}

/// Opens a new cycle for a client (spec 8.1/8.2). Monthly is the spec's
/// documented default (section 25); cycleStart/cycleEnd are still
/// explicit dates so an admin can create an irregular first or last
/// cycle. If a prior cycle exists, its rolloverMode decides how many
/// minutes flow into this new cycle (see computeRolloverInMinutes); a
/// client's very first cycle always starts at rolloverInMinutes = 0.
export async function openHourBankCycle(
  actor: User,
  clientId: string,
  input: {
    cycleStart: Date;
    cycleEnd: Date;
    purchasedMinutes: number;
    rolloverMode: RolloverMode;
    rolloverCapMinutes?: number | null;
    /// Only read when the PREVIOUS cycle's rolloverMode is MANUAL.
    manualRolloverInMinutes?: number;
  }
) {
  assertCan(actor.role, "hour_bank.manage");

  if (input.cycleEnd.getTime() <= input.cycleStart.getTime()) {
    throw new Error("cycleEnd must be after cycleStart");
  }

  const previous = await prisma.hourBank.findFirst({
    where: { clientId, deletedAt: null },
    orderBy: { cycleStart: "desc" },
  });

  // Overnight bug-hunt (docs/adr/0001 section 19.3): this used to pass
  // `previous` straight into computeRolloverInMinutes(), which reads
  // `previous.consumedMinutes` - the CACHED column on the row, only ever
  // refreshed by getHourBankSnapshot() on a read path. An admin who opens
  // a new cycle without first viewing the previous cycle's live snapshot
  // (or right after a time-entry edit landed after the last snapshot
  // read) would carry a stale, possibly-too-high remaining balance into
  // the new cycle's rolloverInMinutes. Recomputing live here guarantees
  // the rollover this function commits to the database is always based
  // on the same real consumption number the admin screen would show.
  const previousLiveConsumedMinutes = previous
    ? await computeConsumedMinutesForRange(clientId, { from: previous.cycleStart, to: previous.cycleEnd })
    : 0;

  const rolloverInMinutes = previous
    ? computeRolloverInMinutes(
        { ...previous, consumedMinutes: previousLiveConsumedMinutes },
        await sumAdjustments(previous.id),
        input.manualRolloverInMinutes
      )
    : 0;

  const bank = await prisma.hourBank.create({
    data: {
      clientId,
      cycleStart: input.cycleStart,
      cycleEnd: input.cycleEnd,
      purchasedMinutes: Math.max(0, Math.round(input.purchasedMinutes)),
      rolloverInMinutes,
      rolloverMode: input.rolloverMode,
      rolloverCapMinutes:
        input.rolloverMode === "CAPPED" ? Math.max(0, Math.round(input.rolloverCapMinutes ?? 0)) : null,
    },
  });

  // Closing the previous cycle here (rather than waiting for the lazy
  // closeIfExpired check) keeps "open a new cycle" and "close the old
  // one" atomic from the admin's point of view - two OPEN cycles for the
  // same client would make getCurrentHourBank's "cycle covering now"
  // lookup ambiguous.
  if (previous && previous.status === "OPEN") {
    await prisma.hourBank.update({
      where: { id: previous.id },
      data: {
        status: "CLOSED",
        // A prepaid package runs to its expiry, a year out. Left as it is,
        // it would still cover "now" next to the new cycle, and the
        // "cycle covering now" lookup would have two answers. Cycles are
        // left alone: their end is the date someone typed.
        ...(previous.kind === "PREPAID" && previous.cycleEnd > input.cycleStart
          ? { cycleEnd: input.cycleStart }
          : {}),
      },
    });
  }

  await recordAudit({
    actorId: actor.id,
    action: "hour_bank.open_cycle",
    entityType: "HourBank",
    entityId: bank.id,
    clientId,
    after: bank,
  });

  return bank;
}

/// Manual credit/debit (spec 8.2: "manual adjustments"). Defaults to the
/// client's current cycle when hourBankId isn't given explicitly.
export async function recordHourBankAdjustment(
  actor: User,
  clientId: string,
  input: { hourBankId?: string; minutes: number; reason: string; effectiveAt?: Date }
) {
  assertCan(actor.role, "hour_bank.manage");

  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("An adjustment requires a reason (spec 8.2 audit trail).");
  }

  let hourBankId = input.hourBankId ?? null;
  if (!hourBankId) {
    const current = await getCurrentHourBank(clientId);
    hourBankId = current?.bank.id ?? null;
  }

  const adjustment = await prisma.hourBankAdjustment.create({
    data: {
      clientId,
      hourBankId,
      minutes: Math.round(input.minutes),
      reason,
      createdById: actor.id,
      effectiveAt: input.effectiveAt ?? new Date(),
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "hour_bank.adjustment.create",
    entityType: "HourBankAdjustment",
    entityId: adjustment.id,
    clientId,
    after: adjustment,
  });

  // A manual credit/debit changes the cycle's total immediately, so the
  // cached consumedMinutes/utilization on the affected bank needs to be
  // treated as stale even though nothing about actual/billable time
  // changed - the same "backdated change to a closed cycle" concern spec
  // 8.2 raises for time-entry edits.
  if (hourBankId) {
    await flagRecalculationIfClosed(hourBankId);
  }

  // Phase 4 (spec 9.2 extension, documented in ADR 11.4): a manual
  // credit/debit changes the cycle's total immediately, so it's a
  // deliberate additional trigger point beyond the spec's literal list.
  // Dynamic import avoids a circular dependency (alerts.ts imports
  // getCurrentHourBank from this file). Best-effort/non-fatal, same
  // pattern as every other alert-evaluation call site.
  // Deferred, like every other alert trigger: the result is not used and
  // a failure is swallowed, so awaiting it only makes the admin wait.
  await afterResponse("evaluateAlertsForClient", async () => {
    const mod = await import("@/lib/app-domain/alerts");
    await mod.evaluateAlertsForClient(clientId);
  });

  return adjustment;
}

async function flagRecalculationIfClosed(hourBankId: string) {
  const bank = await prisma.hourBank.findUnique({ where: { id: hourBankId } });
  if (bank && bank.status === "CLOSED") {
    await prisma.hourBank.update({
      where: { id: bank.id },
      data: { status: "RECALCULATED", recalculatedAt: new Date() },
    });
  }
}

/// Called from lib/app-domain/time-entries.ts whenever a TimeEntry's
/// date/client/billable numbers change after the fact (edit or soft
/// delete). Spec 8.2: a backdated edit landing inside an already-CLOSED
/// cycle must never silently change a produced report - the cycle is
/// instead flagged RECALCULATED (with a timestamp) so the admin screen
/// can surface "this cycle's numbers changed after it closed" rather than
/// quietly showing a different total than what was originally reported.
/// Best-effort: failures here must never block the time-entry write
/// itself, so callers should not await-and-throw on this in a way that
/// rolls back the entry change.
export async function flagAffectedCyclesRecalculated(clientId: string, affectedDates: Date[]) {
  const uniqueDates = affectedDates.filter((d): d is Date => !!d);
  if (uniqueDates.length === 0) return;

  const banks = await prisma.hourBank.findMany({
    where: {
      clientId,
      deletedAt: null,
      status: "CLOSED",
      OR: uniqueDates.map((d) => ({ cycleStart: { lte: d }, cycleEnd: { gt: d } })),
    },
  });

  await Promise.all(
    banks.map((bank) =>
      prisma.hourBank.update({
        where: { id: bank.id },
        data: { status: "RECALCULATED" as HourBankStatus, recalculatedAt: new Date() },
      })
    )
  );
}

// ---------------------------------------------------------------------------
// Prepaid packages (12.10.2026, RIMED)
// ---------------------------------------------------------------------------
//
// A client on a prepaid package buys a block of hours and uses it until it
// runs out; there is no month. The package is still an HourBank row, kind
// PREPAID, so every screen, report, alert, export and backup that reads a
// bank keeps working on it. What differs:
//
//   - It stays open until the next package is loaded, or until it expires
//     (cycleEnd, one year from purchase by default).
//   - Loading the next package ends this one at that moment and starts the
//     new one at the same instant: no minute falls between the two, and
//     none is counted twice.
//   - The whole balance moves across, an overrun included, so hours worked
//     past the end of a package come off the next one (Ariel, 12.10.2026).
//     Hours left in a package that has already expired do not move; an
//     overrun always does.
//   - Utilization is measured against the size of the package, the hours
//     bought in this load (Ariel, 12.10.2026): "80%" means 80% of the 30
//     hours bought. Hours carried in from the previous package are used
//     first; an overrun carried in counts as already used. In one formula:
//     (purchased - remaining) / purchased. 100% is the moment nothing is
//     left.
//   - Alerts are per package (AlertEvent.hourBankId), so the 80% and 100%
//     emails fire again for every package, once each.

/// How many days back the pace of use is measured over.
export const BURN_WINDOW_DAYS = 28;
/// Fewer entries than this in the window is not a pace, it is an anecdote.
export const BURN_MIN_ENTRIES = 4;

export type PrepaidForecast =
  | { status: "depleted"; weeklyMinutes: number | null }
  | { status: "insufficient_data"; weeklyMinutes: null }
  | { status: "projected"; weeklyMinutes: number; depletionDate: Date; daysLeft: number };

/// When the remaining hours will run out at the pace of the last four
/// weeks. Pure, so it is tested without a database.
export function projectDepletion(input: {
  remainingMinutes: number;
  consumedInWindowMinutes: number;
  entriesInWindow: number;
  now: Date;
}): PrepaidForecast {
  const weekly =
    input.entriesInWindow >= BURN_MIN_ENTRIES && input.consumedInWindowMinutes > 0
      ? input.consumedInWindowMinutes / (BURN_WINDOW_DAYS / 7)
      : null;
  if (input.remainingMinutes <= 0) {
    return { status: "depleted", weeklyMinutes: weekly === null ? null : Math.round(weekly) };
  }
  if (weekly === null) return { status: "insufficient_data", weeklyMinutes: null };
  const days = (input.remainingMinutes / weekly) * 7;
  return {
    status: "projected",
    weeklyMinutes: Math.round(weekly),
    depletionDate: new Date(input.now.getTime() + days * 86_400_000),
    daysLeft: Math.max(0, Math.floor(days)),
  };
}

type ForecastSubject = { clientId: string; kind: HourBank["kind"]; remainingMinutes: number };

/// Forecasts for many clients in three queries, whatever the count. Only
/// prepaid packages get one: a cycle renews on a date, it does not run
/// out. Read-only, like getCurrentHourBanksForClients.
export async function getPrepaidForecastsForClients(
  subjects: ForecastSubject[],
  now: Date = new Date()
): Promise<Map<string, PrepaidForecast>> {
  const out = new Map<string, PrepaidForecast>();
  const prepaid = subjects.filter((s) => s.kind === "PREPAID");
  if (prepaid.length === 0) return out;

  const clientIds = prepaid.map((s) => s.clientId);
  const from = new Date(now.getTime() - BURN_WINDOW_DAYS * 86_400_000);
  const [policies, entries] = await Promise.all([
    prisma.billingPolicy.findMany({ where: { clientId: { in: clientIds } } }),
    prisma.timeEntry.findMany({
      where: { clientId: { in: clientIds }, deletedAt: null, endAt: { not: null }, startAt: { gte: from, lt: now } },
      select: { clientId: true, actualSeconds: true, billableSeconds: true, taskId: true, startAt: true },
    }),
  ]);
  const policyByClient = new Map(policies.map((p) => [p.clientId, p]));
  const entriesByClient = new Map<string, ConsumableEntry[]>();
  for (const e of entries) {
    const list = entriesByClient.get(e.clientId);
    if (list) list.push(e);
    else entriesByClient.set(e.clientId, [e]);
  }

  for (const s of prepaid) {
    const mine = entriesByClient.get(s.clientId) ?? [];
    out.set(
      s.clientId,
      projectDepletion({
        remainingMinutes: s.remainingMinutes,
        consumedInWindowMinutes: consumedMinutesFromEntries(mine, policyByClient.get(s.clientId) ?? null),
        entriesInWindow: mine.length,
        now,
      })
    );
  }
  return out;
}

/// One client's forecast, or null for a client whose bank is a cycle.
export async function getPrepaidForecast(
  snapshot: { bank: Pick<HourBank, "clientId" | "kind">; utilization: Pick<HourBankUtilization, "remainingMinutes"> } | null,
  now: Date = new Date()
): Promise<PrepaidForecast | null> {
  if (!snapshot || snapshot.bank.kind !== "PREPAID") return null;
  const map = await getPrepaidForecastsForClients(
    [{ clientId: snapshot.bank.clientId, kind: snapshot.bank.kind, remainingMinutes: snapshot.utilization.remainingMinutes }],
    now
  );
  return map.get(snapshot.bank.clientId) ?? null;
}

/// What moves from the package (or cycle) that is ending into the new
/// package. Pure. `stillValid` is whether the previous one still covered
/// the moment of the load: unused hours of an expired package or an
/// ended cycle stay behind, an overrun always comes along.
export function prepaidCarryInMinutes(previousBalanceMinutes: number, stillValid: boolean): number {
  const carried = stillValid ? previousBalanceMinutes : Math.min(0, previousBalanceMinutes);
  return Math.round(carried);
}

/// Default expiry: the same calendar day one year later, Israel midnight.
export function defaultPackageExpiry(start: Date): Date {
  const [y, m, d] = localDateKey(start).split("-").map(Number);
  // 29.2 has no twin a year later; addDaysToKey rolls it to 1.3.
  const key = addDaysToKey(`${y + 1}-${String(m).padStart(2, "0")}-01`, d - 1);
  return localDateTimeToUtc(key, "00:00");
}

export interface PrepaidLoadPreview {
  previous: {
    id: string;
    kind: HourBank["kind"];
    cycleStart: Date;
    /// Where the previous one will end after the load.
    endsAt: Date;
    totalMinutes: number;
    consumedMinutes: number;
    balanceMinutes: number;
    stillValid: boolean;
  } | null;
  carryInMinutes: number;
}

/// The arithmetic of a load, without writing anything. Used by the form to
/// show the sum before it is confirmed, and by loadPrepaidPackage itself,
/// so what is shown is what is saved.
export async function previewPrepaidLoad(clientId: string, startAt: Date): Promise<PrepaidLoadPreview> {
  const previous = await prisma.hourBank.findFirst({
    where: { clientId, deletedAt: null },
    orderBy: { cycleStart: "desc" },
  });
  if (!previous) return { previous: null, carryInMinutes: 0 };
  if (startAt.getTime() <= previous.cycleStart.getTime()) {
    throw new Error("תאריך הרכישה חייב להיות אחרי תחילת החבילה או המחזור הקודמים.");
  }

  const stillValid = previous.cycleEnd.getTime() > startAt.getTime();
  const endsAt = stillValid ? startAt : previous.cycleEnd;
  const [adjustmentMinutes, consumedMinutes] = await Promise.all([
    sumAdjustments(previous.id),
    computeConsumedMinutesForRange(clientId, { from: previous.cycleStart, to: endsAt }),
  ]);
  const totalMinutes = previous.purchasedMinutes + previous.rolloverInMinutes + adjustmentMinutes;
  const balanceMinutes = totalMinutes - consumedMinutes;

  return {
    previous: {
      id: previous.id,
      kind: previous.kind,
      cycleStart: previous.cycleStart,
      endsAt,
      totalMinutes,
      consumedMinutes,
      balanceMinutes,
      stillValid,
    },
    carryInMinutes: prepaidCarryInMinutes(balanceMinutes, stillValid),
  };
}

/// Loads a prepaid package: the first one, or the next one. Ends the
/// previous package or cycle at `startAt` and opens the new package from
/// that same instant, carrying the balance across (see above).
export async function loadPrepaidPackage(
  actor: User,
  clientId: string,
  input: {
    startAt: Date;
    purchasedMinutes: number;
    /// Defaults to one year after startAt.
    expiresAt?: Date;
  }
) {
  assertCan(actor.role, "hour_bank.manage");

  const purchasedMinutes = Math.round(input.purchasedMinutes);
  if (!(purchasedMinutes > 0)) throw new Error("יש להזין כמה שעות נרכשו.");
  if (input.startAt.getTime() > Date.now()) throw new Error("תאריך הרכישה לא יכול להיות בעתיד.");
  const expiresAt = input.expiresAt ?? defaultPackageExpiry(input.startAt);
  if (expiresAt.getTime() <= input.startAt.getTime()) throw new Error("התוקף חייב להיות אחרי תאריך הרכישה.");

  const preview = await previewPrepaidLoad(clientId, input.startAt);

  const bank = await prisma.$transaction(async (tx) => {
    if (preview.previous) {
      await tx.hourBank.update({
        where: { id: preview.previous.id },
        data: { status: "CLOSED", cycleEnd: preview.previous.endsAt },
      });
    }
    return tx.hourBank.create({
      data: {
        clientId,
        kind: "PREPAID",
        cycleStart: input.startAt,
        cycleEnd: expiresAt,
        purchasedMinutes,
        rolloverInMinutes: preview.carryInMinutes,
        rolloverMode: "FULL",
        rolloverCapMinutes: null,
      },
    });
  });

  await recordAudit({
    actorId: actor.id,
    action: "hour_bank.load_package",
    entityType: "HourBank",
    entityId: bank.id,
    clientId,
    before: preview.previous
      ? { previousId: preview.previous.id, previousEndsAt: preview.previous.endsAt, previousBalanceMinutes: preview.previous.balanceMinutes }
      : undefined,
    after: bank,
  });

  // The two default rules are the whole alert story of a package: 80% of
  // the package, then all of it. Make sure they exist. They go to Ankora
  // and the account manager, not to the client (Ariel, 12.10.2026).
  // Dynamic import: alerts.ts imports this file.
  const alerts = await import("@/lib/app-domain/alerts");
  await alerts.ensureDefaultAlertRules(actor, clientId);

  await afterResponse("evaluateAlertsForClient", async () => {
    await alerts.evaluateAlertsForClient(clientId);
  });

  return { bank, preview };
}
