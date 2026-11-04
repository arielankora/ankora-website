import { beforeEach, describe, expect, it, vi } from "vitest";
import { localDateTimeToUtc } from "@/lib/timezone";

// 3.11.2026, Ariel: "לא רושמים בחבילה סגורה". How time-entries.ts and
// hour-banks.ts enforce the rule, with Prisma mocked. The RIMED case:
// the package from 11.10 closed on 2.11 at 18:00, when the next one was
// loaded, and a manual entry for 2.11 01:00 created afterwards fell in it.

const il = (day: string, time = "00:00") => localDateTimeToUtc(day, time);

const CLOSED = {
  id: "old",
  kind: "PREPAID",
  cycleStart: il("2026-10-11", "10:00"),
  cycleEnd: il("2026-11-02", "18:00"),
  status: "CLOSED",
};
const OPEN = {
  id: "new",
  kind: "PREPAID",
  cycleStart: il("2026-11-02", "18:00"),
  cycleEnd: il("2027-11-02", "18:00"),
  status: "OPEN",
  createdAt: il("2026-11-02", "18:00"),
};

const db = vi.hoisted(() => ({
  hourBank: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
  timeEntry: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  timeEntryRevision: { findFirst: vi.fn(), create: vi.fn() },
  client: { findUniqueOrThrow: vi.fn() },
  category: { findUniqueOrThrow: vi.fn() },
  task: { findFirst: vi.fn() },
  userClientAccess: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const recordAudit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/app-auth/audit", () => ({ recordAudit }));
vi.mock("@/lib/app-domain/billing", () => ({ computeEntryBillableSeconds: vi.fn(async (_c: string, s: number) => s) }));
vi.mock("@/lib/app-domain/alerts", () => ({ evaluateAlertsForClient: vi.fn(async () => {}) }));
vi.mock("@/lib/after-response", () => ({ afterResponse: vi.fn(async () => {}) }));

const { createManualEntry, updateTimeEntry, deleteTimeEntry, closedBankForStoppedEntry, moveEntryIntoOpenBank } =
  await import("@/lib/app-domain/time-entries");
const { ClosedBankError, ClosedBankOverrideReasonRequiredError, RunningTimersOnClientError } = await import(
  "@/lib/app-domain/closed-bank-guard"
);
const { loadPrepaidPackage } = await import("@/lib/app-domain/hour-banks");

const ADMIN = { id: "u-admin", role: "SUPER_ADMIN" } as never;
const EMPLOYEE = { id: "u-emp", role: "ANKORA_EMPLOYEE" } as never;

const manual = (over: Record<string, unknown> = {}) => ({
  clientId: "rimed",
  categoryId: "cat",
  startAt: il("2026-11-02", "01:00"),
  endAt: il("2026-11-02", "01:25"),
  note: "מעקב יומי",
  backdateReason: "נרשם באיחור",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(il("2026-11-03", "20:00"));
  db.hourBank.findMany.mockResolvedValue([OPEN, CLOSED]);
  db.hourBank.findUnique.mockResolvedValue({ createdAt: OPEN.createdAt });
  db.client.findUniqueOrThrow.mockResolvedValue({ id: "rimed", status: "ACTIVE" });
  db.category.findUniqueOrThrow.mockResolvedValue({ id: "cat", active: true, visibility: "GLOBAL", clientId: null });
  db.userClientAccess.findUnique.mockResolvedValue({ userId: "u-emp", clientId: "rimed" });
  db.timeEntry.findFirst.mockResolvedValue(null);
  db.timeEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "e-new", ...data }));
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  db.timeEntryRevision.findFirst.mockResolvedValue(null);
});

describe("a new entry in a closed bank", () => {
  it("is refused, nothing is written, and the employee is offered the open package", async () => {
    const err = await createManualEntry(EMPLOYEE, "u-emp", manual()).catch((e) => e);
    expect(err).toBeInstanceOf(ClosedBankError);
    expect(err.canMoveToOpen).toBe(true);
    expect(err.canOverride).toBe(false);
    expect(db.timeEntry.create).not.toHaveBeenCalled();
  });

  it("with intoOpenBank, lands at the moment the open package opened, same length, with the note line", async () => {
    await createManualEntry(EMPLOYEE, "u-emp", manual({ intoOpenBank: true }));
    const data = db.timeEntry.create.mock.calls[0][0].data;
    expect(data.startAt.toISOString()).toBe(OPEN.cycleStart.toISOString());
    expect(data.endAt.getTime() - data.startAt.getTime()).toBe(25 * 60_000);
    expect(data.note).toBe("מעקב יומי\nעבודה מ-2.11.2026, נרשמה אחרי סגירת החבילה ב-2.11.2026");
    expect(db.hourBank.update).not.toHaveBeenCalled();
  });

  it("an employee cannot override; a manager can, only with a reason, and it is audited and flagged", async () => {
    await expect(
      createManualEntry(EMPLOYEE, "u-emp", manual({ closedBankOverride: { reason: "תיקון" } }))
    ).rejects.toBeInstanceOf(ClosedBankError);

    await expect(
      createManualEntry(ADMIN, "u-emp", manual({ closedBankOverride: { reason: "  " } }))
    ).rejects.toBeInstanceOf(ClosedBankOverrideReasonRequiredError);

    await createManualEntry(ADMIN, "u-emp", manual({ closedBankOverride: { reason: "חיוב מוסכם עם הלקוח" } }));
    expect(db.timeEntry.create.mock.calls[0][0].data.startAt.toISOString()).toBe(il("2026-11-02", "01:00").toISOString());
    expect(db.hourBank.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "old" }, data: expect.objectContaining({ status: "RECALCULATED" }) })
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "hour_bank.closed_override",
        after: { hourBankId: "old", operation: "create", reason: "חיוב מוסכם עם הלקוח" },
      })
    );
  });

  it("time in the open package goes through untouched", async () => {
    await createManualEntry(EMPLOYEE, "u-emp", manual({ startAt: il("2026-11-03", "09:00"), endAt: il("2026-11-03", "09:30") }));
    expect(db.timeEntry.create.mock.calls[0][0].data.startAt.toISOString()).toBe(il("2026-11-03", "09:00").toISOString());
  });
});

describe("changing an entry in a closed bank", () => {
  const stored = {
    id: "e1",
    userId: "u-emp",
    clientId: "rimed",
    categoryId: "cat",
    taskId: null,
    startAt: il("2026-11-02", "01:00"),
    endAt: il("2026-11-02", "01:25"),
    note: "מעקב יומי",
    actualSeconds: 1500,
    billableSeconds: 1500,
    updatedAt: il("2026-11-02", "19:00"),
    deletedAt: null,
    isOverlapConfirmed: false,
  };

  it("an edit is refused, even one that moves it out to the open bank, unless a manager overrides", async () => {
    db.timeEntry.findUniqueOrThrow.mockResolvedValue(stored);
    await expect(
      updateTimeEntry(ADMIN, "e1", { startAt: il("2026-11-02", "19:00"), endAt: il("2026-11-02", "19:25") })
    ).rejects.toMatchObject({ name: "ClosedBankError", canOverride: true });
    expect(db.timeEntry.update).not.toHaveBeenCalled();

    db.timeEntry.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...stored, ...data }));
    await updateTimeEntry(ADMIN, "e1", {
      startAt: il("2026-11-02", "19:00"),
      endAt: il("2026-11-02", "19:25"),
      closedBankOverride: { reason: "העברה לחבילה החדשה באישור Ariel" },
    });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "hour_bank.closed_override" }));
  });

  it("an edit cannot move an open-bank entry into the closed bank either", async () => {
    db.timeEntry.findUniqueOrThrow.mockResolvedValue({ ...stored, startAt: il("2026-11-03", "09:00"), endAt: il("2026-11-03", "09:25") });
    await expect(
      updateTimeEntry(EMPLOYEE, "e1", { startAt: il("2026-11-02", "09:00"), endAt: il("2026-11-02", "09:25") })
    ).rejects.toMatchObject({ name: "ClosedBankError", canOverride: false });
  });

  it("a delete is refused; discarding a running timer is not", async () => {
    db.timeEntry.findUniqueOrThrow.mockResolvedValue(stored);
    await expect(deleteTimeEntry(EMPLOYEE, "e1")).rejects.toBeInstanceOf(ClosedBankError);

    db.timeEntry.findUniqueOrThrow.mockResolvedValue({ ...stored, endAt: null });
    db.timeEntry.update.mockResolvedValue({ ...stored, deletedAt: new Date() });
    await expect(deleteTimeEntry(EMPLOYEE, "e1")).resolves.toBeTruthy();
  });
});

describe("a timer that ran across the closing", () => {
  const crossed = {
    id: "t1",
    userId: "u-emp",
    clientId: "rimed",
    startAt: il("2026-11-02", "17:40"),
    endAt: il("2026-11-02", "18:10"),
    note: "שיחה עם יוסי",
    deletedAt: null,
    isOverlapConfirmed: false,
  };

  it("is recognised only if it stopped after the closing, and the open bank existed by then", async () => {
    expect(await closedBankForStoppedEntry(crossed)).not.toBeNull();
    expect(await closedBankForStoppedEntry({ ...crossed, endAt: il("2026-11-02", "17:55") })).toBeNull();
    db.hourBank.findUnique.mockResolvedValue({ createdAt: il("2026-11-02", "18:30") });
    expect(await closedBankForStoppedEntry(crossed)).toBeNull();
  });

  it("moves into the open bank on request, keeping its 30 minutes", async () => {
    db.timeEntry.findUniqueOrThrow.mockResolvedValue(crossed);
    db.timeEntry.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...crossed, ...data }));
    const moved = await moveEntryIntoOpenBank(EMPLOYEE, "t1");
    expect(moved.startAt.toISOString()).toBe(OPEN.cycleStart.toISOString());
    expect((moved.endAt as Date).getTime() - moved.startAt.getTime()).toBe(30 * 60_000);
    expect(moved.note).toContain("נרשמה אחרי סגירת החבילה ב-2.11.2026");
    expect(db.timeEntryRevision.create).toHaveBeenCalled();
  });

  it("an ordinary entry in the closed bank cannot be moved this way", async () => {
    db.timeEntry.findUniqueOrThrow.mockResolvedValue({ ...crossed, endAt: il("2026-11-02", "17:55") });
    await expect(moveEntryIntoOpenBank(EMPLOYEE, "t1")).rejects.toThrow("לא רץ בזמן");
  });
});

describe("loading a package waits for the client's running timers", () => {
  it("is refused while a timer runs on the client, naming who runs it", async () => {
    db.timeEntry.findMany.mockResolvedValue([{ startAt: il("2026-11-03", "19:30"), user: { name: "Hadas Vinogura" } }]);
    const err = await loadPrepaidPackage(ADMIN, "rimed", { startAt: il("2026-11-03", "19:50"), purchasedMinutes: 1800 }).catch(
      (e) => e
    );
    expect(err).toBeInstanceOf(RunningTimersOnClientError);
    expect(err.message).toContain("Hadas Vinogura");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
