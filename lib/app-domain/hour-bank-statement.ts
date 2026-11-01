import "server-only";
import { prisma } from "@/lib/prisma";
import { consumedMinutesFromEntries, type ConsumableEntry } from "@/lib/app-domain/billing";
import { computeUtilization, type HourBankUtilization } from "@/lib/app-domain/hour-banks";
import { dayEndInZone } from "@/lib/timezone";
import type { HourBank, HourBankAdjustment, HourBankStatus } from "@prisma/client";

// 1.11.2026: the numbers of the "בנק שעות" screen, for one client, as of
// a moment, for the get_hours_bank MCP tool. The weekly RIMED report used
// to rebuild the balance from time entries and a hand-typed anchor; this
// gives it the screen's own arithmetic instead.
//
// READ-ONLY. getHourBankSnapshot (the screen) closes an expired cycle and
// refreshes the consumedMinutes cache as it reads. This file computes the
// same values and writes nothing, like getCurrentHourBanksForClients.
//
// AS OF A DATE. Everything is cut at `cutoff`, an exclusive instant: the
// first moment of the day after asOf, Israel time. Time entries count when
// they started before it, adjustments when they took effect before it
// (Ariel, 1.11.2026). Without asOf there is no cut and every adjustment of
// the package counts, exactly as on the screen.

type BankRow = Pick<
  HourBank,
  "id" | "kind" | "cycleStart" | "cycleEnd" | "purchasedMinutes" | "rolloverInMinutes" | "status"
>;
type AdjustmentRow = Pick<HourBankAdjustment, "id" | "hourBankId" | "minutes" | "reason" | "effectiveAt">;
type PolicyLike = Parameters<typeof consumedMinutesFromEntries>[1];

export interface StatementInput {
  /// The client's banks, any order, deleted ones already left out.
  banks: BankRow[];
  adjustments: AdjustmentRow[];
  /// Finished entries of the client from the earliest bank's start on.
  entries: ConsumableEntry[];
  policy: PolicyLike;
  /// Exclusive end of the asOf day, or null for "now, as the screen shows it".
  cutoff: Date | null;
  now: Date;
  /// When given, newPackageLoadedSince says whether a package or cycle
  /// started on or after it (and before the cutoff).
  since?: Date | null;
}

export interface BankFiguresAt {
  id: string;
  kind: HourBank["kind"];
  loadedAt: Date;
  /// Expiry for a package, end for a cycle. A package ends early at the
  /// moment the next one is loaded.
  validUntil: Date;
  status: HourBankStatus;
  utilization: HourBankUtilization;
  /// The "נוצל" tile of the screen's main card: of a package, what is
  /// gone of the hours loaded (carry-in and adjustments included); of a
  /// cycle, the billable minutes.
  usedMinutes: number;
  /// The tile beside it: the package size, or the cycle's total.
  cardTotalMinutes: number;
  adjustments: AdjustmentRow[];
}

export interface HourBankStatement {
  active: BankFiguresAt | null;
  previous: BankFiguresAt[];
  newPackageLoadedSince: boolean | null;
}

/// The bank the figures belong to. Without a cutoff: the one covering
/// now, else the latest started (getCurrentHourBank's rule). With one: the
/// one whose window holds the last moment before the cutoff, else the
/// latest started before it. A package that ends at the instant the next
/// one is loaded is the one shown for the day before the load.
export function pickBank<T extends BankRow>(banks: T[], cutoff: Date | null, now: Date): T | null {
  const sorted = [...banks].sort((a, b) => b.cycleStart.getTime() - a.cycleStart.getTime());
  if (cutoff === null) {
    const t = now.getTime();
    return sorted.find((b) => b.cycleStart.getTime() <= t && b.cycleEnd.getTime() > t) ?? sorted[0] ?? null;
  }
  const c = cutoff.getTime();
  const started = sorted.filter((b) => b.cycleStart.getTime() < c);
  return started.find((b) => b.cycleEnd.getTime() >= c) ?? started[0] ?? null;
}

function figuresFor(bank: BankRow, input: StatementInput): BankFiguresAt {
  const c = input.cutoff?.getTime() ?? Infinity;
  const end = Math.min(bank.cycleEnd.getTime(), c);
  const mine = input.entries.filter(
    (e) => e.startAt.getTime() >= bank.cycleStart.getTime() && e.startAt.getTime() < end
  );
  const consumed = consumedMinutesFromEntries(mine, input.policy);
  const adjustments = input.adjustments
    .filter((a) => a.hourBankId === bank.id && a.effectiveAt.getTime() < c)
    .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime());
  const adjustmentMinutes = adjustments.reduce((s, a) => s + a.minutes, 0);
  const utilization = computeUtilization(bank, adjustmentMinutes, consumed);
  const asOfMoment = input.cutoff ?? input.now;
  const status: HourBankStatus =
    bank.status === "OPEN" && bank.cycleEnd.getTime() <= asOfMoment.getTime() ? "CLOSED" : bank.status;
  const prepaid = bank.kind === "PREPAID";
  return {
    id: bank.id,
    kind: bank.kind,
    loadedAt: bank.cycleStart,
    validUntil: bank.cycleEnd,
    status,
    utilization,
    usedMinutes: prepaid ? bank.purchasedMinutes - utilization.remainingMinutes : utilization.consumedMinutes,
    cardTotalMinutes: prepaid ? bank.purchasedMinutes : utilization.totalMinutes,
    adjustments,
  };
}

/// Pure: the whole statement from rows already fetched.
export function buildHourBankStatement(input: StatementInput): HourBankStatement {
  const active = pickBank(input.banks, input.cutoff, input.now);
  if (!active) return { active: null, previous: [], newPackageLoadedSince: input.since ? false : null };

  const previous = input.banks
    .filter((b) => b.cycleStart.getTime() < active.cycleStart.getTime())
    .sort((a, b) => b.cycleStart.getTime() - a.cycleStart.getTime())
    .map((b) => figuresFor(b, input));

  const c = input.cutoff?.getTime() ?? Infinity;
  const newPackageLoadedSince = input.since
    ? input.banks.some((b) => b.cycleStart.getTime() >= input.since!.getTime() && b.cycleStart.getTime() < c)
    : null;

  return { active: figuresFor(active, input), previous, newPackageLoadedSince };
}

/// "YYYY-MM-DD" to the exclusive end of that day in Israel. Undefined for
/// anything else.
export function asOfCutoff(asOf: string): Date | undefined {
  const end = dayEndInZone(asOf);
  return end ? new Date(end.getTime() + 1) : undefined;
}

/// Loads one client's rows and builds the statement. Writes nothing.
export async function getHourBankStatement(
  clientId: string,
  opts: { cutoff: Date | null; since?: Date | null; now?: Date }
): Promise<HourBankStatement> {
  const now = opts.now ?? new Date();
  const banks = await prisma.hourBank.findMany({
    where: { clientId, deletedAt: null, ...(opts.cutoff ? { cycleStart: { lt: opts.cutoff } } : {}) },
    select: {
      id: true,
      kind: true,
      cycleStart: true,
      cycleEnd: true,
      purchasedMinutes: true,
      rolloverInMinutes: true,
      status: true,
    },
  });
  if (banks.length === 0) {
    return { active: null, previous: [], newPackageLoadedSince: opts.since ? false : null };
  }
  const from = new Date(Math.min(...banks.map((b) => b.cycleStart.getTime())));
  const to = opts.cutoff ?? new Date(Math.max(...banks.map((b) => b.cycleEnd.getTime())));

  const [adjustments, policy, entries] = await Promise.all([
    prisma.hourBankAdjustment.findMany({
      where: { hourBankId: { in: banks.map((b) => b.id) } },
      select: { id: true, hourBankId: true, minutes: true, reason: true, effectiveAt: true },
    }),
    prisma.billingPolicy.findUnique({ where: { clientId } }),
    prisma.timeEntry.findMany({
      where: { clientId, deletedAt: null, endAt: { not: null }, startAt: { gte: from, lt: to } },
      select: { actualSeconds: true, billableSeconds: true, taskId: true, startAt: true },
    }),
  ]);

  return buildHourBankStatement({
    banks,
    adjustments,
    entries,
    policy,
    cutoff: opts.cutoff,
    since: opts.since ?? null,
    now,
  });
}
