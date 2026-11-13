import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addProcess, approveProcessVersion, linkProcessDates, listProcesses, saveProcessVersion } from "@/lib/app-domain/processes";
import { getProcessRhythm, previewProcessRhythm, saveProcessRhythm } from "@/lib/app-domain/process-rhythm";
import { computeNextOccurrence } from "@/lib/app-domain/important-dates-recurrence";
import { emptyRule, type ScheduleRule } from "@/lib/process-rhythm";

// The rhythm of a process, stored (13.11.2026, processes redesign, stage 1).
// What is worth holding: the dates a schedule needs are made from its rule
// and replaced when it changes; dates someone linked before are unlinked,
// never deleted; the process's trigger kinds and sentence follow the rhythm;
// and the backfill gives every existing process the starts it said.

const S1 = [{ code: "S1" }];

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
  await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  const p = await addProcess(hadas, { clientId: client.id, title: "תשלומי ספקים", ownerId: hadas.id, sources: S1 });
  return { client, hadas, ariel, p };
}

const monthly = (days: number[]): ScheduleRule => ({ ...emptyRule("MONTHLY"), monthDays: days });

describe("process rhythm", () => {
  it("makes a schedule's dates from its rule, and says it in one sentence", async () => {
    const { client, hadas, p } = await setup();
    await saveProcessRhythm(hadas, p.id, [{ kind: "SCHEDULE", schedule: monthly([10, 25]) }, { kind: "EVENT", description: "ספק חדש" }], "הקובץ נשלח שני ימי עסקים לפני");
    const dates = await prisma.importantDate.findMany({ where: { processId: p.id, deletedAt: null }, orderBy: { day: "asc" } });
    expect(dates.map((d) => [d.recurrence, d.day, d.rollConvention, d.responsibleUserId])).toEqual([
      ["MONTHLY", 10, "PREVIOUS_BUSINESS_DAY", hadas.id],
      ["MONTHLY", 25, "PREVIOUS_BUSINESS_DAY", hadas.id],
    ]);
    expect(dates.every((d) => d.processStartId)).toBe(true);
    const process = await prisma.process.findUniqueOrThrow({ where: { id: p.id } });
    expect(process.triggerKinds).toEqual(["SCHEDULED", "EVENT"]);
    expect(process.triggerText).toBe("פעמיים בחודש, ב-10 וב-25. בסוף שבוע או חג: יום העסקים שלפני. כשמשהו קורה: ספק חדש.");
    expect(process.triggerNotes).toBe("הקובץ נשלח שני ימי עסקים לפני");
    const [listed] = await listProcesses(hadas, client.id);
    expect(listed.rhythm).toBe(process.triggerText);
    expect(listed.nextDate).not.toBeNull();
    const audit = await prisma.auditEvent.findMany({ where: { entityId: p.id, action: "process.rhythm" } });
    expect(audit).toHaveLength(1);
  });

  it("replaces a schedule's dates when its rule changes, and keeps them when it does not", async () => {
    const { hadas, p } = await setup();
    await saveProcessRhythm(hadas, p.id, [{ kind: "SCHEDULE", schedule: monthly([10]) }]);
    const first = await prisma.importantDate.findFirstOrThrow({ where: { processId: p.id, deletedAt: null } });
    await saveProcessRhythm(hadas, p.id, [{ kind: "SCHEDULE", schedule: monthly([10]) }]);
    expect((await prisma.importantDate.findFirstOrThrow({ where: { processId: p.id, deletedAt: null } })).id).toBe(first.id);
    await saveProcessRhythm(hadas, p.id, [{ kind: "SCHEDULE", schedule: { ...emptyRule("WEEKLY"), weekdays: [4] } }]);
    const now = await prisma.importantDate.findMany({ where: { processId: p.id, deletedAt: null } });
    expect(now.map((d) => [d.recurrence, d.weekday])).toEqual([["WEEKLY", 4]]);
    expect((await prisma.importantDate.findUniqueOrThrow({ where: { id: first.id } })).deletedAt).not.toBeNull();
    // Taken off altogether: the schedule's dates go with it.
    await saveProcessRhythm(hadas, p.id, [{ kind: "ON_DEMAND" }]);
    expect(await prisma.importantDate.count({ where: { processId: p.id, deletedAt: null } })).toBe(0);
    expect((await prisma.process.findUniqueOrThrow({ where: { id: p.id } })).triggerKinds).toEqual(["ON_DEMAND"]);
  });

  it("unlinks dates someone linked before, and never deletes them", async () => {
    const { client, hadas, p } = await setup();
    const own = await prisma.importantDate.create({
      data: { clientId: client.id, title: "פעימת 10", type: "custom", category: "BUSINESS_FINANCE", month: 1, day: 10, recurrence: "MONTHLY", responsibleUserId: hadas.id },
    });
    await linkProcessDates(hadas, p.id, [own.id]);
    const rhythm = await getProcessRhythm(hadas, p.id);
    expect(rhythm.starts.map((s) => [s.kind, s.legacy])).toEqual([["SCHEDULE", true]]);
    expect(rhythm.sentence).toBe("פעם בחודש, ב-10.");
    // Kept as it is.
    await saveProcessRhythm(hadas, p.id, [{ kind: "SCHEDULE", schedule: null }]);
    expect((await prisma.importantDate.findUniqueOrThrow({ where: { id: own.id } })).processId).toBe(p.id);
    // Replaced by a rule: unlinked, still in the client's dates.
    await saveProcessRhythm(hadas, p.id, [{ kind: "SCHEDULE", schedule: monthly([1]) }]);
    const after = await prisma.importantDate.findUniqueOrThrow({ where: { id: own.id } });
    expect([after.processId, after.deletedAt]).toEqual([null, null]);
  });

  it("refuses what is not a rhythm, and keeping a schedule that was never legacy", async () => {
    const { hadas, p } = await setup();
    await expect(saveProcessRhythm(hadas, p.id, [])).rejects.toThrow("לפחות דבר אחד");
    await expect(saveProcessRhythm(hadas, p.id, [{ kind: "CONTINUOUS", checkEveryDays: null, checkText: null }])).rejects.toThrow("כל כמה ימים");
    await expect(saveProcessRhythm(hadas, p.id, [{ kind: "SCHEDULE", schedule: null }])).rejects.toThrow("כל כמה זמן");
    await expect(saveProcessRhythm(hadas, p.id, [{ kind: "EVENT", description: "password: hunter2" }])).rejects.toThrow("בכספת");
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(saveProcessRhythm(stranger, p.id, [{ kind: "ON_DEMAND" }])).rejects.toThrow();
  });

  it("an ongoing check and an external run are what readiness and the routine read", async () => {
    const { hadas, p } = await setup();
    await saveProcessRhythm(hadas, p.id, [{ kind: "CONTINUOUS", checkEveryDays: 7, checkText: "אין חשבונית תקועה" }]);
    let row = await prisma.process.findUniqueOrThrow({ where: { id: p.id } });
    expect([row.triggerKinds, row.checkEveryDays, row.checkText]).toEqual([["CONTINUOUS"], 7, "אין חשבונית תקועה"]);
    await saveProcessRhythm(hadas, p.id, [{ kind: "EXTERNAL", where: "משימה מתוזמנת של Claude", when: "כל יום ב-07:40", recipient: null }]);
    row = await prisma.process.findUniqueOrThrow({ where: { id: p.id } });
    expect([row.triggerKinds, row.checkEveryDays]).toEqual([["EXTERNAL"], null]);
  });

  it("previews the next dates, the day the run opens, and the day a roll moved", async () => {
    const { hadas, ariel, p } = await setup();
    await saveProcessVersion(hadas, p.id, { steps: [{ title: "שליחת הקובץ", offsetBusinessDays: -2 }, { title: "אישור" }], baseVersion: 0 });
    await approveProcessVersion(ariel, p.id, 1);
    // Friday 13.11.2026, noon in Israel.
    const rows = await previewProcessRhythm(hadas, p.id, monthly([10, 25]), 5, new Date("2026-11-13T10:00:00Z"));
    expect(rows).toEqual([
      { date: "2026-11-25", opens: "2026-11-22", movedFrom: null },
      { date: "2026-12-10", opens: "2026-12-07", movedFrom: null },
      // Friday 25.12 moves to Thursday 24.12.
      { date: "2026-12-24", opens: "2026-12-21", movedFrom: "2026-12-25" },
      { date: "2027-01-10", opens: "2027-01-05", movedFrom: null },
      { date: "2027-01-25", opens: "2027-01-20", movedFrom: null },
    ]);
  });

  it("a process Claude proposes with trigger kinds gets those starts", async () => {
    const { client, hadas } = await setup();
    const q = await addProcess(hadas, { clientId: client.id, title: "קליטת עובד", triggerKinds: ["EVENT", "ON_DEMAND"], triggerText: "עובד חדש", sources: S1 });
    const starts = await prisma.processStart.findMany({ where: { processId: q.id }, orderBy: { sortOrder: "asc" } });
    expect(starts.map((s) => [s.kind, s.description])).toEqual([
      ["EVENT", "עובד חדש"],
      ["ON_DEMAND", null],
    ]);
  });

  it("a daily date falls every day, weekends included", () => {
    const next = computeNextOccurrence({ calendarType: "GREGORIAN", month: 1, day: 1, recurrence: "DAILY" }, new Date("2026-11-13T10:00:00Z"));
    // Friday 13.11.2026 in Israel: today, a Friday, not Sunday.
    expect(next?.toISOString()).toBe("2026-11-12T22:00:00.000Z");
  });
});

describe("the backfill migration", () => {
  it("gives every process the starts its kinds said, and Ariel's four their own", async () => {
    const client = await createTestClient({ name: "Grantor" });
    const { user: owner } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const mk = (id: string, seq: number, kinds: string[], extra: Record<string, unknown> = {}) =>
      prisma.process.create({ data: { id, clientId: client.id, seq, code: `P${seq}`, title: `T${seq}`, triggerKinds: kinds as never, triggerText: `text ${seq}`, ownerId: owner.id, ...extra } });
    await mk("proc_sched", 1, ["SCHEDULED", "EVENT"]);
    await mk("proc_cont", 2, ["CONTINUOUS"], { checkEveryDays: 7, checkText: "x" });
    await mk("cmw100voi000bk108j24crz2b", 3, ["CONTINUOUS"]);
    await mk("cmw0jwz0a000dl80830b3ixwc", 4, ["CONTINUOUS"]);
    await mk("cmw0nz2fa0001l3080zqbebge", 5, ["CONTINUOUS"]);
    const date = await prisma.importantDate.create({
      data: { clientId: client.id, title: "פעימת 10", type: "custom", category: "BUSINESS_FINANCE", month: 1, day: 10, recurrence: "MONTHLY", responsibleUserId: owner.id, processId: "proc_sched" },
    });

    const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261113200100_process_starts_backfill/migration.sql"), "utf8");
    const statements = sql
      .split(/;\s*\n/)
      .map((x) => x.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean);
    for (const statement of statements) await prisma.$executeRawUnsafe(statement);
    // A second run adds nothing.
    for (const statement of statements) await prisma.$executeRawUnsafe(statement);

    const starts = await prisma.processStart.findMany({ orderBy: [{ processId: "asc" }, { sortOrder: "asc" }] });
    expect(starts.map((s) => [s.processId, s.kind])).toEqual([
      ["cmw0jwz0a000dl80830b3ixwc", "EXTERNAL"],
      ["cmw0nz2fa0001l3080zqbebge", "CONTINUOUS"],
      ["cmw100voi000bk108j24crz2b", "SCHEDULE"],
      ["proc_cont", "CONTINUOUS"],
      ["proc_sched", "SCHEDULE"],
      ["proc_sched", "EVENT"],
    ]);
    expect((await prisma.importantDate.findUniqueOrThrow({ where: { id: date.id } })).processStartId).toBe("pss_proc_sched");
    expect(starts.find((s) => s.processId === "proc_cont")?.checkEveryDays).toBe(7);
    expect(starts.find((s) => s.processId === "proc_sched" && s.kind === "EVENT")?.description).toBe("text 1");
    // Grantor P7: a business-daily date of its own, its kinds now a schedule.
    const daily = await prisma.importantDate.findFirstOrThrow({ where: { processId: "cmw100voi000bk108j24crz2b" } });
    expect([daily.recurrence, daily.responsibleUserId, daily.processStartId]).toEqual(["BUSINESS_DAILY", owner.id, "pss_cmw100voi000bk108j24crz2b"]);
    const kinds = await prisma.process.findMany({ where: { clientId: client.id }, orderBy: { seq: "asc" }, select: { triggerKinds: true, triggerNotes: true } });
    expect(kinds.map((k) => k.triggerKinds)).toEqual([["SCHEDULED", "EVENT"], ["CONTINUOUS"], ["SCHEDULED"], ["EXTERNAL"], ["CONTINUOUS"]]);
    expect(kinds.every((k) => k.triggerNotes?.startsWith("text "))).toBe(true);
  });
});
