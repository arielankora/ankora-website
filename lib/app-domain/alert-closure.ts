import "server-only";
import type { AlertCloseKind, AlertThresholdType, Prisma, PrismaClient } from "@prisma/client";

// 4.11.2026: closing hour-bank alert events that no longer apply.
//
// An alert event belongs to one rule and one hour bank (a cycle or a
// prepaid package, AlertEvent.hourBankId). Until now the only thing that
// ever closed one on its own was the next evaluation, and evaluation only
// looks at the client's CURRENT bank. So when a new cycle was opened, or a
// package was loaded, the previous bank's events stayed open forever: on
// the Alerts screen, and in the counter beside "התראות".
//
// The rules, in one place:
//  - a new cycle closes every open event of the client's earlier banks;
//  - loading hours (a package, or a positive adjustment) recomputes the
//    utilization: an event whose threshold no longer holds is closed, one
//    whose threshold still holds stays open;
//  - when a higher utilization threshold fires on a bank, the open lower
//    one on that bank is closed as superseded, and is reopened (the same
//    row, no new email) if the higher one is later closed while the lower
//    threshold still holds;
//  - a closed event is never deleted, and an event a person closed
//    (MANUAL) is never touched by any of this.
//
// Every function that writes takes the database handle it should use, so
// the caller can run it inside the same transaction as the bank change
// that caused it. Kept free of imports from hour-banks.ts and alerts.ts:
// both import this file.

type Db = Prisma.TransactionClient | PrismaClient;

export const CLOSE_REASON = {
  NEW_CYCLE: "נפתח מחזור חדש",
  HOURS_LOADED: "נטענו שעות לבנק",
  BELOW_THRESHOLD: "הניצול ירד מתחת לסף",
} as const;

export function supersededReason(higherThreshold: number): string {
  return `נוצרה התראת ${higherThreshold}%`;
}

/// Everything but MANUAL. What the history labels "נסגר אוטומטית".
export function isAutoClose(kind: AlertCloseKind | null | undefined): boolean {
  return !!kind && kind !== "MANUAL";
}

export interface UtilizationSnapshotForAlerts {
  totalMinutes: number;
  consumedMinutes: number;
  remainingMinutes: number;
  utilizationPct: number;
}

/// Spec 9.1's four threshold types, each read off the same utilization
/// snapshot Hour Banks already computes (lib/app-domain/hour-banks.ts).
/// "Forecast" is deliberately excluded - spec 9.1 itself marks that row
/// "Future" (see ADR 11.5).
export function currentValueForThreshold(
  type: AlertThresholdType,
  snapshot: UtilizationSnapshotForAlerts
): number {
  switch (type) {
    case "UTILIZATION_PCT":
      return snapshot.utilizationPct;
    case "REMAINING_MINUTES":
      return snapshot.remainingMinutes;
    case "CONSUMED_MINUTES":
      return snapshot.consumedMinutes;
    case "OVERAGE":
      return Math.max(0, snapshot.consumedMinutes - snapshot.totalMinutes);
    default:
      return 0;
  }
}

/// Whether a rule should be considered "crossed" (breached) at the given
/// current value. REMAINING_MINUTES is the one inverted case - a rule
/// fires when remaining time drops TO OR BELOW the threshold, every other
/// type fires when its value rises to or above the threshold.
export function isThresholdBreached(type: AlertThresholdType, thresholdValue: number, currentValue: number): boolean {
  if (type === "REMAINING_MINUTES") {
    return currentValue <= thresholdValue;
  }
  return currentValue >= thresholdValue;
}

export function ruleBreached(
  rule: { type: AlertThresholdType; thresholdValue: number },
  utilization: UtilizationSnapshotForAlerts
): boolean {
  return isThresholdBreached(rule.type, rule.thresholdValue, currentValueForThreshold(rule.type, utilization));
}

function closeData(kind: AlertCloseKind, reason: string, now: Date) {
  return { resolvedAt: now, closeKind: kind, closeReason: reason };
}

/// A new cycle or package was opened for the client: every open event on
/// any of its other banks closes. Returns how many closed.
export async function closeOpenAlertsOutsideBank(
  db: Db,
  clientId: string,
  keepBankId: string,
  kind: Extract<AlertCloseKind, "NEW_CYCLE" | "HOURS_LOADED">,
  now = new Date()
): Promise<number> {
  const { count } = await db.alertEvent.updateMany({
    where: { resolvedAt: null, hourBankId: { not: keepBankId }, rule: { clientId } },
    data: closeData(kind, CLOSE_REASON[kind], now),
  });
  return count;
}

/// Hours were added to this bank. Open events whose threshold no longer
/// holds close; the rest stay open. Then a superseded lower threshold that
/// is now uncovered is reopened. Returns how many closed.
export async function reconcileBankAfterHoursLoaded(
  db: Db,
  hourBankId: string,
  utilization: UtilizationSnapshotForAlerts,
  now = new Date()
): Promise<number> {
  const open = await db.alertEvent.findMany({
    where: { hourBankId, resolvedAt: null },
    select: { id: true, rule: { select: { type: true, thresholdValue: true } } },
  });
  const toClose = open.filter((e) => !ruleBreached(e.rule, utilization)).map((e) => e.id);
  if (toClose.length > 0) {
    await db.alertEvent.updateMany({
      where: { id: { in: toClose }, resolvedAt: null },
      data: closeData("HOURS_LOADED", CLOSE_REASON.HOURS_LOADED, now),
    });
  }
  await reopenUncoveredSuperseded(db, hourBankId, utilization);
  return toClose.length;
}

/// A utilization rule just fired on this bank: the open events of the
/// client's lower utilization thresholds on the same bank close as
/// superseded (80% when 100% fires).
export async function supersedeLowerUtilizationAlerts(
  db: Db,
  hourBankId: string,
  firedRule: { id: string; clientId: string; type: AlertThresholdType; thresholdValue: number },
  now = new Date()
): Promise<number> {
  if (firedRule.type !== "UTILIZATION_PCT") return 0;
  const { count } = await db.alertEvent.updateMany({
    where: {
      hourBankId,
      resolvedAt: null,
      ruleId: { not: firedRule.id },
      rule: { clientId: firedRule.clientId, type: "UTILIZATION_PCT", thresholdValue: { lt: firedRule.thresholdValue } },
    },
    data: closeData("SUPERSEDED", supersededReason(firedRule.thresholdValue), now),
  });
  return count;
}

/// The other half of superseding. A lower threshold's event that was
/// closed only because a higher one fired comes back when no higher
/// utilization event on the bank is open any more and its own threshold
/// still holds. The same row is reopened: the alert was sent once, and
/// this is still that alert. Only the latest event of each rule on the
/// bank is considered, and only while the rule has no other open event.
export async function reopenUncoveredSuperseded(
  db: Db,
  hourBankId: string,
  utilization: UtilizationSnapshotForAlerts
): Promise<number> {
  const events = await db.alertEvent.findMany({
    where: { hourBankId, rule: { type: "UTILIZATION_PCT", enabled: true } },
    orderBy: [{ triggeredAt: "desc" }, { id: "desc" }],
    select: { id: true, ruleId: true, resolvedAt: true, closeKind: true, rule: { select: { type: true, thresholdValue: true } } },
  });
  if (events.length === 0) return 0;

  const latestByRule = new Map<string, (typeof events)[number]>();
  for (const e of events) if (!latestByRule.has(e.ruleId)) latestByRule.set(e.ruleId, e);

  const openThresholds = events.filter((e) => e.resolvedAt === null).map((e) => e.rule.thresholdValue);
  let reopened = 0;
  for (const latest of latestByRule.values()) {
    if (latest.closeKind !== "SUPERSEDED") continue;
    if (!ruleBreached(latest.rule, utilization)) continue;
    if (openThresholds.some((t) => t > latest.rule.thresholdValue)) continue;
    const { count } = await db.alertEvent.updateMany({
      where: { id: latest.id, closeKind: "SUPERSEDED" },
      data: { resolvedAt: null, closeKind: null, closeReason: null },
    });
    reopened += count;
  }
  return reopened;
}

// ---------------------------------------------------------------------------
// One-time cleanup of events left open before this change
// (scripts/close-stale-alerts.ts)
// ---------------------------------------------------------------------------

export type StaleAlertCategory = "NEW_CYCLE" | "HOURS_LOADED" | "BELOW_THRESHOLD" | "SUPERSEDED";

export interface StaleAlertCleanupResult {
  openBefore: number;
  toClose: Record<StaleAlertCategory, string[]>;
  /// Open events whose bank is deleted or missing. Reported, not closed.
  skippedBankMissing: string[];
  applied: boolean;
}

/// Finds every open alert event that the rules above would have closed:
///  - its bank is no longer the client's latest one (a later cycle was
///    opened: NEW_CYCLE; a later package was loaded: HOURS_LOADED);
///  - its bank is the latest, and its threshold no longer holds there
///    (BELOW_THRESHOLD);
///  - a higher utilization event is open on the same bank (SUPERSEDED).
/// A latest bank whose end date has passed keeps its events: with no next
/// cycle opened it is still the bank alerts are evaluated against (see
/// reconcileAllClientAlerts in alerts.ts).
///
/// Writes nothing unless `apply` is true. `utilizationOf` is passed in by
/// the caller (hour-banks.ts cannot be imported here) and must not write.
export async function findAndCloseStaleAlerts(
  db: PrismaClient,
  utilizationOf: (bank: {
    id: string;
    clientId: string;
    kind: "CYCLE" | "PREPAID";
    cycleStart: Date;
    cycleEnd: Date;
    purchasedMinutes: number;
    rolloverInMinutes: number;
  }) => Promise<UtilizationSnapshotForAlerts>,
  options: { apply: boolean; now?: Date }
): Promise<StaleAlertCleanupResult> {
  const now = options.now ?? new Date();
  const open = await db.alertEvent.findMany({
    where: { resolvedAt: null },
    select: { id: true, hourBankId: true, rule: { select: { clientId: true, type: true, thresholdValue: true } } },
  });

  const result: StaleAlertCleanupResult = {
    openBefore: open.length,
    toClose: { NEW_CYCLE: [], HOURS_LOADED: [], BELOW_THRESHOLD: [], SUPERSEDED: [] },
    skippedBankMissing: [],
    applied: false,
  };
  if (open.length === 0) return result;

  const banks = await db.hourBank.findMany({
    where: { id: { in: Array.from(new Set(open.map((e) => e.hourBankId))) } },
  });
  const bankById = new Map(banks.map((b) => [b.id, b]));
  const clientIds = Array.from(new Set(open.map((e) => e.rule.clientId)));
  const allBanks = await db.hourBank.findMany({
    where: { clientId: { in: clientIds }, deletedAt: null },
    orderBy: { cycleStart: "desc" },
  });
  const latestByClient = new Map<string, (typeof allBanks)[number]>();
  for (const b of allBanks) if (!latestByClient.has(b.clientId)) latestByClient.set(b.clientId, b);

  const utilizationCache = new Map<string, UtilizationSnapshotForAlerts>();
  const stillOnLatest: typeof open = [];

  for (const e of open) {
    const bank = bankById.get(e.hourBankId);
    const latest = latestByClient.get(e.rule.clientId);
    if (!bank || bank.deletedAt || !latest) {
      result.skippedBankMissing.push(e.id);
      continue;
    }
    if (latest.id !== bank.id) {
      result.toClose[latest.kind === "PREPAID" ? "HOURS_LOADED" : "NEW_CYCLE"].push(e.id);
      continue;
    }
    let utilization = utilizationCache.get(bank.id);
    if (!utilization) {
      utilization = await utilizationOf(bank);
      utilizationCache.set(bank.id, utilization);
    }
    if (!ruleBreached(e.rule, utilization)) {
      result.toClose.BELOW_THRESHOLD.push(e.id);
      continue;
    }
    stillOnLatest.push(e);
  }

  // Superseded: an open lower utilization event next to an open higher one
  // on the same bank.
  const supersededReasonById = new Map<string, string>();
  for (const e of stillOnLatest) {
    if (e.rule.type !== "UTILIZATION_PCT") continue;
    const higher = stillOnLatest
      .filter(
        (o) =>
          o.hourBankId === e.hourBankId &&
          o.rule.type === "UTILIZATION_PCT" &&
          o.rule.thresholdValue > e.rule.thresholdValue
      )
      .sort((a, b) => b.rule.thresholdValue - a.rule.thresholdValue)[0];
    if (higher) {
      result.toClose.SUPERSEDED.push(e.id);
      supersededReasonById.set(e.id, supersededReason(higher.rule.thresholdValue));
    }
  }

  if (!options.apply) return result;

  await db.$transaction(async (tx) => {
    for (const kind of ["NEW_CYCLE", "HOURS_LOADED", "BELOW_THRESHOLD"] as const) {
      const ids = result.toClose[kind];
      if (ids.length === 0) continue;
      await tx.alertEvent.updateMany({
        where: { id: { in: ids }, resolvedAt: null },
        data: closeData(kind, CLOSE_REASON[kind], now),
      });
    }
    for (const id of result.toClose.SUPERSEDED) {
      await tx.alertEvent.updateMany({
        where: { id, resolvedAt: null },
        data: closeData("SUPERSEDED", supersededReasonById.get(id)!, now),
      });
    }
  });
  result.applied = true;
  return result;
}
