import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { computeConsumedMinutesForRange } from "@/lib/app-domain/billing";
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
  bank: Pick<HourBank, "purchasedMinutes" | "rolloverInMinutes">,
  adjustmentMinutes: number,
  consumedMinutes: number
): HourBankUtilization {
  const totalMinutes = bank.purchasedMinutes + bank.rolloverInMinutes + adjustmentMinutes;
  const remainingMinutes = totalMinutes - consumedMinutes;
  const utilizationPct = totalMinutes > 0 ? Math.round((consumedMinutes / totalMinutes) * 1000) / 10 : 0;
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
export async function getCurrentHourBank(clientId: string) {
  const now = new Date();
  const current = await prisma.hourBank.findFirst({
    where: { clientId, deletedAt: null, cycleStart: { lte: now }, cycleEnd: { gt: now } },
    include: { adjustments: { orderBy: { effectiveAt: "desc" } } },
  });
  const bank =
    current ??
    (await prisma.hourBank.findFirst({
      where: { clientId, deletedAt: null },
      orderBy: { cycleStart: "desc" },
      include: { adjustments: { orderBy: { effectiveAt: "desc" } } },
    }));
  if (!bank) return null;
  return getHourBankSnapshot(bank);
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

  const rolloverInMinutes = previous
    ? computeRolloverInMinutes(previous, await sumAdjustments(previous.id), input.manualRolloverInMinutes)
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
    await prisma.hourBank.update({ where: { id: previous.id }, data: { status: "CLOSED" } });
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
  await import("@/lib/app-domain/alerts")
    .then((mod) => mod.evaluateAlertsForClient(clientId))
    .catch((err) => console.error("evaluateAlertsForClient failed (non-fatal)", err));

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
