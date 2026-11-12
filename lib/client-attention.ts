// The clients screen, 3.11.2026 (Ariel): every client in one grid, the
// ones that need attention first, each card saying why in one sentence.
//
// This file decides what "needs attention" means. It is pure, so the rules
// are tested without a database, and the screen only renders its answer.
// The thresholds are named below so the line the screen prints about them
// and the rules themselves cannot drift apart.

import { bankFigures, formatDecimalHours, packageFigures } from "@/lib/hours-format";

/// Less than this share of the bank left needs attention.
export const LOW_REMAINING_SHARE = 0.4;
/// A cycle's pace is not judged before this many days into it: in the
/// first days every client looks fast.
export const PACE_MIN_DAYS = 7;
/// Using this many times the expected hours by now is too fast.
export const PACE_RATIO = 1.5;
/// A prepaid package forecast to run out within this many days.
export const PACKAGE_ENDING_DAYS = 21;

const DAY_MS = 86_400_000;

export type BankKind = "CYCLE" | "PREPAID";

export type BankState = {
  kind: BankKind;
  cycleStart: Date;
  cycleEnd: Date;
  purchasedMinutes: number;
  rolloverInMinutes: number;
  totalMinutes: number;
  consumedMinutes: number;
  remainingMinutes: number;
  utilizationPct: number;
};

/// A cycle or package that came before the current one.
export type PastBank = {
  kind: BankKind;
  purchasedMinutes: number;
  totalMinutes: number;
  consumedMinutes: number;
  remainingMinutes: number;
};

export type Forecast =
  | { status: "depleted" }
  | { status: "insufficient_data" }
  | { status: "projected"; depletionDate: Date; daysLeft: number };

export type Tone = "bad" | "warn" | "ok";

/// A reason as a key under `clients.list.reasons` and its values. Hours
/// are already formatted (decimal hours, as the bank screen shows them);
/// `date` is a Date the screen formats.
export type ReasonCode = {
  key:
    | "bankEmpty"
    | "bankOverdrawn"
    | "previousOverrun"
    | "lowRemaining"
    | "lowRemainingRenews"
    | "pace"
    | "packageEnding"
    | "rolloverIn"
    | "rolloverDebt";
  values: Record<string, string | number | Date>;
};
type Reason = { text: string; code: ReasonCode };

export type Assessment = {
  attention: boolean;
  tone: Tone;
  /// One or two sentences, worst first. Empty when there is nothing to say.
  reasons: string[];
  /// ADR 0006: the same sentences as keys and values, in the same order,
  /// for a screen that words them in the reader's language. `reasons`
  /// stays as it was for everything that reads it.
  reasonCodes: ReasonCode[];
  /// How far through its cycle the bank is, 0 to 100, for the mark on the
  /// bar. Null for a prepaid package, which has no date it renews on.
  expectedPct: number | null;
  /// Overran its previous cycle (a monthly cycle, not a package).
  previousOverrun: boolean;
  /// A package forecast to run out within PACKAGE_ENDING_DAYS.
  endingSoon: boolean;
};

/// The three figures a card shows. A cycle is read against everything in
/// it; a package against the hours bought in this load (hour-banks.ts).
export function bankDisplay(bank: Pick<BankState, "kind" | "purchasedMinutes" | "totalMinutes" | "consumedMinutes" | "remainingMinutes">) {
  if (bank.kind === "PREPAID") {
    return { ...packageFigures(bank.purchasedMinutes, bank.remainingMinutes), sizeMinutes: bank.purchasedMinutes, usedMinutes: bank.purchasedMinutes - bank.remainingMinutes };
  }
  return { ...bankFigures(bank.totalMinutes, bank.consumedMinutes), sizeMinutes: bank.totalMinutes, usedMinutes: bank.consumedMinutes };
}

export function elapsedShare(start: Date, end: Date, now: Date): number {
  const span = end.getTime() - start.getTime();
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / span));
}

function shortDate(d: Date): string {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" }).format(d);
}

function hours(minutes: number): string {
  return formatDecimalHours(Math.abs(minutes));
}

export function assessClient(input: { bank: BankState; previous: PastBank | null; forecast: Forecast | null; now: Date }): Assessment {
  const { bank, previous, forecast, now } = input;
  const bad: Reason[] = [];
  const warn: Reason[] = [];
  const shown = bankDisplay(bank);

  // A cycle's end is the first moment of the next one.
  const isCycle = bank.kind === "CYCLE";
  const share = elapsedShare(bank.cycleStart, bank.cycleEnd, now);
  const expectedPct = isCycle ? Math.round(share * 1000) / 10 : null;

  if (bank.remainingMinutes <= 0) {
    bad.push(
      bank.remainingMinutes < 0
        ? { text: `הבנק נגמר, חריגה של ${hours(bank.remainingMinutes)} שעות.`, code: { key: "bankOverdrawn", values: { hours: hours(bank.remainingMinutes) } } }
        : { text: "הבנק נגמר.", code: { key: "bankEmpty", values: {} } }
    );
  }

  // A package's overrun is taken off the next package by design, so only
  // a monthly cycle that overran is news.
  const previousOverrun = !!previous && previous.kind === "CYCLE" && previous.remainingMinutes < 0;
  if (previous && previousOverrun) {
    bad.push({
      text: `במחזור הקודם חרג ב-${hours(previous.remainingMinutes)} שעות (${formatDecimalHours(previous.consumedMinutes)} מתוך ${formatDecimalHours(previous.totalMinutes)}).`,
      code: {
        key: "previousOverrun",
        values: { hours: hours(previous.remainingMinutes), used: formatDecimalHours(previous.consumedMinutes), total: formatDecimalHours(previous.totalMinutes) },
      },
    });
  }

  if (bank.remainingMinutes > 0 && shown.sizeMinutes > 0 && bank.remainingMinutes / shown.sizeMinutes < LOW_REMAINING_SHARE) {
    const pct = Math.round((bank.remainingMinutes / shown.sizeMinutes) * 100);
    const renews = isCycle ? Math.max(0, Math.ceil((bank.cycleEnd.getTime() - now.getTime()) / DAY_MS)) : null;
    warn.push({
      text: `נותרו ${hours(bank.remainingMinutes)} שעות, ${pct}% מהבנק${renews !== null ? `, ועוד ${renews === 1 ? "יום אחד" : `${renews} ימים`} עד החידוש` : ""}.`,
      code:
        renews !== null
          ? { key: "lowRemainingRenews", values: { hours: hours(bank.remainingMinutes), pct, days: renews } }
          : { key: "lowRemaining", values: { hours: hours(bank.remainingMinutes), pct } },
    });
  }

  if (isCycle && bank.remainingMinutes > 0) {
    const daysIn = (now.getTime() - bank.cycleStart.getTime()) / DAY_MS;
    const expected = Math.max(0, bank.totalMinutes) * share;
    if (daysIn >= PACE_MIN_DAYS && expected > 0) {
      const ratio = bank.consumedMinutes / expected;
      const times = String(Math.round(ratio * 10) / 10);
      if (ratio >= PACE_RATIO) warn.push({ text: `מנצל בקצב גבוה פי ${times} מהצפוי.`, code: { key: "pace", values: { ratio: times } } });
    }
  }

  const endingSoon = bank.kind === "PREPAID" && forecast?.status === "projected" && forecast.daysLeft <= PACKAGE_ENDING_DAYS && bank.remainingMinutes > 0;
  if (endingSoon && forecast?.status === "projected") {
    warn.push({
      text: `בקצב של 4 השבועות האחרונים החבילה תיגמר בסביבות ${shortDate(forecast.depletionDate)}.`,
      code: { key: "packageEnding", values: { date: forecast.depletionDate } },
    });
  }

  if (bad.length + warn.length > 0) {
    const picked = [...bad, ...warn].slice(0, 2);
    return {
      attention: true,
      tone: bad.length ? "bad" : "warn",
      reasons: picked.map((r) => r.text),
      reasonCodes: picked.map((r) => r.code),
      expectedPct,
      previousOverrun,
      endingSoon,
    };
  }

  const ok: Reason[] = [];
  if (bank.rolloverInMinutes > 0) {
    ok.push({ text: `כולל ${hours(bank.rolloverInMinutes)} שעות שהועברו מהמחזור הקודם.`, code: { key: "rolloverIn", values: { hours: hours(bank.rolloverInMinutes) } } });
  } else if (bank.rolloverInMinutes < 0) {
    ok.push({ text: `כולל חוב של ${hours(bank.rolloverInMinutes)} שעות מהחבילה הקודמת.`, code: { key: "rolloverDebt", values: { hours: hours(bank.rolloverInMinutes) } } });
  }
  return { attention: false, tone: "ok", reasons: ok.map((r) => r.text), reasonCodes: ok.map((r) => r.code), expectedPct, previousOverrun, endingSoon };
}

/// The order of the grid: needs attention (the worst first), on track,
/// no bank. Names break ties, as the list was sorted before.
export function attentionRank(a: { attention: boolean; tone: Tone } | null): number {
  if (!a) return 3;
  if (!a.attention) return 2;
  return a.tone === "bad" ? 0 : 1;
}
