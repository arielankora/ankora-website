import { describe, expect, it } from "vitest";
import {
  appendNoteLine,
  bankContaining,
  canOverrideClosedBank,
  ClosedBankError,
  closedBankHit,
  closedBankMessage,
  isBankClosed,
  movedEntryNoteLine,
  movedRange,
  openBankAt,
  RunningTimersOnClientError,
  stoppedAcrossClosureMessage,
  type GuardBank,
} from "@/lib/app-domain/closed-bank-guard";
import { localDateTimeToUtc } from "@/lib/timezone";

// 3.11.2026, Ariel: "לא רושמים בחבילה סגורה". Pure functions only; the
// enforcement in time-entries.ts has its own test file.

const il = (day: string, time = "00:00") => localDateTimeToUtc(day, time);

// RIMED as it stood on 3.11.2026: the package from 11.10 closed when the
// next one was loaded on 2.11 at 18:00.
const closed: GuardBank = {
  id: "old",
  kind: "PREPAID",
  cycleStart: il("2026-10-11", "10:00"),
  cycleEnd: il("2026-11-02", "18:00"),
  status: "CLOSED",
};
const open: GuardBank = {
  id: "new",
  kind: "PREPAID",
  cycleStart: il("2026-11-02", "18:00"),
  cycleEnd: il("2027-11-02", "18:00"),
  status: "OPEN",
};
const banks = [open, closed];
const now = il("2026-11-03", "20:00");

describe("which bank is closed", () => {
  it("a bank marked CLOSED or RECALCULATED is closed", () => {
    expect(isBankClosed(closed, now)).toBe(true);
    expect(isBankClosed({ ...closed, status: "RECALCULATED" }, now)).toBe(true);
  });

  it("an OPEN bank past its end is closed, even before a screen flips it", () => {
    expect(isBankClosed({ status: "OPEN", cycleEnd: il("2026-11-01") }, now)).toBe(true);
    expect(isBankClosed(open, now)).toBe(false);
  });

  it("an instant belongs to the bank whose half-open range holds it", () => {
    expect(bankContaining(banks, il("2026-11-02", "01:00"))?.id).toBe("old");
    expect(bankContaining(banks, il("2026-11-02", "18:00"))?.id).toBe("new");
    expect(bankContaining(banks, il("2026-10-01"))).toBeNull();
    expect(openBankAt(banks, now)?.id).toBe("new");
  });
});

describe("closedBankHit", () => {
  it("the RIMED entry at 2.11 01:00 hits the closed package and names the open one", () => {
    const hit = closedBankHit(banks, il("2026-11-02", "01:00"), now);
    expect(hit?.closed.id).toBe("old");
    expect(hit?.open?.id).toBe("new");
  });

  it("time in the open bank, or in no bank at all, is not affected", () => {
    expect(closedBankHit(banks, il("2026-11-03", "09:00"), now)).toBeNull();
    expect(closedBankHit(banks, il("2026-09-01"), now)).toBeNull();
    expect(closedBankHit([], il("2026-11-02", "01:00"), now)).toBeNull();
  });

  it("with no open bank, the hit says so", () => {
    const hit = closedBankHit([closed], il("2026-11-02", "01:00"), now);
    expect(hit?.open).toBeNull();
    expect(closedBankMessage(hit!)).toContain("אין כרגע חבילה או מחזור פתוחים");
  });
});

describe("what the person reads", () => {
  const hit = closedBankHit(banks, il("2026-11-02", "01:00"), now)!;

  it("a new entry is offered the open package", () => {
    expect(closedBankMessage(hit)).toBe("החבילה מ-11.10.2026 נסגרה ב-2.11.2026. לרשום את הזמן בחבילה הפתוחה?");
  });

  it("a cycle reads as a cycle", () => {
    const cycles = closedBankHit(
      [
        { ...closed, kind: "CYCLE" },
        { ...open, kind: "CYCLE" },
      ],
      il("2026-11-02", "01:00"),
      now
    )!;
    expect(closedBankMessage(cycles)).toBe("המחזור מ-11.10.2026 נסגר ב-2.11.2026. לרשום את הזמן במחזור הפתוח?");
  });

  it("a change is refused, and only a new entry may move to the open bank", () => {
    const create = new ClosedBankError(hit, "create", false);
    const change = new ClosedBankError(hit, "change", true);
    expect(create.canMoveToOpen).toBe(true);
    expect(change.canMoveToOpen).toBe(false);
    expect(change.canOverride).toBe(true);
    expect(change.message).toBe("החבילה מ-11.10.2026 נסגרה ב-2.11.2026. אי אפשר לשנות רישום בחבילה או מחזור סגורים.");
    expect(change.name).toBe("ClosedBankError");
  });

  it("a stop across the closing asks whether to move it", () => {
    expect(stoppedAcrossClosureMessage(hit)).toContain("להעביר את הרישום לחבילה הפתוחה?");
  });

  it("running timers are named, with their start, and the load waits", () => {
    const err = new RunningTimersOnClientError([{ employeeName: "Hadas Vinogura", startAt: il("2026-11-02", "17:30") }]);
    expect(err.message).toContain("Hadas Vinogura");
    expect(err.message).toContain("17:30");
    expect(err.message).toContain("רק אחרי שהם נעצרים");
  });
});

describe("moving an entry into the open bank", () => {
  it("starts when the open bank opened and keeps its length", () => {
    const moved = movedRange(open, il("2026-11-02", "01:00"), il("2026-11-02", "01:25"));
    expect(moved.startAt.toISOString()).toBe(open.cycleStart.toISOString());
    expect(moved.endAt.getTime() - moved.startAt.getTime()).toBe(25 * 60_000);
  });

  it("the note says when the work was done, once", () => {
    const line = movedEntryNoteLine(il("2026-11-01", "23:00"), closed);
    expect(line).toBe("עבודה מ-1.11.2026, נרשמה אחרי סגירת החבילה ב-2.11.2026");
    expect(appendNoteLine("מעקב יומי", line)).toBe(`מעקב יומי\n${line}`);
    expect(appendNoteLine(`מעקב יומי\n${line}`, line)).toBe(`מעקב יומי\n${line}`);
    expect(appendNoteLine(null, line)).toBe(line);
  });
});

describe("who may override", () => {
  it("only SUPER_ADMIN and ANKORA_ADMIN", () => {
    expect(canOverrideClosedBank("SUPER_ADMIN")).toBe(true);
    expect(canOverrideClosedBank("ANKORA_ADMIN")).toBe(true);
    expect(canOverrideClosedBank("ANKORA_EMPLOYEE")).toBe(false);
    expect(canOverrideClosedBank("CLIENT_USER")).toBe(false);
  });
});
